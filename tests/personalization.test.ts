import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type {
  Block,
  CollectionConfig,
  Config,
  Field,
  PayloadRequest,
} from "payload";
import { NextRequest } from "next/server.js";
import { utmPlugin } from "../src/index.js";
import {
  clearManifestCache,
  createPersonalizationMiddleware,
} from "../src/next.js";
import {
  conditionMatches,
  filterPersonalizedBlocks,
  hasCampaignParameters,
  parseAudienceManifest,
  resolveAudience,
  type AudienceManifest,
} from "../src/personalization/match.js";

const q = (query: string) => new URLSearchParams(query);
const manifest: AudienceManifest = {
  version: 1,
  audiences: [
    {
      id: 2,
      key: "restaurants",
      priority: 10,
      match: "all",
      conditions: [
        { parameter: "utm_medium", operator: "equals", value: "qr" },
      ],
    },
    {
      id: 1,
      key: "restaurant-a",
      priority: 0,
      match: "all",
      conditions: [
        { parameter: "utm_source", operator: "equals", value: "Restaurant-A" },
        { parameter: "utm_medium", operator: "in", value: "qr, flyer" },
      ],
    },
    {
      id: 3,
      key: "partners",
      priority: 5,
      match: "any",
      conditions: [
        { parameter: "ref", operator: "startsWith", value: "partner-" },
      ],
    },
  ],
};

test("operators compare trimmed, case-insensitive values", () => {
  const p = q("UTM_SOURCE=%20Restaurant-A%20&utm_campaign=summer-2026");
  assert(
    conditionMatches(p, {
      parameter: "utm_source",
      operator: "equals",
      value: "restaurant-a",
    }),
  );
  assert(
    conditionMatches(p, {
      parameter: "utm_campaign",
      operator: "contains",
      value: "SUMMER",
    }),
  );
  assert(
    conditionMatches(p, {
      parameter: "utm_campaign",
      operator: "startsWith",
      value: "summer",
    }),
  );
  assert(conditionMatches(p, { parameter: "utm_source", operator: "exists" }));
  assert(!conditionMatches(p, { parameter: "utm_term", operator: "exists" }));
  assert(
    conditionMatches(p, {
      parameter: "utm_source",
      operator: "in",
      value: "x, restaurant-a",
    }),
  );
  assert(
    conditionMatches(p, {
      parameter: "utm_source",
      operator: "notEquals",
      value: "other",
    }),
  );
  assert(
    !conditionMatches(p, {
      parameter: "utm_term",
      operator: "contains",
      value: "",
    }),
  );
});

test("resolves the lowest priority matching audience, any/all semantics", () => {
  assert.equal(
    resolveAudience(q("utm_source=restaurant-a&utm_medium=qr"), manifest)?.key,
    "restaurant-a",
  );
  assert.deepEqual(resolveAudience(q("utm_source=b&utm_medium=qr"), manifest), {
    key: "restaurants",
    id: 2,
  });
  assert.equal(resolveAudience(q("ref=partner-12"), manifest)?.key, "partners");
  assert.equal(resolveAudience(q("utm_source=nobody"), manifest), null);
  assert(hasCampaignParameters(q("ref=x"), manifest));
  assert(hasCampaignParameters(q("utm_id=1"), manifest));
  assert(!hasCampaignParameters(q("page=2&utm_source="), manifest));
});

test("manifest parser drops malformed or reserved entries", () => {
  const parsed = parseAudienceManifest({
    audiences: [
      {
        key: "ok",
        conditions: [
          { parameter: "utm_source", operator: "equals", value: "a" },
        ],
      },
      {
        key: "ok",
        conditions: [
          { parameter: "utm_source", operator: "equals", value: "dup" },
        ],
      },
      {
        key: "default",
        conditions: [{ parameter: "utm_source", operator: "exists" }],
      },
      {
        key: "../evil",
        conditions: [{ parameter: "utm_source", operator: "exists" }],
      },
      { key: "no-rules", conditions: [] },
      {
        key: "bad-op",
        conditions: [
          { parameter: "utm_source", operator: "regex", value: ".*" },
        ],
      },
    ],
  });
  assert.deepEqual(
    parsed.audiences.map((a) => a.key),
    ["ok"],
  );
  assert.deepEqual(parseAudienceManifest("nonsense"), {
    version: 1,
    audiences: [],
  });
});

test("filters blocks by populated docs or raw IDs", () => {
  const blocks = [
    {
      id: "default-hero",
      personalization: {
        mode: "except",
        audiences: [{ id: 1, key: "restaurant-a" }],
      },
    },
    { id: "hero-a", personalization: { mode: "only", audiences: [1] } },
    { id: "always" },
    {
      id: "polymorphic",
      personalization: {
        mode: "only",
        audiences: [{ relationTo: "utm-audiences", value: 1 }],
      },
    },
  ];
  const ids = (list: { id: string }[]) => list.map((b) => b.id);
  assert.deepEqual(ids(filterPersonalizedBlocks(blocks, null)), [
    "default-hero",
    "always",
  ]);
  assert.deepEqual(
    ids(filterPersonalizedBlocks(blocks, { key: "restaurant-a", id: 1 })),
    ["hero-a", "always", "polymorphic"],
  );
  // Without an ID (static mode, depth 0) only populated docs can match.
  assert.deepEqual(ids(filterPersonalizedBlocks(blocks, "restaurant-a")), [
    "always",
  ]);
  assert.deepEqual(ids(filterPersonalizedBlocks(blocks, "../bad")), [
    "default-hero",
    "always",
  ]);
});

