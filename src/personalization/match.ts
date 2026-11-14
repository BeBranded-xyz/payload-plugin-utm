/**
 * Edge-safe personalization core: no Payload, React or Next.js imports.
 */
import { normalizeUtmValue, utmParameters } from "../utilities.js";

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
  /**
   * Public paths with content for this audience (static mode). Undefined means
   * unknown: every path is rewritten.
   */
  paths?: string[];
};
/** Where a visit comes from: campaign parameters and/or the referring site. */
export type CampaignTouch = {
  params?: URLSearchParams | Record<string, string>;
  /** Referring hostname or URL, e.g. `coudac.com`. */
  referrer?: string | null;
};
export type TouchInput = URLSearchParams | CampaignTouch;
/** Condition parameter that targets the referring site instead of a query parameter. */
export const REFERRER_PARAMETER = "$referrer";
export type AudienceManifest = { version: 1; audiences: AudienceRule[] };
export type ActiveAudience = { key: string; id?: string | number };
export type PersonalizationValue = {
  mode?: "all" | "only" | "except" | null;
  audiences?: unknown[] | null;
} | null;

export const AUDIENCE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const RESERVED_AUDIENCE_KEYS = ["default", "auto"] as const;
export const AUDIENCE_HEADER = "x-utm-audience";
export const AUDIENCE_ID_HEADER = "x-utm-audience-id";
/** Cookie holding the visitor's source memory (see `SourceMemory`). */
export const AUDIENCE_COOKIE = "utm_memory";
/** Request header carrying the serialized source memory to Server Components. */
export const SOURCE_MEMORY_HEADER = "x-utm-source-memory";
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

const asParams = (params: CampaignTouch["params"]): URLSearchParams =>
  params instanceof URLSearchParams
    ? params
    : new URLSearchParams(params ?? {});
const asTouch = (input: TouchInput): CampaignTouch =>
  input instanceof URLSearchParams ? { params: input } : input;

