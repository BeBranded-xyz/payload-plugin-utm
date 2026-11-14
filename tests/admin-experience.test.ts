import assert from "node:assert/strict";
import { test } from "node:test";
import type { Block, CollectionConfig, Config, Field } from "payload";
import { NextRequest } from "next/server.js";
import { utmPlugin } from "../src/index.js";
import { createPersonalizationMiddleware } from "../src/next.js";
import {
  collectPersonalizedBlocks,
  consistencyAlerts,
  findAudience,
  isAudienceLive,
  parseAudienceManifest,
  resolveAudience,
  simulateCampaignUrl,
  summarizeDocument,
  variantPersonalization,
  type AudienceManifest,
} from "../src/personalization/match.js";

const named = (fields: Field[], name: string) =>
  fields.find((f) => "name" in f && f.name === name) as
    | (Field & Record<string, unknown>)
    | undefined;

test("campaign dates: audiences are ignored outside their window", () => {
  const manifest = parseAudienceManifest({
    audiences: [
      {
        key: "salon",
        startsAt: "2026-12-01T00:00:00.000Z",
        endsAt: "2026-12-04T00:00:00.000Z",
        conditions: [
          { parameter: "utm_campaign", operator: "equals", value: "salon" },
        ],
      },
      {
        key: "bad-dates",
        startsAt: "not a date",
        conditions: [{ parameter: "utm_source", operator: "exists" }],
      },
    ],
  });
  assert.equal(
    manifest.audiences[1]!.startsAt,
    undefined,
    "invalid dates dropped",
  );
  const params = new URLSearchParams("utm_campaign=salon");
  const before = new Date("2026-11-30T23:59:59Z");
  const during = new Date("2026-12-02T10:00:00Z");
  const after = new Date("2026-12-04T00:00:00Z");
  assert.equal(resolveAudience(params, manifest, before), null);
  assert.equal(resolveAudience(params, manifest, during)?.key, "salon");
  assert.equal(
    resolveAudience(params, manifest, after),
    null,
    "end is exclusive",
  );
  assert.equal(findAudience(manifest, "salon", during)?.key, "salon");
  assert.equal(
    findAudience(manifest, "salon", after),
    null,
    "remembered cookie expires too",
  );
  assert(isAudienceLive({}, after));
});

test("middleware stops serving an audience whose campaign has ended", async () => {
  const run = createPersonalizationMiddleware({
    loadManifest: () => ({
      audiences: [
        {
          key: "ended",
          endsAt: "2020-01-01T00:00:00.000Z",
          conditions: [{ parameter: "utm_source", operator: "exists" }],
        },
      ],
    }),
  });
  const response = await run(
    new NextRequest("https://site.test/?utm_source=x", {
      headers: { cookie: "utm_audience=ended" },
    }),
  );
  assert.equal(
    response.headers.get("x-middleware-request-x-utm-audience"),
    null,
  );
});

test("endsAt must be after startsAt and both are published in the manifest", async () => {
  const result = await utmPlugin({ personalization: {} })({
    collections: [],
  } as unknown as Config);
  const audiences = result.collections!.find(
    (c) => c.slug === "utm-audiences",
  )!;
  const endsAt = named(audiences.fields, "endsAt") as unknown as {
    validate: (v: unknown, o: { siblingData?: unknown }) => true | string;
  };
  assert(named(audiences.fields, "startsAt"));
  assert.equal(endsAt.validate(null, { siblingData: {} }), true);
  assert.equal(
    endsAt.validate("2026-12-05", { siblingData: { startsAt: "2026-12-01" } }),
    true,
  );
  assert.notEqual(
    endsAt.validate("2026-12-01", { siblingData: { startsAt: "2026-12-05" } }),
    true,
  );
  let select: Record<string, unknown> | undefined;
  await (audiences.endpoints || [])[0]!.handler({
    headers: new Headers(),
    query: {},
    payload: {
      find: async (input: Record<string, unknown>) => {
        select = input.select as Record<string, unknown>;
        return { docs: [] };
      },
    },
  } as never);
  assert.equal(select!.startsAt, true);
  assert.equal(select!.endsAt, true);
});

