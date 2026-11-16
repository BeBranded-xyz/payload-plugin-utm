/**
 * Server components for the Payload admin (import map: `payload-plugin-utm/rsc`).
 */
import { Gutter, SetStepNav } from "@payloadcms/ui";
import type {
  AdminViewServerProps,
  CollectionSlug,
  GlobalSlug,
  Payload,
  PayloadRequest,
} from "payload";
import type { ComponentType, ReactNode } from "react";
import {
  CreateDetectedCampaign,
  PersonalizationSimulator,
} from "./client/index.js";
import type { PersonalizationTarget } from "./personalization/collection.js";
import {
  audienceDocToRule,
  audienceRefIds,
  collectPersonalizedBlocks,
  consistencyAlerts,
  isAudienceLive,
  parseAudienceManifest,
  type AudienceSummary,
  type ConsistencyAlert,
  type PersonalizedBlock,
  type SimulatedDocument,
} from "./personalization/match.js";
import {
  DEFAULT_AUDIENCE,
  dayOf,
  summarizeViews,
  buildDashboard,
  installChecks,
  unregisteredCampaigns,
  unregisteredReferrers,
  type Dashboard,
  type InstallCheck,
  type StatsSummary,
  type UnregisteredCampaign,
  type ViewRecord,
} from "./personalization/stats.js";

type PluginViewOptions = {
  locale: "en" | "fr";
  previewParam: string | null;
  siteUrl?: string;
  draftRoute?: string;
  audiencesSlug: string;
  linksSlug: string;
  statsSlug?: string | null;
  statsLimit?: number | null;
  targets: PersonalizationTarget[];
  blockLabels: Record<string, unknown>;
  /** Import map key of DefaultTemplate (its module differs in Payload 3 and 4). */
  templatePath?: string;
};

const t = {
  en: {
    title: "Personalization",
    intro:
      "Campaign audiences, the pages they change and the UTM links that trigger them, filtered by your permissions.",
    audiences: "Personalized campaigns",
    audience: "Campaign",
    status: "Status",
    documents: "Personalized content",
    links: "UTM links",
    priority: "Priority",
    none: "No campaign personalizes the site yet.",
    create: "Create a campaign",
    active: "Active",
    archived: "Archived",
    scheduled: "Scheduled",
    ended: "Ended",
    blocks: (n: number) => `${n} block${n > 1 ? "s" : ""}`,
    alerts: "Consistency checks",
    allGood: "No inconsistency found.",
    truncated: (slug: string, n: number) =>
      `Only the first ${n} documents of “${slug}” were analysed.`,
    unreadable: (slug: string) =>
      `“${slug}” could not be read with your permissions.`,
    alert: {
      "audience-unused": (a: string) => `“${a}” is not used by any block.`,
      "block-archived-audience": (a: string, d: string) =>
        `A block in ${d} targets “${a}”, which is archived or ended.`,
      "block-unknown-audience": (a: string, d: string) =>
        `A block in ${d} targets a deleted audience (${a}).`,
      "block-no-audience": (d: string) =>
        `A block in ${d} is restricted to audiences but none is selected.`,
      "link-mismatch": (l: string, a: string, r: string | null) =>
        `The UTM link ${l} is meant for “${a}” but triggers ${r ? `“${r}”` : "no audience"}.`,
      "link-inactive-audience": (l: string, a: string) =>
        `The UTM link ${l} targets “${a}”, which is archived, ended or has no valid rule.`,
    },
  },
  fr: {
    title: "Personnalisation",
    intro:
      "Les audiences de campagne, les contenus qu’elles modifient et les liens UTM qui les déclenchent, selon vos droits.",
    audiences: "Campagnes personnalisées",
    audience: "Campagne",
    status: "Statut",
    documents: "Contenus personnalisés",
    links: "Liens UTM",
    priority: "Priorité",
    none: "Aucune campagne ne personnalise encore le site.",
    create: "Créer une campagne",
    active: "Active",
    archived: "Archivée",
    scheduled: "Programmée",
    ended: "Terminée",
    blocks: (n: number) => `${n} bloc${n > 1 ? "s" : ""}`,
    alerts: "Contrôles de cohérence",
    allGood: "Aucune incohérence détectée.",
    truncated: (slug: string, n: number) =>
      `Seuls les ${n} premiers documents de « ${slug} » ont été analysés.`,
    unreadable: (slug: string) =>
      `« ${slug} » n’a pas pu être lu avec vos droits.`,
    alert: {
      "audience-unused": (a: string) =>
        `« ${a} » n’est utilisée par aucun bloc.`,
      "block-archived-audience": (a: string, d: string) =>
        `Un bloc de ${d} cible « ${a} », archivée ou terminée.`,
      "block-unknown-audience": (a: string, d: string) =>
        `Un bloc de ${d} cible une audience supprimée (${a}).`,
      "block-no-audience": (d: string) =>
        `Un bloc de ${d} est réservé à des audiences mais aucune n’est choisie.`,
      "link-mismatch": (l: string, a: string, r: string | null) =>
        `Le lien UTM ${l} vise « ${a} » mais déclenche ${r ? `« ${r} »` : "aucune audience"}.`,
      "link-inactive-audience": (l: string, a: string) =>
        `Le lien UTM ${l} vise « ${a} », archivée, terminée ou sans règle valide.`,
    },
  },
};