/** Lowercase hostname without `www.`; accepts a bare domain or a URL. */
export function normalizeHost(value: unknown): string {
  if (typeof value !== "string") return "";
  let host = value.trim().toLowerCase();
  if (!host) return "";
  if (host.includes("://"))
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  host = host.split(/[/?#]/)[0]!.replace(/:\d+$/, "").replace(/\.$/, "");
  return host.replace(/^www\./, "");
}
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Same domain or a subdomain of it. `name.*` matches the name on any extension
 * (`coudac.*`: coudac.com, coudac.fr, shop.coudac.co.uk).
 */
export function domainMatches(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  if (expected.endsWith(".*")) {
    const base = expected.slice(0, -2);
    return (
      base !== "" &&
      new RegExp(
        `(^|\\.)${escapeRegExp(base)}(\\.(co|com|org|net|ac|gov|edu))?\\.[a-z]{2,}$`,
      ).test(actual)
    );
  }
  return actual === expected || actual.endsWith("." + expected);
}
const sameOrSubdomain = domainMatches;

/** Case-insensitive parameter lookup; the first non-empty value wins. */
function readParameter(params: URLSearchParams, name: string): string {
  const wanted = name.trim().toLowerCase();
  for (const [key, value] of params)
    if (key.toLowerCase() === wanted && value.trim()) return clean(value);
  return "";
}

function referrerMatches(
  referrer: unknown,
  condition: AudienceCondition,
): boolean {
  const actual = normalizeHost(referrer);
  const expected = normalizeHost(condition.value);
  switch (condition.operator) {
    case "exists":
      return actual !== "";
    case "equals":
      return actual !== "" && sameOrSubdomain(actual, expected);
    case "notEquals":
      return !sameOrSubdomain(actual, expected);
    case "in":
      return (
        actual !== "" &&
        String(condition.value ?? "")
          .split(",")
          .map(normalizeHost)
          .some((domain) => sameOrSubdomain(actual, domain))
      );
    case "contains":
      return actual !== "" && expected !== "" && actual.includes(expected);
    case "startsWith":
      return actual !== "" && expected !== "" && actual.startsWith(expected);
    default:
      return false;
  }
}

export function conditionMatches(
  input: TouchInput,
  condition: AudienceCondition,
): boolean {
  const touch = asTouch(input);
  if (condition.parameter === REFERRER_PARAMETER)
    return referrerMatches(touch.referrer, condition);
  const actual = readParameter(asParams(touch.params), condition.parameter);
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
  input: TouchInput,
  audience: AudienceRule,
): boolean {
  if (!audience.conditions.length) return false;
  const touch = asTouch(input);
  const results = audience.conditions.map((condition) =>
    conditionMatches(touch, condition),
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
  input: TouchInput,
  manifest: AudienceManifest,
  now: Date = new Date(),
): ActiveAudience | null {
  const touch = asTouch(input);
  const ordered = manifest.audiences
    .filter((audience) => isAudienceLive(audience, now))
    .map((audience, index) => ({ audience, index }))
    .sort(
      (a, b) =>
        (a.audience.priority ?? 0) - (b.audience.priority ?? 0) ||
        a.index - b.index,
    );
  for (const { audience } of ordered)
    if (audienceMatches(touch, audience))
      return { key: audience.key, id: audience.id };
  return null;
}

/** Query parameters worth remembering: UTM plus custom parameters used by rules. */
export function trackedParameterNames(manifest: AudienceManifest): Set<string> {
  const names = new Set(utmQueryParameters as string[]);
  for (const audience of manifest.audiences)
    for (const condition of audience.conditions)
      if (condition.parameter !== REFERRER_PARAMETER)
        names.add(condition.parameter.toLowerCase());
  return names;
}

/** True when the URL carries a UTM parameter or a custom parameter used by a rule. */
export function hasCampaignParameters(
  params: URLSearchParams,
  manifest: AudienceManifest,
): boolean {
  const names = trackedParameterNames(manifest);
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
    paths: doc.paths,
    conditions: Array.isArray(doc.conditions)
      ? doc.conditions.map((c: Record<string, unknown>) => ({
          parameter:
            c?.parameter === "custom"
              ? c.customParameter
              : c?.parameter === "referrer"
                ? REFERRER_PARAMETER
                : c?.parameter,
          operator: c?.operator,
          value: c?.value,
        }))
      : [],
  };
}

/** `/menu/` → `/menu`; query and hash removed; root stays `/`. */
export function normalizePath(path: string): string {
  // Linear scan (runs on every request URL): collapse repeated slashes, drop one trailing slash.
  const raw = path.split(/[?#]/)[0]!;
  let clean = "";
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (char === "/" && clean.endsWith("/")) continue;
    clean += char;
  }
  if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
  return clean.length > 1 ? clean : "/";
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
      ...(Array.isArray(entry.paths)
        ? {
            paths: [
              ...new Set(
                entry.paths
                  .filter(
                    (path): path is string =>
                      typeof path === "string" &&
                      path.startsWith("/") &&
                      path.length <= 2048,
                  )
                  .map(normalizePath),
              ),
            ].slice(0, 1000),
          }
        : {}),
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
  referrer?: string | null,
): SimulationResult {
  let params: URLSearchParams;
  try {
    params = new URL(url.trim(), "https://example.invalid").searchParams;
  } catch {
    return { ok: false };
  }
  const audience = resolveAudience({ params, referrer }, manifest, now);
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

/* ------------------------------------------------------------------ */
/* Source memory: where the visitor came from, kept in one cookie.     */
/* ------------------------------------------------------------------ */

/** One arrival: tracked parameters, referring host, epoch seconds. */
export type SourceTouch = { p?: Record<string, string>; r?: string; t: number };
/**
 * `f` first and `l` latest arrival from a campaign or another site (attribution);
 * `s` the arrival that selected the current audience (personalization).
 */
export type SourceMemory = {
  v: 1;
  f?: SourceTouch;
  l?: SourceTouch;
  s?: SourceTouch;
};

const MAX_VALUE = 200;
const MAX_PARAMS = 12;

function sanitizeTouch(value: unknown): SourceTouch | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.t !== "number" || !Number.isFinite(raw.t)) return undefined;
  const touch: SourceTouch = { t: Math.floor(raw.t) };
  if (raw.p && typeof raw.p === "object") {
    const p: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw.p).slice(0, MAX_PARAMS))
      if (/^[A-Za-z0-9_.-]{1,64}$/.test(key) && typeof val === "string")
        p[key] = val.slice(0, MAX_VALUE);
    if (Object.keys(p).length) touch.p = p;
  }
  const host = normalizeHost(raw.r);
  if (host && /^[a-z0-9.-]{1,253}$/.test(host)) touch.r = host;
  return touch.p || touch.r ? touch : undefined;
}