const hero: Block = { slug: "hero", fields: [{ name: "title", type: "text" }] };
const custom: Block = {
  slug: "custom",
  admin: { components: { Label: "app/Label#Label" } },
  fields: [],
};
const plain: Block = { slug: "plain", fields: [] };

test("editor UI: badge label, variant action, sidebar panel, admin view and nav link", async () => {
  const pages: CollectionConfig = {
    slug: "pages",
    admin: { useAsTitle: "title" },
    fields: [
      { name: "title", type: "text" },
      {
        type: "tabs",
        tabs: [
          {
            label: "Content",
            fields: [
              { name: "layout", type: "blocks", blocks: [hero, custom] },
            ],
          },
          {
            name: "seo",
            fields: [{ name: "faq", type: "blocks", blocks: [hero] }],
          },
        ],
      },
    ],
  };
  const posts: CollectionConfig = {
    slug: "posts",
    fields: [{ name: "body", type: "blocks", blocks: [plain] }],
  };
  const result = await utmPlugin({
    locale: "fr",
    personalization: {
      blocks: ["hero", "custom"],
      preview: { siteUrl: "https://site.test" },
    },
  })({
    collections: [pages, posts],
    globals: [
      {
        slug: "home",
        fields: [{ name: "layout", type: "blocks", blocks: [hero] }],
      },
    ],
  } as unknown as Config);

  const resultPages = result.collections!.find((c) => c.slug === "pages")!;
  const tabs = resultPages.fields[1] as unknown as {
    tabs: { fields: Field[] }[];
  };
  const [h, c] = (tabs.tabs[0]!.fields[0] as unknown as { blocks: Block[] })
    .blocks;
  const label = h!.admin!.components!.Label as {
    path: string;
    clientProps: Record<string, unknown>;
  };
  assert.equal(label.path, "payload-plugin-utm/client#PersonalizedBlockLabel");
  assert.equal(label.clientProps.blockLabel, "hero");
  assert.equal(label.clientProps.locale, "fr");
  assert.equal(
    c!.admin!.components!.Label,
    "app/Label#Label",
    "user labels are kept",
  );
  const group = named(h!.fields, "personalization") as unknown as {
    fields: Field[];
  };
  assert(
    named(group.fields, "variantAction"),
    "variant action inside the block",
  );

  const panel = named(
    resultPages.fields,
    "utmPersonalizationPanel",
  ) as unknown as {
    admin: {
      position: string;
      components: { Field: { clientProps: Record<string, unknown> } };
    };
  };
  assert.equal(panel.admin.position, "sidebar");
  assert.equal(
    panel.admin.components.Field.clientProps.siteUrl,
    "https://site.test",
  );
  assert.equal(
    panel.admin.components.Field.clientProps.previewParam,
    "utm_preview",
  );
  assert(
    !named(
      result.collections!.find((c) => c.slug === "posts")!.fields,
      "utmPersonalizationPanel",
    ),
  );
  assert(named(result.globals![0]!.fields, "utmPersonalizationPanel"));

  const view = result.admin!.components!.views!.utmPersonalization!;
  assert.equal(view.path, "/personalization");
  const props = (
    view.Component as {
      serverProps: { pluginOptions: Record<string, unknown> };
    }
  ).serverProps.pluginOptions;
  assert.deepEqual(props.targets, [
    { kind: "collection", slug: "pages", fields: ["layout", "seo"] },
    { kind: "global", slug: "home", fields: ["layout"] },
  ]);
  const nav = result.admin!.components!.afterNavLinks!.at(-1) as {
    path: string;
  };
  assert.equal(nav.path, "payload-plugin-utm/client#PersonalizationNavLink");
});

