import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config, PayloadRequest } from "payload";
import { utmPlugin } from "../src/index.js";
import { serializeSourceMemory } from "../src/personalization/match.js";
import {
  buildDashboard,
  conversionSource,
  installChecks,
  parseViewEvent,
  summarizeViews,
  unregisteredReferrers,
} from "../src/personalization/stats.js";
import { allFields, endpointOf } from "./helpers.js";

test("conversions are a separate event, never counted as page views", () => {
  const event = parseViewEvent(
    { type: "conversion", name: "Contact form submit", path: "/contact" },
    new Set(),
  );
  assert.deepEqual(event, {
    audience: "auto",
    path: "/contact",
    variant: false,
    entry: false,
    conversion: "contact form submit",
  });
  assert.equal(
    parseViewEvent({ type: "conversion", name: "<x>", path: "/" }, new Set()),
    null,
  );
  const summary = summarizeViews([
    { day: "2026-11-15", audience: "coudac", path: "/", entry: true },
    {
      day: "2026-11-15",
      audience: "coudac",
      path: "/contact",
      conversion: "lead",
    },
  ]);
  assert.equal(summary.total.views, 1);
});

test("conversions are attributed to the latest arrival", () => {
  assert.deepEqual(
    conversionSource({
      l: {
        p: {
          utm_source: "LinkedIn",
          utm_medium: "social",
          utm_campaign: "launch",
        },
      },
    }),
    { source: "linkedin", medium: "social", campaign: "launch", utm: true },
  );
  assert.deepEqual(conversionSource({ l: { r: "coudac.com" } }), {
    source: "coudac.com",
  });
  assert.deepEqual(conversionSource(null), { source: "(direct)" });
});

test("stats endpoint stores a conversion with the visitor's campaign and source", async () => {
  const config = utmPlugin({ personalization: {} })({
    collections: [],
  } as unknown as Config) as Config;
  const links = config.collections!.find((c) => c.slug === "utm-links")!;
  const handler = endpointOf(links, "/stats").handler;
  const created: Record<string, unknown>[] = [];
  const now = Math.floor(Date.now() / 1000);
  const memory = serializeSourceMemory({
    v: 1,
    l: { p: { utm_source: "coudac", utm_medium: "referral" }, t: now },
    s: { p: { utm_source: "coudac", utm_medium: "referral" }, t: now },
  });
  const req = {
    headers: new Headers({ cookie: `utm_memory=${memory}` }),
    text: async () =>
      JSON.stringify({
        type: "conversion",
        name: "Call booked",
        path: "/contact",
        audience: "auto",
      }),
    payload: {
      logger: { error: () => {} },
      find: async () => ({
        docs: [{ id: 1, key: "coudac", source: "coudac" }],
      }),
      create: async ({ data }: { data: Record<string, unknown> }) => (
        created.push(data), data
      ),
      delete: async () => ({ docs: [] }),
    },
  } as unknown as PayloadRequest;
  assert.equal((await handler(req)).status, 204);
  assert.equal(created[0]!.conversion, "call booked");
  assert.equal(created[0]!.audience, "coudac");
  assert.equal(created[0]!.source, "coudac");
  assert.equal(created[0]!.medium, "referral");
});

