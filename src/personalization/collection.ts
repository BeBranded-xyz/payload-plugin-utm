import type {
  Block,
  CollectionConfig,
  CollectionSlug,
  Config,
  Endpoint,
  Field,
  PayloadRequest,
  Where,
} from "payload";
import { utmParameters } from "../utilities.js";
import {
  audienceDocToRule,
  audienceOperators,
  collectPersonalizedBlocks,
  isValidAudienceKey,
  normalizeHost,
  parseAudienceManifest,
} from "./match.js";

/** Public path(s) of a document, or null when it is not routable. */
export type PathResolver = (args: {
  doc: Record<string, unknown>;
}) => string | readonly string[] | null | undefined;

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
  /**
   * Called after an audience is created, updated or deleted, e.g. to call
   * `revalidatePersonalizedRoutes()` in static (rewrite) mode. Errors are logged, never thrown.
   */
  afterAudienceChange?: (args: {
    operation: "create" | "update" | "delete";
    doc: Record<string, unknown>;
    previousDoc?: Record<string, unknown>;
    req: PayloadRequest;
  }) => void | Promise<void>;
  /** Preview links in the admin. Must match the middleware `previewParam`. */
  preview?: false | { siteUrl?: string; param?: string };
  /**
   * Admin overview at `/admin/personalization` (audiences × documents × links,
   * consistency alerts, URL simulator). `false` disables the view and its nav link.
   */
  adminView?: false | { path?: `/${string}` };
  /**
   * Static mode performance: public paths of documents, per collection or global
   * slug. The manifest then lists, per audience, the pages that change for it,
   * and the middleware only rewrites those. Omit to rewrite every path.
   */
  paths?: {
    collections?: Record<string, PathResolver>;
    globals?: Record<string, PathResolver>;
    /** Max documents scanned per collection, default 2000. */
    limit?: number;
  };
  /**
   * Content editors can attach to an audience and reuse in blocks with
   * `{{audience.<field>}}`: `displayName` and `tagline` are built in.
   */
  content?: {
    /** Adds an `image` upload field pointing at this collection. */
    imageCollection?: string;
    /** Extra fields (top-level `name`d text fields work with tokens). */
    fields?: Field[];
  };
  overrides?: (collection: CollectionConfig) => CollectionConfig;
};
export type AudienceCollectionContext = {
  locale: "en" | "fr";
  linksSlug: string;
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
  locale: "en" | "fr" = "en",
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
      {
        name: "variantAction",
        type: "ui",
        admin: {
          components: {
            Field: {
              path: "payload-plugin-utm/client#BlockVariantAction",
              clientProps: { locale, audiencesSlug, fieldName: name },
            },
          },
        },
      } as Field,
    ],
  };
}

const labelOf = (block: Block): unknown => {
  const singular = block.labels?.singular;
  return typeof singular === "string" ||
    (singular && typeof singular === "object")
    ? singular
    : block.slug;
};

/** True when these fields hold a block carrying the personalization group. */
function containsPersonalizedBlock(
  fields: Field[],
  personalizedSlugs: ReadonlySet<string>,
): boolean {
  return fields.some((field) => {
    if (field.type === "blocks")
      return [...(field.blocks ?? []), ...(field.blockReferences ?? [])].some(
        (block) =>
          typeof block === "string"
            ? personalizedSlugs.has(block)
            : personalizedSlugs.has(block.slug) ||
              containsPersonalizedBlock(block.fields, personalizedSlugs),
      );
    if (field.type === "tabs")
      return field.tabs.some((tab) =>
        containsPersonalizedBlock(tab.fields, personalizedSlugs),
      );
    return (
      "fields" in field &&
      Array.isArray(field.fields) &&
      containsPersonalizedBlock(field.fields, personalizedSlugs)
    );
  });
}