const DOC_LIMIT = 200;

const statsText = {
  en: {
    title: "Statistics",
    period: (d: number) => `Last ${d} days`,
    off: "Statistics are off. Enable personalization.stats and add <PersonalizationTracker stats /> to your pages.",
    empty: "No view recorded in this period.",
    views: "Page views",
    entries: "Entries",
    variantViews: "Personalized views",
    audience: "Audience",
    page: "Page",
    shown: "Version shown",
    personalized: "personalized",
    default: "default",
    everyone: "No audience",
    sources: "Where entries come from",
    source: "Source (utm_source or site)",
    medium: "Medium",
    campaign: "Campaign",
    capped: (n: number) =>
      `Only the latest ${n} views were aggregated; narrow the period.`,
    unregistered: "UTM used but not created in Payload",
    unregisteredHint:
      "Campaign parameters seen on visits that match no UTM link saved here (built by hand, by an ad platform or a partner). Create them as UTM links to keep campaigns consistent.",
    noneUnregistered: "Every UTM seen in this period matches a saved link.",
    seen: "Seen",
    createLink: "Create a UTM link",
    days: "Per day",
    detectedLink:
      "Detected campaigns, not created yet → in the UTM campaigns list",
  },
  fr: {
    title: "Statistiques",
    period: (d: number) => `${d} derniers jours`,
    off: "Les statistiques sont désactivées. Activez personalization.stats et ajoutez <PersonalizationTracker stats /> à vos pages.",
    empty: "Aucune vue enregistrée sur cette période.",
    views: "Pages vues",
    entries: "Arrivées",
    variantViews: "Vues personnalisées",
    audience: "Audience",
    page: "Page",
    shown: "Version vue",
    personalized: "personnalisée",
    default: "par défaut",
    everyone: "Sans audience",
    sources: "D’où viennent les arrivées",
    source: "Source (utm_source ou site)",
    medium: "Support",
    campaign: "Campagne",
    capped: (n: number) =>
      `Seules les ${n} dernières vues ont été agrégées ; réduisez la période.`,
    unregistered: "UTM utilisés mais non créés dans Payload",
    unregisteredHint:
      "Paramètres de campagne vus sur des visites et qui ne correspondent à aucun lien UTM enregistré ici (créés à la main, par une régie publicitaire ou un partenaire). Créez-les en liens UTM pour garder des campagnes cohérentes.",
    noneUnregistered:
      "Tous les UTM vus sur cette période correspondent à un lien enregistré.",
    seen: "Vu",
    createLink: "Créer un lien UTM",
    days: "Par jour",
    detectedLink:
      "Campagnes détectées, pas encore créées → dans la liste des campagnes UTM",
  },
};
const PERIODS = [7, 30, 90] as const;

type DocRow = {
  id: string;
  title: string;
  href: string;
  blocks: PersonalizedBlock[];
};

function translate(label: unknown, lang: string): string {
  if (typeof label === "string") return label;
  if (label && typeof label === "object") {
    const record = label as Record<string, unknown>;
    const value = record[lang] ?? record.en ?? Object.values(record)[0];
    if (typeof value === "string") return value;
  }
  return "";
}

const getIn = (data: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      data,
    );

