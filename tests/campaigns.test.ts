import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "payload";
import { utmPlugin } from "../src/index.js";
import { campaignAudienceKey } from "../src/personalization/collection.js";
import {
  audienceDocToRule,
  parseAudienceManifest,
  resolveAudience,
} from "../src/personalization/match.js";
import { unregisteredCampaigns, unregisteredReferrers } from "../src/personalization/stats.js";

const manifestOf = (...docs: Record<string, unknown>[]) =>
  parseAudienceManifest({ audiences: docs.map(audienceDocToRule) });

test("a campaign matches its UTM values OR a referring site OR its advanced rules", () => {
  const manifest = manifestOf({
    id: 1,
    key: "coudac",
    source: "coudac",
    medium: "referral",
    referrerDomains: ["coudac.*"],
    match: "any",
    conditions: [{ parameter: "custom", customParameter: "ref", operator: "equals", value: "coudac" }],
  });
  const audience = (params: string, referrer?: string) =>
    resolveAudience({ params: new URLSearchParams(params), referrer }, manifest)?.key ?? null;
  assert.equal(audience("utm_source=coudac&utm_medium=referral"), "coudac");
  assert.equal(audience("utm_source=coudac&utm_medium=email"), null, "medium set on the campaign");
  assert.equal(audience("", "https://www.coudac.fr/"), "coudac");
  assert.equal(audience("ref=coudac"), "coudac");
  assert.equal(audience("utm_source=other"), null);
});

test("source only: every medium and campaign of that source", () => {
  const manifest = manifestOf({ id: 2, key: "newsletter", source: "Newsletter" });
  const audience = (params: string) =>
    resolveAudience({ params: new URLSearchParams(params) }, manifest)?.key ?? null;
  assert.equal(audience("utm_source=newsletter&utm_medium=email&utm_campaign=nov"), "newsletter");
  assert.equal(audience("utm_medium=email"), null);
});

test("audience keys are generated from source and campaign", () => {
  assert.equal(campaignAudienceKey("Coudac"), "coudac");
  assert.equal(campaignAudienceKey("La Fabrique du Net", "Été 2026"), "la-fabrique-du-net-ete-2026");
  assert.equal(campaignAudienceKey("default"), "default-1", "reserved key avoided");
  assert.match(campaignAudienceKey("x".repeat(80)), /^x{64}$/);
});

test("the key is generated on save, unique among campaigns", async () => {
  const config = utmPlugin({ personalization: {} })({ collections: [] } as unknown as Config) as Config;
  const links = config.collections!.find((c) => c.slug === "utm-links")!;
  const hook = links.hooks!.beforeValidate!.at(-1)!;
  const taken = new Set(["coudac"]);
  const req = {
    payload: {
      find: async ({ where }: { where: { and: { key?: { equals: string } }[] } }) => ({
        docs: taken.has(where.and[0]!.key!.equals) ? [{ id: 9 }] : [],
      }),
    },
  };
  const data = (await hook({ data: { source: "coudac", personalize: true }, req } as never)) as { key: string };
  assert.equal(data.key, "coudac-2");
  const plain = (await hook({ data: { source: "coudac" }, req } as never)) as { key?: string };
  assert.equal(plain.key, undefined, "no key without personalization");
});

test("detected referring sites leave out search engines and known campaigns", () => {
  const rows = [
    { day: "2026-11-14", entry: true, source: "lafabriquedunet.fr" },
    { day: "2026-11-15", entry: true, source: "lafabriquedunet.fr" },
    { day: "2026-11-15", entry: true, source: "www.google.com" },
    { day: "2026-11-15", entry: true, source: "shop.coudac.fr" },
    { day: "2026-11-15", entry: true, source: "(direct)" },
    { day: "2026-11-15", entry: true, utm: true, source: "linkedin" },
  ];
  assert.deepEqual(unregisteredReferrers(rows, [{ referrerDomains: ["coudac.*"] }]), [
    { domain: "lafabriquedunet.fr", entries: 2, firstDay: "2026-11-14", lastDay: "2026-11-15" },
  ]);
  // A campaign with only a source covers every medium and campaign of it.
  assert.deepEqual(
    unregisteredCampaigns(
      [{ day: "2026-11-15", entry: true, utm: true, source: "linkedin", medium: "social", campaign: "x" }],
      [{ source: "LinkedIn" }],
    ),
    [],
  );
});