/** Top-level field names whose data holds personalized blocks (for `select`). */
export function personalizedFieldNames(
  fields: Field[],
  personalizedSlugs: ReadonlySet<string>,
): string[] {
  return fields.flatMap((field): string[] => {
    if (field.type === "tabs")
      return field.tabs.flatMap((tab) =>
        "name" in tab && tab.name
          ? containsPersonalizedBlock(tab.fields, personalizedSlugs)
            ? [tab.name]
            : []
          : personalizedFieldNames(tab.fields, personalizedSlugs),
      );
    if ("name" in field && field.name)
      return containsPersonalizedBlock([field], personalizedSlugs)
        ? [field.name]
        : [];
    return "fields" in field && Array.isArray(field.fields)
      ? personalizedFieldNames(field.fields, personalizedSlugs)
      : [];
  });
}

export type PersonalizationUi = {
  locale: "en" | "fr";
  previewParam: string | null;
  siteUrl?: string;
};

export type PersonalizationTarget = {
  kind: "collection" | "global";
  slug: string;
  /** Top-level fields to select when reading documents. */
  fields: string[];
};

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

export const PANEL_FIELD = "utmPersonalizationPanel";

export function addPersonalizationToBlocks(
  config: Config,
  targets: readonly string[] | "all",
  audiencesSlug: string,
  ui: PersonalizationUi = { locale: "en", previewParam: "utm_preview" },
): {
  config: Config;
  targets: PersonalizationTarget[];
  blockLabels: Record<string, unknown>;
} {
  const wanted = (slug: string) => targets === "all" || targets.includes(slug);
  const personalizedSlugs = new Set<string>();
  const blockLabels: Record<string, unknown> = {};
  // Shared block objects map to one shared result; every block is traversed
  // so target blocks nested inside non-target blocks are reached too.
  const seen = new WeakMap<Block, Block>();
  const traverse = (block: Block): Block => {
    const cached = seen.get(block);
    if (cached) return cached;
    const nested: Block = {
      ...block,
      fields: withBlockFields(block.fields, traverse),
    };
    let result = nested;
    if (wanted(block.slug)) {
      personalizedSlugs.add(block.slug);
      blockLabels[block.slug] = labelOf(block);
      if (
        !nested.fields.some(
          (field) => "name" in field && field.name === "personalization",
        )
      )
        result = {
          ...result,
          fields: [
            ...result.fields,
            personalizationField(audiencesSlug, "personalization", ui.locale),
          ],
        };
      // Badge in the block header, unless the app already customizes it.
      if (!block.admin?.components?.Label && !block.admin?.components?.Block)
        result = {
          ...result,
          admin: {
            ...result.admin,
            components: {
              ...result.admin?.components,
              Label: {
                path: "payload-plugin-utm/client#PersonalizedBlockLabel",
                clientProps: {
                  locale: ui.locale,
                  audiencesSlug,
                  blockLabel: labelOf(block),
                  showBlockName: !block.admin?.disableBlockName,
                },
              },
            },
          },
        };
    }
    seen.set(block, result);
    return result;
  };
  const blocks = config.blocks?.map(traverse);
  const collections = config.collections?.map((collection) => ({
    ...collection,
    fields: withBlockFields(collection.fields, traverse),
  }));
  const globals = config.globals?.map((global) => ({
    ...global,
    fields: withBlockFields(global.fields, traverse),
  }));
  const found: PersonalizationTarget[] = [];
  const panel = (fields: Field[]): Field[] =>
    fields.some((field) => "name" in field && field.name === PANEL_FIELD)
      ? fields
      : [
          ...fields,
          {
            name: PANEL_FIELD,
            type: "ui",
            admin: {
              position: "sidebar",
              components: {
                Field: {
                  path: "payload-plugin-utm/client#PersonalizationPanel",
                  clientProps: {
                    locale: ui.locale,
                    audiencesSlug,
                    previewParam: ui.previewParam,
                    siteUrl: ui.siteUrl,
                    blockLabels,
                  },
                },
              },
            },
          } as Field,
        ];
  const withPanels = <T extends { slug: string; fields: Field[] }>(
    entities: T[] | undefined,
    kind: PersonalizationTarget["kind"],
  ): T[] | undefined =>
    entities?.map((entity) => {
      if (!containsPersonalizedBlock(entity.fields, personalizedSlugs))
        return entity;
      found.push({
        kind,
        slug: entity.slug,
        fields: personalizedFieldNames(entity.fields, personalizedSlugs),
      });
      return { ...entity, fields: panel(entity.fields) };
    });
  return {
    config: {
      ...config,
      blocks,
      collections: withPanels(collections, "collection"),
      globals: withPanels(globals, "global"),
    },
    targets: found,
    blockLabels,
  };
}

