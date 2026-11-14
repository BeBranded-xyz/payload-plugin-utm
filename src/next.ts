/**
 * Next.js integration (middleware / proxy and server helpers).
 * Edge-safe: imports nothing from Payload or React.
 */
import { NextResponse, type NextRequest } from "next/server.js";
import {
  AUDIENCE_COOKIE,
  AUDIENCE_HEADER,
  AUDIENCE_ID_HEADER,
  findAudience,
  hasCampaignParameters,
  isValidAudienceKey,
  parseAudienceManifest,
  resolveAudience,
  type ActiveAudience,
  type AudienceManifest,
} from "./personalization/match.js";

export type PersonalizationMiddlewareOptions = {
  /** Absolute manifest URL, e.g. `https://site.com/api/utm-audiences/manifest`. */
  manifestUrl?: string | URL | ((request: NextRequest) => string | URL);
  /** Custom loader (Edge Config, KV, static JSON…). Takes precedence over `manifestUrl`. */
  loadManifest?: (request: NextRequest) => Promise<unknown> | unknown;
  /** Sent as `Authorization: Bearer <secret>` to `manifestUrl`. */
  secret?: string;
  /** In-memory cache per manifest URL, default 60 s. */
  cacheTtlSeconds?: number;
  /** Abort a manifest request after this delay, default 1500 ms. */
  timeoutMs?: number;
  /** Remember the audience after the landing page. `false` personalizes only URLs carrying parameters. */
  cookie?: false | { name?: string; maxAgeSeconds?: number; secure?: boolean };
  /** Return false to skip the cookie (e.g. no consent). Personalization of the current URL still applies. */
  consent?: (request: NextRequest) => boolean;
  /**
   * Static mode: rewrite `/path` to `<prefix>/<audience>/path` so every
   * audience variant is a cacheable route. Visitors without an audience are not rewritten.
   */
  rewrite?: false | { prefix?: string };
};

type CacheEntry = { manifest: AudienceManifest; expires: number };
const cache = new Map<string, CacheEntry>();
const EMPTY: AudienceManifest = { version: 1, audiences: [] };

/** For tests. */
export function clearManifestCache() {
  cache.clear();
}

async function getManifest(
  request: NextRequest,
  options: PersonalizationMiddlewareOptions,
): Promise<AudienceManifest> {
  const ttl = (options.cacheTtlSeconds ?? 60) * 1000;
  const url = options.loadManifest
    ? "custom"
    : typeof options.manifestUrl === "function"
      ? String(options.manifestUrl(request))
      : options.manifestUrl
        ? String(options.manifestUrl)
        : new URL("/api/utm-audiences/manifest", request.url).toString();
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.manifest;
  try {
    let raw: unknown;
    if (options.loadManifest) raw = await options.loadManifest(request);
    else {
      const response = await fetch(url, {
        headers: options.secret
          ? { authorization: `Bearer ${options.secret}` }
          : {},
        signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
      });
      if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
      raw = await response.json();
    }
    const manifest = parseAudienceManifest(raw);
    cache.set(url, { manifest, expires: Date.now() + ttl });
    return manifest;
  } catch {
    // Never break the site: serve stale rules, else no personalization, and retry soon.
    const manifest = cached?.manifest ?? EMPTY;
    cache.set(url, { manifest, expires: Date.now() + Math.min(ttl, 10_000) });
    return manifest;
  }
}

export function createPersonalizationMiddleware(
  options: PersonalizationMiddlewareOptions = {},
) {
  const cookieName =
    (options.cookie !== false && options.cookie?.name) || AUDIENCE_COOKIE;
  const maxAge =
    (options.cookie !== false && options.cookie?.maxAgeSeconds) ||
    60 * 60 * 24 * 30;
  const prefix =
    options.rewrite &&
    "/" + (options.rewrite.prefix ?? "/utm-audience").replace(/^\/+|\/+$/g, "");
  if (prefix && !/^\/[A-Za-z0-9][A-Za-z0-9-]*$/.test(prefix))
    throw new Error(
      "createPersonalizationMiddleware: rewrite.prefix must be one path segment without a leading underscore.",
    );

  return async function personalize(
    request: NextRequest,
  ): Promise<NextResponse> {
    const url = request.nextUrl;
    // Variant routes are internal; never serve them under their own URL.
    if (
      prefix &&
      (url.pathname === prefix || url.pathname.startsWith(prefix + "/"))
    ) {
      const target = url.clone();
      const rest = url.pathname
        .slice(prefix.length)
        .split("/")
        .slice(2)
        .join("/");
      target.pathname = "/" + rest;
      return NextResponse.redirect(target, 308);
    }

    const manifest = await getManifest(request, options);
    const fromUrl = hasCampaignParameters(url.searchParams, manifest);
    const allowCookie =
      options.cookie !== false && (options.consent?.(request) ?? true);
    let audience: ActiveAudience | null = null;
    if (fromUrl) audience = resolveAudience(url.searchParams, manifest);
    else if (allowCookie)
      audience = findAudience(manifest, request.cookies.get(cookieName)?.value);

    const headers = new Headers(request.headers);
    headers.delete(AUDIENCE_HEADER);
    headers.delete(AUDIENCE_ID_HEADER);
    if (audience) {
      headers.set(AUDIENCE_HEADER, audience.key);
      if (audience.id !== undefined)
        headers.set(AUDIENCE_ID_HEADER, String(audience.id));
    }

    let response: NextResponse;
    if (prefix && audience) {
      const target = url.clone();
      target.pathname = `${prefix}/${audience.key}${url.pathname === "/" ? "" : url.pathname}`;
      response = NextResponse.rewrite(target, { request: { headers } });
    } else response = NextResponse.next({ request: { headers } });

    if (fromUrl && allowCookie) {
      if (audience)
        response.cookies.set(cookieName, audience.key, {
          maxAge,
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure:
            (options.cookie !== false && options.cookie?.secure) ??
            url.protocol === "https:",
        });
      // Last touch: a new campaign that matches nothing resets the audience.
      else if (request.cookies.has(cookieName))
        response.cookies.delete(cookieName);
    }
    return response;
  };
}

/** Dynamic mode: read the audience forwarded by the middleware in a Server Component. */
export async function getActiveAudience(): Promise<ActiveAudience | null> {
  const { headers } = await import("next/headers.js");
  const list = await headers();
  const key = list.get(AUDIENCE_HEADER);
  if (!isValidAudienceKey(key)) return null;
  const id = list.get(AUDIENCE_ID_HEADER);
  return id ? { key, id } : { key };
}

/** Static mode: validate the `[audience]` route segment. */
export function audienceFromParam(value: unknown): string | null {
  return isValidAudienceKey(value) ? value : null;
}

export {
  AUDIENCE_COOKIE,
  AUDIENCE_HEADER,
  AUDIENCE_ID_HEADER,
  filterPersonalizedBlocks,
  isVisibleForAudience,
} from "./personalization/match.js";
export type { ActiveAudience } from "./personalization/match.js";
