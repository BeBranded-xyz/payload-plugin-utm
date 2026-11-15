import type { CollectionSlug, Payload } from "payload";
import { isValidAudienceKey, type ActiveAudience } from "./match.js";

/**
 * Content fields of the active audience (display name, tagline, image…), for
 * `fillAudienceTokens()` or direct rendering. Content is public by design, so
 * this reads with `overrideAccess` and selects only the `content` group.
 */
export async function getAudienceContent(
  payload: Payload,
  audience: ActiveAudience | string | null | undefined,
  options: {
    /** The UTM campaigns collection, default `utm-links`. */
    audiencesSlug?: string;
    depth?: number;
    locale?: string;
  } = {},
): Promise<Record<string, unknown> | null> {
  if (!audience) return null;
  const active = typeof audience === "string" ? { key: audience } : audience;
  if (!isValidAudienceKey(active.key)) return null;
  const result = await payload.find({
    collection: (options.audiencesSlug ?? "utm-links") as CollectionSlug,
    overrideAccess: true,
    depth: options.depth ?? 1,
    limit: 1,
    pagination: false,
    ...(options.locale ? { locale: options.locale as never } : {}),
    where: {
      and: [
        active.id !== undefined
          ? { id: { equals: active.id } }
          : { key: { equals: active.key } },
        { personalize: { equals: true } },
      ],
    },
    select: { audienceContent: true } as never,
  });
  const content = (result.docs[0] as { audienceContent?: unknown } | undefined)
    ?.audienceContent;
  return content && typeof content === "object"
    ? flattenAudienceContent(content as Record<string, unknown>)
    : null;
}

/**
 * Campaign content with the editor's "Other texts" (`texts: [{ name, value }]`)
 * lifted to top-level keys, so `{{audience.offer}}` and `content.offer` work.
 * Built-in fields win over a text of the same name.
 */
export function flattenAudienceContent(
  content: Record<string, unknown>,
): Record<string, unknown> {
  const { texts, ...rest } = content;
  const extra: Record<string, unknown> = {};
  if (Array.isArray(texts))
    for (const row of texts) {
      const name = (row as { name?: unknown } | null)?.name;
      const value = (row as { value?: unknown } | null)?.value;
      if (
        typeof name === "string" &&
        /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) &&
        typeof value === "string" &&
        !(name in rest)
      )
        extra[name] = value;
    }
  return { ...extra, ...rest };
}