export function parseSourceMemory(value: unknown): SourceMemory | null {
  if (typeof value !== "string" || !value || value.length > 4096) return null;
  try {
    // Raw JSON (cookie, decoded by the framework) or URI-encoded (header, legacy cookie).
    const text = value.trimStart().startsWith("{")
      ? value
      : decodeURIComponent(value);
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || raw.v !== 1) return null;
    const memory: SourceMemory = { v: 1 };
    for (const key of ["f", "l", "s"] as const) {
      const touch = sanitizeTouch(raw[key]);
      if (touch) memory[key] = touch;
    }
    return memory;
  } catch {
    return null;
  }
}

export function serializeSourceMemory(memory: SourceMemory): string {
  return encodeURIComponent(JSON.stringify(memory));
}

/**
 * The arrival described by this request, or null for internal navigation and
 * direct visits. Only tracked parameters are kept; same-site referrers are ignored.
 */
export function touchFromRequest(input: {
  params: URLSearchParams;
  referrer?: string | null;
  host?: string | null;
  manifest: AudienceManifest;
  now?: Date;
}): SourceTouch | null {
  const names = trackedParameterNames(input.manifest);
  const p: Record<string, string> = {};
  for (const [key, value] of input.params)
    if (
      names.has(key.toLowerCase()) &&
      value.trim() &&
      Object.keys(p).length < MAX_PARAMS
    )
      p[key.toLowerCase()] = value.trim().slice(0, MAX_VALUE);
  const referrer = normalizeHost(input.referrer);
  const self = normalizeHost(input.host);
  const external =
    referrer && referrer !== self && !referrer.endsWith("." + self)
      ? referrer
      : undefined;
  if (!Object.keys(p).length && !external) return null;
  return {
    ...(Object.keys(p).length ? { p } : {}),
    ...(external ? { r: external } : {}),
    t: Math.floor((input.now ?? new Date()).getTime() / 1000),
  };
}

export const touchToInput = (touch: SourceTouch): CampaignTouch => ({
  params: touch.p ?? {},
  referrer: touch.r ?? null,
});

/**
 * Sticky rule: a remembered audience stays until another audience replaces it
 * or it expires. Arrivals that match nothing are recorded for attribution only.
 */
export function updateSourceMemory(input: {
  memory: SourceMemory | null;
  touch: SourceTouch | null;
  manifest: AudienceManifest;
  maxAgeSeconds: number;
  now?: Date;
}): {
  audience: ActiveAudience | null;
  memory: SourceMemory | null;
  changed: boolean;
} {
  const now = input.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const fresh = (touch?: SourceTouch) =>
    touch && nowSeconds - touch.t < input.maxAgeSeconds ? touch : undefined;
  const previous = input.memory;
  const sticky = fresh(previous?.s);
  const remembered = sticky
    ? resolveAudience(touchToInput(sticky), input.manifest, now)
    : null;
  if (!input.touch)
    return { audience: remembered, memory: previous, changed: false };
  const candidate = resolveAudience(
    touchToInput(input.touch),
    input.manifest,
    now,
  );
  const memory: SourceMemory = {
    v: 1,
    f: fresh(previous?.f) ?? input.touch,
    l: input.touch,
    ...(candidate ? { s: input.touch } : sticky ? { s: sticky } : {}),
  };
  return { audience: candidate ?? remembered, memory, changed: true };
}

