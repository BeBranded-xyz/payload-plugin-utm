/**
 * Next.js integration (middleware / proxy and server helpers).
 * Edge-safe: imports nothing from Payload or React.
 */
import { NextResponse, type NextRequest } from "next/server.js";
import {
  AUDIENCE_COOKIE,
  AUDIENCE_HEADER,
  AUDIENCE_ID_HEADER,
  SOURCE_MEMORY_HEADER,
  findAudience,
  isValidAudienceKey,
  normalizePath,
  parseAudienceManifest,
  parseSourceMemory,
  serializeSourceMemory,
  touchFromRequest,
  updateSourceMemory,
  type ActiveAudience,
  type AudienceManifest,
  type SourceMemory,
} from "./personalization/match.js";

export type PersonalizationMiddlewareOptions = {
  /** Absolute manifest URL, e.g. `https://site.com/api/utm-links/manifest`. */
  manifestUrl?: string | URL | ((request: NextRequest) => string | URL);
  /** Custom loader (Edge Config, KV, static JSON…). Takes precedence over `manifestUrl`. */
  loadManifest?: (request: NextRequest) => Promise<unknown> | unknown;
  /** Sent as `Authorization: Bearer <secret>` to `manifestUrl`. */
  secret?: string;
  /** In-memory cache per manifest URL, default 60 s. */
  cacheTtlSeconds?: number;
  /** Abort a manifest request after this delay, default 1500 ms. */
  timeoutMs?: number;
  /**
   * Remember where the visitor came from (UTM parameters and referring site,
   * first/latest/sticky arrival), 90 days by default. `false` personalizes only
   * the landing request.
   */
  cookie?: false | { name?: string; maxAgeSeconds?: number; secure?: boolean };
  /** Return false to neither read nor write the cookie (e.g. no consent). The landing request is still personalized. */
  consent?: (request: NextRequest) => boolean;
  /**
   * Static mode: rewrite `/path` to `<prefix>/<audience>/path` so every
   * audience variant is a cacheable route. Visitors without an audience are not rewritten.
   */
  rewrite?:
    | false
    | {
        prefix?: string;
        /**
         * Locale segments your site places before the variant segment
         * (`/fr/utm-audience/<key>`): direct hits on them are redirected too.
         */
        localePrefixes?: string[];
      };
  /**
   * Admin preview: `?utm_preview=<key>` (or `default`) forces an audience for
   * that request only, without touching the cookie. `false` disables it.
   */
  previewParam?: string | false;
};

type CacheEntry = { manifest: AudienceManifest; expires: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AudienceManifest>>();
const EMPTY: AudienceManifest = { version: 1, audiences: [] };

/** Cookie the caller must set on its response (see `PersonalizationDecision.apply`). */
export type PersonalizationCookie = {
  name: string;
  value: string;
  options: {
    maxAge: number;
    path: string;
    httpOnly: boolean;
    sameSite: "lax";
    secure: boolean;
  };
};

/** What the personalization layer decided for one request. Builds no response. */
export type PersonalizationDecision = {
  /** Resolved audience (preview included), null for default content. */
  audience: ActiveAudience | null;
  /** Copy of the request headers with the audience and source memory set (spoofed copies removed). Forward them. */
  requestHeaders: Headers;
  /** Set when the request hits the internal variant prefix directly: answer with a 308 to this URL. */
  redirect: URL | null;
  /**
   * Static mode: the variant segment to insert when this public path has
   * content for the audience, else null (serve the normal route).
   */
  variant: { prefix: string; key: string } | null;
  /** `variantPath("/en/about")` → `/utm-audience/coudac/en/about` when `variant` is set, else the path unchanged. */
  variantPath: (pathname: string) => string;
  /** Source memory cookie to write (arrivals only), or null. */
  cookie: PersonalizationCookie | null;
  /** Sets `cookie` on the response you built (rewrite, next, redirect…) and returns it. */
  apply: <R extends NextResponse>(response: R) => R;
};

/** For tests. */
export function clearManifestCache() {
  cache.clear();
  inflight.clear();
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
        : new URL("/api/utm-links/manifest", request.url).toString();
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.manifest;
  // Stale-while-revalidate: once loaded, requests never wait for a refresh.
  let refresh = inflight.get(url);
  if (!refresh) {
    refresh = (async () => {
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
        // Never break the site: keep stale rules, else no personalization, and retry soon.
        const previous = cache.get(url)?.manifest ?? EMPTY;
        cache.set(url, {
          manifest: previous,
          expires: Date.now() + Math.min(ttl, 10_000),
        });
        return previous;
      } finally {
        inflight.delete(url);
      }
    })();
    inflight.set(url, refresh);
  }
  return cached ? cached.manifest : refresh;
}