test("dashboard: daily series, totals vs previous period, campaigns and landing pages", () => {
  const rows = [
    { day: "2026-11-14", audience: "coudac", path: "/", entry: true },
    { day: "2026-11-15", audience: "coudac", path: "/", entry: true },
    {
      day: "2026-11-15",
      audience: "coudac",
      path: "/contact",
      conversion: "lead",
    },
    {
      day: "2026-11-15",
      audience: "default",
      path: "/blog/x",
      entry: true,
      utm: true,
      source: "linkedin",
      medium: "social",
    },
    { day: "2026-11-15", audience: "default", path: "/blog/x" },
  ];
  const dashboard = buildDashboard(
    rows,
    [{ day: "2026-11-10", audience: "default", path: "/", entry: true }],
    {
      since: "2026-11-13",
      until: "2026-11-15",
      titles: { coudac: "Coudac" },
    },
  );
  assert.deepEqual(
    dashboard.days.map((d) => [d.day, d.entries, d.conversions]),
    [
      ["2026-11-13", 0, 0],
      ["2026-11-14", 1, 0],
      ["2026-11-15", 2, 1],
    ],
  );
  assert.deepEqual(dashboard.totals, {
    entries: 3,
    views: 4,
    variantViews: 0,
    conversions: 1,
  });
  assert.equal(dashboard.previous.entries, 1);
  assert.deepEqual(dashboard.campaigns[0], {
    id: "coudac",
    label: "Coudac",
    entries: 2,
    conversions: 1,
    rate: 0.5,
  });
  assert.equal(dashboard.campaigns[1]!.label, "linkedin / social");
  assert.deepEqual(
    dashboard.landingPages.map((p) => p.path),
    ["/", "/blog/x"],
  );
  assert.deepEqual(dashboard.conversions, [{ name: "lead", count: 1 }]);
});

test("install checks spot missing tracker, single template, missing proxy and pages", () => {
  const manifest = {
    audiences: [
      {
        key: "coudac",
        groups: [[{ parameter: "utm_source", value: "coudac" }]],
      },
    ],
  };
  assert.deepEqual(
    installChecks({
      rows: [],
      today: "2026-11-15",
      manifest,
      personalized: [],
    }).map((c) => c.id),
    ["no-views"],
  );
  const onHome = Array.from({ length: 20 }, () => ({
    day: "2026-11-10",
    audience: "default",
    path: "/",
    entry: true,
    utm: true,
    source: "coudac",
  }));
  const ids = installChecks({
    rows: onHome,
    today: "2026-11-15",
    manifest,
    personalized: [{ key: "coudac", pages: [] }],
  }).map((c) => c.id);
  assert.deepEqual(ids, ["stale-views", "single-page", "proxy", "no-pages"]);
  const healthy = [
    {
      day: "2026-11-15",
      audience: "coudac",
      path: "/",
      entry: true,
      utm: true,
      source: "coudac",
    },
    { day: "2026-11-15", audience: "default", path: "/blog", entry: true },
  ];
  assert.deepEqual(
    installChecks({
      rows: healthy,
      today: "2026-11-15",
      manifest,
      personalized: [{ key: "coudac", pages: ["/"] }],
    }),
    [],
  );
});

test("detected sites know their most frequent landing page", () => {
  const rows = [
    { entry: true, source: "sortlist.fr", path: "/agence-webflow" },
    { entry: true, source: "sortlist.fr", path: "/agence-webflow" },
    { entry: true, source: "sortlist.fr", path: "/" },
  ];
  assert.equal(
    unregisteredReferrers(rows, [])[0]!.landingPath,
    "/agence-webflow",
  );
});

test("list columns and GA4 option", () => {
  const config = utmPlugin({ personalization: {} })({
    collections: [],
  } as unknown as Config) as Config;
  const links = config.collections!.find((c) => c.slug === "utm-links")!;
  assert(
    allFields(links).some(
      (f) =>
        "name" in f &&
        f.name === "arrivals30d" &&
        (f as { virtual?: boolean }).virtual,
    ),
  );
  assert(links.admin!.defaultColumns!.includes("arrivals30d"));
  assert.equal(
    links.endpoints &&
      (links.endpoints as { path: string }[]).some((e) => e.path === "/ga4"),
    false,
  );
  const run = (ga4: unknown) =>
    utmPlugin({ personalization: { ga4 } as never })({
      collections: [],
    } as unknown as Config);
  assert.throws(() => run({ propertyId: "abc" }), /propertyId/);
  assert.throws(() => run({ propertyId: "410476274" }), /credentials/);
  const withGa4 = run({
    propertyId: "410476274",
    getAccessToken: async () => "t",
  }) as Config;
  const campaigns = withGa4.collections!.find((c) => c.slug === "utm-links")!;
  assert(
    (campaigns.endpoints as { path: string }[]).some((e) => e.path === "/ga4"),
  );
});