async function audiencePaths(
  req: PayloadRequest,
  paths: NonNullable<PersonalizationOptions["paths"]>,
  tenantWhere: Where | undefined,
): Promise<Map<string, Set<string>> | null> {
  const byAudience = new Map<string, Set<string>>();
  const add = (doc: Record<string, unknown>, resolve: PathResolver) => {
    const blocks = collectPersonalizedBlocks(doc).filter(
      (block) => block.mode !== "all",
    );
    if (!blocks.length) return;
    const resolved = resolve({ doc });
    const list = (Array.isArray(resolved) ? resolved : [resolved]).filter(
      (path): path is string =>
        typeof path === "string" && path.startsWith("/"),
    );
    for (const block of blocks)
      for (const id of block.audienceIds) {
        const set = byAudience.get(id) ?? new Set<string>();
        list.forEach((path) => set.add(path));
        byAudience.set(id, set);
      }
  };
  try {
    for (const [collection, resolve] of Object.entries(
      paths.collections ?? {},
    )) {
      const result = await req.payload.find({
        collection: collection as CollectionSlug,
        overrideAccess: true,
        depth: 0,
        limit: paths.limit ?? 2000,
        ...(tenantWhere ? { where: tenantWhere } : {}),
      });
      if (result.hasNextPage) return null;
      result.docs.forEach((doc) =>
        add(doc as Record<string, unknown>, resolve),
      );
    }
    for (const [global, resolve] of Object.entries(paths.globals ?? {}))
      add(
        (await req.payload.findGlobal({
          slug: global as never,
          overrideAccess: true,
          depth: 0,
        })) as Record<string, unknown>,
        resolve,
      );
  } catch (error) {
    // Incomplete knowledge must not hide variants: fall back to rewriting every path.
    req.payload.logger.error({
      err: error,
      msg: "utmPlugin: audience paths unavailable",
    });
    return null;
  }
  return byAudience;
}