/**
 * Decision only, for sites that already have a middleware / proxy (locale or
 * host rewrites, redirects…): resolves the audience, the forwarded headers,
 * the cookie and the variant path, and lets your code build the response.
 *
 * ```ts
 * const personalize = createPersonalizationResolver({ rewrite: { prefix: "utm-audience" } });
 * export async function proxy(request: NextRequest) {
 *   const decision = await personalize(request);
 *   if (decision.redirect) return NextResponse.redirect(decision.redirect, 308);
 *   const url = request.nextUrl.clone();
 *   url.pathname = decision.variantPath(`/en${url.pathname}`); // your own rewrite
 *   return decision.apply(NextResponse.rewrite(url, { request: { headers: decision.requestHeaders } }));
 * }
 * ```
 */
export function createPersonalizationResolver(
  options: PersonalizationMiddlewareOptions = {},
) {
  const previewParam =
    options.previewParam === false
      ? null
      : (options.previewParam ?? "utm_preview");
  if (previewParam !== null && !/^[A-Za-z0-9_.-]{1,64}$/.test(previewParam))
    throw new Error(
      "createPersonalizationMiddleware: previewParam must be a URL parameter name.",
    );
  const cookieName =
    (options.cookie !== false && options.cookie?.name) || AUDIENCE_COOKIE;
  const maxAge =
    (options.cookie !== false && options.cookie?.maxAgeSeconds) ||
    60 * 60 * 24 * 90;
  const prefix =
    options.rewrite &&
    "/" + (options.rewrite.prefix ?? "/utm-audience").replace(/^\/+|\/+$/g, "");
  if (prefix && !/^\/[A-Za-z0-9][A-Za-z0-9-]*$/.test(prefix))
    throw new Error(
      "createPersonalizationMiddleware: rewrite.prefix must be one path segment without a leading underscore.",
    );
  const localePrefixes =
    (options.rewrite && options.rewrite.localePrefixes) || [];
  if (localePrefixes.some((l) => !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(l)))
    throw new Error(
      "createPersonalizationMiddleware: rewrite.localePrefixes must be path segments such as fr or en-us.",
    );
  /** `/<locale>?/<prefix>/<key>/rest` → `/<locale>?/rest`, or null when not a variant path. */
  const publicPathOf = (pathname: string): string | null => {
    if (!prefix) return null;
    for (const locale of ["", ...localePrefixes]) {
      const head = locale ? `/${locale}${prefix}` : prefix;
      if (pathname === head || pathname.startsWith(head + "/")) {
        const rest = pathname.slice(head.length).split("/").slice(2).join("/");
        return locale ? `/${locale}${rest ? "/" + rest : ""}` : "/" + rest;
      }
    }
    return null;
  };

  return async function resolvePersonalization(
    request: NextRequest,
  ): Promise<PersonalizationDecision> {
    const url = request.nextUrl;
    const headers = new Headers(request.headers);
    headers.delete(AUDIENCE_HEADER);
    headers.delete(AUDIENCE_ID_HEADER);
    headers.delete(SOURCE_MEMORY_HEADER);
    const decision = (
      audience: ActiveAudience | null,
      extra: Partial<PersonalizationDecision> = {},
    ): PersonalizationDecision => {
      const variant = extra.variant ?? null;
      const cookie = extra.cookie ?? null;
      return {
        audience,
        requestHeaders: headers,
        redirect: null,
        variant,
        cookie,
        variantPath: (pathname) =>
          variant
            ? `${variant.prefix}/${variant.key}${pathname === "/" ? "" : pathname}`
            : pathname,
        apply: (response) => {
          if (cookie)
            response.cookies.set(cookie.name, cookie.value, cookie.options);
          return response;
        },
        ...extra,
      };
    };

    // Variant routes are internal; never serve them under their own URL.
    const publicPath = publicPathOf(url.pathname);
    if (publicPath !== null) {
      const target = url.clone();
      target.pathname = publicPath;
      return decision(null, { redirect: target });
    }

    const manifest = await getManifest(request, options);
    const previewKey = previewParam ? url.searchParams.get(previewParam) : null;
    const allowCookie =
      options.cookie !== false && (options.consent?.(request) ?? true);
    let audience: ActiveAudience | null = null;
    let memory: SourceMemory | null = null;
    let changed = false;
    if (previewKey !== null) audience = findAudience(manifest, previewKey);
    else {
      const touch = touchFromRequest({
        params: url.searchParams,
        referrer: request.headers.get("referer"),
        host: request.headers.get("host") ?? url.host,
        manifest,
      });
      const result = updateSourceMemory({
        memory: allowCookie
          ? parseSourceMemory(request.cookies.get(cookieName)?.value)
          : null,
        touch,
        manifest,
        maxAgeSeconds: maxAge,
      });
      audience = result.audience;
      memory = allowCookie ? result.memory : null;
      changed = allowCookie && result.changed;
    }

    if (audience) {
      headers.set(AUDIENCE_HEADER, audience.key);
      if (audience.id !== undefined)
        headers.set(AUDIENCE_ID_HEADER, String(audience.id));
    }
    if (memory)
      headers.set(SOURCE_MEMORY_HEADER, serializeSourceMemory(memory));

    // Static mode: only paths that have content for this audience get a variant.
    const paths = audience
      ? manifest.audiences.find((item) => item.key === audience!.key)?.paths
      : undefined;
    const variant =
      prefix &&
      audience &&
      (!paths || paths.includes(normalizePath(url.pathname)))
        ? { prefix, key: audience.key }
        : null;

    // Written only on arrivals, so cached internal navigation carries no Set-Cookie.
    const cookie: PersonalizationCookie | null =
      changed && memory
        ? {
            name: cookieName,
            // Next encodes cookie values itself; pass raw JSON to avoid double encoding.
            value: JSON.stringify(memory),
            options: {
              maxAge,
              path: "/",
              httpOnly: true,
              sameSite: "lax",
              secure:
                (options.cookie !== false && options.cookie?.secure) ??
                url.protocol === "https:",
            },
          }
        : null;
    return decision(audience, { variant, cookie });
  };
}

