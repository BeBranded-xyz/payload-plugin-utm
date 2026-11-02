import type { CollectionConfig, CollectionSlug } from "payload";
import type { UtmUrlOptions } from "./utilities.js";
export type UtmPreset = {
  label: string;
  source: string;
  medium: string;
  content?: string;
};
export type UtmPluginOptions = UtmUrlOptions & {
  enabled?: boolean;
  collectionSlug?: string;
  relatedCollections?: CollectionSlug[];
  presets?: UtmPreset[];
  /** Custom controls; Payload field labels support both languages. */
  locale?: "en" | "fr";
  /** Export cap, 1–10000; default 1000. */
  csvExport?: false | { maxRows?: number };
  overrides?: (collection: CollectionConfig) => CollectionConfig;
};
