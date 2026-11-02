import type { CollectionConfig, Field, Plugin } from "payload";
import { csvEndpoint } from "./csv-endpoint.js";
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
    return {
      ...config,
      collections: [...(config.collections ?? []), collection],
    };
  };
}
