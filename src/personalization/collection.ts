import type {
  Block,
  CollectionConfig,
  CollectionSlug,
  Config,
  Endpoint,
  Field,
  Payload,
  PayloadRequest,
  Where,
} from "payload";
import { utmParameters } from "../utilities.js";
import type { Ga4Options } from "./ga4.js";
import {
  AUDIENCE_COOKIE,
  PERSISTENT_MAX_AGE_SECONDS,
  VISIT_COOKIE,
  VISIT_MAX_AGE_SECONDS,
  type CookieLifetime,
  audienceDocToRule,
  parseSourceMemory,
  updateSourceMemory,
  audienceOperators,
  collectPersonalizedBlocks,
  isValidAudienceKey,
  normalizeHost,
  normalizePath,
  parseAudienceManifest,
  type AudienceManifest,
} from "./match.js";
import {
  AUTO_AUDIENCE,
  DEFAULT_AUDIENCE,
  conversionSource,
  dayOf,
  parseViewEvent,
} from "./stats.js";

/** Audience links: a same-site path or an absolute http(s) URL, nothing else. */
/** Name of an editor-defined campaign text, usable as `{{audience.<name>}}`. */
export const CUSTOM_TEXT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const BUILT_IN_CONTENT = new Set([
  "displayName",
  "tagline",
  "linkLabel",
  "linkUrl",
  "image",
  "texts",
]);

