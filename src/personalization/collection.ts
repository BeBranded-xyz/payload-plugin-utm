import type {
  Block,
  CollectionConfig,
  CollectionSlug,
  Config,
  Endpoint,
  Field,
  Where,
} from "payload";
import { utmParameters } from "../utilities.js";
import {
  audienceOperators,
  isValidAudienceKey,
  parseAudienceManifest,
} from "./match.js";

export type PersonalizationOptions = {
  /** Default `utm-audiences`. */
  audiencesSlug?: string;
  /** Block slugs that receive the visibility controls, or `'all'`. */
  blocks?: readonly string[] | "all";
  manifest?: {
    /** When set, the manifest requires `Authorization: Bearer <secret>`. */
    secret?: string;
    /** Allow `?tenant=<id>` on the manifest, filtered on this field (e.g. `tenant`). */
    tenantField?: string;
    /** Max audiences published, default 500. */
    limit?: number;
  };
  overrides?: (collection: CollectionConfig) => CollectionConfig;
};

const operatorLabels: Record<
  (typeof audienceOperators)[number],
  { en: string; fr: string }
> = {
  equals: { en: "is", fr: "est égal à" },
  notEquals: { en: "is not", fr: "est différent de" },
  in: {
    en: "is one of (comma-separated)",
    fr: "fait partie de (liste, virgules)",
  },
  contains: { en: "contains", fr: "contient" },
  startsWith: { en: "starts with", fr: "commence par" },
  exists: { en: "is present", fr: "est présent" },
};

export function personalizationField(
  audiencesSlug = "utm-audiences",
  name = "personalization",
): Field {
  return {
    name,
    type: "group",
    label: { en: "Personalization", fr: "Personnalisation" },
    admin: {
      description: {
        en: "Show or hide this block depending on the visitor's campaign audience.",
        fr: "Afficher ou masquer ce bloc selon l’audience de campagne du visiteur.",
      },
    },
    fields: [
      {
        name: "mode",
        type: "select",
        defaultValue: "all",
        required: true,
        label: { en: "Visible to", fr: "Visible pour" },
        options: [
          { label: { en: "Everyone", fr: "Tout le monde" }, value: "all" },
          {
            label: {
              en: "Only these audiences",
              fr: "Uniquement ces audiences",
            },
            value: "only",
          },
          {
            label: {
              en: "Everyone except these audiences",
              fr: "Tout le monde sauf ces audiences",
            },
            value: "except",
          },
        ],
      },
      {
        name: "audiences",
        type: "relationship",
        relationTo: audiencesSlug as CollectionSlug,
        hasMany: true,
        label: { en: "Audiences", fr: "Audiences" },
        admin: {
          condition: (_, sibling) =>
            Boolean(sibling?.mode && sibling.mode !== "all"),
        },
        validate: (
          value: unknown,
          { siblingData }: { siblingData?: unknown },
        ) => {
          const mode = (siblingData as { mode?: string } | undefined)?.mode;
          if (
            mode &&
            mode !== "all" &&
            (!Array.isArray(value) || !value.length)
          )
            return "Select at least one audience.";
          return true;
        },
      } as Field,
    ],
  };
}

/** Recursively add the personalization group to matching blocks. */
function withBlockFields(
  fields: Field[],
  apply: (block: Block) => Block,
): Field[] {
  return fields.map((field): Field => {
    if (field.type === "blocks")
      return {
        ...field,
        blocks: (field.blocks ?? []).map(apply),
        ...(field.blockReferences
          ? {
              blockReferences: field.blockReferences.map((ref) =>
                typeof ref === "string" ? ref : apply(ref),
              ),
            }
          : {}),
      } as Field;
    if (field.type === "tabs")
      return {
        ...field,
        tabs: field.tabs.map((tab) => ({
          ...tab,
          fields: withBlockFields(tab.fields, apply),
        })),
      };
    if ("fields" in field && Array.isArray(field.fields))
      return {
        ...field,
        fields: withBlockFields(field.fields, apply),
      } as Field;
    return field;
  });
}

