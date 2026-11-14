/**
 * Edge-safe personalization core: no Payload, React or Next.js imports.
 */
import { utmParameters } from "../utilities.js";

export const audienceOperators = [
  "equals",
  "notEquals",
  "in",
  "contains",
  "startsWith",
  "exists",
] as const;
export type AudienceOperator = (typeof audienceOperators)[number];
export type AudienceCondition = {
  /** Query parameter name, e.g. `utm_source`. */
  parameter: string;
  operator: AudienceOperator;
  value?: string | null;
};
export type AudienceRule = {
  id?: string | number;
  key: string;
  priority?: number;
  match?: "all" | "any";
  conditions: AudienceCondition[];
};
export type AudienceManifest = { version: 1; audiences: AudienceRule[] };
export type ActiveAudience = { key: string; id?: string | number };
export type PersonalizationValue = {
  mode?: "all" | "only" | "except" | null;
  audiences?: unknown[] | null;
} | null;

export const AUDIENCE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const RESERVED_AUDIENCE_KEYS = ["default"] as const;
export const AUDIENCE_HEADER = "x-utm-audience";
export const AUDIENCE_ID_HEADER = "x-utm-audience-id";
export const AUDIENCE_COOKIE = "utm_audience";
export const utmQueryParameters = Object.values(utmParameters);

export function isValidAudienceKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    AUDIENCE_KEY_PATTERN.test(value) &&
    !(RESERVED_AUDIENCE_KEYS as readonly string[]).includes(value)
  );
}

const clean = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/** Case-insensitive parameter lookup; the first non-empty value wins. */
function readParameter(params: URLSearchParams, name: string): string {
  const wanted = name.trim().toLowerCase();
  for (const [key, value] of params)
    if (key.toLowerCase() === wanted && value.trim()) return clean(value);
  return "";
}

export function conditionMatches(
  params: URLSearchParams,
  condition: AudienceCondition,
): boolean {
  const actual = readParameter(params, condition.parameter);
  const expected = clean(condition.value);
  switch (condition.operator) {
    case "exists":
      return actual !== "";
    case "equals":
      return actual !== "" && actual === expected;
    case "notEquals":
      return actual !== expected;
    case "in":
      return (
        actual !== "" &&
        expected
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .includes(actual)
      );
    case "contains":
      return actual !== "" && expected !== "" && actual.includes(expected);
    case "startsWith":
      return actual !== "" && expected !== "" && actual.startsWith(expected);
    default:
      return false;
  }
}

export function audienceMatches(
  params: URLSearchParams,
  audience: AudienceRule,
): boolean {
  if (!audience.conditions.length) return false;
  const results = audience.conditions.map((condition) =>
    conditionMatches(params, condition),
  );
  return audience.match === "any"
    ? results.some(Boolean)
    : results.every(Boolean);
}

/** Lowest priority first, then manifest order. */
export function resolveAudience(
  params: URLSearchParams,
  manifest: AudienceManifest,
): ActiveAudience | null {
  const ordered = manifest.audiences
    .map((audience, index) => ({ audience, index }))
    .sort(
      (a, b) =>
        (a.audience.priority ?? 0) - (b.audience.priority ?? 0) ||
        a.index - b.index,
    );
  for (const { audience } of ordered)
    if (audienceMatches(params, audience))
      return { key: audience.key, id: audience.id };
  return null;
}

/** True when the URL carries a UTM parameter or a custom parameter used by a rule. */
export function hasCampaignParameters(
  params: URLSearchParams,
  manifest: AudienceManifest,
): boolean {
  const names = new Set(utmQueryParameters as string[]);
  for (const audience of manifest.audiences)
    for (const condition of audience.conditions)
      names.add(condition.parameter.toLowerCase());
  for (const [key, value] of params)
    if (names.has(key.toLowerCase()) && value.trim()) return true;
  return false;
}

export function findAudience(
  manifest: AudienceManifest,
  key: unknown,
): ActiveAudience | null {
  if (!isValidAudienceKey(key)) return null;
  const audience = manifest.audiences.find((item) => item.key === key);
  return audience ? { key: audience.key, id: audience.id } : null;
}

