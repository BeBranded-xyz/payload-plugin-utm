import assert from "node:assert/strict";
import { allFields } from "./helpers.js";
import { test } from "node:test";
import type { Block, Config, PayloadRequest } from "payload";
import { utmPlugin } from "../src/index.js";
import { sourceMemoryFields } from "../src/personalization/match.js";
import {
  entrySource,
  parseViewEvent,
  summarizeViews,
  unregisteredCampaigns,
} from "../src/personalization/stats.js";
import { safePreviewPath } from "../src/preview.js";

const known = new Set(["coudac", "ugc"]);

test("view events are validated against active audiences", () => {
  assert.deepEqual(
    parseViewEvent(
      {
        audience: "coudac",
        path: "/fr/offres/?x=1",
        variant: true,
        entry: false,
      },
      known,
    ),
    { audience: "coudac", path: "/fr/offres", variant: true, entry: false },
  );
  assert.equal(parseViewEvent({ audience: "hacker", path: "/" }, known), null);
  assert.equal(
    parseViewEvent({ audience: "coudac", path: "https://x" }, known),
    null,
  );
  assert.equal(parseViewEvent({ path: "/a b" }, known), null);
  assert.equal(parseViewEvent("nope", known), null);
  const entry = parseViewEvent(
    {
      audience: null,
      path: "/",
      variant: true,
      entry: true,
      source: " LinkedIn ",
      medium: "social",
      campaign: "<script>",
      utm: true,
    },
    known,
  )!;
  assert.equal(entry.audience, "default");
  assert.equal(entry.variant, false, "no variant without an audience");
  assert.equal(entry.source, "linkedin");
  assert.equal(entry.medium, "social");
  assert.equal(entry.campaign, undefined, "unsafe label dropped");
  assert.equal(entry.utm, true);
});

test("entry source: utm_source, else referring site, else direct", () => {
  assert.deepEqual(
    entrySource(
      "?utm_source=newsletter&utm_medium=email&utm_campaign=nov",
      "",
      "site.com",
    ),
    {
      entry: true,
      source: "newsletter",
      medium: "email",
      campaign: "nov",
      utm: true,
    },
  );
  assert.deepEqual(entrySource("", "https://www.coudac.com/blog", "site.com"), {
    entry: true,
    source: "coudac.com",
  });
  assert.deepEqual(entrySource("", "https://site.com/a", "www.site.com"), {
    entry: false,
  });
  assert.deepEqual(entrySource("", "", "site.com"), {
    entry: true,
    source: "(direct)",
  });
});

test("views are summarized per audience, page and source", () => {
  const rows = [
    {
      day: "2026-11-13",
      audience: "coudac",
      path: "/",
      variant: true,
      entry: true,
      source: "coudac.com",
    },
    {
      day: "2026-11-13",
      audience: "coudac",
      path: "/about",
      variant: false,
      entry: false,
    },
    {
      day: "2026-11-14",
      audience: "default",
      path: "/",
      variant: false,
      entry: true,
      source: "(direct)",
    },
    {
      day: "2026-11-14",
      audience: "coudac",
      path: "/",
      variant: true,
      entry: false,
    },
  ];
  const summary = summarizeViews(rows);
  assert.deepEqual(summary.total, { views: 4, entries: 2, variantViews: 2 });
  assert.deepEqual(summary.audiences[0], {
    audience: "coudac",
    entries: 1,
    views: 3,
    variantViews: 2,
  });
  assert.equal(
    summary.audiences.at(-1)!.audience,
    "default",
    "default listed last",
  );
  assert.deepEqual(summary.pages[0], {
    path: "/",
    audience: "coudac",
    views: 2,
    variantViews: 2,
  });
  assert.equal(summary.sources.length, 2);
  assert.deepEqual(
    summary.days.map((d) => d.day),
    ["2026-11-13", "2026-11-14"],
  );
});

test("UTM seen in traffic but not saved as a link are flagged", () => {
  const rows = [
    {
      day: "2026-11-10",
      entry: true,
      utm: true,
      source: "linkedin",
      medium: "social",
      campaign: "launch",
    },
    {
      day: "2026-11-12",
      entry: true,
      utm: true,
      source: "linkedin",
      medium: "social",
      campaign: "launch",
    },
    {
      day: "2026-11-12",
      entry: true,
      utm: true,
      source: "newsletter",
      medium: "email",
      campaign: "nov",
    },
    { day: "2026-11-12", entry: true, source: "coudac.com" }, // referrer, not a UTM
    { day: "2026-11-12", entry: false, utm: true, source: "ignored" },
  ];
  const links = [{ source: "Newsletter", medium: "Email", campaign: "NOV" }];
  assert.deepEqual(unregisteredCampaigns(rows, links), [
    {
      source: "linkedin",
      medium: "social",
      campaign: "launch",
      entries: 2,
      landingPath: null,
      firstDay: "2026-11-10",
      lastDay: "2026-11-12",
    },
  ]);
});

test("source memory flattens into form fields", () => {
  const fields = sourceMemoryFields({
    v: 1,
    f: { p: { utm_source: "linkedin" }, t: 1_700_000_000 },
    s: { r: "coudac.com", t: 1_700_000_100 },
  });
  assert.equal(fields.first_utm_source, "linkedin");
  assert.equal(fields.first_at, new Date(1_700_000_000_000).toISOString());
  assert.equal(fields.audience_referrer, "coudac.com");
  assert.deepEqual(sourceMemoryFields(null), {});
});

test("draft preview only redirects to same-site paths", () => {
  assert.equal(safePreviewPath("/fr/offres?x=1"), "/fr/offres?x=1");
  for (const bad of [
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "relative",
    3,
  ])
    assert.equal(safePreviewPath(bad), null);
});

