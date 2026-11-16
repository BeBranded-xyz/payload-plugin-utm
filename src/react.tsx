/**
 * Code mode: personalize hand-written React pages (no Payload blocks needed).
 * Audiences and their content stay managed in Payload; developers place
 * `<Personalized>` where the page should change.
 */
import type { ReactNode } from "react";
import { getActiveAudience, getSourceMemory } from "./next.js";
import {
  isValidAudienceKey,
  sourceMemoryFields,
  type ActiveAudience,
} from "./personalization/match.js";

type Keys = string | readonly string[];

export type PersonalizedProps = {
  /** Show `children` only to these audience keys. */
  only?: Keys;
  /** Show `children` to everyone except these audience keys. */
  except?: Keys;
  /**
   * Active audience. Omit in dynamic mode (read from the middleware headers).
   * In static mode pass the `[audience]` route param (`audienceFromParam(...)`),
   * or `null` for the default variant, so the route stays static.
   */
  audience?: ActiveAudience | string | null;
  /** Rendered instead of `children` when hidden. */
  fallback?: ReactNode;
  children?: ReactNode;
};

const list = (keys: Keys | undefined) =>
  keys === undefined ? undefined : typeof keys === "string" ? [keys] : keys;

/** Pure rule behind `<Personalized>`: `only` and `except` combine (both must pass). */
export function matchesAudienceKeys(
  audience: ActiveAudience | string | null | undefined,
  rule: { only?: Keys; except?: Keys },
): boolean {
  const key = typeof audience === "string" ? audience : audience?.key;
  const active = isValidAudienceKey(key) ? key : null;
  const only = list(rule.only);
  const except = list(rule.except);
  if (only && !(active && only.includes(active))) return false;
  if (except && active && except.includes(active)) return false;
  return true;
}

/** Resolves the audience: the given one, else the middleware headers (dynamic mode). */
export async function currentAudience(
  audience: ActiveAudience | string | null | undefined,
): Promise<ActiveAudience | null> {
  if (audience === null) return null;
  if (audience === undefined) return getActiveAudience();
  const active = typeof audience === "string" ? { key: audience } : audience;
  return isValidAudienceKey(active.key) ? active : null;
}

/**
 * Server Component.
 *
 * ```tsx
 * <Personalized only="coudac" fallback={<DefaultBadge />}>
 *   <CoudacBadge />
 * </Personalized>
 * ```
 */
export async function Personalized({
  only,
  except,
  audience,
  fallback = null,
  children,
}: PersonalizedProps) {
  const active = await currentAudience(audience);
  return (
    <>{matchesAudienceKeys(active, { only, except }) ? children : fallback}</>
  );
}

/**
 * Hidden inputs with the visitor's source memory (first, latest and
 * audience-selecting arrival), for a lead form posted to your CRM.
 * Server Component; renders nothing without memory or consent.
 */
export async function SourceMemoryFields({
  prefix = "",
}: {
  /** Prepended to every input name, e.g. `utm_` → `utm_first_utm_source`. */
  prefix?: string;
}) {
  const memory = await getSourceMemory();
  const fields = sourceMemoryFields(memory);
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input
          key={name}
          type="hidden"
          name={`${prefix}${name}`}
          value={value}
        />
      ))}
    </>
  );
}