/** Map a stored audience document (admin shape) to manifest input. */
export function audienceDocToRule(doc: Record<string, unknown>): unknown {
  return {
    id: doc.id,
    key: doc.key,
    priority: doc.priority,
    match: doc.match,
    conditions: Array.isArray(doc.conditions)
      ? doc.conditions.map((c: Record<string, unknown>) => ({
          parameter:
            c?.parameter === "custom" ? c.customParameter : c?.parameter,
          operator: c?.operator,
          value: c?.value,
        }))
      : [],
  };
}

/** Defensive parser: drops malformed entries instead of throwing. */
export function parseAudienceManifest(input: unknown): AudienceManifest {
  const empty: AudienceManifest = { version: 1, audiences: [] };
  if (!input || typeof input !== "object") return empty;
  const raw = (input as { audiences?: unknown }).audiences;
  if (!Array.isArray(raw)) return empty;
  const seen = new Set<string>();
  const audiences: AudienceRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (!isValidAudienceKey(entry.key) || seen.has(entry.key)) continue;
    const conditions = Array.isArray(entry.conditions)
      ? entry.conditions.flatMap((value): AudienceCondition[] => {
          if (!value || typeof value !== "object") return [];
          const c = value as Record<string, unknown>;
          if (
            typeof c.parameter !== "string" ||
            !c.parameter.trim() ||
            !(audienceOperators as readonly unknown[]).includes(c.operator)
          )
            return [];
          return [
            {
              parameter: c.parameter.trim(),
              operator: c.operator as AudienceOperator,
              value: typeof c.value === "string" ? c.value : null,
            },
          ];
        })
      : [];
    if (!conditions.length) continue;
    seen.add(entry.key);
    audiences.push({
      key: entry.key,
      id:
        typeof entry.id === "string" || typeof entry.id === "number"
          ? entry.id
          : undefined,
      priority: typeof entry.priority === "number" ? entry.priority : 0,
      match: entry.match === "any" ? "any" : "all",
      conditions,
    });
  }
  return { version: 1, audiences };
}

const normalizeActive = (
  audience: ActiveAudience | string | null | undefined,
): ActiveAudience | null =>
  typeof audience === "string"
    ? isValidAudienceKey(audience)
      ? { key: audience }
      : null
    : (audience ?? null);

/** Matches a relationship value: a populated doc (by key) or a raw ID. */
function referencesAudience(ref: unknown, audience: ActiveAudience): boolean {
  if (ref && typeof ref === "object") {
    const doc = ref as { key?: unknown; id?: unknown; value?: unknown };
    if (doc.key !== undefined) return doc.key === audience.key;
    if (doc.value !== undefined) return referencesAudience(doc.value, audience);
    ref = doc.id;
  }
  return (
    audience.id !== undefined &&
    (typeof ref === "string" || typeof ref === "number") &&
    String(ref) === String(audience.id)
  );
}

export function isVisibleForAudience(
  personalization: PersonalizationValue | undefined,
  audience: ActiveAudience | string | null | undefined,
): boolean {
  const mode = personalization?.mode ?? "all";
  if (mode === "all") return true;
  const active = normalizeActive(audience);
  const listed = Boolean(
    active &&
      (personalization?.audiences ?? []).some((ref) =>
        referencesAudience(ref, active),
      ),
  );
  return mode === "only" ? listed : !listed;
}

/** Keep blocks (or any items) visible to the active audience. */
export function filterPersonalizedBlocks<T>(
  blocks: readonly T[] | null | undefined,
  audience: ActiveAudience | string | null | undefined,
  fieldName = "personalization",
): T[] {
  return (blocks ?? []).filter((block) =>
    isVisibleForAudience(
      (block as Record<string, unknown> | null)?.[fieldName] as
        | PersonalizationValue
        | undefined,
      audience,
    ),
  );
}

/** Query string that satisfies the audience's conditions, when one can be inferred. */
export function exampleCampaignQuery(
  conditions: { parameter: string; operator: string; value?: string | null }[],
  match: "all" | "any" = "all",
): string {
  const params = new URLSearchParams();
  const usable = conditions.filter((c) =>
    ["equals", "in", "startsWith", "contains", "exists"].includes(c.operator),
  );
  for (const c of match === "any" ? usable.slice(0, 1) : usable) {
    const value =
      c.operator === "exists"
        ? "1"
        : c.operator === "in"
          ? (c.value ?? "").split(",")[0]!.trim()
          : (c.value ?? "").trim();
    if (c.parameter && value) params.set(c.parameter, value);
  }
  return params.toString();
}