const hero: Block = { slug: "hero", fields: [{ name: "title", type: "text" }] };
const cta: Block = { slug: "cta", fields: [{ name: "label", type: "text" }] };
const hasPersonalization = (block: Block) =>
  block.fields.some((f) => "name" in f && f.name === "personalization");
const blocksOf = (field: Field | undefined) =>
  (field as { blocks: Block[] }).blocks;

test("adds audiences collection and injects visibility into targeted blocks everywhere", async () => {
  const pages: CollectionConfig = {
    slug: "pages",
    fields: [
      {
        type: "tabs",
        tabs: [
          {
            label: "Content",
            fields: [{ name: "layout", type: "blocks", blocks: [hero, cta] }],
          },
        ],
      },
      {
        name: "sections",
        type: "array",
        fields: [
          {
            name: "inner",
            type: "blocks",
            blocks: [
              {
                slug: "wrapper",
                fields: [{ name: "nested", type: "blocks", blocks: [hero] }],
              },
            ],
          },
        ],
      },
    ],
  };
  const input = {
    collections: [pages],
    globals: [
      {
        slug: "home",
        fields: [{ name: "layout", type: "blocks", blocks: [hero] }],
      },
    ],
    blocks: [hero],
  } as unknown as Config;
  const result = await utmPlugin({ personalization: { blocks: ["hero"] } })(
    input,
  );
  assert(!hasPersonalization(hero), "input blocks are not mutated");
  assert.deepEqual(
    result.collections!.map((c) => c.slug),
    ["pages", "utm-links", "utm-audiences"],
  );
  const resultPages = result.collections![0]!;
  const tabs = resultPages.fields[0] as { tabs: { fields: Field[] }[] };
  const [h, c] = blocksOf(tabs.tabs[0]!.fields[0]);
  assert(hasPersonalization(h!));
  assert(!hasPersonalization(c!));
  const array = resultPages.fields[1] as { fields: Field[] };
  const wrapper = blocksOf(array.fields[0])[0]!;
  assert(!hasPersonalization(wrapper));
  assert(
    hasPersonalization(blocksOf(wrapper.fields[0])[0]!),
    "nested target reached",
  );
  assert(hasPersonalization(blocksOf(result.globals![0]!.fields[0])[0]!));
  assert(hasPersonalization(result.blocks![0]!));
});

test("personalization is opt-in and validates options", async () => {
  const base = await utmPlugin()({ collections: [] } as unknown as Config);
  assert.deepEqual(
    base.collections!.map((c) => c.slug),
    ["utm-links"],
  );
  const run = (personalization: unknown) =>
    utmPlugin({ personalization } as never)({
      collections: [],
    } as unknown as Config);
  assert.throws(() => run({ audiencesSlug: "Bad Slug" }), /audiencesSlug/);
  assert.throws(() => run({ blocks: "hero" }), /blocks/);
  assert.throws(() => run({ manifest: { secret: "short" } }), /secret/);
  assert.throws(() => run({ manifest: { limit: 0 } }), /limit/);
  assert.throws(
    () =>
      utmPlugin({ personalization: {} })({
        collections: [{ slug: "utm-audiences", fields: [] }],
      } as unknown as Config),
    /already exists/,
  );
});

const audiencesConfig = async (manifestOptions = {}) => {
  const result = await utmPlugin({
    personalization: { manifest: manifestOptions },
  })({
    collections: [],
  } as unknown as Config);
  return result.collections!.find((c) => c.slug === "utm-audiences")!;
};

test("audience key validation rejects reserved and unsafe keys", async () => {
  const collection = await audiencesConfig();
  const key = collection.fields.find(
    (f) => "name" in f && f.name === "key",
  ) as {
    validate: (v: unknown) => true | string;
  };
  assert.equal(key.validate("restaurant-a"), true);
  for (const bad of ["default", "Restaurant", "../x", "", "a".repeat(65)])
    assert.notEqual(key.validate(bad), true);
});

