import type {
  CollectionConfig,
  CollectionSlug,
  Config,
  Field,
  Plugin,
} from "payload";
import type {
  AudienceCollectionContext,
  PersonalizationOptions,
} from "./personalization/collection.js";
import { csvEndpoint } from "./csv-endpoint.js";
import {
  addPersonalizationToBlocks,
  audiencesCollection,
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
export { getAudienceContent } from "./personalization/server.js";
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
      labels: {
        singular: { en: "UTM link", fr: "Lien UTM" },
        plural: { en: "UTM links", fr: "Liens UTM" },
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
          en: "Create and organize campaign links. Analytics results are not collected by this plugin.",
          fr: "Créez et retrouvez vos liens de campagne. Ce plugin ne collecte pas les résultats Analytics.",
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
          required: true,
          maxLength: 8192,
          label: { en: "Destination URL", fr: "URL de destination" },
          validate: (value: unknown) => validateDestination(value, policy),
        },
        {
          type: "row",
          fields: [
            param(
              "source",
              { en: "Source · utm_source", fr: "Source · utm_source" },
              true,
            ),
            param(
              "medium",
              { en: "Medium · utm_medium", fr: "Support · utm_medium" },
              true,
            ),
          ],
        },
        param(
          "campaign",
          { en: "Campaign · utm_campaign", fr: "Campagne · utm_campaign" },
          true,
        ),
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
    if (options.personalization) {
      const audiencesSlug =
        options.personalization.audiencesSlug ?? "utm-audiences";
      collection = {
        ...collection,
        fields: [
          ...collection.fields,
          {
            name: "audience",
            type: "relationship",
            relationTo: audiencesSlug as CollectionSlug,
            index: true,
            label: {
              en: "Personalized audience",
              fr: "Audience personnalisée",
            },
            admin: {
              position: "sidebar",
              description: {
                en: "Optional: the audience this link is meant to trigger.",
                fr: "Facultatif : l’audience que ce lien doit déclencher.",
              },
            },
          } as Field,
          {
            name: "audienceCheck",
            type: "ui",
            admin: {
              position: "sidebar",
              components: {
                Field: {
                  path: "payload-plugin-utm/client#AudienceMatchNotice",
                  clientProps: {
                    locale: options.locale ?? "en",
                    audiencesSlug,
                    policy,
                  },
                },
              },
            },
          } as Field,
        ],
      };
    }
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
  const slug = options.audiencesSlug ?? "utm-audiences";
  if (!/^[a-z][a-z0-9-]*$/.test(slug))
    throw new Error(
      "utmPlugin: personalization.audiencesSlug must contain lowercase letters, digits and hyphens.",
    );
  if (config.collections?.some((collection) => collection.slug === slug))
    throw new Error(`utmPlugin: collection "${slug}" already exists.`);
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
    const { siteUrl, param } = options.preview;
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
  let audiences = audiencesCollection(slug, options, context);
  if (options.overrides) audiences = options.overrides(audiences);
  if (audiences.slug !== slug)
    throw new Error(
      "utmPlugin: change the audiences slug with personalization.audiencesSlug, not overrides.",
    );
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
  };
  const withCollection: Config = {
    ...config,
    collections: [...(config.collections ?? []), audiences],
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
  const views = result.admin?.components?.views ?? {};
  if (views.utmPersonalization)
    throw new Error(
      'utmPlugin: admin view "utmPersonalization" already exists.',
    );
  return {
    ...result,
    admin: {
      ...result.admin,
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
                  targets,
                  blockLabels,
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
