import assert from "node:assert/strict";
import { test } from "node:test";
import type { CollectionConfig, Config, PayloadRequest } from "payload";
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant";
import { utmPlugin } from "../src/index.js";

const makeCollection = async (
  options: Parameters<typeof utmPlugin>[0] = {},
) => {
  const result = await utmPlugin(options)({
    collections: [],
  } as unknown as Config);
  return result.collections![0]!;
};

test("appends a private collection without mutating existing collections", async () => {
  const original = {
    collections: [{ slug: "pages", fields: [] }],
  } as unknown as Config;
  const result = await utmPlugin()(original);
  assert.equal(original.collections?.length, 1);
  assert.equal(result.collections?.length, 2);
  const collection = result.collections![1]!;
  assert.equal(collection.slug, "utm-links");
  for (const access of Object.values(collection.access!)) {
    assert.equal(await access({ req: { user: null } } as never), false);
    assert.equal(await access({ req: { user: { id: 1 } } } as never), true);
  }
});
test("disabled plugin leaves the input config untouched", async () => {
  const config = { collections: [] } as unknown as Config;
  assert.equal(await utmPlugin({ enabled: false })(config), config);
});
test("checks slug conflicts, invalid options, origins and preset definitions", async () => {
  assert.throws(
    () =>
      utmPlugin({ collectionSlug: "not/a/slug" })({
        collections: [],
      } as unknown as Config),
    /collectionSlug/,
  );
  assert.throws(
    () =>
      utmPlugin()({
        collections: [{ slug: "utm-links", fields: [] }],
      } as unknown as Config),
    /already exists/,
  );
  assert.throws(
    () =>
      utmPlugin({ allowedOrigins: ["https://example.com/path"] })({
        collections: [],
      } as unknown as Config),
    /origins/,
  );
  assert.throws(
    () =>
      utmPlugin({ csvExport: { maxRows: 0 } })({
        collections: [],
      } as unknown as Config),
    /maxRows/,
  );
  assert.throws(
    () =>
      utmPlugin({ presets: [{ label: "Invalid", source: "", medium: "" }] })({
        collections: [],
      } as unknown as Config),
    /preset/,
  );
  assert.throws(
    () =>
      utmPlugin({
        overrides: (collection) => ({ ...collection, slug: "changed" }),
      })({ collections: [] } as unknown as Config),
    /collectionSlug/,
  );
});
test("server recomputes forged URLs and handles partial updates", async () => {
  const collection = await makeCollection();
  const hook = collection.hooks!.beforeValidate!.at(-1)!;
  const data = {
    destination: "https://example.com/",
    source: " instagram ",
    medium: "social",
    campaign: "launch",
    generatedUrl: "javascript:bad",
  };
  const created = await hook({ data } as never);
  assert.equal(created.source, "instagram");
  assert.equal(
    new URL(created.generatedUrl).searchParams.get("utm_source"),
    "instagram",
  );
  const changed = await hook({
    data: { notes: "new note", generatedUrl: "forged" },
    originalDoc: created,
  } as never);
  assert.equal(changed.generatedUrl, created.generatedUrl);
  assert.equal(changed.notes, "new note");
});
test("application hooks and access customization are retained", async () => {
  const customRead = () => false;
  const collection = await makeCollection({
    overrides: (collection) => ({
      ...collection,
      access: { ...collection.access, read: customRead },
      hooks: {
        beforeValidate: [
          ({ data }) => ({ ...data, campaign: "hook-campaign" }),
        ],
      },
    }),
  });
  assert.equal(collection.access!.read, customRead);
  let data = {
    destination: "https://example.com",
    source: "a",
    medium: "b",
    campaign: "old",
  };
  for (const hook of collection.hooks!.beforeValidate!)
    data = await hook({ data } as never);
  assert.equal(
    new URL(
      (data as unknown as { generatedUrl: string }).generatedUrl,
    ).searchParams.get("utm_campaign"),
    "hook-campaign",
  );
});
test("optional relationship schema and CSV disable are supported", async () => {
  const collection = await makeCollection({
    collectionSlug: "campaign-links",
    relatedCollections: ["pages"],
    csvExport: false,
  });
  assert.equal(collection.slug, "campaign-links");
  assert(
    collection.fields.some(
      (field) => "name" in field && field.name === "relatedContent",
    ),
  );
  assert.equal((collection.endpoints || []).length, 0);
});
test("composes with Payload multi-tenant plugin when installed before it", async () => {
  const users: CollectionConfig = { slug: "users", auth: true, fields: [] };
  const tenants: CollectionConfig = {
    slug: "tenants",
    fields: [{ name: "name", type: "text" }],
  };
  const initial = await utmPlugin()({
    collections: [users, tenants],
    admin: { user: "users" },
  } as unknown as Config);
  const result = await multiTenantPlugin({ collections: { "utm-links": {} } })(
    initial,
  );
  const links = result.collections!.find(
    (collection) => collection.slug === "utm-links",
  )!;
  assert(
    links.fields.some((field) => "name" in field && field.name === "tenant"),
  );
  assert(links.access?.read);
});
test("CSV export denies anonymous requests without querying the database", async () => {
  const collection = await makeCollection();
  const handler = (collection.endpoints || [])[0]!.handler;
  const response = await handler({
    user: null,
    payload: {
      find: () => {
        throw new Error("must not query");
      },
    },
  } as unknown as PayloadRequest);
  assert.equal(response.status, 401);
});
test("CSV export preserves the request and access permissions, accepts where filters", async () => {
  const collection = await makeCollection({ csvExport: { maxRows: 5 } });
  const where = { campaign: { equals: "launch" } };
  let args: Record<string, unknown> | undefined;
  const req = {
    user: { id: 1 },
    query: { where },
    payload: {
      find: async (input: Record<string, unknown>) => {
        args = input;
        return {
          docs: [{ title: "Allowed link", campaign: "launch" }],
          hasNextPage: false,
        };
      },
    },
  } as unknown as PayloadRequest;
  const response = await (collection.endpoints || [])[0]!.handler(req);
  assert.equal(response.status, 200);
  assert.equal(args!.req, req);
  assert.equal(args!.overrideAccess, false);
  assert.equal(args!.depth, 0);
  assert.deepEqual(args!.where, where);
  assert.equal(args!.limit, 6);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert((await response.text()).includes("Allowed link"));
});
test("CSV export rejects malformed filters and over-limit datasets", async () => {
  const collection = await makeCollection({ csvExport: { maxRows: 1 } });
  const handler = (collection.endpoints || [])[0]!.handler;
  const bad = await handler({
    user: { id: 1 },
    query: { where: "bad filter" },
  } as unknown as PayloadRequest);
  assert.equal(bad.status, 400);
  const large = await handler({
    user: { id: 1 },
    query: {},
    payload: { find: async () => ({ docs: [{}, {}], hasNextPage: false }) },
  } as unknown as PayloadRequest);
  assert.equal(large.status, 413);
});