test("manifest endpoint publishes a fixed projection of active audiences", async () => {
  const collection = await audiencesConfig({
    secret: "s".repeat(20),
    tenantField: "tenant",
  });
  const handler = (collection.endpoints || [])[0]!.handler;
  let args: Record<string, unknown> | undefined;
  const req = (auth: string, query: Record<string, unknown> = {}) =>
    ({
      headers: new Headers(auth ? { authorization: auth } : {}),
      query,
      payload: {
        find: async (input: Record<string, unknown>) => {
          args = input;
          return {
            docs: [
              {
                id: 7,
                key: "vip",
                priority: 1,
                match: "any",
                notes: "secret notes",
                conditions: [
                  {
                    parameter: "custom",
                    customParameter: "ref",
                    operator: "equals",
                    value: "vip",
                  },
                ],
              },
            ],
          };
        },
      },
    }) as unknown as PayloadRequest;
  assert.equal((await handler(req(""))).status, 401);
  const ok = await handler(req(`Bearer ${"s".repeat(20)}`, { tenant: "12" }));
  assert.equal(ok.status, 200);
  assert.deepEqual(args!.where, {
    and: [{ state: { equals: "active" } }, { tenant: { equals: "12" } }],
  });
  assert.equal(ok.headers.get("cache-control"), "private, max-age=30");
  const body = await ok.json();
  assert.deepEqual(body.audiences, [
    {
      key: "vip",
      id: 7,
      priority: 1,
      match: "any",
      conditions: [{ parameter: "ref", operator: "equals", value: "vip" }],
    },
  ]);
  assert(!JSON.stringify(body).includes("secret notes"));
  const bad = await handler(
    req(`Bearer ${"s".repeat(20)}`, { tenant: { not_equals: "x" } }),
  );
  assert.equal(bad.status, 400);
});

beforeEach(() => clearManifestCache());
const middleware = (
  options: Parameters<typeof createPersonalizationMiddleware>[0] = {},
) =>
  createPersonalizationMiddleware({ loadManifest: () => manifest, ...options });
const request = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "https://site.test"), {
    headers: { ...(cookie ? { cookie } : {}), "x-utm-audience": "spoofed" },
  });
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

test("middleware resolves from URL, forwards headers and sets a last-touch cookie", async () => {
  const response = await middleware()(
    request("/menu?utm_source=restaurant-a&utm_medium=qr"),
  );
  assert.equal(forwarded(response, "x-utm-audience"), "restaurant-a");
  assert.equal(forwarded(response, "x-utm-audience-id"), "1");
  const cookie = response.cookies.get("utm_audience");
  assert.equal(cookie?.value, "restaurant-a");
  assert.equal(cookie?.httpOnly, true);
  // A new campaign matching nothing clears the remembered audience.
  const reset = await middleware()(
    request("/?utm_source=google", "utm_audience=restaurant-a"),
  );
  assert.equal(
    forwarded(reset, "x-utm-audience"),
    null,
    "spoofed header stripped",
  );
  assert.equal(reset.cookies.get("utm_audience")?.value, "");
});

test("middleware reuses only known cookie keys and honours consent", async () => {
  const known = await middleware()(request("/about", "utm_audience=partners"));
  assert.equal(forwarded(known, "x-utm-audience"), "partners");
  const unknown = await middleware()(
    request("/about", "utm_audience=deleted-one"),
  );
  assert.equal(forwarded(unknown, "x-utm-audience"), null);
  const noConsent = await middleware({ consent: () => false })(
    request("/?utm_medium=qr", "utm_audience=partners"),
  );
  assert.equal(forwarded(noConsent, "x-utm-audience"), "restaurants");
  assert.equal(noConsent.cookies.get("utm_audience"), undefined);
  const ignoredCookie = await middleware({ consent: () => false })(
    request("/", "utm_audience=partners"),
  );
  assert.equal(forwarded(ignoredCookie, "x-utm-audience"), null);
});

test("static mode rewrites to the audience segment and redirects direct hits", async () => {
  const run = middleware({ rewrite: { prefix: "variants" } });
  const rewritten = await run(request("/menu?utm_medium=qr"));
  assert.equal(
    new URL(rewritten.headers.get("x-middleware-rewrite")!).pathname,
    "/variants/restaurants/menu",
  );
  const home = await run(request("/?utm_medium=qr"));
  assert.equal(
    new URL(home.headers.get("x-middleware-rewrite")!).pathname,
    "/variants/restaurants",
  );
  const plain = await run(request("/menu"));
  assert.equal(plain.headers.get("x-middleware-rewrite"), null);
  const direct = await run(request("/variants/restaurants/menu?x=1"));
  assert.equal(direct.status, 308);
  assert.equal(new URL(direct.headers.get("location")!).pathname, "/menu");
  assert.throws(
    () => createPersonalizationMiddleware({ rewrite: { prefix: "_private" } }),
    /prefix/,
  );
});

test("manifest failures never break requests and stale rules are reused", async () => {
  let calls = 0;
  const flaky = createPersonalizationMiddleware({
    cacheTtlSeconds: 0,
    loadManifest: () => {
      calls += 1;
      if (calls > 1) throw new Error("down");
      return manifest;
    },
  });
  const first = await flaky(request("/?utm_medium=qr"));
  assert.equal(forwarded(first, "x-utm-audience"), "restaurants");
  const second = await flaky(request("/?utm_medium=qr"));
  assert.equal(forwarded(second, "x-utm-audience"), "restaurants");
  clearManifestCache();
  const empty = await createPersonalizationMiddleware({
    loadManifest: () => {
      throw new Error("down");
    },
  })(request("/?utm_medium=qr"));
  assert.equal(empty.status, 200);
  assert.equal(forwarded(empty, "x-utm-audience"), null);
});