export function isSafeAudienceLink(value: string): boolean {
  const text = value.trim();
  if (/^\/(?![/\\])/.test(text)) return !/\s/.test(text);
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Public path(s) of a document, or null when it is not routable. */
export type PathResolver = (args: {
  doc: Record<string, unknown>;
  /** Locale the document was read in, when localization is enabled (one call per locale). */
  locale?: string;
}) => string | readonly string[] | null | undefined;

export type PersonalizationOptions = {
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
  /**
   * Preview links in the admin. `param` must match the middleware `previewParam`.
   * `draftRoute`: path of a `createDraftPreviewRoute()` handler on the site,
   * so previews show unsaved drafts (Next.js draft mode) instead of the published page.
   */
  preview?:
    | false
    | { siteUrl?: string; param?: string; draftRoute?: `/${string}` };
  /**
   * Anonymous view statistics in the Personalization view (page views per
   * audience, page version shown, entry sources). Recorded only by
   * `<PersonalizationTracker stats />`. Off by default.
   */
  stats?:
    | boolean
    | {
        /** Collection storing views, default `utm-personalization-views`. */
        slug?: string;
        /** Views older than this are deleted, default 180 days. */
        retentionDays?: number;
        /** Accepted `Origin` headers (exact origins). Default: any. */
        allowedOrigins?: string[];
        /** Max rows aggregated by the admin view, default 50 000. */
        reportLimit?: number;
        /**
         * Pages that do not know the audience send `auto`: it is resolved from
         * this source-memory cookie. Match the middleware `cookie` options.
         */
        cookieName?: string;
        memoryMaxAgeSeconds?: number;
        /** Same as the middleware `cookie.lifetime`: sets the default cookie name and max age. */
        memoryLifetime?: CookieLifetime;
      };
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
  /**
   * Optional: GA4 sessions and key events in each campaign's Statistics tab
   * (Google Analytics Data API, read-only, cached 1 h).
   */
  ga4?: Ga4Options;
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
  audiencesSlug = "utm-links",
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
        // Only campaigns that personalize the site.
        filterOptions: { personalize: { equals: true } },
        label: { en: "Campaigns", fr: "Campagnes" },
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

/**
 * Payload 3 keeps references to `config.blocks` in `blockReferences`;
 * Payload 4 removed the property and merged slugs into `blocks`.
 */
const blockReferencesOf = (field: Field): (Block | string)[] | undefined =>
  (field as { blockReferences?: (Block | string)[] }).blockReferences;

/** True when these fields hold a block carrying the personalization group. */
function containsPersonalizedBlock(
  fields: Field[],
  personalizedSlugs: ReadonlySet<string>,
): boolean {
  return fields.some((field) => {
    if (field.type === "blocks")
      return [
        ...(field.blocks ?? []),
        ...(blockReferencesOf(field) ?? []),
      ].some((block) =>
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
  draftRoute?: string;
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
        // Payload 4 also accepts slugs of `config.blocks` here.
        blocks: (field.blocks ?? []).map((block: Block | string) =>
          typeof block === "string" ? block : apply(block),
        ),
        ...(blockReferencesOf(field)
          ? {
              blockReferences: blockReferencesOf(field)!.map((ref) =>
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
                    draftRoute: ui.draftRoute,
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
  payload: Payload,
  paths: NonNullable<PersonalizationOptions["paths"]>,
  tenantWhere: Where | undefined,
): Promise<Map<string, Set<string>> | null> {
  const byAudience = new Map<string, Set<string>>();
  const localization = payload.config?.localization;
  const locales: (string | undefined)[] = localization
    ? localization.localeCodes
    : [undefined];
  const add = (
    doc: Record<string, unknown>,
    resolve: PathResolver,
    locale: string | undefined,
  ) => {
    const blocks = collectPersonalizedBlocks(doc).filter(
      (block) => block.mode !== "all",
    );
    if (!blocks.length) return;
    const resolved = resolve(locale ? { doc, locale } : { doc });
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
    // Localized layouts differ per locale: read each locale as the site renders it
    // (with the configured fallback) and resolve its path.
    for (const locale of locales) {
      const localeArgs = locale ? { locale: locale as never } : {};
      for (const [collection, resolve] of Object.entries(
        paths.collections ?? {},
      )) {
        const result = await payload.find({
          collection: collection as CollectionSlug,
          overrideAccess: true,
          depth: 0,
          limit: paths.limit ?? 2000,
          ...localeArgs,
          ...(tenantWhere ? { where: tenantWhere } : {}),
        });
        if (result.hasNextPage) return null;
        result.docs.forEach((doc) =>
          add(doc as Record<string, unknown>, resolve, locale),
        );
      }
      for (const [global, resolve] of Object.entries(paths.globals ?? {}))
        add(
          (await payload.findGlobal({
            slug: global as never,
            overrideAccess: true,
            depth: 0,
            ...localeArgs,
          })) as Record<string, unknown>,
          resolve,
          locale,
        );
    }
  } catch (error) {
    // Incomplete knowledge must not hide variants: fall back to rewriting every path.
    payload.logger.error({
      err: error,
      msg: "utmPlugin: audience paths unavailable",
    });
    return null;
  }
  return byAudience;
}

/** Settings the plugin stores on `config.custom` for `buildAudienceManifest`. */
export const MANIFEST_SETTINGS_KEY = "utmPersonalizationManifest";
export type ManifestSettings = {
  audiencesSlug: string;
  limit: number;
  paths?: PersonalizationOptions["paths"];
};

/**
 * The audience manifest, read from the database: what `GET /api/<audiences>/manifest`
 * returns, without an HTTP round trip. Use it as the middleware `loadManifest`
 * when the proxy runs in the same app as Payload (Node.js runtime):
 *
 * ```ts
 * createPersonalizationResolver({
 *   loadManifest: async () => buildAudienceManifest(await getPayload({ config })),
 * })
 * ```
 */
export async function buildAudienceManifest(
  payload: Payload,
  options: {
    audiencesSlug?: string;
    limit?: number;
    paths?: PersonalizationOptions["paths"];
    /** Extra filters (tenant…), combined with `state = active`. */
    where?: Where[];
    tenantWhere?: Where;
  } = {},
): Promise<AudienceManifest> {
  const stored = (payload.config?.custom?.[MANIFEST_SETTINGS_KEY] ??
    {}) as Partial<ManifestSettings>;
  const slug = options.audiencesSlug ?? stored.audiencesSlug ?? "utm-links";
  const paths = options.paths ?? stored.paths;
  const where: Where[] = [
    ...(options.where ?? [{ state: { equals: "active" } }]),
    { personalize: { equals: true } },
  ];
  // Public, fixed projection: arbitrary filters would expose private fields.
  const result = await payload.find({
    collection: slug as CollectionSlug,
    overrideAccess: true,
    depth: 0,
    limit: options.limit ?? stored.limit ?? 500,
    sort: "priority",
    where: { and: where },
    select: {
      key: true,
      priority: true,
      match: true,
      conditions: true,
      startsAt: true,
      endsAt: true,
      pages: true,
      source: true,
      medium: true,
      campaign: true,
      referrerDomains: true,
    } as never,
  });
  const pathMap = paths
    ? await audiencePaths(payload, paths, options.tenantWhere)
    : null;
  return parseAudienceManifest({
    audiences: result.docs.map((doc) => {
      const rule = audienceDocToRule(doc as Record<string, unknown>) as Record<
        string,
        unknown
      >;
      // Pages entered on the audience (code mode) plus pages found in personalized blocks.
      const manual = (
        Array.isArray((doc as { pages?: unknown }).pages)
          ? ((doc as { pages: unknown[] }).pages as unknown[])
          : []
      )
        .filter((path): path is string => typeof path === "string")
        .map(normalizePath);
      if (pathMap)
        return {
          ...rule,
          paths: [
            ...new Set([...(pathMap.get(String(rule.id)) ?? []), ...manual]),
          ],
        };
      return manual.length ? { ...rule, paths: [...new Set(manual)] } : rule;
    }),
  });
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
      const manifest = await buildAudienceManifest(req.payload, {
        audiencesSlug: slug,
        limit,
        paths,
        where,
        tenantWhere,
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
          "Use lowercase letters, digits and hyphens (max 64). “default” and “auto” are reserved.",
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
                          !/^[a-z0-9.-]+\.([a-z]{2,}|\*)$/.test(
                            normalizeHost(item),
                          ),
                      )
                  )
                    return "Enter a domain such as partner.com (subdomains are included), or partner.* for any extension.";
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
        name: "pages",
        type: "text",
        hasMany: true,
        maxRows: 200,
        label: { en: "Pages it changes", fr: "Pages concernées" },
        admin: {
          position: "sidebar",
          description: {
            en: "Public paths this audience changes, e.g. / and /fr. In static mode only these pages get a variant (pages from personalized blocks are added). Empty: detected from blocks, or every page.",
            fr: "Chemins publics que cette audience modifie, ex. / et /fr. En mode statique, seules ces pages ont une variante (les pages des blocs personnalisés s’ajoutent). Vide : détectées depuis les blocs, sinon toutes les pages.",
          },
        },
        validate: (value: unknown) =>
          !Array.isArray(value) ||
          value.every(
            (path) =>
              typeof path === "string" &&
              path.length <= 300 &&
              /^\/(?!\/)[^\s?#]*$/.test(path),
          ) ||
          "Enter public paths starting with /, without query or #.",
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
                      ...(options.preview?.draftRoute
                        ? { draftRoute: options.preview.draftRoute }
                        : {}),
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
            localized: true,
            maxLength: 120,
            label: { en: "Display name", fr: "Nom affiché" },
          },
          {
            name: "tagline",
            type: "textarea",
            localized: true,
            maxLength: 500,
            label: { en: "Tagline", fr: "Accroche" },
          },
          {
            name: "linkLabel",
            type: "text",
            localized: true,
            maxLength: 120,
            label: { en: "Link text", fr: "Texte du lien" },
          },
          {
            name: "linkUrl",
            type: "text",
            maxLength: 2048,
            label: { en: "Link", fr: "Lien" },
            admin: {
              description: {
                en: "A site path (/contact) or a full https:// URL.",
                fr: "Un chemin du site (/contact) ou une adresse https:// complète.",
              },
            },
            validate: (value: unknown) =>
              !value ||
              (typeof value === "string" && isSafeAudienceLink(value)) ||
              "Enter a path starting with / or an http(s) URL.",
          } as Field,
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
          {
            name: "texts",
            type: "array",
            label: { en: "Other texts", fr: "Autres textes" },
            labels: {
              singular: { en: "Text", fr: "Texte" },
              plural: { en: "Texts", fr: "Textes" },
            },
            maxRows: 50,
            admin: {
              initCollapsed: false,
              description: {
                en: "Add your own texts for this campaign: a name, then the text. Use them in blocks with {{audience.<name>}}.",
                fr: "Ajoutez vos propres textes pour cette campagne : un nom, puis le texte. Utilisez-les dans les blocs avec {{audience.<nom>}}.",
              },
            },
            fields: [
              {
                type: "row",
                fields: [
                  {
                    name: "name",
                    type: "text",
                    required: true,
                    maxLength: 64,
                    label: { en: "Name", fr: "Nom" },
                    admin: {
                      width: "30%",
                      placeholder: "offer",
                    },
                    validate: (value: unknown) =>
                      (typeof value === "string" &&
                        CUSTOM_TEXT_NAME.test(value) &&
                        !BUILT_IN_CONTENT.has(value)) ||
                      "Letters, digits and _ only, starting with a letter; not displayName, tagline, linkLabel, linkUrl, image or texts.",
                  } as Field,
                  {
                    name: "value",
                    type: "textarea",
                    localized: true,
                    maxLength: 2000,
                    label: { en: "Text", fr: "Texte" },
                    admin: { width: "70%", rows: 2 },
                  },
                ],
              },
            ],
          } as Field,
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
    endpoints: [
      manifestEndpoint(slug, options.manifest, options.paths),
      ...(statsSettings(options)
        ? [statsEndpoint(slug, statsSettings(options)!)]
        : []),
    ],
  };
}

export type StatsSettings = {
  slug: string;
  cookieName: string;
  memoryMaxAgeSeconds: number;
  retentionDays: number;
  allowedOrigins?: string[];
  reportLimit: number;
};

export function statsSettings(
  options: PersonalizationOptions,
): StatsSettings | null {
  // On by default with personalization (detected campaigns need it); `stats: false` opts out.
  if (options.stats === false) return null;
  const custom =
    options.stats === true || options.stats === undefined ? {} : options.stats;
  return {
    slug: custom.slug ?? "utm-personalization-views",
    cookieName:
      custom.cookieName ??
      (custom.memoryLifetime === "visit" ? VISIT_COOKIE : AUDIENCE_COOKIE),
    memoryMaxAgeSeconds:
      custom.memoryMaxAgeSeconds ??
      (custom.memoryLifetime === "visit"
        ? VISIT_MAX_AGE_SECONDS
        : PERSISTENT_MAX_AGE_SECONDS),
    retentionDays: custom.retentionDays ?? 180,
    allowedOrigins: custom.allowedOrigins,
    reportLimit: custom.reportLimit ?? 50_000,
  };
}

/** Stored page views. Written only by the stats endpoint, never by the API. */
export function viewsCollection(settings: StatsSettings): CollectionConfig {
  const authenticated = ({ req }: { req: PayloadRequest }) => Boolean(req.user);
  const text = (name: string, index = false): Field => ({
    name,
    type: "text",
    index,
    maxLength: 300,
  });
  return {
    slug: settings.slug,
    labels: {
      singular: { en: "Personalization view", fr: "Vue personnalisée" },
      plural: { en: "Personalization views", fr: "Vues personnalisées" },
    },
    admin: { group: "Marketing", hidden: true, useAsTitle: "path" },
    access: {
      read: authenticated,
      create: () => false,
      update: () => false,
      delete: authenticated,
    },
    timestamps: false,
    // Payload 4 enables versions and authorship by default; versions also
    // require timestamps. Anonymous, high-volume rows need neither.
    versions: false,
    ...({ authorship: false } as object),
    fields: [
      { ...text("day", true), required: true } as Field,
      { ...text("audience", true), required: true } as Field,
      { ...text("path", true), required: true } as Field,
      { name: "variant", type: "checkbox", defaultValue: false },
      { name: "entry", type: "checkbox", defaultValue: false, index: true },
      { name: "utm", type: "checkbox", defaultValue: false },
      text("source"),
      text("medium"),
      text("campaign"),
      { ...text("conversion", true) } as Field,
    ],
  };
}

let knownKeys: {
  keys: Set<string>;
  manifest: ReturnType<typeof parseAudienceManifest>;
  expires: number;
  slug: string;
} | null = null;

function statsEndpoint(
  audiencesSlug: string,
  settings: StatsSettings,
): Endpoint {
  return {
    path: "/stats",
    method: "post",
    handler: async (req) => {
      const origin = req.headers.get("origin");
      if (
        settings.allowedOrigins &&
        (!origin || !settings.allowedOrigins.includes(origin))
      )
        return new Response(null, { status: 403 });
      // sendBeacon posts text/plain (no CORS preflight); cap the body.
      const body = (await req.text?.()) ?? "";
      if (!body || body.length > 2048)
        return new Response(null, { status: 400 });
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return new Response(null, { status: 400 });
      }
      try {
        if (
          !knownKeys ||
          knownKeys.expires < Date.now() ||
          knownKeys.slug !== audiencesSlug
        ) {
          const result = await req.payload.find({
            collection: audiencesSlug as CollectionSlug,
            overrideAccess: true,
            depth: 0,
            limit: 5000,
            pagination: false,
            where: {
              and: [
                { state: { equals: "active" } },
                { personalize: { equals: true } },
              ],
            },
            select: {
              key: true,
              priority: true,
              match: true,
              conditions: true,
              startsAt: true,
              endsAt: true,
              source: true,
              medium: true,
              campaign: true,
              referrerDomains: true,
            } as never,
          });
          const manifest = parseAudienceManifest({
            audiences: (result.docs as Record<string, unknown>[]).map(
              audienceDocToRule,
            ),
          });
          knownKeys = {
            slug: audiencesSlug,
            expires: Date.now() + 60_000,
            manifest,
            keys: new Set(manifest.audiences.map((audience) => audience.key)),
          };
        }
        const event = parseViewEvent(parsed, knownKeys.keys);
        if (!event) return new Response(null, { status: 400 });
        // The page did not know the audience (static page without variant):
        // resolve it from the visitor's source memory, sent with the beacon.
        // Source memory sent with the beacon (same-site cookie): resolves `auto`
        // audiences and attributes conversions to the latest arrival.
        if (event.audience === AUTO_AUDIENCE || event.conversion) {
          const cookie = (req.headers.get("cookie") ?? "")
            .split(/;\s*/)
            .find((part) => part.startsWith(`${settings.cookieName}=`));
          let value = cookie?.slice(settings.cookieName.length + 1);
          try {
            value = value ? decodeURIComponent(value) : value;
          } catch {
            value = undefined;
          }
          const memory = parseSourceMemory(value);
          if (event.audience === AUTO_AUDIENCE) {
            const resolved = updateSourceMemory({
              memory,
              touch: null,
              manifest: knownKeys.manifest,
              maxAgeSeconds: settings.memoryMaxAgeSeconds,
            }).audience;
            event.audience = resolved?.key ?? DEFAULT_AUDIENCE;
            event.variant = false;
          }
          if (event.conversion) Object.assign(event, conversionSource(memory));
        }
        const now = new Date();
        await req.payload.create({
          collection: settings.slug as CollectionSlug,
          overrideAccess: true,
          depth: 0,
          data: { ...event, day: dayOf(now) } as never,
        });
        // Retention, amortized over writes.
        if (Math.random() < 0.01) {
          const cutoff = dayOf(
            new Date(now.getTime() - settings.retentionDays * 86_400_000),
          );
          await req.payload.delete({
            collection: settings.slug as CollectionSlug,
            overrideAccess: true,
            where: { day: { less_than: cutoff } },
          });
        }
      } catch (error) {
        req.payload.logger.error({
          err: error,
          msg: "utmPlugin: personalization view not recorded",
        });
        return new Response(null, { status: 500 });
      }
      return new Response(null, { status: 204 });
    },
  };
}

const domainPattern = /^[a-z0-9.-]+\.([a-z]{2,}|\*)$/;

/** Audience key from a campaign: `source[-campaign]`, slugged, max 64 chars. */
export function campaignAudienceKey(
  source: unknown,
  campaign?: unknown,
): string {
  const slug = (value: unknown) =>
    typeof value === "string"
      ? value
          .normalize("NFKD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-/, "")
          .replace(/-$/, "")
      : "";
  const parts = [slug(source), slug(campaign)].filter(Boolean);
  let key = parts.join("-").slice(0, 64).replace(/-$/, "");
  if (!key || !/^[a-z0-9]/.test(key)) key = `campaign-${key}`.slice(0, 64);
  return isValidAudienceKey(key) ? key : `${key}-1`.slice(0, 64);
}

/**
 * Personalization on UTM campaigns: the "Personalize the site" tab (audience
 * fields), the hooks that keep the key and caches in sync, and the manifest /
 * statistics endpoints. One menu entry: a campaign is a UTM link that can also
 * personalize the site.
 */
export function campaignPersonalization(
  linksSlug: string,
  options: PersonalizationOptions,
  context: AudienceCollectionContext,
): {
  fields: Field[];
  hooks: NonNullable<CollectionConfig["hooks"]>;
  endpoints: Endpoint[];
} {
  const base = audiencesCollection(linksSlug, options, context);
  const pick = (name: string) => {
    const field = base.fields.find((f) => "name" in f && f.name === name);
    if (!field) throw new Error(`utmPlugin: missing audience field ${name}`);
    return field as Field & { admin?: Record<string, unknown> };
  };
  const enabled = (data: Record<string, unknown> | undefined) =>
    data?.personalize === true;
  const onlyWhenEnabled = <F extends Field>(field: F): F =>
    ({
      ...field,
      admin: {
        ...(("admin" in field && field.admin) || {}),
        position: undefined,
        condition: (data: Record<string, unknown>) => enabled(data),
      },
    }) as F;
  const keyField = pick("key") as Field & {
    validate?: unknown;
    required?: boolean;
  };
  const conditions = pick("conditions") as Field & { minRows?: number };
  const content = pick("content") as Field & { name: string };
  const fields: Field[] = [
    {
      name: "personalize",
      type: "checkbox",
      defaultValue: false,
      index: true,
      label: { en: "Personalize the site", fr: "Personnaliser le site" },
      admin: {
        components: {
          Cell: {
            path: "payload-plugin-utm/client#CampaignStatusCell",
            clientProps: { locale: context.locale },
          },
        },
        description: {
          en: "Visitors arriving with this campaign's UTM values (or from the sites below) are remembered 90 days and see the content targeted at this campaign.",
          fr: "Les visiteurs qui arrivent avec les UTM de cette campagne (ou depuis les sites ci-dessous) sont mémorisés 90 jours et voient le contenu destiné à cette campagne.",
        },
      },
    },
    onlyWhenEnabled({
      name: "referrerDomains",
      type: "text",
      hasMany: true,
      maxRows: 50,
      label: {
        en: "Also recognize visitors coming from",
        fr: "Reconnaître aussi les visiteurs venant de",
      },
      admin: {
        description: {
          en: "Sites that link to you without UTM, e.g. coudac.com (subdomains included) or coudac.* (any extension).",
          fr: "Sites qui renvoient vers vous sans UTM, ex. coudac.com (sous-domaines compris) ou coudac.* (toutes extensions).",
        },
      },
      validate: (value: unknown) =>
        !Array.isArray(value) ||
        value.every(
          (domain) =>
            typeof domain === "string" &&
            domainPattern.test(normalizeHost(domain)),
        ) ||
        "Enter domains such as partner.com or partner.*",
    } as Field),
    onlyWhenEnabled({ ...pick("pages") } as Field),
    onlyWhenEnabled({
      ...content,
      name: "audienceContent",
    } as Field),
    onlyWhenEnabled({
      type: "row",
      fields: [
        {
          ...pick("startsAt"),
          admin: { ...pick("startsAt").admin, position: undefined },
        },
        {
          ...pick("endsAt"),
          admin: { ...pick("endsAt").admin, position: undefined },
        },
        {
          ...pick("priority"),
          admin: { ...pick("priority").admin, position: undefined },
        },
      ] as Field[],
    } as Field),
    onlyWhenEnabled({
      ...keyField,
      required: false,
      admin: {
        ...keyField.admin,
        description: {
          en: "Generated from source and campaign. Used in cookies and URLs; changing it forgets remembered visitors.",
          fr: "Généré depuis la source et la campagne. Utilisé dans les cookies et les URL ; le modifier oublie les visiteurs mémorisés.",
        },
      },
      validate: (value: unknown) =>
        value == null ||
        value === "" ||
        isValidAudienceKey(value) ||
        "Use lowercase letters, digits and hyphens (max 64). “default” and “auto” are reserved.",
    } as Field),
    onlyWhenEnabled({
      type: "collapsible",
      label: { en: "Advanced rules", fr: "Règles avancées" },
      admin: {
        initCollapsed: true,
        description: {
          en: "Optional extra ways to recognize visitors (e.g. ?ref=partner). They are combined with OR with the UTM values and sites above.",
          fr: "Facultatif : d’autres façons de reconnaître les visiteurs (ex. ?ref=partenaire), en plus (OU) des UTM et des sites ci-dessus.",
        },
      },
      fields: [pick("match"), { ...conditions, required: false, minRows: 0 }],
    } as Field),
    ...base.fields
      .filter((f) => "name" in f && f.name === "preview")
      .map((f) => onlyWhenEnabled(f)),
  ];

  const hooks: NonNullable<CollectionConfig["hooks"]> = {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        if (!data) return data;
        const merged = { ...originalDoc, ...data } as Record<string, unknown>;
        if (merged.personalize !== true || merged.key) return data;
        // Unique key from source and campaign, suffixed on conflict.
        const wanted = campaignAudienceKey(merged.source, merged.campaign);
        let key = wanted;
        for (let n = 2; n < 50; n++) {
          const taken = await req.payload.find({
            collection: linksSlug as CollectionSlug,
            req,
            overrideAccess: true,
            depth: 0,
            limit: 1,
            where: {
              and: [
                { key: { equals: key } },
                ...(originalDoc?.id !== undefined
                  ? [{ id: { not_equals: originalDoc.id } }]
                  : []),
              ],
            },
          });
          if (!taken.docs.length) break;
          key = `${wanted.slice(0, 60)}-${n}`;
        }
        return { ...data, key };
      },
    ],
    afterChange: [
      ...(base.hooks?.afterChange ?? []).map(
        (hook) =>
          ((args: Parameters<typeof hook>[0]) =>
            args.doc?.personalize || args.previousDoc?.personalize
              ? hook(args)
              : args.doc) as typeof hook,
      ),
    ],
    afterDelete: [
      ...(base.hooks?.afterDelete ?? []).map(
        (hook) =>
          ((args: Parameters<typeof hook>[0]) =>
            args.doc?.personalize ? hook(args) : args.doc) as typeof hook,
      ),
    ],
  };
  return { fields, hooks, endpoints: base.endpoints || [] };
}
