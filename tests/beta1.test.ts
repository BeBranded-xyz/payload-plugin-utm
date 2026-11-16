import assert from "node:assert/strict";
import { allFields } from "./helpers.js";
import { beforeEach, test } from "node:test";
import type { Config, PayloadRequest } from "payload";
import { NextRequest } from "next/server.js";
import { utmPlugin } from "../src/index.js";
import {
  clearManifestCache,
  createPersonalizationResolver,
} from "../src/next.js";
import { isSafeAudienceLink } from "../src/personalization/collection.js";
import {
  domainMatches,
  isValidAudienceKey,
  serializeSourceMemory,
  type AudienceManifest,
} from "../src/personalization/match.js";

type Handler = (req: PayloadRequest) => Promise<Response>;
const endpoint = (config: Config, path: string) =>
  (
    (config.collections!.find((c) => c.slug === "utm-links")!.endpoints ||
      []) as { path: string; handler: Handler }[]
  ).find((e) => e.path === path)!.handler;

beforeEach(() => clearManifestCache());

test("referring site on any extension, without lookalikes", () => {
  for (const host of [
    "coudac.com",
    "coudac.fr",
    "shop.coudac.co.uk",
    "coudac.com.au",
  ])
    assert.equal(domainMatches(host, "coudac.*"), true, host);
  for (const host of ["notcoudac.com", "coudac.evil.com", "coudac", ""])
    assert.equal(domainMatches(host, "coudac.*"), false, host);
  assert.equal(domainMatches("blog.coudac.com", "coudac.com"), true);
  assert.equal(isValidAudienceKey("auto"), false, "auto is reserved");
});

test("audience links accept site paths and http(s) URLs only", () => {
  for (const ok of [
    "/contact",
    "/projects/coudac?x=1",
    "https://coudac.com/case",
  ])
    assert.equal(isSafeAudienceLink(ok), true, ok);
  for (const bad of [
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "contact",
    "/a b",
  ])
    assert.equal(isSafeAudienceLink(bad), false, bad);
});

test("pages entered on an audience limit its variants (code mode)", async () => {
  const config = utmPlugin({ personalization: {} })({} as Config) as Config;
  const audiences = config.collections!.find((c) => c.slug === "utm-links")!;
  const pages = allFields(audiences).find(
    (f) => "name" in f && f.name === "pages",
  ) as {
    validate: (v: unknown) => unknown;
  };
  assert.equal(pages.validate(["/", "/fr"]), true);
  assert.notEqual(pages.validate(["fr"]), true);
  assert.notEqual(pages.validate(["//evil.com"]), true);
  const handler = endpoint(config, "/manifest");
  const req = {
    headers: new Headers(),
    query: {},
    payload: {
      logger: { error: () => {} },
      find: async () => ({
        docs: [
          {
            id: 1,
            key: "coudac",
            pages: ["/", "/fr/"],
            conditions: [
              { parameter: "referrer", operator: "equals", value: "coudac.*" },
            ],
          },
          {
            id: 2,
            key: "ugc",
            conditions: [
              { parameter: "utm_source", operator: "equals", value: "ugc" },
            ],
          },
        ],
      }),
    },
  } as unknown as PayloadRequest;
  const body = await (await handler(req)).json();
  assert.deepEqual(body.audiences[0].paths, ["/", "/fr"]);
  assert.equal("paths" in body.audiences[1], false, "no pages: every page");
});

const manifest = (key: string): AudienceManifest => ({
  version: 1,
  audiences: [
    {
      key,
      priority: 0,
      match: "any",
      conditions: [
        { parameter: "$referrer", operator: "equals", value: "coudac.com" },
      ],
      paths: ["/", "/fr"],
    },
  ],
});
const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "https://site.test"), { headers });

