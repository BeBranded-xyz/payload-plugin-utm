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
    ? (content as Record<string, unknown>)
    : null;
}