/* ------------------------------------------------------------------ */
/* Audience content tokens: {{audience.name|our clients}}              */
/* ------------------------------------------------------------------ */

// Fallbacks cannot contain braces: bounded, no backtracking across tokens.
const TOKEN =
  /\{\{\s{0,3}audience\.([A-Za-z0-9_]{1,64})\s{0,3}(?:\|([^{}]{0,500}))?\}\}/g;

/**
 * Replace `{{audience.<field>}}` / `{{audience.<field>|fallback}}` in every
 * string of `value` (block data, Lexical JSON…) with the active audience's
 * content fields. Values only ever come from the CMS, never from the URL.
 * Returns a copy; `content` null means default visitor (fallbacks are used).
 */
export function fillAudienceTokens<T>(
  value: T,
  content: Record<string, unknown> | null | undefined,
): T {
  const replace = (text: string) =>
    text.includes("{{")
      ? text.replace(TOKEN, (_, field: string, fallback?: string) => {
          const found = content?.[field];
          return typeof found === "string" && found.trim()
            ? found
            : typeof found === "number"
              ? String(found)
              : (fallback ?? "").trim();
        })
      : text;
  const walk = (input: unknown): unknown => {
    if (typeof input === "string") return replace(input);
    if (Array.isArray(input)) return input.map(walk);
    if (
      input &&
      typeof input === "object" &&
      Object.getPrototypeOf(input) === Object.prototype
    )
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, child]) => [
          key,
          walk(child),
        ]),
      );
    return input;
  };
  return walk(value) as T;
}

/**
 * Audience prefilled from a saved UTM link: matches its source and campaign
 * (and content when set), so the link triggers it.
 */
export function audienceDraftFromLink(link: {
  title?: string | null;
  source?: string | null;
  campaign?: string | null;
  content?: string | null;
}): {
  title: string;
  key: string;
  match: "all";
  conditions: { parameter: string; operator: "equals"; value: string }[];
} | null {
  const source = link.source?.trim();
  const campaign = link.campaign?.trim();
  if (!source || !campaign) return null;
  const conditions = [
    { parameter: "utm_source", operator: "equals" as const, value: source },
    { parameter: "utm_campaign", operator: "equals" as const, value: campaign },
    ...(link.content?.trim()
      ? [
          {
            parameter: "utm_content",
            operator: "equals" as const,
            value: link.content.trim(),
          },
        ]
      : []),
  ];
  let key = normalizeUtmValue(`${source}-${campaign}`, "slug")
    .slice(0, 60)
    .replace(/-+$/, "");
  if (!isValidAudienceKey(key))
    key = `audience-${key}`.slice(0, 60).replace(/-+$/, "");
  return {
    title: link.title?.trim() || `${source} · ${campaign}`,
    key,
    match: "all",
    conditions,
  };
}

/**
 * Flat fields for a lead form or CRM (hidden inputs, HubSpot properties…):
 * `first_utm_source`, `first_referrer`, `first_at`, `latest_…`, `audience_…`.
 * Values come from the visitor's URL, so treat them as untrusted text.
 */
export function sourceMemoryFields(
  memory: SourceMemory | null | undefined,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const slots = [
    ["first", memory?.f],
    ["latest", memory?.l],
    ["audience", memory?.s],
  ] as const;
  for (const [prefix, touch] of slots) {
    if (!touch) continue;
    for (const [name, value] of Object.entries(touch.p ?? {}))
      if (/^[A-Za-z0-9_.-]{1,64}$/.test(name))
        fields[`${prefix}_${name}`] = value;
    if (touch.r) fields[`${prefix}_referrer`] = touch.r;
    if (Number.isFinite(touch.t))
      fields[`${prefix}_at`] = new Date(touch.t * 1000).toISOString();
  }
  return fields;
}