export async function PersonalizationView(
  props: AdminViewServerProps & { pluginOptions: PluginViewOptions },
) {
  const {
    importMap,
    initPageResult,
    params,
    searchParams,
    pluginOptions: options,
  } = props;
  const DefaultTemplate = (importMap[
    options.templatePath ?? "@payloadcms/next/templates#DefaultTemplate"
  ] ?? (({ children }: { children?: ReactNode }) => children)) as ComponentType<
    Record<string, unknown> & { children?: ReactNode }
  >;
  const { req, permissions, visibleEntities, locale } = initPageResult;
  const { payload } = req;
  const text = t[options.locale];
  const lang = req.i18n?.language ?? options.locale;
  const admin = payload.config.routes.admin;
  const notes: string[] = [];

  const audienceResult = req.user
    ? await payload.find({
        collection: options.audiencesSlug as CollectionSlug,
        req,
        overrideAccess: false,
        depth: 0,
        limit: 1000,
        pagination: false,
        sort: "priority",
        where: { personalize: { equals: true } },
      })
    : { docs: [] };
  const audienceDocs = audienceResult.docs as Record<string, unknown>[];
  const audiences: AudienceSummary[] = audienceDocs.map((doc) => ({
    id: doc.id as string | number,
    key: String(doc.key ?? ""),
    title: typeof doc.title === "string" ? doc.title : String(doc.key ?? ""),
    state: typeof doc.state === "string" ? doc.state : "active",
    startsAt: (doc.startsAt as string | null) ?? null,
    endsAt: (doc.endsAt as string | null) ?? null,
  }));
  const manifest = parseAudienceManifest({
    audiences: audienceDocs
      .filter((doc) => doc.state === "active")
      .map(audienceDocToRule),
  });

  // A campaign is its own UTM link: no separate link inventory to cross-check.
  const links: {
    id: string;
    title: string;
    generatedUrl?: string;
    audience?: unknown;
  }[] = [];

  const documents: DocRow[] = [];
  for (const target of options.targets) {
    try {
      if (target.kind === "collection") {
        const config =
          payload.collections[target.slug as CollectionSlug]?.config;
        const titleField = config?.admin?.useAsTitle ?? "id";
        const result = await payload.find({
          collection: target.slug as CollectionSlug,
          req,
          overrideAccess: false,
          depth: 0,
          limit: DOC_LIMIT,
          select: Object.fromEntries(
            [titleField, ...target.fields].map((name) => [name, true]),
          ),
        });
        if (result.hasNextPage)
          notes.push(text.truncated(target.slug, DOC_LIMIT));
        for (const doc of result.docs as Record<string, unknown>[]) {
          const blocks = collectPersonalizedBlocks(doc);
          if (!blocks.length) continue;
          const label =
            translate(config?.labels?.singular, lang) || target.slug;
          documents.push({
            id: `${target.slug}:${doc.id}`,
            title: `${label} · ${String(getIn(doc, titleField) ?? doc.id)}`,
            href: `${admin}/collections/${target.slug}/${doc.id}`,
            blocks,
          });
        }
      } else {
        const doc = (await payload.findGlobal({
          slug: target.slug as GlobalSlug,
          req,
          overrideAccess: false,
          depth: 0,
        })) as Record<string, unknown>;
        const blocks = collectPersonalizedBlocks(doc);
        if (!blocks.length) continue;
        const config = payload.config.globals.find(
          (g) => g.slug === target.slug,
        );
        documents.push({
          id: `global:${target.slug}`,
          title: translate(config?.label, lang) || target.slug,
          href: `${admin}/globals/${target.slug}`,
          blocks,
        });
      }
    } catch {
      notes.push(text.unreadable(target.slug));
    }
  }

  const now = new Date();
  const alerts = consistencyAlerts({
    audiences,
    manifest,
    documents,
    links,
    now,
  });
  const nameOf = (id: string) =>
    audiences.find((a) => String(a.id) === id)?.title ?? id;
  const docTitle = (id: string) =>
    documents.find((d) => d.id === id)?.title ?? id;
  const linkTitle = (id: string) => links.find((l) => l.id === id)?.title ?? id;
  const keyTitle = (key: string | null) =>
    key ? (audiences.find((a) => a.key === key)?.title ?? key) : null;
  const describe = (alert: ConsistencyAlert): string => {
    switch (alert.kind) {
      case "audience-unused":
        return text.alert[alert.kind](nameOf(alert.audienceId));
      case "block-archived-audience":
      case "block-unknown-audience":
        return text.alert[alert.kind](
          nameOf(alert.audienceId),
          docTitle(alert.documentId),
        );
      case "block-no-audience":
        return text.alert[alert.kind](docTitle(alert.documentId));
      case "link-mismatch":
        return text.alert[alert.kind](
          linkTitle(alert.linkId),
          nameOf(alert.audienceId),
          keyTitle(alert.resolvedKey),
        );
      case "link-inactive-audience":
        return text.alert[alert.kind](
          linkTitle(alert.linkId),
          nameOf(alert.audienceId),
        );
    }
  };
  const statusOf = (audience: AudienceSummary) => {
    if (audience.state !== "active") return text.archived;
    if (
      audience.startsAt &&
      !isAudienceLive({ startsAt: audience.startsAt }, now)
    )
      return text.scheduled;
    if (!isAudienceLive({ endsAt: audience.endsAt }, now)) return text.ended;
    return text.active;
  };
  const blockLabel = (block: PersonalizedBlock) =>
    block.blockName ||
    translate(options.blockLabels[block.blockType], lang) ||
    block.blockType;
  const simulated: (SimulatedDocument & { href: string })[] = documents.map(
    (doc) => ({
      id: doc.id,
      title: doc.title,
      href: doc.href,
      blocks: doc.blocks.map((block, index) => ({
        label: `${blockLabel(block)} (#${index + 1})`,
        personalization: { mode: block.mode, audiences: block.audienceIds },
      })),
    }),
  );

  // Statistics (opt-in): anonymous page views recorded by the tracker.
  const periodParam = Number(
    (searchParams as Record<string, unknown> | undefined)?.days,
  );
  const period = (PERIODS as readonly number[]).includes(periodParam)
    ? periodParam
    : 30;
  let stats: StatsSummary | null = null;
  let unregistered: UnregisteredCampaign[] = [];
  let statsCapped = false;
  let dashboard: Dashboard | null = null;
  let checks: InstallCheck[] = [];
  if (options.statsSlug && req.user) {
    try {
      const limit = options.statsLimit ?? 50_000;
      const today = dayOf(now);
      const since = dayOf(new Date(now.getTime() - (period - 1) * 86_400_000));
      // Current period and the previous one, for the comparison.
      const previousSince = dayOf(
        new Date(now.getTime() - (2 * period - 1) * 86_400_000),
      );
      const result = await payload.find({
        collection: options.statsSlug as CollectionSlug,
        req,
        overrideAccess: false,
        depth: 0,
        limit,
        sort: "-day",
        where: { day: { greater_than_equal: previousSince } },
        select: {
          day: true,
          audience: true,
          path: true,
          variant: true,
          entry: true,
          utm: true,
          source: true,
          medium: true,
          campaign: true,
          conversion: true,
        } as never,
      });
      statsCapped = result.hasNextPage;
      const all = result.docs as Partial<ViewRecord>[];
      const rows = all.filter((row) => (row.day ?? "") >= since);
      const previousRows = all.filter((row) => (row.day ?? "") < since);
      stats = summarizeViews(rows);
      dashboard = buildDashboard(rows, previousRows, {
        since,
        until: today,
        titles: Object.fromEntries(
          audiences.map((a) => [a.key, a.title ?? a.key]),
        ),
      });
      checks = installChecks({
        rows,
        today,
        manifest,
        personalized: audienceDocs.map((doc) => ({
          key: String(doc.key ?? ""),
          pages: doc.pages,
        })),
      });
      const allLinks = await payload.find({
        collection: options.linksSlug as CollectionSlug,
        req,
        overrideAccess: false,
        depth: 0,
        limit: 5000,
        pagination: false,
        select: { source: true, medium: true, campaign: true } as never,
      });
      unregistered = unregisteredCampaigns(
        rows,
        allLinks.docs as Record<string, unknown>[],
      );
    } catch {
      notes.push(text.unreadable(options.statsSlug));
    }
  }
  const st = statsText[options.locale];
  const audienceName = (key: string) =>
    key === DEFAULT_AUDIENCE
      ? st.everyone
      : (audiences.find((a) => a.key === key)?.title ?? key);

  const cell = {
    padding: "8px 12px",
    borderBottom: "1px solid var(--theme-elevation-100)",
    verticalAlign: "top" as const,
  };
  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user ?? undefined}
      visibleEntities={visibleEntities}
    >
      <SetStepNav nav={[{ label: text.title }]} />
      <Gutter>
        <h1 style={{ marginTop: 24 }}>{text.title}</h1>
        <p style={{ color: "var(--theme-elevation-600)" }}>{text.intro}</p>
        {options.statsSlug && (
          <InstallChecks checks={checks} locale={options.locale} />
        )}

        <h2 style={{ marginTop: 32 }}>{text.audiences}</h2>
        {audiences.length === 0 ? (
          <p>
            {text.none}{" "}
            <a href={`${admin}/collections/${options.audiencesSlug}/create`}>
              {text.create}
            </a>
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={cell}>{text.audience}</th>
                  <th style={cell}>{text.status}</th>
                  <th style={cell}>{text.documents}</th>
                  <th style={cell}>{text.priority}</th>
                </tr>
              </thead>
              <tbody>
                {audiences.map((audience) => {
                  const id = String(audience.id);
                  const usedBy = documents
                    .map((doc) => ({
                      doc,
                      count: doc.blocks.filter(
                        (b) => b.mode !== "all" && b.audienceIds.includes(id),
                      ).length,
                    }))
                    .filter((entry) => entry.count > 0);
                  return (
                    <tr key={id}>
                      <td style={cell}>
                        <a
                          href={`${admin}/collections/${options.audiencesSlug}/${id}`}
                        >
                          {audience.title}
                        </a>
                        <div
                          style={{
                            color: "var(--theme-elevation-500)",
                            fontSize: 12,
                          }}
                        >
                          {audience.key}
                        </div>
                      </td>
                      <td style={cell}>{statusOf(audience)}</td>
                      <td style={cell}>
                        {usedBy.length === 0
                          ? "—"
                          : usedBy.map(({ doc, count }) => (
                              <div key={doc.id}>
                                <a href={doc.href}>{doc.title}</a> ·{" "}
                                {text.blocks(count)}
                              </div>
                            ))}
                      </td>
                      <td style={cell}>
                        {String(
                          audienceDocs.find((d) => String(d.id) === id)
                            ?.priority ?? 0,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ marginTop: 32 }}>{st.title}</h2>
        {!options.statsSlug ? (
          <p style={{ color: "var(--theme-elevation-600)" }}>{st.off}</p>
        ) : (
          <>
            <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {PERIODS.map((d) =>
                d === period ? (
                  <strong key={d}>{st.period(d)}</strong>
                ) : (
                  <a key={d} href={`?days=${d}`}>
                    {st.period(d)}
                  </a>
                ),
              )}
            </p>
            {statsCapped && (
              <p style={{ color: "var(--theme-elevation-600)" }}>
                {st.capped(options.statsLimit ?? 50_000)}
              </p>
            )}
            {!stats || stats.total.views === 0 ? (
              <p>{st.empty}</p>
            ) : (
              <>
                {dashboard && (
                  <DashboardSection
                    dashboard={dashboard}
                    locale={options.locale}
                    cell={cell}
                  />
                )}
                <h3 style={{ marginTop: 24 }}>{st.audience}</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left" }}>
                        <th style={cell}>{st.audience}</th>
                        <th style={cell}>{st.entries}</th>
                        <th style={cell}>{st.views}</th>
                        <th style={cell}>{st.variantViews}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.audiences.map((row) => (
                        <tr key={row.audience}>
                          <td style={cell}>{audienceName(row.audience)}</td>
                          <td style={cell}>{row.entries}</td>
                          <td style={cell}>{row.views}</td>
                          <td style={cell}>
                            {row.audience === DEFAULT_AUDIENCE
                              ? "—"
                              : row.variantViews}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3 style={{ marginTop: 24 }}>{st.page}</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left" }}>
                        <th style={cell}>{st.page}</th>
                        <th style={cell}>{st.audience}</th>
                        <th style={cell}>{st.views}</th>
                        <th style={cell}>{st.shown}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.pages.map((row) => (
                        <tr key={`${row.path}|${row.audience}`}>
                          <td style={cell}>
                            <code>{row.path}</code>
                          </td>
                          <td style={cell}>{audienceName(row.audience)}</td>
                          <td style={cell}>{row.views}</td>
                          <td style={cell}>
                            {row.variantViews > 0
                              ? `${row.variantViews} ${st.personalized}`
                              : ""}
                            {row.variantViews > 0 &&
                            row.views > row.variantViews
                              ? " · "
                              : ""}
                            {row.views > row.variantViews
                              ? `${row.views - row.variantViews} ${st.default}`
                              : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3 style={{ marginTop: 24 }}>{st.sources}</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left" }}>
                        <th style={cell}>{st.source}</th>
                        <th style={cell}>{st.campaign}</th>
                        <th style={cell}>{st.audience}</th>
                        <th style={cell}>{st.entries}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.sources.map((row) => (
                        <tr
                          key={`${row.source}|${row.campaign}|${row.audience}`}
                        >
                          <td style={cell}>{row.source}</td>
                          <td style={cell}>{row.campaign ?? "—"}</td>
                          <td style={cell}>{audienceName(row.audience)}</td>
                          <td style={cell}>{row.entries}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <p style={{ marginTop: 24 }}>
              <a href={`${admin}/collections/${options.linksSlug}`}>
                {st.detectedLink}
              </a>
            </p>
          </>
        )}

        <h2 style={{ marginTop: 32 }}>{text.alerts}</h2>
        {alerts.length === 0 && notes.length === 0 ? (
          <p>✓ {text.allGood}</p>
        ) : (
          <ul>
            {alerts.map((alert, index) => (
              <li key={index}>⚠ {describe(alert)}</li>
            ))}
            {notes.map((note, index) => (
              <li
                key={`note-${index}`}
                style={{ color: "var(--theme-elevation-600)" }}
              >
                {note}
              </li>
            ))}
          </ul>
        )}

        <PersonalizationSimulator
          locale={options.locale}
          manifest={manifest}
          documents={simulated}
          previewParam={options.previewParam}
          siteUrl={options.siteUrl}
          draftRoute={options.draftRoute}
          titles={Object.fromEntries(
            audiences.map((a) => [a.key, a.title ?? a.key]),
          )}
        />
      </Gutter>
    </DefaultTemplate>
  );
}

const detectedText = {
  en: {
    title: "Detected campaigns, not created yet",
    intro: (days: number) =>
      `Last ${days} days: UTM values and referring sites that bring visitors but match no campaign here. Create one to name it, measure it and personalize the site for its visitors.`,
    utm: "UTM values",
    sites: "Referring sites without UTM",
    arrivals: "Arrivals",
    seen: "Seen",
    none: "Nothing new: every campaign and referring site seen is already here.",
    off: "Detection needs the personalization tracker on your pages (<PersonalizationTracker stats />).",
  },
  fr: {
    title: "Campagnes détectées, pas encore créées",
    intro: (days: number) =>
      `${days} derniers jours : des UTM et des sites qui vous envoient des visiteurs mais ne correspondent à aucune campagne ici. Créez-la pour la nommer, la mesurer et personnaliser le site pour ses visiteurs.`,
    utm: "UTM",
    sites: "Sites qui renvoient vers vous sans UTM",
    arrivals: "Arrivées",
    seen: "Vu",
    none: "Rien de nouveau : toutes les campagnes et tous les sites vus sont déjà là.",
    off: "La détection a besoin du traceur de personnalisation sur vos pages (<PersonalizationTracker stats />).",
  },
};

type DetectedOptions = {
  locale: "en" | "fr";
  linksSlug: string;
  statsSlug: string;
  statsLimit?: number;
};

/** Above the campaigns list: UTM values and referring sites seen but not created. */
export async function DetectedCampaigns(props: {
  payload: Payload;
  user?: NonNullable<PayloadRequest["user"]>;
  pluginOptions: DetectedOptions;
}) {
  const { payload, user, pluginOptions: options } = props;
  const text = detectedText[options.locale];
  if (!user) return null;
  const days = 30;
  let rows: Partial<ViewRecord>[] = [];
  let links: Record<string, unknown>[] = [];
  try {
    const since = dayOf(new Date(Date.now() - (days - 1) * 86_400_000));
    const views = await payload.find({
      collection: options.statsSlug as CollectionSlug,
      user,
      overrideAccess: false,
      depth: 0,
      limit: options.statsLimit ?? 50_000,
      sort: "-day",
      where: {
        and: [
          { day: { greater_than_equal: since } },
          { entry: { equals: true } },
        ],
      },
      select: {
        day: true,
        entry: true,
        utm: true,
        path: true,
        source: true,
        medium: true,
        campaign: true,
      } as never,
    });
    rows = views.docs as Partial<ViewRecord>[];
    const result = await payload.find({
      collection: options.linksSlug as CollectionSlug,
      user,
      overrideAccess: false,
      depth: 0,
      limit: 5000,
      pagination: false,
      select: {
        source: true,
        medium: true,
        campaign: true,
        referrerDomains: true,
      } as never,
    });
    links = result.docs as Record<string, unknown>[];
  } catch {
    return null;
  }
  const utm = unregisteredCampaigns(rows, links, 20);
  const sites = unregisteredReferrers(rows, links, 20);
  const cell = {
    padding: "6px 10px",
    borderBottom: "1px solid var(--theme-elevation-100)",
    textAlign: "left" as const,
  };
  const seen = (first: string | null, last: string | null) =>
    first === last ? (first ?? "") : `${first} → ${last}`;
  return (
    <Gutter>
      <details
        open={utm.length + sites.length > 0}
        style={{
          margin: "16px 0 24px",
          padding: "12px 16px",
          border: "1px solid var(--theme-elevation-150)",
          borderRadius: 4,
        }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          {text.title} ({utm.length + sites.length})
        </summary>
        <p style={{ color: "var(--theme-elevation-600)" }}>
          {text.intro(days)}
        </p>
        {rows.length === 0 ? (
          <p style={{ color: "var(--theme-elevation-600)" }}>{text.off}</p>
        ) : utm.length + sites.length === 0 ? (
          <p>✓ {text.none}</p>
        ) : (
          <>
            {utm.length > 0 && (
              <>
                <h4>{text.utm}</h4>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={cell}>utm_source</th>
                      <th style={cell}>utm_medium</th>
                      <th style={cell}>utm_campaign</th>
                      <th style={cell}>{text.arrivals}</th>
                      <th style={cell}>{text.seen}</th>
                      <th style={cell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {utm.map((row) => (
                      <tr key={`${row.source}|${row.medium}|${row.campaign}`}>
                        <td style={cell}>{row.source}</td>
                        <td style={cell}>{row.medium ?? "—"}</td>
                        <td style={cell}>{row.campaign ?? "—"}</td>
                        <td style={cell}>{row.entries}</td>
                        <td style={cell}>{seen(row.firstDay, row.lastDay)}</td>
                        <td style={cell}>
                          <CreateDetectedCampaign
                            locale={options.locale}
                            linksSlug={options.linksSlug}
                            source={row.source}
                            medium={row.medium}
                            campaign={row.campaign}
                            landingPath={row.landingPath}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {sites.length > 0 && (
              <>
                <h4 style={{ marginTop: 16 }}>{text.sites}</h4>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={cell}>Site</th>
                      <th style={cell}>{text.arrivals}</th>
                      <th style={cell}>{text.seen}</th>
                      <th style={cell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((row) => (
                      <tr key={row.domain}>
                        <td style={cell}>{row.domain}</td>
                        <td style={cell}>{row.entries}</td>
                        <td style={cell}>{seen(row.firstDay, row.lastDay)}</td>
                        <td style={cell}>
                          <CreateDetectedCampaign
                            locale={options.locale}
                            linksSlug={options.linksSlug}
                            source={row.domain}
                            referrer={row.domain}
                            landingPath={row.landingPath}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </details>
    </Gutter>
  );
}

const dashboardText = {
  en: {
    entries: "Arrivals",
    views: "Page views",
    variantViews: "Personalized views",
    conversions: "Conversions",
    rate: "Conversion rate",
    vsPrevious: "vs previous period",
    perDay: "Arrivals per day (bars) and conversions (dots)",
    campaigns: "Campaigns",
    campaign: "Campaign or source",
    landing: "Landing pages",
    page: "Page",
    byName: "Conversions by type",
    fresh: "new",
  },
  fr: {
    entries: "Arrivées",
    views: "Pages vues",
    variantViews: "Vues personnalisées",
    conversions: "Conversions",
    rate: "Taux de conversion",
    vsPrevious: "vs période précédente",
    perDay: "Arrivées par jour (barres) et conversions (points)",
    campaigns: "Campagnes",
    campaign: "Campagne ou source",
    landing: "Pages d’arrivée",
    page: "Page",
    byName: "Conversions par type",
    fresh: "nouveau",
  },
};

const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 1000) / 10} %`;

function Delta({
  now,
  before,
  fresh,
}: {
  now: number;
  before: number;
  fresh: string;
}) {
  if (!before && !now) return null;
  const change = before ? (now - before) / before : 1;
  const color =
    change > 0
      ? "var(--theme-success-500, #2e7d32)"
      : change < 0
        ? "var(--theme-error-500, #c62828)"
        : "var(--theme-elevation-500)";
  return (
    <span style={{ color, fontSize: 12, marginLeft: 6 }}>
      {change > 0 ? "▲" : change < 0 ? "▼" : "="}{" "}
      {before ? `${Math.round(Math.abs(change) * 100)} %` : fresh}
    </span>
  );
}

/** KPIs with their trend, a daily chart and the top campaigns and landing pages. */
function DashboardSection({
  dashboard,
  locale,
  cell,
}: {
  dashboard: Dashboard;
  locale: "en" | "fr";
  cell: Record<string, unknown>;
}) {
  const text = dashboardText[locale];
  const { totals, previous } = dashboard;
  const rate = totals.entries ? totals.conversions / totals.entries : null;
  const previousRate = previous.entries
    ? previous.conversions / previous.entries
    : null;
  const tiles: [string, string | number, number, number][] = [
    [text.entries, totals.entries, totals.entries, previous.entries],
    [text.views, totals.views, totals.views, previous.views],
    [
      text.variantViews,
      totals.variantViews,
      totals.variantViews,
      previous.variantViews,
    ],
    [
      text.conversions,
      totals.conversions,
      totals.conversions,
      previous.conversions,
    ],
    [text.rate, percent(rate), rate ?? 0, previousRate ?? 0],
  ];
  const max = Math.max(1, ...dashboard.days.map((d) => d.entries));
  const width = 720;
  const height = 120;
  const step = width / Math.max(1, dashboard.days.length);
  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          margin: "8px 0 16px",
        }}
      >
        {tiles.map(([label, value, now, before]) => (
          <div key={label}>
            <strong style={{ fontSize: 24 }}>{value}</strong>
            <Delta now={now} before={before} fresh={text.fresh} />
            <div style={{ color: "var(--theme-elevation-600)", fontSize: 13 }}>
              {label}
            </div>
          </div>
        ))}
      </div>
      <p
        style={{ color: "var(--theme-elevation-600)", fontSize: 12, margin: 0 }}
      >
        {text.perDay} · {text.vsPrevious}
      </p>
      <svg
        viewBox={`0 0 ${width} ${height + 16}`}
        width="100%"
        style={{ maxWidth: width, display: "block" }}
        role="img"
        aria-label={text.perDay}
      >
        {dashboard.days.map((day, index) => {
          const barHeight = (day.entries / max) * height;
          return (
            <g key={day.day}>
              <title>{`${day.day}: ${day.entries} · ${day.conversions}`}</title>
              <rect
                x={index * step + 1}
                y={height - barHeight}
                width={Math.max(1, step - 2)}
                height={barHeight}
                fill="var(--theme-elevation-400)"
              />
              {day.conversions > 0 && (
                <circle
                  cx={index * step + step / 2}
                  cy={height - barHeight - 6}
                  r={3}
                  fill="var(--theme-success-500, #2e7d32)"
                />
              )}
            </g>
          );
        })}
        <text
          x={0}
          y={height + 14}
          fontSize={10}
          fill="var(--theme-elevation-500)"
        >
          {dashboard.days[0]?.day}
        </text>
        <text
          x={width}
          y={height + 14}
          fontSize={10}
          textAnchor="end"
          fill="var(--theme-elevation-500)"
        >
          {dashboard.days.at(-1)?.day}
        </text>
      </svg>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 24,
          marginTop: 16,
        }}
      >
        <div>
          <h3>{text.campaigns}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={cell}>{text.campaign}</th>
                <th style={cell}>{text.entries}</th>
                <th style={cell}>{text.conversions}</th>
                <th style={cell}>{text.rate}</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.campaigns.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.label}</td>
                  <td style={cell}>{row.entries}</td>
                  <td style={cell}>{row.conversions}</td>
                  <td style={cell}>{percent(row.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>{text.landing}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={cell}>{text.page}</th>
                <th style={cell}>{text.entries}</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.landingPages.map((row) => (
                <tr key={row.path}>
                  <td style={cell}>
                    <code>{row.path}</code>
                  </td>
                  <td style={cell}>{row.entries}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dashboard.conversions.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>{text.byName}</h3>
              <ul>
                {dashboard.conversions.map((c) => (
                  <li key={c.name}>
                    {c.name} : {c.count}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}

const checkText = {
  en: {
    title: "Setup check",
    ok: "Tracker, pages and middleware look fine.",
    "no-views": () =>
      "No view recorded yet: add <PersonalizationTracker stats /> to your pages (root layout or page template).",
    "stale-views": (d?: string) =>
      `No view since ${d}: is the tracker still on your pages, and is the statistics endpoint reachable?`,
    "single-page": (d?: string) =>
      `Every view comes from ${d}: the tracker seems to be on one template only. Put it on every page to measure all arrivals and detect campaigns.`,
    proxy: (d?: string) =>
      `${d} visitors arrived with the UTM values of a personalized campaign but were not recognized: is the middleware / proxy running on your pages?`,
    "no-pages": (d?: string) =>
      `Campaigns without “Pages it changes” (${d}): in static mode every page gets a variant. Fill the pages to keep the others cached.`,
  },
  fr: {
    title: "Contrôle de l’installation",
    ok: "Traceur, pages et proxy semblent en place.",
    "no-views": () =>
      "Aucune vue enregistrée : ajoutez <PersonalizationTracker stats /> à vos pages (layout ou gabarit de page).",
    "stale-views": (d?: string) =>
      `Aucune vue depuis le ${d} : le traceur est-il toujours sur vos pages, et l’endpoint des statistiques joignable ?`,
    "single-page": (d?: string) =>
      `Toutes les vues viennent de ${d} : le traceur semble n’être que sur un gabarit. Mettez-le sur toutes les pages pour mesurer toutes les arrivées et détecter les campagnes.`,
    proxy: (d?: string) =>
      `${d} visiteurs sont arrivés avec les UTM d’une campagne personnalisée sans être reconnus : le middleware / proxy tourne-t-il sur vos pages ?`,
    "no-pages": (d?: string) =>
      `Campagnes sans « Pages concernées » (${d}) : en mode statique, toutes les pages ont une variante. Renseignez les pages pour garder les autres en cache.`,
  },
};

function InstallChecks({
  checks,
  locale,
}: {
  checks: InstallCheck[];
  locale: "en" | "fr";
}) {
  const text = checkText[locale];
  return (
    <div
      style={{
        margin: "16px 0",
        padding: "12px 16px",
        borderRadius: 4,
        border: `1px solid ${checks.some((c) => c.level === "error") ? "var(--theme-error-500, #c62828)" : "var(--theme-elevation-150)"}`,
      }}
    >
      <strong>{text.title}</strong>
      {checks.length === 0 ? (
        <p style={{ margin: "6px 0 0" }}>✓ {text.ok}</p>
      ) : (
        <ul style={{ margin: "6px 0 0" }}>
          {checks.map((check) => (
            <li key={check.id}>
              {check.level === "error" ? "⛔" : "⚠"}{" "}
              {text[check.id](check.detail)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