test("admin view can be disabled or moved, and paths are validated", async () => {
  const run = (personalization: unknown) =>
    utmPlugin({ personalization } as never)({
      collections: [],
    } as unknown as Config);
  const off = await run({ adminView: false });
  assert.equal(off.admin?.components?.views?.utmPersonalization, undefined);
  const moved = await run({ adminView: { path: "/campaigns/audiences" } });
  assert.equal(
    moved.admin!.components!.views!.utmPersonalization!.path,
    "/campaigns/audiences",
  );
  assert.throws(() => run({ adminView: { path: "no-slash" } }), /adminView/);
});

test("collects personalized blocks from documents, including nested ones and populated refs", () => {
  const doc = {
    title: "Home",
    layout: [
      {
        blockType: "hero",
        personalization: { mode: "except", audiences: [1] },
      },
      { blockType: "text" },
      {
        blockType: "columns",
        items: [
          {
            blockType: "hero",
            blockName: "Hero A",
            personalization: { mode: "only", audiences: [{ id: 1, key: "a" }] },
          },
        ],
      },
    ],
    seo: { faq: [{ blockType: "hero", personalization: { mode: "all" } }] },
  };
  assert.deepEqual(collectPersonalizedBlocks(doc), [
    {
      path: "layout.0",
      blockType: "hero",
      blockName: undefined,
      mode: "except",
      audienceIds: ["1"],
    },
    {
      path: "layout.2.items.0",
      blockType: "hero",
      blockName: "Hero A",
      mode: "only",
      audienceIds: ["1"],
    },
    {
      path: "seo.faq.0",
      blockType: "hero",
      blockName: undefined,
      mode: "all",
      audienceIds: [],
    },
  ]);
});

test("variant split: everyone, except and only cases", () => {
  assert.deepEqual(variantPersonalization({ mode: "all" }, 7), {
    original: { mode: "except", audiences: ["7"] },
    copy: { mode: "only", audiences: ["7"] },
  });
  assert.deepEqual(
    variantPersonalization({ mode: "except", audiences: [3] }, 7).original,
    {
      mode: "except",
      audiences: ["3", "7"],
    },
  );
  assert.deepEqual(
    variantPersonalization({ mode: "except", audiences: [7] }, 7).original,
    {
      mode: "except",
      audiences: ["7"],
    },
  );
  assert.deepEqual(
    variantPersonalization({ mode: "only", audiences: [3, 7] }, 7).original,
    {
      mode: "only",
      audiences: ["3"],
    },
  );
  assert.equal(variantPersonalization(null, "x").original.mode, "except");
});

const audiences = [
  { id: 1, key: "restaurant-a", title: "Restaurant A", state: "active" },
  { id: 2, key: "old", title: "Old", state: "archived" },
  { id: 3, key: "unused", title: "Unused", state: "active" },
  {
    id: 4,
    key: "ended",
    title: "Ended",
    state: "active",
    endsAt: "2020-01-01T00:00:00Z",
  },
];
const manifest: AudienceManifest = parseAudienceManifest({
  audiences: [
    {
      id: 1,
      key: "restaurant-a",
      conditions: [
        { parameter: "utm_source", operator: "equals", value: "restaurant-a" },
      ],
    },
    {
      id: 3,
      key: "unused",
      priority: 5,
      conditions: [
        { parameter: "utm_medium", operator: "equals", value: "qr" },
      ],
    },
    {
      id: 4,
      key: "ended",
      endsAt: "2020-01-01T00:00:00Z",
      conditions: [{ parameter: "utm_source", operator: "exists" }],
    },
  ],
});
const now = new Date("2026-11-14T12:00:00Z");

