import path from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, type Block } from "payload";
import { utmPlugin } from "payload-plugin-utm";
import { seed } from "./seed";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const hero: Block = {
  slug: "hero",
  labels: { singular: "Hero", plural: "Heroes" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "text", type: "textarea" },
  ],
};
const cta: Block = {
  slug: "cta",
  labels: { singular: "Call to action", plural: "Calls to action" },
  fields: [{ name: "label", type: "text", required: true }],
};

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || "dev-only-secret-0123456789abcdef",
  admin: { user: "users", importMap: { baseDir: dirname } },
  db: sqliteAdapter({
    client: { url: `file:${path.resolve(dirname, "dev.db")}` },
  }),
  localization: { locales: ["fr", "en"], defaultLocale: "fr" },
  collections: [
    { slug: "users", auth: true, fields: [] },
    {
      slug: "pages",
      admin: { useAsTitle: "title" },
      versions: { drafts: true },
      access: { read: () => true },
      fields: [
        { name: "title", type: "text", required: true, localized: true },
        { name: "slug", type: "text", required: true, unique: true },
        {
          name: "layout",
          type: "blocks",
          localized: true,
          blocks: [hero, cta],
        },
      ],
    },
  ],
  plugins: [
    utmPlugin({
      locale: "fr",
      personalization: {
        blocks: ["hero", "cta"],
        preview: { draftRoute: "/api/utm-preview" },
        stats: true,
        paths: {
          collections: {
            pages: ({ doc, locale }) => {
              const slug = doc.slug === "home" ? "" : `/${String(doc.slug)}`;
              return locale === "en" ? `/en${slug}` : slug || "/";
            },
          },
        },
      },
    }),
  ],
  typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
  onInit: seed,
});
