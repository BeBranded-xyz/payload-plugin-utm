import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildUtmUrl,
  buildUtmVariants,
  normalizeUtmValue,
  utmLinksToCsv,
  validateDestination,
} from "../src/utilities.js";

const base = {
  destination: "https://example.com/article/?ref=menu#details",
  source: "instagram",
  medium: "social",
  campaign: "launch",
};

test("required UTM fields, existing parameters and anchors survive encoding", () => {
  const url = new URL(buildUtmUrl(base)!);
  assert.equal(url.searchParams.get("utm_source"), "instagram");
  assert.equal(url.searchParams.get("utm_medium"), "social");
  assert.equal(url.searchParams.get("utm_campaign"), "launch");
  assert.equal(url.searchParams.get("ref"), "menu");
  assert.equal(url.hash, "#details");
});
test("old UTM values, duplicate keys and mixed-case variants are replaced", () => {
  const url = new URL(
    buildUtmUrl({
      ...base,
      destination:
        "https://example.com/?utm_source=a&utm_source=b&UTM_MEDIUM=x&utm_content=old&utm_custom=y&ref=1",
    })!,
  );
  assert.deepEqual(url.searchParams.getAll("utm_source"), ["instagram"]);
  assert.equal(url.searchParams.has("UTM_MEDIUM"), false);
  assert.equal(url.searchParams.has("utm_content"), false);
  assert.equal(url.searchParams.has("utm_custom"), false);
  assert.equal(url.searchParams.get("ref"), "1");
});
test("unicode, ampersands, plus signs, optional IDs and terms round trip", () => {
  const url = new URL(
    buildUtmUrl({
      ...base,
      campaign: " été & fête / 2026 ",
      content: "A+B",
      campaignId: "campaign-7",
      term: "été à Paris",
    })!,
  );
  assert.equal(url.searchParams.get("utm_campaign"), "été & fête / 2026");
  assert.equal(url.searchParams.get("utm_content"), "A+B");
  assert.equal(url.searchParams.get("utm_id"), "campaign-7");
  assert.equal(url.searchParams.get("utm_term"), "été à Paris");
});
for (const value of [
  "",
  "/relative",
  "javascript:alert(1)",
  "data:text/html,test",
  "ftp://example.com",
  "https://name:password@example.com",
]) {
  test(`rejects unsafe or incomplete destination: ${value.split(":")[0] || "empty"}`, () => {
    assert.notEqual(validateDestination(value), true);
    assert.equal(buildUtmUrl({ ...base, destination: value }), null);
  });
}
test("does not permit credentials hidden in a username", () =>
  assert.notEqual(validateDestination("https://name@example.com"), true));
test("origin restrictions match exact origin, including protocol and port", () => {
  const options = { allowedOrigins: ["https://example.com"] };
  assert(buildUtmUrl(base, options));
  for (const destination of [
    "http://example.com",
    "https://example.com:8443",
    "https://example.com.evil.test",
    "https://other.test",
  ])
    assert.equal(buildUtmUrl({ ...base, destination }, options), null);
  assert.equal(buildUtmUrl(base, { allowedOrigins: [] }), null);
});
test("only the source is required; empty medium or campaign are left out", () => {
  assert.equal(buildUtmUrl({ ...base, source: " " }), null);
  assert.equal(
    buildUtmUrl({ ...base, source: "你好" }, { normalization: "slug" }),
    null,
  );
  const noMedium = buildUtmUrl({ ...base, medium: " ", campaign: "" })!;
  assert.equal(new URL(noMedium).searchParams.get("utm_source"), base.source);
  assert.equal(new URL(noMedium).searchParams.has("utm_medium"), false);
  assert.equal(new URL(noMedium).searchParams.has("utm_campaign"), false);
});
test("defensive runtime checks reject non-string and oversized input", () => {
  assert.equal(buildUtmUrl({ ...base, source: 42 as unknown as string }), null);
  assert.equal(buildUtmUrl({ ...base, content: "a".repeat(513) }), null);
  assert.notEqual(
    validateDestination("https://example.com/" + "a".repeat(8192)),
    true,
  );
});
test("preserves case by default; normalization is explicitly opt-in", () => {
  assert.equal(normalizeUtmValue(" PartnerABC "), "PartnerABC");
  assert.equal(normalizeUtmValue(" PartnerABC ", "lowercase"), "partnerabc");
  assert.equal(normalizeUtmValue(" Été / 2026 ", "slug"), "ete-2026");
});
test("campaign variants retain base properties and never mutate input", () => {
  const original = structuredClone(base);
  const result = buildUtmVariants(base, [
    { source: "newsletter", medium: "email" },
    { content: "bio" },
  ]);
  assert.equal(new URL(result[0]!).searchParams.get("utm_medium"), "email");
  assert.equal(new URL(result[1]!).searchParams.get("utm_content"), "bio");
  assert.deepEqual(base, original);
  assert.throws(() => buildUtmVariants(base, [{ source: "" }]), /variant 1/);
});
test("CSV quotes commas, newlines and quotes, with UTF-8 BOM and CRLF", () => {
  const csv = utmLinksToCsv([{ title: 'A, "B"\nC', source: "été" }]);
  assert(csv.startsWith("\uFEFFtitle,"));
  assert(csv.includes('"A, ""B""\nC"'));
  assert(csv.includes('"été"'));
  assert(csv.endsWith("\r\n"));
});
test("CSV neutralizes spreadsheet formulas, including leading whitespace", () => {
  for (const title of ["=1+1", "+cmd", "-cmd", "@cmd", "\t=SUM(A1)", "  +1"]) {
    assert(utmLinksToCsv([{ title }]).includes(`"'${title}"`));
  }
});
