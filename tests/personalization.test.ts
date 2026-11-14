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
  REFERRER_PARAMETER,
  audienceDocToRule,
  audienceDraftFromLink,
  fillAudienceTokens,
  normalizeHost,
  parseSourceMemory,
  serializeSourceMemory,
  conditionMatches,
  exampleCampaignQuery,
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

const memoryCookie = (response: Response) =>
  (
    response as unknown as {
      cookies: {
        get: (
          n: string,
        ) => { value: string; httpOnly?: boolean; maxAge?: number } | undefined;
      };
    }
  ).cookies.get("utm_memory");
const asCookie = (value: string) => `utm_memory=${value}`;

test("middleware resolves from URL, forwards headers and remembers the source", async () => {
  const response = await middleware()(
    request("/menu?utm_source=restaurant-a&utm_medium=qr&page=2"),
  );
  assert.equal(forwarded(response, "x-utm-audience"), "restaurant-a");
  assert.equal(forwarded(response, "x-utm-audience-id"), "1");
  const cookie = memoryCookie(response)!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.maxAge, 60 * 60 * 24 * 90);
  const memory = parseSourceMemory(cookie.value)!;
  assert.deepEqual(
    memory.s?.p,
    { utm_source: "restaurant-a", utm_medium: "qr" },
    "untracked params dropped",
  );
  assert.deepEqual(memory.f, memory.l);
  assert.deepEqual(
    parseSourceMemory(forwarded(response, "x-utm-source-memory")),
    memory,
  );
  assert.ok(cookie.value.startsWith("{"), "raw JSON, encoded once by Next");
  // Internal navigation: audience from memory, no Set-Cookie (cacheable).
  const next = await middleware()(request("/contact", asCookie(cookie.value)));
  assert.equal(forwarded(next, "x-utm-audience"), "restaurant-a");
  assert.equal(memoryCookie(next), undefined);
});

test("sticky memory: unmatched arrivals keep the audience, another audience replaces it", async () => {
  const first = memoryCookie(
    await middleware()(request("/?utm_medium=qr")),
  )!.value;
  const google = await middleware()(
    new NextRequest("https://site.test/", {
      headers: { cookie: asCookie(first), referer: "https://www.google.com/" },
    }),
  );
  assert.equal(
    forwarded(google, "x-utm-audience"),
    "restaurants",
    "kept after a Google visit",
  );
  const afterGoogle = parseSourceMemory(memoryCookie(google)!.value)!;
  assert.equal(
    afterGoogle.l?.r,
    "google.com",
    "latest arrival recorded for attribution",
  );
  assert.deepEqual(afterGoogle.s?.p, { utm_medium: "qr" });
  const partner = await middleware()(
    request("/?ref=partner-7", asCookie(memoryCookie(google)!.value)),
  );
  assert.equal(
    forwarded(partner, "x-utm-audience"),
    "partners",
    "replaced by another audience",
  );
  assert.equal(
    parseSourceMemory(memoryCookie(partner)!.value)!.f?.p?.utm_medium,
    "qr",
    "first touch kept",
  );
});

test("referring site conditions, same-site referrers and expiry", async () => {
  const referrerManifest: AudienceManifest = {
    version: 1,
    audiences: [
      {
        key: "coudac",
        conditions: [
          {
            parameter: REFERRER_PARAMETER,
            operator: "equals",
            value: "https://www.coudac.com/",
          },
        ],
      },
    ],
  };
  const run = createPersonalizationMiddleware({
    loadManifest: () => referrerManifest,
  });
  const fromPartner = await run(
    new NextRequest("https://site.test/", {
      headers: { referer: "https://blog.coudac.com/article" },
    }),
  );
  assert.equal(forwarded(fromPartner, "x-utm-audience"), "coudac");
  const internal = await run(
    new NextRequest("https://site.test/about", {
      headers: {
        referer: "https://site.test/",
        cookie: asCookie(memoryCookie(fromPartner)!.value),
      },
    }),
  );
  assert.equal(forwarded(internal, "x-utm-audience"), "coudac");
  assert.equal(
    memoryCookie(internal),
    undefined,
    "same-site referrer is not an arrival",
  );
  const old = serializeSourceMemory({ v: 1, s: { r: "coudac.com", t: 1 } });
  clearManifestCache();
  const expired = await run(request("/", asCookie(old)));
  assert.equal(forwarded(expired, "x-utm-audience"), null);
});

