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
  /** ISO dates; outside this window the audience is ignored. */
  startsAt?: string | null;
  endsAt?: string | null;
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

/** True when `now` is inside the audience's optional campaign window. */
export function isAudienceLive(
  audience: Pick<AudienceRule, "startsAt" | "endsAt">,
  now: Date = new Date(),
): boolean {
  const time = now.getTime();
  const start = audience.startsAt ? Date.parse(audience.startsAt) : NaN;
  const end = audience.endsAt ? Date.parse(audience.endsAt) : NaN;
  if (!Number.isNaN(start) && time < start) return false;
  if (!Number.isNaN(end) && time >= end) return false;
  return true;
}

/** Lowest priority first, then manifest order. Audiences outside their dates are skipped. */
export function resolveAudience(
  params: URLSearchParams,
  manifest: AudienceManifest,
  now: Date = new Date(),
): ActiveAudience | null {
  const ordered = manifest.audiences
    .filter((audience) => isAudienceLive(audience, now))
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
  now: Date = new Date(),
): ActiveAudience | null {
  if (!isValidAudienceKey(key)) return null;
  const audience = manifest.audiences.find(
    (item) => item.key === key && isAudienceLive(item, now),
  );
  return audience ? { key: audience.key, id: audience.id } : null;
}

/** Map a stored audience document (admin shape) to manifest input. */
export function audienceDocToRule(doc: Record<string, unknown>): unknown {
  return {
    id: doc.id,
    key: doc.key,
    priority: doc.priority,
    match: doc.match,
    startsAt: doc.startsAt,
    endsAt: doc.endsAt,
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

const validDate = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

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
      ...(validDate(entry.startsAt) ? { startsAt: entry.startsAt } : {}),
      ...(validDate(entry.endsAt) ? { endsAt: entry.endsAt } : {}),
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

// ---------------------------------------------------------------------------
// Admin analysis helpers (pure: shared by the editor panel, the admin view and tests)
// ---------------------------------------------------------------------------

export type PersonalizedBlock = {
  /** Dot path from the document root, e.g. `layout.2`. */
  path: string;
  blockType: string;
  blockName?: string;
  mode: "all" | "only" | "except";
  /** Referenced audience IDs (stringified), from raw IDs or populated docs. */
  audienceIds: string[];
};

/** Normalize relationship values (ID, populated doc, polymorphic) to string IDs. */
export function audienceRefIds(refs: unknown): string[] {
  if (!Array.isArray(refs)) return [];
  return refs.flatMap((ref): string[] => {
    if (typeof ref === "string" || typeof ref === "number")
      return [String(ref)];
    if (ref && typeof ref === "object") {
      const doc = ref as { id?: unknown; value?: unknown };
      if (doc.value !== undefined) return audienceRefIds([doc.value]);
      if (typeof doc.id === "string" || typeof doc.id === "number")
        return [String(doc.id)];
    }
    return [];
  });
}

/** Every block (object with `blockType`) carrying a personalization group, depth-first. */
export function collectPersonalizedBlocks(
  data: unknown,
  fieldName = "personalization",
): PersonalizedBlock[] {
  const found: PersonalizedBlock[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        walk(item, path ? `${path}.${index}` : String(index)),
      );
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const group = record[fieldName];
    if (
      typeof record.blockType === "string" &&
      group &&
      typeof group === "object" &&
      !Array.isArray(group)
    ) {
      const p = group as { mode?: unknown; audiences?: unknown };
      found.push({
        path,
        blockType: record.blockType,
        blockName:
          typeof record.blockName === "string" && record.blockName
            ? record.blockName
            : undefined,
        mode: p.mode === "only" || p.mode === "except" ? p.mode : "all",
        audienceIds: audienceRefIds(p.audiences),
      });
    }
    for (const [key, child] of Object.entries(record))
      if (key !== fieldName) walk(child, path ? `${path}.${key}` : key);
  };
  walk(data, "");
  return found;
}

export type AudienceSummary = {
  id: string | number;
  key: string;
  title?: string;
  state?: string;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type BlockWarning = {
  path: string;
  kind:
    | "no-audience"
    | "unknown-audience"
    | "archived-audience"
    | "expired-audience";
  audienceId?: string;
};

/** Per-audience block counts and warnings for one document. */
export function summarizeDocument(
  blocks: readonly PersonalizedBlock[],
  audiences: readonly AudienceSummary[],
  now: Date = new Date(),
): { counts: Record<string, number>; warnings: BlockWarning[] } {
  const byId = new Map(audiences.map((a) => [String(a.id), a]));
  const counts: Record<string, number> = {};
  const warnings: BlockWarning[] = [];
  for (const block of blocks) {
    if (block.mode === "all") continue;
    if (!block.audienceIds.length)
      warnings.push({ path: block.path, kind: "no-audience" });
    for (const id of block.audienceIds) {
      counts[id] = (counts[id] ?? 0) + 1;
      const audience = byId.get(id);
      if (!audience)
        warnings.push({
          path: block.path,
          kind: "unknown-audience",
          audienceId: id,
        });
      else if (audience.state && audience.state !== "active")
        warnings.push({
          path: block.path,
          kind: "archived-audience",
          audienceId: id,
        });
      else if (!isAudienceLive({ endsAt: audience.endsAt }, now))
        warnings.push({
          path: block.path,
          kind: "expired-audience",
          audienceId: id,
        });
    }
  }
  return { counts, warnings };
}

/**
 * Personalization values for "create a variant for this audience":
 * the copy is shown only to the audience, the original stops showing to it.
 */
export function variantPersonalization(
  original: { mode?: unknown; audiences?: unknown } | null | undefined,
  audienceId: string | number,
): {
  original: { mode: "all" | "only" | "except"; audiences: string[] };
  copy: { mode: "only"; audiences: string[] };
} {
  const id = String(audienceId);
  const mode =
    original?.mode === "only" || original?.mode === "except"
      ? original.mode
      : "all";
  const ids = audienceRefIds(original?.audiences);
  const next: { mode: "all" | "only" | "except"; audiences: string[] } =
    mode === "all"
      ? { mode: "except", audiences: [id] }
      : mode === "except"
        ? { mode, audiences: ids.includes(id) ? ids : [...ids, id] }
        : { mode, audiences: ids.filter((item) => item !== id) };
  return { original: next, copy: { mode: "only", audiences: [id] } };
}

export type SimulatedDocument = {
  id: string;
  title: string;
  /** All blocks of the document, personalized or not. */
  blocks: { label: string; personalization?: PersonalizationValue }[];
};

export type SimulationResult =
  | { ok: false }
  | {
      ok: true;
      audience: ActiveAudience | null;
      documents: {
        id: string;
        title: string;
        shown: string[];
        hidden: string[];
      }[];
    };

/** What a visitor landing on `url` would get, document by document. */
export function simulateCampaignUrl(
  url: string,
  manifest: AudienceManifest,
  documents: readonly SimulatedDocument[],
  now: Date = new Date(),
): SimulationResult {
  let params: URLSearchParams;
  try {
    params = new URL(url.trim(), "https://example.invalid").searchParams;
  } catch {
    return { ok: false };
  }
  const audience = resolveAudience(params, manifest, now);
  return {
    ok: true,
    audience,
    documents: documents.map((doc) => {
      const shown: string[] = [];
      const hidden: string[] = [];
      for (const block of doc.blocks)
        (isVisibleForAudience(block.personalization, audience)
          ? shown
          : hidden
        ).push(block.label);
      return { id: doc.id, title: doc.title, shown, hidden };
    }),
  };
}

export type ConsistencyAlert =
  | { kind: "audience-unused"; audienceId: string }
  | {
      kind: "block-archived-audience" | "block-unknown-audience";
      documentId: string;
      path: string;
      audienceId: string;
    }
  | { kind: "block-no-audience"; documentId: string; path: string }
  | {
      kind: "link-mismatch";
      linkId: string;
      audienceId: string;
      resolvedKey: string | null;
    }
  | { kind: "link-inactive-audience"; linkId: string; audienceId: string };

/** Cross-checks audiences, personalized blocks and UTM links. */
export function consistencyAlerts(input: {
  audiences: readonly AudienceSummary[];
  manifest: AudienceManifest;
  documents: readonly { id: string; blocks: readonly PersonalizedBlock[] }[];
  links: readonly {
    id: string;
    generatedUrl?: string | null;
    audience?: unknown;
  }[];
  now?: Date;
}): ConsistencyAlert[] {
  const now = input.now ?? new Date();
  const alerts: ConsistencyAlert[] = [];
  const used = new Set<string>();
  for (const doc of input.documents) {
    for (const block of doc.blocks)
      if (block.mode !== "all") block.audienceIds.forEach((id) => used.add(id));
    const { warnings } = summarizeDocument(doc.blocks, input.audiences, now);
    for (const warning of warnings)
      if (warning.kind === "no-audience")
        alerts.push({
          kind: "block-no-audience",
          documentId: doc.id,
          path: warning.path,
        });
      else
        alerts.push({
          kind:
            warning.kind === "unknown-audience"
              ? "block-unknown-audience"
              : "block-archived-audience",
          documentId: doc.id,
          path: warning.path,
          audienceId: warning.audienceId!,
        });
  }
  for (const audience of input.audiences)
    if (
      (audience.state ?? "active") === "active" &&
      !used.has(String(audience.id))
    )
      alerts.push({ kind: "audience-unused", audienceId: String(audience.id) });
  for (const link of input.links) {
    const [audienceId] = audienceRefIds([link.audience]);
    if (!audienceId) continue;
    const target = input.manifest.audiences.find(
      (a) => String(a.id) === audienceId && isAudienceLive(a, now),
    );
    if (!target) {
      alerts.push({
        kind: "link-inactive-audience",
        linkId: link.id,
        audienceId,
      });
      continue;
    }
    let resolved: ActiveAudience | null = null;
    try {
      resolved = link.generatedUrl
        ? resolveAudience(
            new URL(link.generatedUrl).searchParams,
            input.manifest,
            now,
          )
        : null;
    } catch {
      resolved = null;
    }
    if (resolved?.key !== target.key)
      alerts.push({
        kind: "link-mismatch",
        linkId: link.id,
        audienceId,
        resolvedKey: resolved?.key ?? null,
      });
  }
  return alerts;
}
