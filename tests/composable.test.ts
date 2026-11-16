import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { NextRequest, NextResponse } from "next/server.js";
import {
  clearManifestCache,
  createPersonalizationResolver,
} from "../src/next.js";
import { Personalized, matchesAudienceKeys } from "../src/react.js";
import type { AudienceManifest } from "../src/personalization/match.js";

const manifest: AudienceManifest = {
  version: 1,
  audiences: [
    {
      id: 7,
      key: "coudac",
      priority: 0,
      match: "any",
      conditions: [
        { parameter: "$referrer", operator: "equals", value: "coudac.com" },
        { parameter: "utm_source", operator: "equals", value: "coudac" },
      ],
      paths: ["/", "/fr"],
    },
  ],
};

beforeEach(() => clearManifestCache());
const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "https://bebranded.test"), {
    headers: { "x-utm-audience": "spoofed", ...headers },
  });

// A site proxy that already rewrites every non-/fr path to an internal /en segment.
const resolve = createPersonalizationResolver({
  loadManifest: () => manifest,
  rewrite: { prefix: "utm-audience" },
});
async function siteProxy(req: NextRequest) {
  const decision = await resolve(req);
  if (decision.redirect) return NextResponse.redirect(decision.redirect, 308);
  const url = req.nextUrl.clone();
  const internal = url.pathname.startsWith("/fr")
    ? url.pathname
    : `/en${url.pathname === "/" ? "" : url.pathname}`;
  url.pathname = decision.variantPath(internal);
  return decision.apply(
    NextResponse.rewrite(url, {
      request: { headers: decision.requestHeaders },
    }),
  );
}
const rewritten = (response: Response) =>
  new URL(response.headers.get("x-middleware-rewrite")!).pathname;

test("resolver composes with an existing locale rewrite", async () => {
  const landing = await siteProxy(
    request("/", { referer: "https://www.coudac.com/partenaires" }),
  );
  assert.equal(rewritten(landing), "/utm-audience/coudac/en");
  assert.equal(
    landing.headers.get("x-middleware-request-x-utm-audience"),
    "coudac",
  );
  const setCookie = landing.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /utm_memory=/);
  assert.match(setCookie, /HttpOnly/i);

  // Untargeted page: the site's own rewrite only, audience still forwarded.
  const cookie = setCookie.split(";")[0]!;
  const about = await siteProxy(request("/about", { cookie }));
  assert.equal(rewritten(about), "/en/about");
  assert.equal(
    about.headers.get("x-middleware-request-x-utm-audience"),
    "coudac",
  );
  assert.equal(
    about.headers.get("set-cookie"),
    null,
    "no Set-Cookie off arrivals",
  );

  const plain = await siteProxy(request("/"));
  assert.equal(rewritten(plain), "/en");
  assert.equal(plain.headers.get("x-middleware-request-x-utm-audience"), null);
});

test("resolver reports direct prefix hits instead of answering", async () => {
  const decision = await resolve(request("/utm-audience/coudac/about"));
  assert.equal(decision.redirect?.pathname, "/about");
  assert.equal(decision.audience, null);
  const response = await siteProxy(request("/utm-audience/coudac/about"));
  assert.equal(response.status, 308);
});

test("resolver without rewrite never returns a variant", async () => {
  const dynamic = createPersonalizationResolver({
    loadManifest: () => manifest,
  });
  const decision = await dynamic(request("/?utm_source=coudac"));
  assert.equal(decision.audience?.key, "coudac");
  assert.equal(decision.variant, null);
  assert.equal(decision.variantPath("/en"), "/en");
  assert.ok(decision.cookie);
});

test("only / except rules", () => {
  assert.equal(matchesAudienceKeys("coudac", { only: "coudac" }), true);
  assert.equal(matchesAudienceKeys(null, { only: "coudac" }), false);
  assert.equal(
    matchesAudienceKeys({ key: "ugc" }, { only: ["coudac", "ugc"] }),
    true,
  );
  assert.equal(matchesAudienceKeys("coudac", { except: "coudac" }), false);
  assert.equal(matchesAudienceKeys(null, { except: "coudac" }), true);
  assert.equal(
    matchesAudienceKeys("default", { only: "default" }),
    false,
    "reserved key",
  );
  assert.equal(matchesAudienceKeys("ugc", {}), true);
});

test("<Personalized> renders children or fallback from an explicit audience", async () => {
  const shown = (await Personalized({
    only: "coudac",
    audience: "coudac",
    children: "badge",
    fallback: "default",
  })) as { props: { children: unknown } };
  assert.equal(shown.props.children, "badge");
  const hidden = (await Personalized({
    only: "coudac",
    audience: null,
    children: "badge",
    fallback: "default",
  })) as { props: { children: unknown } };
  assert.equal(hidden.props.children, "default");
});
