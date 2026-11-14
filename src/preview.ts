/**
 * Draft preview route: lets editors see unpublished variants as an audience.
 *
 * ```ts
 * // app/api/utm-preview/route.ts
 * import config from '@payload-config'
 * import { createDraftPreviewRoute } from 'payload-plugin-utm/preview'
 * export const GET = createDraftPreviewRoute({ config })
 * ```
 * then `personalization.preview.draftRoute: '/api/utm-preview'`. Pages read
 * drafts when `(await draftMode()).isEnabled` (`draft: true` in `payload.find`).
 */
import { draftMode } from "next/headers.js";
import { getPayload, type SanitizedConfig } from "payload";
import { isValidAudienceKey } from "./personalization/match.js";

export type DraftPreviewRouteOptions = {
  config: SanitizedConfig | Promise<SanitizedConfig>;
  /** Must match the middleware `previewParam`, default `utm_preview`. */
  param?: string;
};

/** Validates the redirect target: a same-site path, never another origin. */
export function safePreviewPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return null;
  try {
    const url = new URL(value, "https://placeholder.invalid");
    if (url.origin !== "https://placeholder.invalid") return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

export function createDraftPreviewRoute(options: DraftPreviewRouteOptions) {
  const param = options.param ?? "utm_preview";
  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = safePreviewPath(url.searchParams.get("path") ?? "/");
    const audience = url.searchParams.get(param);
    if (
      !path ||
      (audience !== null &&
        audience !== "default" &&
        !isValidAudienceKey(audience))
    )
      return new Response("Invalid preview request.", { status: 400 });

    const payload = await getPayload({ config: options.config });
    const { user } = await payload.auth({ headers: request.headers });
    if (!user)
      return new Response(
        "Sign in to the Payload admin on this domain to preview drafts.",
        { status: 401 },
      );

    (await draftMode()).enable();
    const target = new URL(path, url.origin);
    if (audience !== null) target.searchParams.set(param, audience);
    // Next adds the draft-mode cookie to the returned response. A relative
    // target keeps the visitor on the host that received it.
    return new Response(null, {
      status: 307,
      headers: {
        location: target.pathname + target.search,
        "cache-control": "no-store",
      },
    });
  };
}
