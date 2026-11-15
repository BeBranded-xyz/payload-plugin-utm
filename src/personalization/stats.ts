/**
 * Personalization statistics: anonymous page views per audience, recorded by
 * `<PersonalizationTracker stats />` and aggregated in the admin view.
 * No identifier, no IP, no user agent: one row per page view.
 * Pure functions, safe on the edge.
 */
import {
  domainMatches,
  isValidAudienceKey,
  normalizeHost,
  normalizePath,
} from "./match.js";

export const DEFAULT_AUDIENCE = "default";
/** Sent by pages that do not know the audience; the server resolves it from the source-memory cookie. */
export const AUTO_AUDIENCE = "auto";

/** What the tracker sends. */
export type ViewEvent = {
  /** Audience key, or `default`. */
  audience: string;
  /** Public path, without query or hash. */
  path: string;
  /** The page showed content specific to the audience. */
  variant: boolean;
  /** First page of a visit (no same-site referrer). */
  entry: boolean;
  /** Entry only: utm_source, else referring domain, else `(direct)`. */
  source?: string;
  /** Entry only: utm_medium. */
  medium?: string;
  /** Entry only: utm_campaign. */
  campaign?: string;
  /** Entry only: `source` comes from utm_source (not a referring domain). */
  utm?: boolean;
};

/** Stored row. */
export type ViewRecord = ViewEvent & { day: string };

const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._()/-]{0,99}$/u;
const cleanLabel = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase().slice(0, 100);
  return text && LABEL.test(text) ? text : undefined;
};

/**
 * Validates an untrusted beacon body. `knownKeys` are the active audience keys:
 * anything else is rejected so the table cannot be filled with arbitrary labels.
 */
