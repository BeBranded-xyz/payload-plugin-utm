import type {
  CollectionConfig,
  CollectionSlug,
  Config,
  Field,
  Plugin,
} from "payload";
import * as payloadRuntime from "payload";
import type {
  AudienceCollectionContext,
  PersonalizationOptions,
} from "./personalization/collection.js";
import { csvEndpoint } from "./csv-endpoint.js";
import { ga4Endpoint } from "./personalization/ga4.js";
import {
  addPersonalizationToBlocks,
  campaignPersonalization,
  MANIFEST_SETTINGS_KEY,
  statsSettings,
  viewsCollection,
} from "./personalization/collection.js";
import type { UtmPluginOptions } from "./types.js";
import {
  buildUtmUrl,
  normalizeUtmValue,
  utmParameters,
  validateDestination,
} from "./utilities.js";
export type { UtmPluginOptions, UtmPreset } from "./types.js";
export {
  buildUtmUrl,
  buildUtmVariants,
  normalizeUtmValue,
  utmLinksToCsv,
  utmParameters,
  validateDestination,
} from "./utilities.js";
export type { UtmInput, UtmKey, UtmUrlOptions } from "./utilities.js";
export {
  personalizationField,
  type PersonalizationOptions,
} from "./personalization/collection.js";
export * from "./personalization/match.js";
export {
  flattenAudienceContent,
  getAudienceContent,
} from "./personalization/server.js";
export { buildAudienceManifest } from "./personalization/collection.js";
export type { Ga4Options } from "./personalization/ga4.js";
export * from "./personalization/stats.js";
export type { PathResolver } from "./personalization/collection.js";
export function utmPlugin(options: UtmPluginOptions = {}): Plugin {
  return (config) => {
    if (options.enabled === false) return config;
    const slug = options.collectionSlug ?? "utm-links";
    if (!/^[a-z][a-z0-9-]*$/.test(slug))
      throw new Error(
        "utmPlugin: collectionSlug must contain lowercase letters, digits and hyphens.",
      );
    if (config.collections?.some((collection) => collection.slug === slug))
      throw new Error(`utmPlugin: collection "${slug}" already exists.`);
    if (options.locale && !["en", "fr"].includes(options.locale))
      throw new Error("utmPlugin: locale must be en or fr.");
    if (
      options.normalization &&
      !["preserve", "lowercase", "slug"].includes(options.normalization)
    )
      throw new Error("utmPlugin: invalid normalization mode.");
    const maxRows =
      options.csvExport === false ? 1000 : (options.csvExport?.maxRows ?? 1000);
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000)
      throw new Error(
        "utmPlugin: CSV maxRows must be an integer between 1 and 10000.",
      );
    for (const origin of options.allowedOrigins ?? [])
      if (
        validateDestination(origin) !== true ||
        new URL(origin).origin !== origin
      )
        throw new Error(
          "utmPlugin: allowedOrigins must be exact origins without paths or trailing slashes.",
        );
    for (const preset of options.presets ?? [])
      if (
        !preset.label?.trim() ||
        !preset.source?.trim() ||
        !preset.medium?.trim()
      )
        throw new Error(
          "utmPlugin: each preset needs a label, source and medium.",
        );
    const policy = {
      allowedOrigins: options.allowedOrigins,
      normalization: options.normalization,
    };
    const authenticated: NonNullable<CollectionConfig["access"]>["read"] = ({
      req,
    }) => Boolean(req.user);
    const param = (
      name: string,
      label: { en: string; fr: string },
      required = false,
    ): Field => ({
      name,
      type: "text",
      required,
      maxLength: 512,
      index: ["source", "medium", "campaign", "campaignId"].includes(name),
      label,
    });
    let collection: CollectionConfig = {
      slug,
      // Same schema on Payload 3 and 4 (4 turns versions and createdBy/updatedBy
      // on by default); `overrides` can enable them.
      versions: false,
      ...({ authorship: false } as object),
      labels: {
        singular: { en: "UTM campaign", fr: "Campagne UTM" },
        plural: { en: "UTM campaigns", fr: "Campagnes UTM" },
      },
      admin: {
        useAsTitle: "title",
        group: "Marketing",
        defaultColumns: [
          "title",
          "source",
          "medium",
          "campaign",
          "generatedUrl",
          "state",
          "createdAt",
        ],
        listSearchableFields: [
          "title",
          "source",
          "medium",
          "campaign",
          "campaignId",
        ],
        description: {
          en: "Your campaigns: UTM values, the link to share, and optionally a personalized site for their visitors.",
          fr: "Vos campagnes : leurs UTM, le lien à partager et, si vous le souhaitez, un site personnalisé pour leurs visiteurs.",
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
          label: { en: "Link name", fr: "Nom du lien" },
        },
        {
          name: "destination",
          type: "text",
          maxLength: 8192,
          label: { en: "Destination URL", fr: "URL de destination" },
          admin: {
            description: {
              en: "Optional: fill it to get a link to share. Without it, the campaign still recognizes its visitors.",
              fr: "Facultatif : renseignez-la pour obtenir un lien à partager. Sans elle, la campagne reconnaît quand même ses visiteurs.",
            },
          },
          validate: (value: unknown) =>
            value == null || value === ""
              ? true
              : validateDestination(value, policy),
        },
        {
          type: "row",
          fields: [
            param(
              "source",
              { en: "Source · utm_source", fr: "Source · utm_source" },
              true,
            ),
            param("medium", {
              en: "Medium · utm_medium",
              fr: "Support · utm_medium",
            }),
          ],
        },
        param("campaign", {
          en: "Campaign · utm_campaign",
          fr: "Campagne · utm_campaign",
        }),
        {
          name: "generatedUrl",
          type: "text",
          label: { en: "Shareable link", fr: "Lien à partager" },
          admin: {
            readOnly: true,
            components: {
              Field: {
                path: "payload-plugin-utm/client#UtmUrlField",
                clientProps: {
                  presets: options.presets ?? [],
                  locale: options.locale ?? "en",
                  policy,
                  collectionSlug: slug,
                  csvExport: options.csvExport !== false,
                },
              },
              Cell: {
                path: "payload-plugin-utm/client#UtmUrlCell",
                clientProps: { locale: options.locale ?? "en" },
              },
            },
          },
        },
        {
          type: "collapsible",
          label: {
            en: "Optional parameters",
            fr: "Paramètres complémentaires",
          },
          fields: [
            param("campaignId", {
              en: "Campaign ID · utm_id",
              fr: "Identifiant de campagne · utm_id",
            }),
            param("content", {
              en: "Variation · utm_content",
              fr: "Variante · utm_content",
            }),
            param("term", {
              en: "Keyword · utm_term",
              fr: "Mot-clé · utm_term",
            }),
          ],
        },
        ...(options.relatedCollections?.length
          ? [
              {
                name: "relatedContent",
                type: "relationship",
                relationTo: options.relatedCollections,
                label: { en: "Related content", fr: "Contenu associé" },
                admin: {
                  description: {
                    en: "For organization only. The destination URL remains authoritative.",
                    fr: "Un rattachement interne. L’URL de destination reste celle saisie.",
                  },
                },
              } as Field,
            ]
          : []),
        {
          name: "notes",
          type: "textarea",
          label: { en: "Internal notes", fr: "Notes internes" },
        },
        {
          name: "state",
          type: "select",
          required: true,
          defaultValue: "active",
          index: true,
          label: { en: "Status", fr: "Classement" },
          options: [
            { label: { en: "Active", fr: "Actif" }, value: "active" },
            { label: { en: "Archived", fr: "Archivé" }, value: "archived" },
          ],
          admin: {
            position: "sidebar",
            description: {
              en: "Archiving organizes this inventory; shared URLs keep working.",
              fr: "L’archivage classe le lien ; les URL déjà partagées continuent de fonctionner.",
            },
          },
        },
      ],
      endpoints:
        options.csvExport === false ? [] : [csvEndpoint(slug, maxRows)],
    };
    if (options.overrides) collection = options.overrides(collection);
    if (collection.slug !== slug)
      throw new Error(
        "utmPlugin: change the slug with collectionSlug, not overrides.",
      );
    // Generate after application validation hooks; never trust a caller-supplied URL.
    collection = {
      ...collection,
      hooks: {
        ...collection.hooks,
        beforeValidate: [
          ...(collection.hooks?.beforeValidate ?? []),
          ({ data, originalDoc }) => {
            if (!data) return data;
            const clean = { ...data };
            for (const key of [
              "title",
              "destination",
              ...Object.keys(utmParameters),
            ])
              if (typeof clean[key] === "string")
                clean[key] =
                  key in utmParameters
                    ? normalizeUtmValue(clean[key], policy.normalization)
                    : clean[key].trim();
            return {
              ...clean,
              generatedUrl:
                buildUtmUrl({ ...originalDoc, ...clean }, policy) ?? "",
            };
          },
        ],
      },
    };
    const result: Config = {
      ...config,
      collections: [...(config.collections ?? []), collection],
    };
    return options.personalization
      ? withPersonalization(result, options.personalization, {
          locale: options.locale ?? "en",
          linksSlug: slug,
        })
      : result;
  };
}
function withPersonalization(
  config: Config,
  options: PersonalizationOptions,
  context: AudienceCollectionContext,
): Config {
  // Audiences live on the UTM campaigns themselves (one menu entry).
  if ((options as { audiencesSlug?: unknown }).audiencesSlug !== undefined)
    throw new Error(
      "utmPlugin: personalization.audiencesSlug was removed in 0.2.0-beta.4: audiences now live on UTM campaigns (Personalize the site tab).",
    );
  const slug = context.linksSlug;
  const blocks = options.blocks ?? [];
  if (
    blocks !== "all" &&
    (!Array.isArray(blocks) ||
      blocks.some((block) => typeof block !== "string" || !block))
  )
    throw new Error(
      "utmPlugin: personalization.blocks must be 'all' or a list of block slugs.",
    );
  const manifest = options.manifest ?? {};
  if (
    manifest.secret !== undefined &&
    (typeof manifest.secret !== "string" || manifest.secret.length < 16)
  )
    throw new Error(
      "utmPlugin: personalization.manifest.secret must be at least 16 characters.",
    );
  if (
    manifest.limit !== undefined &&
    (!Number.isInteger(manifest.limit) ||
      manifest.limit < 1 ||
      manifest.limit > 5000)
  )
    throw new Error(
      "utmPlugin: personalization.manifest.limit must be an integer between 1 and 5000.",
    );
  if (options.preview) {
    const { siteUrl, param, draftRoute } = options.preview;
    if (
      draftRoute !== undefined &&
      (typeof draftRoute !== "string" ||
        !/^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(draftRoute))
    )
      throw new Error(
        "utmPlugin: personalization.preview.draftRoute must be a path such as /api/utm-preview.",
      );
    if (
      siteUrl !== undefined &&
      (validateDestination(siteUrl) !== true ||
        new URL(siteUrl).origin !== siteUrl)
    )
      throw new Error(
        "utmPlugin: personalization.preview.siteUrl must be an exact origin, e.g. https://example.com.",
      );
    if (param !== undefined && !/^[A-Za-z0-9_.-]{1,64}$/.test(param))
      throw new Error(
        "utmPlugin: personalization.preview.param must be a URL parameter name.",
      );
  }
  if (
    options.afterAudienceChange !== undefined &&
    typeof options.afterAudienceChange !== "function"
  )
    throw new Error(
      "utmPlugin: personalization.afterAudienceChange must be a function.",
    );
  const paths = options.paths;
  if (paths !== undefined) {
    const resolvers = [
      ...Object.values(paths.collections ?? {}),
      ...Object.values(paths.globals ?? {}),
    ];
    if (!resolvers.length || resolvers.some((fn) => typeof fn !== "function"))
      throw new Error(
        "utmPlugin: personalization.paths needs path functions per collection or global slug.",
      );
    if (
      paths.limit !== undefined &&
      (!Number.isInteger(paths.limit) || paths.limit < 1 || paths.limit > 10000)
    )
      throw new Error(
        "utmPlugin: personalization.paths.limit must be an integer between 1 and 10000.",
      );
  }
  if (
    options.content?.fields !== undefined &&
    !Array.isArray(options.content.fields)
  )
    throw new Error(
      "utmPlugin: personalization.content.fields must be an array of fields.",
    );
  if (options.ga4 !== undefined) {
    const ga4 = options.ga4;
    if (!ga4 || !/^\d{4,20}$/.test(String(ga4.propertyId ?? "")))
      throw new Error(
        "utmPlugin: personalization.ga4.propertyId must be a numeric GA4 property ID.",
      );
    if (
      !ga4.getAccessToken &&
      !(ga4.credentials?.client_email && ga4.credentials?.private_key)
    )
      throw new Error(
        "utmPlugin: personalization.ga4 needs credentials (service account client_email + private_key) or getAccessToken().",
      );
  }
  const stats = statsSettings(options);
  if (stats) {
    if (!/^[a-z][a-z0-9-]*$/.test(stats.slug) || stats.slug === slug)
      throw new Error(
        "utmPlugin: personalization.stats.slug must be a distinct lowercase slug.",
      );
    if (config.collections?.some((c) => c.slug === stats.slug))
      throw new Error(`utmPlugin: collection "${stats.slug}" already exists.`);
    if (
      !Number.isInteger(stats.retentionDays) ||
      stats.retentionDays < 1 ||
      stats.retentionDays > 3650
    )
      throw new Error(
        "utmPlugin: personalization.stats.retentionDays must be an integer between 1 and 3650.",
      );
    if (
      !Number.isInteger(stats.reportLimit) ||
      stats.reportLimit < 100 ||
      stats.reportLimit > 500_000
    )
      throw new Error(
        "utmPlugin: personalization.stats.reportLimit must be an integer between 100 and 500000.",
      );
    if (
      stats.allowedOrigins !== undefined &&
      (!Array.isArray(stats.allowedOrigins) ||
        stats.allowedOrigins.some((origin) => {
          try {
            return new URL(origin).origin !== origin;
          } catch {
            return true;
          }
        }))
    )
      throw new Error(
        "utmPlugin: personalization.stats.allowedOrigins must be exact origins, e.g. https://example.com.",
      );
  }
  const personalization = campaignPersonalization(slug, options, context);
  const linkCollections = (config.collections ?? []).map((collection) => {
    if (collection.slug !== slug) return collection;
    // Title on top; link fields, personalization and statistics in tabs; sidebar fields stay.
    const isSidebar = (field: Field) =>
      "admin" in field &&
      (field.admin as { position?: string } | undefined)?.position ===
        "sidebar";
    const isTitle = (field: Field) => "name" in field && field.name === "title";
    const head = collection.fields.filter(isTitle);
    const sidebar = collection.fields.filter(
      (field) => !isTitle(field) && isSidebar(field),
    );
    const main = collection.fields.filter(
      (field) => !isTitle(field) && !isSidebar(field),
    );
    // List columns: personalization status badges, and arrivals over 30 days (computed, not stored).
    const listColumns: Field[] = stats
      ? [
          {
            name: "arrivals30d",
            type: "number",
            virtual: true,
            label: { en: "Arrivals (30 days)", fr: "Arrivées (30 j)" },
            admin: {
              position: "sidebar",
              readOnly: true,
              components: {
                Field: "payload-plugin-utm/client#HiddenField",
                Cell: {
                  path: "payload-plugin-utm/client#CampaignArrivalsCell",
                  clientProps: { statsSlug: stats.slug },
                },
              },
            },
          } as Field,
        ]
      : [];
    const fields: Field[] = [
      ...head,
      {
        type: "tabs",
        tabs: [
          { label: { en: "Link", fr: "Lien" }, fields: main },
          {
            label: { en: "Personalize the site", fr: "Personnaliser le site" },
            fields: personalization.fields,
          },
          ...(stats
            ? [
                {
                  label: { en: "Statistics", fr: "Statistiques" },
                  fields: [
                    {
                      name: "campaignStats",
                      type: "ui",
                      admin: {
                        components: {
                          Field: {
                            path: "payload-plugin-utm/client#CampaignStats",
                            clientProps: {
                              locale: context.locale,
                              statsSlug: stats.slug,
                              linksSlug: slug,
                              ga4: Boolean(options.ga4),
                            },
                          },
                        },
                      },
                    } as Field,
                  ],
                },
              ]
            : []),
        ],
      } as Field,
      ...sidebar,
      ...listColumns,
    ];
    return {
      ...collection,
      fields,
      admin: {
        ...collection.admin,
        defaultColumns: [
          ...(collection.admin?.defaultColumns ?? []).filter(
            (column) => column !== "createdAt",
          ),
          "personalize",
          ...(stats ? ["arrivals30d"] : []),
        ],
        components: {
          ...collection.admin?.components,
          ...(stats
            ? {
                beforeList: [
                  ...(collection.admin?.components?.beforeList ?? []),
                  {
                    path: "payload-plugin-utm/rsc#DetectedCampaigns",
                    serverProps: {
                      pluginOptions: {
                        locale: context.locale,
                        linksSlug: slug,
                        statsSlug: stats.slug,
                        statsLimit: stats.reportLimit,
                      },
                    },
                  },
                ],
              }
            : {}),
        },
      },
      hooks: {
        ...collection.hooks,
        beforeValidate: [
          ...(collection.hooks?.beforeValidate ?? []),
          ...(personalization.hooks.beforeValidate ?? []),
        ],
        afterChange: [
          ...(collection.hooks?.afterChange ?? []),
          ...(personalization.hooks.afterChange ?? []),
        ],
        afterDelete: [
          ...(collection.hooks?.afterDelete ?? []),
          ...(personalization.hooks.afterDelete ?? []),
        ],
      },
      endpoints: [
        ...(Array.isArray(collection.endpoints) ? collection.endpoints : []),
        ...personalization.endpoints,
        ...(options.ga4 ? [ga4Endpoint(options.ga4)] : []),
      ],
    } as CollectionConfig;
  });
  const viewPath =
    options.adminView === false
      ? null
      : (options.adminView?.path ?? "/personalization");
  if (viewPath !== null && !/^\/[a-z0-9][a-z0-9/-]*$/.test(viewPath))
    throw new Error(
      "utmPlugin: personalization.adminView.path must look like /personalization.",
    );
  const ui = {
    locale: context.locale,
    previewParam:
      options.preview === false
        ? null
        : (options.preview?.param ?? "utm_preview"),
    siteUrl: options.preview ? options.preview.siteUrl : undefined,
    draftRoute: options.preview ? options.preview.draftRoute : undefined,
  };
  const withCollection: Config = {
    ...config,
    // Read by buildAudienceManifest(payload) so a proxy can load the manifest without HTTP.
    custom: {
      ...config.custom,
      [MANIFEST_SETTINGS_KEY]: {
        audiencesSlug: slug,
        limit: manifest.limit ?? 500,
        paths: options.paths,
      },
    },
    collections: [
      ...linkCollections,
      ...(stats ? [viewsCollection(stats)] : []),
    ],
  };
  const {
    config: result,
    targets,
    blockLabels,
  } = blocks === "all" || blocks.length
    ? addPersonalizationToBlocks(withCollection, blocks, slug, ui)
    : { config: withCollection, targets: [], blockLabels: {} };
  if (options.paths) {
    // A personalized collection without a resolver would silently lose its variants.
    const missing = targets
      .filter(
        (target) =>
          !(
            target.kind === "collection"
              ? options.paths?.collections
              : options.paths?.globals
          )?.[target.slug],
      )
      .map((target) => `${target.kind} "${target.slug}"`);
    if (missing.length)
      throw new Error(
        `utmPlugin: personalization.paths needs a resolver for ${missing.join(", ")}, or remove paths to rewrite every page.`,
      );
  }
  if (viewPath === null) return result;
  // Payload 4 moved DefaultTemplate from @payloadcms/next/templates to
  // @payloadcms/ui/rsc; `createPayloadRequestFromWebRequest` only exists in 4.
  const templatePath =
    "createPayloadRequestFromWebRequest" in payloadRuntime
      ? "@payloadcms/ui/rsc#DefaultTemplate"
      : "@payloadcms/next/templates#DefaultTemplate";
  const views = result.admin?.components?.views ?? {};
  if (views.utmPersonalization)
    throw new Error(
      'utmPlugin: admin view "utmPersonalization" already exists.',
    );
  return {
    ...result,
    admin: {
      ...result.admin,
      dependencies: {
        ...result.admin?.dependencies,
        utmPersonalizationTemplate: { path: templatePath, type: "component" },
      },
      components: {
        ...result.admin?.components,
        views: {
          ...views,
          utmPersonalization: {
            path: viewPath as `/${string}`,
            exact: true,
            Component: {
              path: "payload-plugin-utm/rsc#PersonalizationView",
              serverProps: {
                pluginOptions: {
                  ...ui,
                  audiencesSlug: slug,
                  linksSlug: context.linksSlug,
                  statsSlug: stats?.slug ?? null,
                  statsLimit: stats?.reportLimit ?? null,
                  targets,
                  blockLabels,
                  templatePath,
                },
              },
            },
          },
        },
        afterNavLinks: [
          ...(result.admin?.components?.afterNavLinks ?? []),
          {
            path: "payload-plugin-utm/client#PersonalizationNavLink",
            clientProps: { locale: context.locale, path: viewPath },
          },
        ],
      },
    },
  };
}