const hero: Block = { slug: "hero", fields: [{ name: "title", type: "text" }] };
const build = (personalization: unknown, extra: Partial<Config> = {}) =>
  utmPlugin({ personalization: personalization as never })({
    collections: [
      {
        slug: "pages",
        fields: [
          { name: "layout", type: "blocks", localized: true, blocks: [hero] },
        ],
      },
    ],
    ...extra,
  } as unknown as Config) as Config;

test("stats and draft route options are validated; views collection is private", async () => {
  assert.throws(
    () => build({ blocks: ["hero"], preview: { draftRoute: "api/x" } }),
    /draftRoute/,
  );
  assert.throws(
    () => build({ blocks: ["hero"], stats: { retentionDays: 0 } }),
    /retentionDays/,
  );
  assert.throws(
    () =>
      build({
        blocks: ["hero"],
        stats: { allowedOrigins: ["https://a.com/x"] },
      }),
    /allowedOrigins/,
  );
  assert.throws(
    () => build({ blocks: ["hero"], stats: { slug: "utm-links" } }),
    /stats.slug/,
  );
  const off = build({ blocks: ["hero"], stats: false });
  assert.equal(
    off.collections!.some((c) => c.slug === "utm-personalization-views"),
    false,
  );
  const config = build({
    blocks: ["hero"],
    stats: true,
    preview: { draftRoute: "/api/utm-preview" },
  });
  const views = config.collections!.find(
    (c) => c.slug === "utm-personalization-views",
  )!;
  assert.equal(views.admin?.hidden, true);
  const create = views.access!.create as (args: unknown) => boolean;
  assert.equal(
    create({ req: { user: { id: 1 } } }),
    false,
    "only the endpoint writes",
  );
  const audiences = config.collections!.find((c) => c.slug === "utm-links")!;
  const content = allFields(audiences).find(
    (f) => "name" in f && f.name === "audienceContent",
  ) as { fields: { name: string; localized?: boolean }[] };
  assert.equal(
    content.fields.find((f) => f.name === "displayName")!.localized,
    true,
  );
  const preview = allFields(audiences).find(
    (f) => "name" in f && f.name === "preview",
  ) as {
    admin: { components: { Field: { clientProps: Record<string, unknown> } } };
  };
  assert.equal(
    preview.admin.components.Field.clientProps.draftRoute,
    "/api/utm-preview",
  );
});

test("stats endpoint records valid views anonymously and rejects the rest", async () => {
  const config = build({
    blocks: ["hero"],
    stats: { allowedOrigins: ["https://site.test"] },
  });
  const audiences = config.collections!.find((c) => c.slug === "utm-links")!;
  const handler = (
    (audiences.endpoints || []) as {
      path: string;
      handler: (req: PayloadRequest) => Promise<Response>;
    }[]
  ).find((e) => e.path === "/stats")!.handler;
  const created: Record<string, unknown>[] = [];
  const req = (body: string, origin = "https://site.test") =>
    ({
      headers: new Headers({ origin }),
      text: async () => body,
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
                  value: "coudac.com",
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
  const ok = await handler(
    req(
      JSON.stringify({
        audience: "coudac",
        path: "/",
        variant: true,
        entry: true,
        source: "coudac.com",
      }),
    ),
  );
  assert.equal(ok.status, 204);
  assert.equal(created[0]!.audience, "coudac");
  assert.match(String(created[0]!.day), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal("ip" in created[0]!, false);
  assert.equal((await handler(req("{}", "https://evil.test"))).status, 403);
  assert.equal((await handler(req("not json"))).status, 400);
  assert.equal(
    (await handler(req(JSON.stringify({ audience: "nobody", path: "/" }))))
      .status,
    400,
  );
  assert.equal((await handler(req("x".repeat(3000)))).status, 400);
  assert.equal(created.length, 1);
});

test("manifest paths are resolved per locale when localization is on", async () => {
  const config = build({
    blocks: ["hero"],
    paths: {
      collections: {
        pages: ({ doc, locale }: { doc: { slug: string }; locale?: string }) =>
          `${locale === "en" ? "" : "/fr"}/${doc.slug}`,
      },
    },
  });
  const audiences = config.collections!.find((c) => c.slug === "utm-links")!;
  const handler = (
    (audiences.endpoints || []) as {
      path: string;
      handler: (req: PayloadRequest) => Promise<Response>;
    }[]
  ).find((e) => e.path === "/manifest")!.handler;
  const layoutByLocale: Record<string, unknown[]> = {
    fr: [
      { blockType: "hero", personalization: { mode: "only", audiences: [1] } },
    ],
    en: [{ blockType: "hero", personalization: { mode: "all" } }],
  };
  const req = {
    headers: new Headers(),
    query: {},
    payload: {
      config: { localization: { localeCodes: ["fr", "en"] } },
      logger: { error: () => {} },
      find: async ({
        collection,
        locale,
      }: {
        collection: string;
        locale?: string;
      }) =>
        collection === "pages"
          ? {
              docs: [
                { id: "p", slug: "offres", layout: layoutByLocale[locale!] },
              ],
              hasNextPage: false,
            }
          : {
              docs: [
                {
                  id: 1,
                  key: "coudac",
                  conditions: [
                    {
                      parameter: "utm_source",
                      operator: "equals",
                      value: "coudac",
                    },
                  ],
                },
              ],
            },
    },
  } as unknown as PayloadRequest;
  const body = await (await handler(req)).json();
  assert.deepEqual(
    body.audiences[0].paths,
    ["/fr/offres"],
    "only the locale that has the variant",
  );
});