/**
 * Complete middleware / proxy for sites without one. If you already have a
 * proxy (locale, hosts…), use `createPersonalizationResolver()` inside it.
 */
export function createPersonalizationMiddleware(
  options: PersonalizationMiddlewareOptions = {},
) {
  const resolve = createPersonalizationResolver(options);
  return async function personalize(
    request: NextRequest,
  ): Promise<NextResponse> {
    const decision = await resolve(request);
    if (decision.redirect) return NextResponse.redirect(decision.redirect, 308);
    const init = { request: { headers: decision.requestHeaders } };
    if (decision.variant) {
      const target = request.nextUrl.clone();
      target.pathname = decision.variantPath(target.pathname);
      return decision.apply(NextResponse.rewrite(target, init));
    }
    return decision.apply(NextResponse.next(init));
  };
}

/**
 * Static (rewrite) mode: invalidate every cached audience variant, e.g. from
 * `personalization.afterAudienceChange` or your pages' `afterChange` hooks.
 * Call it only inside a Next.js server context (hooks triggered by the admin or API).
 */
export async function revalidatePersonalizedRoutes(
  options: { prefix?: string } = {},
): Promise<void> {
  const prefix = (options.prefix ?? "utm-audience").replace(/^\/+|\/+$/g, "");
  const { revalidatePath } = await import("next/cache.js");
  revalidatePath(`/${prefix}`, "layout");
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

/**
 * Where the visitor came from (first, latest and audience-selecting arrival),
 * e.g. to attach UTM parameters to a lead form. Null without consent or memory.
 */
export async function getSourceMemory(): Promise<SourceMemory | null> {
  const { headers } = await import("next/headers.js");
  return parseSourceMemory((await headers()).get(SOURCE_MEMORY_HEADER));
}

/** Static mode: validate the `[audience]` route segment. */
export function audienceFromParam(value: unknown): string | null {
  return isValidAudienceKey(value) ? value : null;
}

export {
  AUDIENCE_COOKIE,
  AUDIENCE_HEADER,
  AUDIENCE_ID_HEADER,
  SOURCE_MEMORY_HEADER,
  fillAudienceTokens,
  sourceMemoryFields,
  filterPersonalizedBlocks,
  isVisibleForAudience,
} from "./personalization/match.js";
export type {
  ActiveAudience,
  SourceMemory,
  SourceTouch,
} from "./personalization/match.js";