test("variant segments behind a locale are protected too", async () => {
  const resolve = createPersonalizationResolver({
    loadManifest: () => manifest("coudac"),
    rewrite: { prefix: "utm-audience", localePrefixes: ["fr", "en"] },
  });
  assert.equal(
    (await resolve(request("/fr/utm-audience/coudac/offres"))).redirect
      ?.pathname,
    "/fr/offres",
  );
  assert.equal(
    (await resolve(request("/fr/utm-audience/coudac"))).redirect?.pathname,
    "/fr",
  );
  assert.equal(
    (await resolve(request("/utm-audience/coudac/a"))).redirect?.pathname,
    "/a",
  );
  assert.equal((await resolve(request("/fr/offres"))).redirect, null);
  assert.throws(
    () =>
      createPersonalizationResolver({ rewrite: { localePrefixes: ["../x"] } }),
    /localePrefixes/,
  );
});

test("expired manifests are served stale while one refresh runs", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const resolve = createPersonalizationResolver({
    cacheTtlSeconds: 0,
    loadManifest: () => {
      calls++;
      if (calls === 1) return manifest("first");
      return new Promise<AudienceManifest>((done) => {
        release = () => done(manifest("second"));
      });
    },
  });
  const arrival = { referer: "https://coudac.com/" };
  assert.equal((await resolve(request("/", arrival))).audience?.key, "first");
  // Expired (TTL 0): answered immediately from the stale copy, refresh pending.
  assert.equal((await resolve(request("/", arrival))).audience?.key, "first");
  assert.equal((await resolve(request("/", arrival))).audience?.key, "first");
  assert.equal(calls, 2, "one refresh in flight, not one per request");
  release!();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((await resolve(request("/", arrival))).audience?.key, "second");
});

test("stats endpoint resolves `auto` from the source-memory cookie", async () => {
  const config = utmPlugin({ personalization: { stats: true } })(
    {} as Config,
  ) as Config;
  const handler = endpoint(config, "/stats");
  const created: Record<string, unknown>[] = [];
  const req = (audience: unknown, cookie = "") =>
    ({
      headers: new Headers(cookie ? { cookie } : {}),
      text: async () =>
        JSON.stringify({ audience, path: "/about", variant: true }),
      payload: {
        logger: { error: () => {} },
        find: async () => ({
          docs: [
            {
              id: 1,
              key: "coudac",
              conditions: [
                {
                  parameter: "referrer",
                  operator: "equals",
                  value: "coudac.*",
                },
              ],
            },
          ],
        }),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        },
        delete: async () => ({ docs: [] }),
      },
    }) as unknown as PayloadRequest;
  const now = Math.floor(Date.now() / 1000);
  const memory = serializeSourceMemory({
    v: 1,
    f: { r: "coudac.fr", t: now },
    l: { r: "coudac.fr", t: now },
    s: { r: "coudac.fr", t: now },
  });
  assert.equal(
    (await handler(req("auto", `other=1; utm_memory=${memory}`))).status,
    204,
  );
  assert.equal(created[0]!.audience, "coudac");
  assert.equal(
    created[0]!.variant,
    false,
    "auto views are never counted as personalized",
  );
  assert.equal((await handler(req("auto"))).status, 204);
  assert.equal(created[1]!.audience, "default");
});

test("buildAudienceManifest reads the database directly with the plugin settings", async () => {
  const { buildAudienceManifest } = await import("../src/index.js");
  const config = utmPlugin({
    collectionSlug: "campaigns",
    personalization: { manifest: { limit: 7 } },
  })({} as Config) as Config;
  let seen: Record<string, unknown> = {};
  const payload = {
    config: { custom: config.custom },
    logger: { error: () => {} },
    find: async (args: Record<string, unknown>) => {
      seen = args;
      return {
        docs: [
          {
            id: 1,
            key: "coudac",
            pages: ["/fr/"],
            conditions: [
              { parameter: "referrer", operator: "equals", value: "coudac.*" },
            ],
          },
        ],
      };
    },
  };
  const manifest = await buildAudienceManifest(payload as never);
  assert.equal(seen.collection, "campaigns");
  assert.deepEqual((seen.where as { and: unknown[] }).and.at(-1), {
    personalize: { equals: true },
  });
  assert.equal(seen.limit, 7);
  assert.equal(seen.overrideAccess, true);
  assert.deepEqual(
    manifest.audiences.map((a) => [a.key, a.paths]),
    [["coudac", ["/fr"]]],
  );
});