test("consent off: landing request personalized, memory neither read nor written", async () => {
  const stored = serializeSourceMemory({
    v: 1,
    s: { p: { ref: "partner-1" }, t: Math.floor(Date.now() / 1000) },
  });
  const known = await middleware()(request("/about", asCookie(stored)));
  assert.equal(forwarded(known, "x-utm-audience"), "partners");
  const noConsent = middleware({ consent: () => false });
  const landing = await noConsent(request("/?utm_medium=qr", asCookie(stored)));
  assert.equal(forwarded(landing, "x-utm-audience"), "restaurants");
  assert.equal(memoryCookie(landing), undefined);
  assert.equal(forwarded(landing, "x-utm-source-memory"), null);
  const ignored = await noConsent(request("/", asCookie(stored)));
  assert.equal(forwarded(ignored, "x-utm-audience"), null);
  const garbage = await middleware()(request("/", "utm_memory=%7Bnot-json"));
  assert.equal(garbage.status, 200);
  assert.equal(forwarded(garbage, "x-utm-audience"), null);
});

test("static mode only rewrites paths listed for the audience", async () => {
  const withPaths = {
    version: 1 as const,
    audiences: manifest.audiences.map((audience) =>
      audience.key === "restaurants"
        ? { ...audience, paths: ["/menu"] }
        : audience,
    ),
  };
  const run = createPersonalizationMiddleware({
    loadManifest: () => withPaths,
    rewrite: {},
  });
  const menu = await run(request("/menu/?utm_medium=qr"));
  assert.equal(
    new URL(menu.headers.get("x-middleware-rewrite")!).pathname,
    "/utm-audience/restaurants/menu/",
  );
  const contact = await run(request("/contact?utm_medium=qr"));
  assert.equal(
    contact.headers.get("x-middleware-rewrite"),
    null,
    "unchanged page stays on the shared cache",
  );
  assert.equal(forwarded(contact, "x-utm-audience"), "restaurants");
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

test("preview parameter forces an audience for one request without touching the cookie", async () => {
  const run = middleware();
  const forced = await run(
    request("/menu?utm_preview=partners", "utm_audience=restaurants"),
  );
  assert.equal(forwarded(forced, "x-utm-audience"), "partners");
  assert.equal(forced.cookies.get("utm_memory"), undefined);
  const defaults = await run(
    request("/?utm_preview=default&utm_medium=qr", "utm_audience=restaurants"),
  );
  assert.equal(forwarded(defaults, "x-utm-audience"), null);
  assert.equal(defaults.cookies.get("utm_memory"), undefined);
  const disabled = await middleware({ previewParam: false })(
    request("/?utm_preview=partners"),
  );
  assert.equal(forwarded(disabled, "x-utm-audience"), null);
  assert.throws(
    () => createPersonalizationMiddleware({ previewParam: "bad param" }),
    /previewParam/,
  );
});

test("example campaign query and stored doc mapping", () => {
  assert.equal(
    exampleCampaignQuery([
      { parameter: "utm_source", operator: "equals", value: " Restaurant-A " },
      { parameter: "utm_medium", operator: "in", value: "qr, flyer" },
      { parameter: "utm_term", operator: "notEquals", value: "x" },
      { parameter: "ref", operator: "exists" },
    ]),
    "utm_source=Restaurant-A&utm_medium=qr&ref=1",
  );
  assert.equal(
    exampleCampaignQuery(
      [
        { parameter: "utm_source", operator: "equals", value: "a" },
        { parameter: "utm_source", operator: "equals", value: "b" },
      ],
      "any",
    ),
    "utm_source=a",
  );
  const parsed = parseAudienceManifest({
    audiences: [
      audienceDocToRule({
        id: 4,
        key: "vip",
        conditions: [
          {
            parameter: "custom",
            customParameter: "ref",
            operator: "equals",
            value: "vip",
          },
        ],
      }),
    ],
  });
  assert.equal(resolveAudience(q("ref=VIP"), parsed)?.id, 4);
});

test("UTM links get an audience relationship and match notice when personalization is on", async () => {
  const result = await utmPlugin({
    locale: "fr",
    personalization: { audiencesSlug: "audiences" },
  })({
    collections: [],
  } as unknown as Config);
  const links = result.collections!.find((c) => c.slug === "utm-links")!;
  const audience = links.fields.find(
    (f) => "name" in f && f.name === "audience",
  ) as {
    relationTo: string;
  };
  assert.equal(audience.relationTo, "audiences");
  const notice = links.fields.find(
    (f) => "name" in f && f.name === "audienceCheck",
  ) as {
    admin: { components: { Field: { clientProps: Record<string, unknown> } } };
  };
  assert.equal(
    notice.admin.components.Field.clientProps.audiencesSlug,
    "audiences",
  );
  assert.equal(notice.admin.components.Field.clientProps.locale, "fr");
  const base = await utmPlugin()({ collections: [] } as unknown as Config);
  assert(
    !base.collections![0]!.fields.some(
      (f) => "name" in f && f.name === "audience",
    ),
  );
});

test("preview options are validated and can be disabled", async () => {
  const run = (personalization: unknown) =>
    utmPlugin({ personalization } as never)({
      collections: [],
    } as unknown as Config);
  assert.throws(
    () => run({ preview: { siteUrl: "https://site.test/path" } }),
    /siteUrl/,
  );
  assert.throws(() => run({ preview: { param: "a b" } }), /param/);
  assert.throws(
    () => run({ afterAudienceChange: "nope" }),
    /afterAudienceChange/,
  );
  const enabled = await run({
    preview: { siteUrl: "https://site.test", param: "see" },
  });
  const audiences = enabled.collections!.find(
    (c) => c.slug === "utm-audiences",
  )!;
  const preview = audiences.fields.find(
    (f) => "name" in f && f.name === "preview",
  ) as {
    admin: { components: { Field: { clientProps: Record<string, unknown> } } };
  };
  assert.deepEqual(preview.admin.components.Field.clientProps, {
    locale: "en",
    siteUrl: "https://site.test",
    param: "see",
    linksSlug: "utm-links",
  });
  const disabled = await run({ preview: false });
  assert(
    !disabled
      .collections!.find((c) => c.slug === "utm-audiences")!
      .fields.some((f) => "name" in f && f.name === "preview"),
  );
});

test("afterAudienceChange runs on change and delete, and its errors never fail the save", async () => {
  const calls: string[] = [];
  const logged: unknown[] = [];
  const result = await utmPlugin({
    personalization: {
      afterAudienceChange: ({ operation, doc }) => {
        calls.push(`${operation}:${doc.key}`);
        if (operation === "delete")
          throw new Error("revalidate outside request");
      },
    },
  })({ collections: [] } as unknown as Config);
  const audiences = result.collections!.find(
    (c) => c.slug === "utm-audiences",
  )!;
  const req = {
    payload: { logger: { error: (entry: unknown) => logged.push(entry) } },
  };
  const doc = { id: 1, key: "vip" };
  assert.equal(
    await audiences.hooks!.afterChange![0]!({
      doc,
      previousDoc: {},
      operation: "update",
      req,
    } as never),
    doc,
  );
  await audiences.hooks!.afterDelete![0]!({ doc, req } as never);
  assert.deepEqual(calls, ["update:vip", "delete:vip"]);
  assert.equal(logged.length, 1);
});

test("referrer matching normalizes domains and includes subdomains", () => {
  assert.equal(
    normalizeHost("https://WWW.Coudac.com:443/path?q"),
    "coudac.com",
  );
  assert.equal(normalizeHost("shop.coudac.com/"), "shop.coudac.com");
  const rule = (operator: "equals" | "in" | "notEquals", value: string) => ({
    parameter: REFERRER_PARAMETER,
    operator,
    value,
  });
  assert(
    conditionMatches(
      { referrer: "https://blog.coudac.com/" },
      rule("equals", "coudac.com"),
    ),
  );
  assert(
    !conditionMatches(
      { referrer: "https://notcoudac.com/" },
      rule("equals", "coudac.com"),
    ),
  );
  assert(
    conditionMatches(
      { referrer: "clutch.co" },
      rule("in", "sortlist.fr, clutch.co"),
    ),
  );
  assert(conditionMatches({ referrer: null }, rule("notEquals", "coudac.com")));
  assert(
    !conditionMatches(q("utm_source=coudac.com"), rule("equals", "coudac.com")),
    "params are not referrers",
  );
});

test("audience tokens are filled from CMS content with fallbacks, deeply", () => {
  const block = {
    heading: "Hello {{audience.displayName|there}}!",
    rich: { root: { children: [{ text: "{{ audience.tagline }}" }] } },
    count: 3,
  };
  assert.deepEqual(
    fillAudienceTokens(block, {
      displayName: "Coudac clients",
      tagline: "E-commerce first",
    }),
    {
      heading: "Hello Coudac clients!",
      rich: { root: { children: [{ text: "E-commerce first" }] } },
      count: 3,
    },
  );
  assert.equal(fillAudienceTokens(block, null).heading, "Hello there!");
  assert.equal(
    fillAudienceTokens("{{audience.unknown}}x", { displayName: "a" }),
    "x",
  );
  assert.equal(
    block.heading,
    "Hello {{audience.displayName|there}}!",
    "input untouched",
  );
});

test("audience draft from a UTM link matches that link", () => {
  const draft = audienceDraftFromLink({
    title: "",
    source: "Coudac",
    campaign: "Partenaires 2026",
    content: "footer",
  })!;
  assert.equal(draft.key, "coudac-partenaires-2026");
  assert.equal(draft.title, "Coudac · Partenaires 2026");
  const parsed = parseAudienceManifest({
    audiences: [{ key: draft.key, conditions: draft.conditions }],
  });
  assert.equal(
    resolveAudience(
      q(
        "utm_source=Coudac&utm_medium=x&utm_campaign=Partenaires%202026&utm_content=footer",
      ),
      parsed,
    )?.key,
    draft.key,
  );
  assert.equal(audienceDraftFromLink({ source: "a" }), null);
});

test("manifest lists the pages that change per audience, and falls back safely", async () => {
  const hero: Block = {
    slug: "hero",
    fields: [{ name: "title", type: "text" }],
  };
  const build = (paths: unknown) =>
    utmPlugin({ personalization: { blocks: ["hero"], paths } as never })({
      collections: [
        {
          slug: "pages",
          fields: [{ name: "layout", type: "blocks", blocks: [hero] }],
        },
      ],
    } as unknown as Config);
  assert.throws(() => build({ collections: {} }), /path functions/);
  assert.throws(
    () => build({ collections: { posts: () => "/x" } }),
    /resolver for collection "pages"/,
  );
  const result = await build({
    collections: {
      pages: ({ doc }: { doc: { slug: string } }) =>
        doc.slug === "home" ? "/" : `/${doc.slug}`,
    },
  });
  const audiences = result.collections!.find(
    (c) => c.slug === "utm-audiences",
  )!;
  const handler = (audiences.endpoints || [])[0]!.handler;
  const pages = [
    {
      id: "p1",
      slug: "home",
      layout: [
        {
          blockType: "hero",
          personalization: { mode: "except", audiences: [1] },
        },
        {
          blockType: "hero",
          personalization: { mode: "only", audiences: [1, 2] },
        },
      ],
    },
    {
      id: "p2",
      slug: "contact",
      layout: [{ blockType: "hero", personalization: { mode: "all" } }],
    },
  ];
  const req = (failPages = false) =>
    ({
      headers: new Headers(),
      query: {},
      payload: {
        logger: { error: () => {} },
        find: async ({ collection }: { collection: string }) => {
          if (collection === "pages") {
            if (failPages) throw new Error("db down");
            return { docs: pages, hasNextPage: false };
          }
          return {
            docs: [
              {
                id: 1,
                key: "coudac",
                conditions: [
                  {
                    parameter: "referrer",
                    operator: "equals",
                    value: "coudac.com",
                  },
                ],
              },
              {
                id: 2,
                key: "sortlist",
                conditions: [
                  {
                    parameter: "utm_source",
                    operator: "equals",
                    value: "sortlist",
                  },
                ],
              },
              {
                id: 3,
                key: "unused",
                conditions: [{ parameter: "utm_source", operator: "exists" }],
              },
            ],
          };
        },
      },
    }) as unknown as PayloadRequest;
  const body = await (await handler(req())).json();
  assert.deepEqual(
    body.audiences.map(
      (a: {
        key: string;
        paths?: string[];
        conditions: { parameter: string }[];
      }) => [a.key, a.paths],
    ),
    [
      ["coudac", ["/"]],
      ["sortlist", ["/"]],
      ["unused", []],
    ],
  );
  assert.equal(body.audiences[0].conditions[0].parameter, REFERRER_PARAMETER);
  const fallback = await (await handler(req(true))).json();
  assert.equal(
    fallback.audiences[0].paths,
    undefined,
    "unknown pages: rewrite everywhere",
  );
});

test("referrer condition values must be domains; content fields are added", async () => {
  const result = await utmPlugin({
    personalization: {
      content: {
        imageCollection: "media",
        fields: [{ name: "sector", type: "text" }],
      },
    },
  })({ collections: [] } as unknown as Config);
  const audiences = result.collections!.find(
    (c) => c.slug === "utm-audiences",
  )!;
  const content = audiences.fields.find(
    (f) => "name" in f && f.name === "content",
  ) as { fields: { name: string }[] };
  assert.deepEqual(
    content.fields.map((f) => f.name),
    ["displayName", "tagline", "image", "sector"],
  );
  const conditions = audiences.fields.find(
    (f) => "name" in f && f.name === "conditions",
  ) as {
    fields: {
      fields: {
        name: string;
        validate?: (v: unknown, o: unknown) => unknown;
      }[];
    }[];
  };
  const value = conditions.fields[0]!.fields.find((f) => f.name === "value")!;
  const check = (v: string, parameter = "referrer", operator = "equals") =>
    value.validate!(v, { siblingData: { parameter, operator } });
  assert.equal(check("https://www.coudac.com/"), true);
  assert.equal(check("coudac.com, clutch.co", "referrer", "in"), true);
  assert.notEqual(check("not a domain"), true);
  assert.equal(check("not a domain", "utm_source"), true);
  assert.equal(check("coud", "referrer", "contains"), true);
});