export function addPersonalizationToBlocks(
  config: Config,
  targets: readonly string[] | "all",
  audiencesSlug: string,
): Config {
  const wanted = (slug: string) => targets === "all" || targets.includes(slug);
  // Shared block objects map to one shared result; every block is traversed
  // so target blocks nested inside non-target blocks are reached too.
  const seen = new WeakMap<Block, Block>();
  const traverse = (block: Block): Block => {
    const cached = seen.get(block);
    if (cached) return cached;
    const nested = {
      ...block,
      fields: withBlockFields(block.fields, traverse),
    };
    const result =
      !wanted(block.slug) ||
      nested.fields.some(
        (field) => "name" in field && field.name === "personalization",
      )
        ? nested
        : {
            ...nested,
            fields: [...nested.fields, personalizationField(audiencesSlug)],
          };
    seen.set(block, result);
    return result;
  };
  return {
    ...config,
    blocks: config.blocks?.map(traverse),
    collections: config.collections?.map((collection) => ({
      ...collection,
      fields: withBlockFields(collection.fields, traverse),
    })),
    globals: config.globals?.map((global) => ({
      ...global,
      fields: withBlockFields(global.fields, traverse),
    })),
  };
}

function manifestEndpoint(
  slug: string,
  options: PersonalizationOptions["manifest"] = {},
): Endpoint {
  const limit = options.limit ?? 500;
  return {
    path: "/manifest",
    method: "get",
    handler: async (req) => {
      if (options.secret) {
        const header = req.headers.get("authorization") ?? "";
        if (header !== `Bearer ${options.secret}`)
          return Response.json({ error: "Unauthorized." }, { status: 401 });
      }
      const where: Where[] = [{ state: { equals: "active" } }];
      const tenant = req.query?.tenant;
      if (tenant !== undefined) {
        if (
          !options.tenantField ||
          typeof tenant !== "string" ||
          !/^[\w-]{1,64}$/.test(tenant)
        )
          return Response.json(
            { error: "Invalid tenant filter." },
            { status: 400 },
          );
        where.push({ [options.tenantField]: { equals: tenant } });
      }
      // Public, fixed projection: arbitrary filters would expose private fields.
      const result = await req.payload.find({
        collection: slug as CollectionSlug,
        overrideAccess: true,
        depth: 0,
        limit,
        sort: "priority",
        where: { and: where },
        select: { key: true, priority: true, match: true, conditions: true },
      });
      const manifest = parseAudienceManifest({
        audiences: result.docs.map((doc) => {
          const d = doc as Record<string, unknown>;
          return {
            id: d.id,
            key: d.key,
            priority: d.priority,
            match: d.match,
            conditions: Array.isArray(d.conditions)
              ? d.conditions.map((c: Record<string, unknown>) => ({
                  parameter:
                    c.parameter === "custom" ? c.customParameter : c.parameter,
                  operator: c.operator,
                  value: c.value,
                }))
              : [],
          };
        }),
      });
      return Response.json(manifest, {
        headers: {
          "Cache-Control": options.secret
            ? "private, max-age=30"
            : "public, max-age=30, s-maxage=30, stale-while-revalidate=300",
        },
      });
    },
  };
}