export function parseViewEvent(
  body: unknown,
  knownKeys: ReadonlySet<string>,
): ViewEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const audience =
    raw.audience === DEFAULT_AUDIENCE || raw.audience == null
      ? DEFAULT_AUDIENCE
      : raw.audience === AUTO_AUDIENCE
        ? AUTO_AUDIENCE
        : isValidAudienceKey(raw.audience) && knownKeys.has(raw.audience)
          ? raw.audience
          : null;
  if (!audience) return null;
  if (typeof raw.path !== "string" || !raw.path.startsWith("/")) return null;
  const path = normalizePath(raw.path.split(/[?#]/)[0]!);
  if (path.length > 300 || path.startsWith("//") || /[\s<>"]/.test(path))
    return null;
  const entry = raw.entry === true;
  const event: ViewEvent = {
    audience,
    path,
    variant:
      audience !== DEFAULT_AUDIENCE &&
      audience !== AUTO_AUDIENCE &&
      raw.variant === true,
    entry,
  };
  if (entry) {
    event.source = cleanLabel(raw.source) ?? "(direct)";
    const medium = cleanLabel(raw.medium);
    if (medium) event.medium = medium;
    const campaign = cleanLabel(raw.campaign);
    if (campaign) event.campaign = campaign;
    if (raw.utm === true && event.source !== "(direct)") event.utm = true;
  }
  return event;
}

/** Entry source as the tracker computes it: utm_source, else referring domain. */
export function entrySource(
  search: string,
  referrer: string,
  host: string,
): {
  entry: boolean;
  source?: string;
  medium?: string;
  campaign?: string;
  utm?: boolean;
} {
  const params = new URLSearchParams(search);
  let referrerHost = "";
  try {
    referrerHost = referrer ? normalizeHost(new URL(referrer).host) : "";
  } catch {
    referrerHost = "";
  }
  const sameSite = referrerHost && referrerHost === normalizeHost(host);
  if (sameSite) return { entry: false };
  const utmSource = params.get("utm_source") || "";
  const source = utmSource || referrerHost || "(direct)";
  const medium = params.get("utm_medium") || undefined;
  const campaign = params.get("utm_campaign") || undefined;
  return {
    entry: true,
    source,
    ...(medium ? { medium } : {}),
    ...(campaign ? { campaign } : {}),
    ...(utmSource ? { utm: true } : {}),
  };
}

export const dayOf = (date: Date) => date.toISOString().slice(0, 10);

export type AudienceStats = {
  audience: string;
  entries: number;
  views: number;
  variantViews: number;
};
export type PageStats = {
  path: string;
  audience: string;
  views: number;
  variantViews: number;
};
export type SourceStats = {
  source: string;
  campaign: string | null;
  audience: string;
  entries: number;
};
export type StatsSummary = {
  total: { views: number; entries: number; variantViews: number };
  audiences: AudienceStats[];
  pages: PageStats[];
  sources: SourceStats[];
  days: { day: string; views: number; variantViews: number }[];
};

const bump = <T>(map: Map<string, T>, key: string, init: () => T) => {
  let value = map.get(key);
  if (!value) map.set(key, (value = init()));
  return value;
};

/** Aggregates stored rows for the admin view. */
export function summarizeViews(
  rows: readonly Partial<ViewRecord>[],
  options: { pageLimit?: number; sourceLimit?: number } = {},
): StatsSummary {
  const total = { views: 0, entries: 0, variantViews: 0 };
  const audiences = new Map<string, AudienceStats>();
  const pages = new Map<string, PageStats>();
  const sources = new Map<string, SourceStats>();
  const days = new Map<string, StatsSummary["days"][number]>();
  for (const row of rows) {
    const audience = row.audience || DEFAULT_AUDIENCE;
    const path = row.path || "/";
    const variant = row.variant === true;
    total.views++;
    if (variant) total.variantViews++;
    const a = bump(audiences, audience, () => ({
      audience,
      entries: 0,
      views: 0,
      variantViews: 0,
    }));
    a.views++;
    if (variant) a.variantViews++;
    const p = bump(pages, `${path}\u0000${audience}`, () => ({
      path,
      audience,
      views: 0,
      variantViews: 0,
    }));
    p.views++;
    if (variant) p.variantViews++;
    if (row.day) {
      const d = bump(days, row.day, () => ({
        day: row.day!,
        views: 0,
        variantViews: 0,
      }));
      d.views++;
      if (variant) d.variantViews++;
    }
    if (row.entry) {
      total.entries++;
      a.entries++;
      const source = row.source || "(direct)";
      const campaign = row.campaign || null;
      bump(
        sources,
        `${source}\u0000${campaign ?? ""}\u0000${audience}`,
        () => ({ source, campaign, audience, entries: 0 }),
      ).entries++;
    }
  }
  const byViews = (a: { views: number }, b: { views: number }) =>
    b.views - a.views;
  return {
    total,
    audiences: [...audiences.values()].sort(
      (a, b) =>
        Number(a.audience === DEFAULT_AUDIENCE) -
          Number(b.audience === DEFAULT_AUDIENCE) || b.views - a.views,
    ),
    pages: [...pages.values()].sort(byViews).slice(0, options.pageLimit ?? 50),
    sources: [...sources.values()]
      .sort((a, b) => b.entries - a.entries)
      .slice(0, options.sourceLimit ?? 50),
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export type UnregisteredCampaign = {
  source: string;
  medium: string | null;
  campaign: string | null;
  entries: number;
  firstDay: string | null;
  lastDay: string | null;
};

const norm = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * UTM combinations seen on entries that match no UTM link saved in Payload
 * (source, medium and campaign compared case-insensitively; missing values
 * in traffic match any). Typical causes: links built by hand, by an ad
 * platform or by a partner.
 */
export function unregisteredCampaigns(
  rows: readonly Partial<ViewRecord>[],
  links: readonly { source?: unknown; medium?: unknown; campaign?: unknown }[],
  limit = 100,
): UnregisteredCampaign[] {
  const known = links.map((link) => ({
    source: norm(link.source),
    medium: norm(link.medium),
    campaign: norm(link.campaign),
  }));
  const registered = (row: Partial<ViewRecord>) =>
    known.some(
      (link) =>
        link.source === norm(row.source) &&
        // A campaign without medium or campaign covers every value of it.
        (!link.medium || !row.medium || link.medium === norm(row.medium)) &&
        (!link.campaign ||
          !row.campaign ||
          link.campaign === norm(row.campaign)),
    );
  const found = new Map<string, UnregisteredCampaign>();
  for (const row of rows) {
    if (!row.entry || !row.utm || !row.source || registered(row)) continue;
    const item = bump(
      found,
      `${norm(row.source)}\u0000${norm(row.medium)}\u0000${norm(row.campaign)}`,
      () => ({
        source: row.source!,
        medium: row.medium || null,
        campaign: row.campaign || null,
        entries: 0,
        firstDay: null as string | null,
        lastDay: null as string | null,
      }),
    );
    item.entries++;
    if (row.day) {
      if (!item.firstDay || row.day < item.firstDay) item.firstDay = row.day;
      if (!item.lastDay || row.day > item.lastDay) item.lastDay = row.day;
    }
  }
  return [...found.values()]
    .sort((a, b) => b.entries - a.entries)
    .slice(0, limit);
}

export type UnregisteredReferrer = {
  domain: string;
  entries: number;
  firstDay: string | null;
  lastDay: string | null;
};

/** Search engines: their visitors are organic traffic, not a partner to recognize. */
const SEARCH_ENGINES =
  /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|qwant|baidu|yandex|brave|startpage)\.[a-z.]+$/;

/**
 * Sites that send visitors without UTM and that no campaign recognizes yet
 * (`referrerDomains`, `name.*` included). Search engines are left out.
 */
export function unregisteredReferrers(
  rows: readonly Partial<ViewRecord>[],
  links: readonly { referrerDomains?: unknown }[],
  limit = 100,
): UnregisteredReferrer[] {
  const known = links.flatMap((link) =>
    Array.isArray(link.referrerDomains)
      ? link.referrerDomains
          .filter((d): d is string => typeof d === "string")
          .map(normalizeHost)
      : [],
  );
  const found = new Map<string, UnregisteredReferrer>();
  for (const row of rows) {
    if (!row.entry || row.utm) continue;
    const domain = normalizeHost(row.source);
    if (!domain || domain === "(direct)" || !domain.includes(".")) continue;
    if (SEARCH_ENGINES.test(domain)) continue;
    if (known.some((expected) => domainMatches(domain, expected))) continue;
    const item = bump(found, domain, () => ({
      domain,
      entries: 0,
      firstDay: null as string | null,
      lastDay: null as string | null,
    }));
    item.entries++;
    if (row.day) {
      if (!item.firstDay || row.day < item.firstDay) item.firstDay = row.day;
      if (!item.lastDay || row.day > item.lastDay) item.lastDay = row.day;
    }
  }
  return [...found.values()]
    .sort((a, b) => b.entries - a.entries)
    .slice(0, limit);
}
