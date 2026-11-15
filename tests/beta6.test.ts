import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "payload";
import { utmPlugin } from "../src/index.js";
import { fillAudienceTokens } from "../src/personalization/match.js";
import { flattenAudienceContent } from "../src/personalization/server.js";
import { allFields } from "./helpers.js";

test("editor texts become audience tokens; built-in fields win", () => {
  const content = flattenAudienceContent({
    displayName: "Coudac",
    texts: [
      { name: "offer", value: "-10 % pour les clients Coudac" },
      { name: "displayName", value: "ignored" },
      { name: "bad name", value: "ignored" },
      { name: "empty" },
    ],
  });
  assert.equal(content.offer, "-10 % pour les clients Coudac");
  assert.equal(content.displayName, "Coudac");
  assert.equal("texts" in content, false);
  assert.equal("bad name" in content, false);
  assert.equal(
    fillAudienceTokens(
      "{{audience.offer|Offre}} via {{audience.displayName}}",
      content,
    ),
    "-10 % pour les clients Coudac via Coudac",
  );
  assert.equal(fillAudienceTokens("{{audience.offer|Offre}}", null), "Offre");
});

test("campaigns get an 'Other texts' list with validated names", () => {
  const config = utmPlugin({
    personalization: { blocks: [], stats: false } as never,
  })({
    collections: [],
  } as unknown as Config) as Config;
  const links = config.collections!.find((c) => c.slug === "utm-links")!;
  const content = allFields(links).find(
    (f) => "name" in f && f.name === "audienceContent",
  ) as { fields: { name?: string }[] };
  const texts = content.fields.find((f) => f.name === "texts") as unknown as {
    type: string;
    fields: unknown[];
  };
  assert.equal(texts.type, "array");
  const row = texts.fields[0] as {
    fields: {
      name: string;
      localized?: boolean;
      validate?: (v: unknown) => unknown;
    }[];
  };
  const name = row.fields.find((f) => f.name === "name")!;
  const value = row.fields.find((f) => f.name === "value")!;
  assert.equal(value.localized, true);
  assert.equal(name.validate!("offer_2"), true);
  assert.notEqual(name.validate!("tagline"), true);
  assert.notEqual(name.validate!("2offer"), true);
  assert.notEqual(name.validate!("of-fer"), true);
});

test("Payload 4 block slugs in `blocks` are personalized like Block objects", () => {
  const hero = { slug: "hero", fields: [{ name: "title", type: "text" }] };
  const config = utmPlugin({
    personalization: { blocks: ["hero"], stats: false } as never,
  })({
    blocks: [hero],
    collections: [
      {
        slug: "pages",
        fields: [{ name: "layout", type: "blocks", blocks: ["hero"] }],
      },
    ],
  } as unknown as Config) as Config;
  const shared = config.blocks!.find((b) => b.slug === "hero")!;
  assert.ok(
    shared.fields.some((f) => "name" in f && f.name === "personalization"),
  );
  const pages = config.collections!.find((c) => c.slug === "pages")!;
  const layout = pages.fields.find(
    (f) => "name" in f && f.name === "layout",
  ) as {
    blocks: unknown[];
  };
  assert.deepEqual(layout.blocks, ["hero"], "slugs are kept as references");
  assert.ok(
    pages.fields.some(
      (f) => "name" in f && f.name === "utmPersonalizationPanel",
    ),
    "the panel is added to documents using the shared block",
  );
});