function manifestEndpoint(
  slug: string,
  options: PersonalizationOptions["manifest"] = {},
  paths?: PersonalizationOptions["paths"],
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
      const tenantWhere =
        typeof tenant === "string" && options.tenantField
          ? { [options.tenantField]: { equals: tenant } }
          : undefined;
      // Public, fixed projection: arbitrary filters would expose private fields.
      const result = await req.payload.find({
        collection: slug as CollectionSlug,
        overrideAccess: true,
        depth: 0,
        limit,
        sort: "priority",
        where: { and: where },
        select: {
          key: true,
          priority: true,
          match: true,
          conditions: true,
          startsAt: true,
          endsAt: true,
        },
      });
      const pathMap = paths
        ? await audiencePaths(req, paths, tenantWhere)
        : null;
      const manifest = parseAudienceManifest({
        audiences: result.docs.map((doc) => {
          const rule = audienceDocToRule(
            doc as Record<string, unknown>,
          ) as Record<string, unknown>;
          return pathMap
            ? { ...rule, paths: [...(pathMap.get(String(rule.id)) ?? [])] }
            : rule;
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
  context: AudienceCollectionContext = { locale: "en", linksSlug: "utm-links" },
): CollectionConfig {
  const notify = async (
    args: Parameters<
      NonNullable<PersonalizationOptions["afterAudienceChange"]>
    >[0],
  ) => {
    if (!options.afterAudienceChange) return;
    try {
      await options.afterAudienceChange(args);
    } catch (error) {
      args.req.payload.logger.error({
        err: error,
        msg: "utmPlugin: afterAudienceChange failed",
      });
    }
  };
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
                      en: "Referring site (domain)",
                      fr: "Site de provenance (domaine)",
                    },
                    value: "referrer",
                  },
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
                ) => {
                  const sibling = siblingData as
                    | { operator?: string; parameter?: string }
                    | undefined;
                  if (sibling?.operator === "exists") return true;
                  if (typeof value !== "string" || value.trim() === "")
                    return "Enter a value.";
                  if (
                    sibling?.parameter === "referrer" &&
                    ["equals", "notEquals", "in"].includes(
                      sibling.operator ?? "",
                    ) &&
                    value
                      .split(",")
                      .some(
                        (item) =>
                          !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalizeHost(item)),
                      )
                  )
                    return "Enter a domain such as partner.com (subdomains are included).";
                  return true;
                },
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
        name: "startsAt",
        type: "date",
        label: { en: "Campaign starts", fr: "Début de campagne" },
        admin: {
          position: "sidebar",
          date: { pickerAppearance: "dayAndTime" },
          description: {
            en: "Optional. The audience is ignored before this date.",
            fr: "Facultatif. L’audience est ignorée avant cette date.",
          },
        },
      },
      {
        name: "endsAt",
        type: "date",
        label: { en: "Campaign ends", fr: "Fin de campagne" },
        admin: {
          position: "sidebar",
          date: { pickerAppearance: "dayAndTime" },
          description: {
            en: "Optional. From this date, visitors see the default content again (within about a minute).",
            fr: "Facultatif. À partir de cette date, les visiteurs revoient le contenu par défaut (sous une minute environ).",
          },
        },
        validate: (
          value: unknown,
          { siblingData }: { siblingData?: unknown },
        ) => {
          const start = (siblingData as { startsAt?: unknown } | undefined)
            ?.startsAt;
          if (!value || !start) return true;
          return (
            Date.parse(String(value)) > Date.parse(String(start)) ||
            "The end date must be after the start date."
          );
        },
      } as Field,
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
      ...(options.preview === false
        ? []
        : [
            {
              name: "preview",
              type: "ui",
              label: { en: "Preview", fr: "Aperçu" },
              admin: {
                position: "sidebar",
                components: {
                  Field: {
                    path: "payload-plugin-utm/client#AudiencePreview",
                    clientProps: {
                      locale: context.locale,
                      siteUrl: options.preview?.siteUrl,
                      param: options.preview?.param ?? "utm_preview",
                      linksSlug: context.linksSlug,
                    },
                  },
                },
              },
            } as Field,
          ]),
      {
        name: "content",
        type: "group",
        label: { en: "Audience content", fr: "Contenu de l’audience" },
        admin: {
          description: {
            en: "Reuse these values in any block text with {{audience.displayName}} or {{audience.tagline|fallback text}}.",
            fr: "Réutilisez ces valeurs dans le texte des blocs avec {{audience.displayName}} ou {{audience.tagline|texte par défaut}}.",
          },
        },
        fields: [
          {
            name: "displayName",
            type: "text",
            maxLength: 120,
            label: { en: "Display name", fr: "Nom affiché" },
          },
          {
            name: "tagline",
            type: "textarea",
            maxLength: 500,
            label: { en: "Tagline", fr: "Accroche" },
          },
          ...(options.content?.imageCollection
            ? [
                {
                  name: "image",
                  type: "upload",
                  relationTo: options.content.imageCollection as CollectionSlug,
                  label: { en: "Image", fr: "Image" },
                } as Field,
              ]
            : []),
          ...(options.content?.fields ?? []),
        ],
      },
      {
        name: "notes",
        type: "textarea",
        label: { en: "Internal notes", fr: "Notes internes" },
      },
    ],
    hooks: {
      afterChange: [
        async ({ doc, previousDoc, operation, req }) => {
          await notify({ operation, doc, previousDoc, req });
          return doc;
        },
      ],
      afterDelete: [
        async ({ doc, req }) => {
          await notify({ operation: "delete", doc, req });
        },
      ],
    },
    endpoints: [manifestEndpoint(slug, options.manifest, options.paths)],
  };
}