test("document summary counts audiences and flags problems", () => {
  const { counts, warnings } = summarizeDocument(
    [
      {
        path: "layout.0",
        blockType: "hero",
        mode: "except",
        audienceIds: ["1"],
      },
      {
        path: "layout.1",
        blockType: "hero",
        mode: "only",
        audienceIds: ["1", "2"],
      },
      { path: "layout.2", blockType: "hero", mode: "only", audienceIds: [] },
      {
        path: "layout.3",
        blockType: "hero",
        mode: "only",
        audienceIds: ["99", "4"],
      },
      { path: "layout.4", blockType: "hero", mode: "all", audienceIds: ["2"] },
    ],
    audiences,
    now,
  );
  assert.deepEqual(counts, { "1": 2, "2": 1, "99": 1, "4": 1 });
  assert.deepEqual(
    warnings.map((w) => `${w.path}:${w.kind}`),
    [
      "layout.1:archived-audience",
      "layout.2:no-audience",
      "layout.3:unknown-audience",
      "layout.3:expired-audience",
    ],
  );
});

test("consistency alerts cross-check audiences, blocks and UTM links", () => {
  const alerts = consistencyAlerts({
    audiences,
    manifest,
    now,
    documents: [
      {
        id: "pages:1",
        blocks: [
          {
            path: "layout.0",
            blockType: "hero",
            mode: "except",
            audienceIds: ["1"],
          },
          {
            path: "layout.1",
            blockType: "hero",
            mode: "only",
            audienceIds: ["2"],
          },
          {
            path: "layout.2",
            blockType: "hero",
            mode: "only",
            audienceIds: [],
          },
        ],
      },
    ],
    links: [
      {
        id: "ok",
        audience: 1,
        generatedUrl:
          "https://s.test/?utm_source=restaurant-a&utm_medium=qr&utm_campaign=c",
      },
      {
        id: "wrong",
        audience: { id: 1 },
        generatedUrl:
          "https://s.test/?utm_source=x&utm_medium=qr&utm_campaign=c",
      },
      {
        id: "archived",
        audience: 2,
        generatedUrl:
          "https://s.test/?utm_source=a&utm_medium=b&utm_campaign=c",
      },
      { id: "none" },
    ],
  });
  assert.deepEqual(alerts, [
    {
      kind: "block-archived-audience",
      documentId: "pages:1",
      path: "layout.1",
      audienceId: "2",
    },
    { kind: "block-no-audience", documentId: "pages:1", path: "layout.2" },
    { kind: "audience-unused", audienceId: "3" },
    { kind: "audience-unused", audienceId: "4" },
    {
      kind: "link-mismatch",
      linkId: "wrong",
      audienceId: "1",
      resolvedKey: "unused",
    },
    { kind: "link-inactive-audience", linkId: "archived", audienceId: "2" },
  ]);
});

test("URL simulator resolves the audience and lists shown and hidden blocks", () => {
  const documents = [
    {
      id: "pages:1",
      title: "Home",
      blocks: [
        {
          label: "Default hero",
          personalization: { mode: "except" as const, audiences: ["1"] },
        },
        {
          label: "Hero A",
          personalization: { mode: "only" as const, audiences: ["1"] },
        },
        {
          label: "Ended promo",
          personalization: { mode: "only" as const, audiences: ["4"] },
        },
      ],
    },
  ];
  const hit = simulateCampaignUrl(
    "https://s.test/menu?utm_source=restaurant-a",
    manifest,
    documents,
    now,
  );
  assert(hit.ok);
  assert.deepEqual(hit.audience, { key: "restaurant-a", id: 1 });
  assert.deepEqual(hit.documents[0]!.shown, ["Hero A"]);
  assert.deepEqual(hit.documents[0]!.hidden, ["Default hero", "Ended promo"]);
  const relative = simulateCampaignUrl(
    "/menu?utm_source=other",
    manifest,
    documents,
    now,
  );
  assert(relative.ok);
  assert.equal(relative.audience, null, "ended audience is not resolved");
  assert.deepEqual(relative.documents[0]!.shown, ["Default hero"]);
  assert.deepEqual(
    simulateCampaignUrl("http://[bad", manifest, documents, now),
    { ok: false },
  );
});