export function audiencesCollection(
  slug: string,
  options: PersonalizationOptions,
): CollectionConfig {
  const authenticated: NonNullable<CollectionConfig["access"]>["read"] = ({
    req,
  }) => Boolean(req.user);
  return {
    slug,
    labels: {
      singular: { en: "Campaign audience", fr: "Audience de campagne" },
      plural: { en: "Campaign audiences", fr: "Audiences de campagne" },
    },
    admin: {
      useAsTitle: "title",
      group: "Marketing",
      defaultColumns: ["title", "key", "priority", "state", "updatedAt"],
      description: {
        en: "Visitors matching these rules see the blocks targeted at them. Rules are evaluated on the landing URL and remembered by a cookie.",
        fr: "Les visiteurs qui correspondent à ces règles voient les blocs qui leur sont destinés. Les règles s’appliquent à l’URL d’arrivée puis sont mémorisées par un cookie.",
      },
    },
    access: {
      read: authenticated,
      create: authenticated,
      update: authenticated,
      delete: authenticated,
    },
    fields: [
      {
        name: "title",
        type: "text",
        required: true,
        label: { en: "Name", fr: "Nom" },
      },
      {
        name: "key",
        type: "text",
        required: true,
        unique: true,
        index: true,
        maxLength: 64,
        label: { en: "Key", fr: "Identifiant" },
        admin: {
          description: {
            en: "Lowercase letters, digits and hyphens. Used in cookies and URLs; changing it resets remembered visitors.",
            fr: "Minuscules, chiffres et tirets. Utilisé dans les cookies et les URL ; le modifier oublie les visiteurs mémorisés.",
          },
        },
        validate: (value: unknown) =>
          isValidAudienceKey(value) ||
          "Use lowercase letters, digits and hyphens (max 64). “default” is reserved.",
      },
      {
        name: "match",
        type: "radio",
        defaultValue: "all",
        required: true,
        label: { en: "Visitor must match", fr: "Le visiteur doit remplir" },
        options: [
          {
            label: { en: "All conditions", fr: "Toutes les conditions" },
            value: "all",
          },
          {
            label: { en: "Any condition", fr: "Au moins une condition" },
            value: "any",
          },
        ],
      },
      {
        name: "conditions",
        type: "array",
        required: true,
        minRows: 1,
        maxRows: 20,
        label: { en: "Conditions", fr: "Conditions" },
        labels: {
          singular: { en: "Condition", fr: "Condition" },
          plural: { en: "Conditions", fr: "Conditions" },
        },
        fields: [
          {
            type: "row",
            fields: [
              {
                name: "parameter",
                type: "select",
                required: true,
                defaultValue: "utm_source",
                label: { en: "Parameter", fr: "Paramètre" },
                options: [
                  ...Object.values(utmParameters).map((value) => ({
                    label: value,
                    value,
                  })),
                  {
                    label: {
                      en: "Other URL parameter",
                      fr: "Autre paramètre d’URL",
                    },
                    value: "custom",
                  },
                ],
              },
              {
                name: "customParameter",
                type: "text",
                maxLength: 64,
                label: { en: "Parameter name", fr: "Nom du paramètre" },
                admin: {
                  condition: (_, sibling) => sibling?.parameter === "custom",
                },
                validate: (
                  value: unknown,
                  { siblingData }: { siblingData?: unknown },
                ) =>
                  (siblingData as { parameter?: string })?.parameter !==
                    "custom" ||
                  (typeof value === "string" &&
                    /^[A-Za-z0-9_.-]{1,64}$/.test(value)) ||
                  "Enter a parameter name (letters, digits, _ . -).",
              } as Field,
              {
                name: "operator",
                type: "select",
                required: true,
                defaultValue: "equals",
                label: { en: "Condition", fr: "Condition" },
                options: audienceOperators.map((value) => ({
                  label: operatorLabels[value],
                  value,
                })),
              },
              {
                name: "value",
                type: "text",
                maxLength: 512,
                label: { en: "Value", fr: "Valeur" },
                admin: {
                  condition: (_, sibling) => sibling?.operator !== "exists",
                },
                validate: (
                  value: unknown,
                  { siblingData }: { siblingData?: unknown },
                ) =>
                  (siblingData as { operator?: string })?.operator ===
                    "exists" ||
                  (typeof value === "string" && value.trim() !== "") ||
                  "Enter a value.",
              } as Field,
            ],
          },
        ],
      },
      {
        name: "priority",
        type: "number",
        defaultValue: 0,
        required: true,
        index: true,
        label: { en: "Priority", fr: "Priorité" },
        admin: {
          position: "sidebar",
          description: {
            en: "Lower numbers win when a visitor matches several audiences.",
            fr: "Le plus petit nombre l’emporte si un visiteur correspond à plusieurs audiences.",
          },
        },
      },
      {
        name: "state",
        type: "select",
        required: true,
        defaultValue: "active",
        index: true,
        label: { en: "Status", fr: "Statut" },
        options: [
          { label: { en: "Active", fr: "Active" }, value: "active" },
          { label: { en: "Archived", fr: "Archivée" }, value: "archived" },
        ],
        admin: { position: "sidebar" },
      },
      {
        name: "notes",
        type: "textarea",
        label: { en: "Internal notes", fr: "Notes internes" },
      },
    ],
    endpoints: [manifestEndpoint(slug, options.manifest)],
  };
}
