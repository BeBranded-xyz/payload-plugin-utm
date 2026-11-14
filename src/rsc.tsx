/**
 * Server components for the Payload admin (import map: `payload-plugin-utm/rsc`).
 */
import { DefaultTemplate } from "@payloadcms/next/templates";
import { Gutter, SetStepNav } from "@payloadcms/ui";
import type { AdminViewServerProps, CollectionSlug, GlobalSlug } from "payload";
import { PersonalizationSimulator } from "./client/index.js";
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

type PluginViewOptions = {
  locale: "en" | "fr";
  previewParam: string | null;
  siteUrl?: string;
  audiencesSlug: string;
  linksSlug: string;
  targets: PersonalizationTarget[];
  blockLabels: Record<string, unknown>;
};

const t = {
  en: {
    title: "Personalization",
    intro:
      "Campaign audiences, the pages they change and the UTM links that trigger them, filtered by your permissions.",
    audiences: "Audiences",
    audience: "Audience",
    status: "Status",
    documents: "Personalized content",
    links: "UTM links",
    priority: "Priority",
    none: "No audience yet.",
    create: "Create an audience",
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
    audiences: "Audiences",
    audience: "Audience",
    status: "Statut",
    documents: "Contenus personnalisés",
    links: "Liens UTM",
    priority: "Priorité",
    none: "Aucune audience pour l’instant.",
    create: "Créer une audience",
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
    initPageResult,
    params,
    searchParams,
    pluginOptions: options,
  } = props;
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

  let links: {
    id: string;
    title: string;
    generatedUrl?: string;
    audience?: unknown;
  }[] = [];
  try {
    const result = await payload.find({
      collection: options.linksSlug as CollectionSlug,
      req,
      overrideAccess: false,
      depth: 0,
      limit: 1000,
      pagination: false,
      where: { audience: { exists: true } },
      select: { title: true, generatedUrl: true, audience: true },
    });
    links = (result.docs as Record<string, unknown>[]).map((doc) => ({
      id: String(doc.id),
      title: String(doc.title ?? doc.id),
      generatedUrl:
        typeof doc.generatedUrl === "string" ? doc.generatedUrl : undefined,
      audience: doc.audience,
    }));
  } catch {
    notes.push(text.unreadable(options.linksSlug));
  }

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
                  <th style={cell}>{text.links}</th>
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
                  const linkCount = links.filter(
                    (link) => audienceRefIds([link.audience])[0] === id,
                  ).length;
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
                        {linkCount === 0 ? (
                          "0"
                        ) : (
                          <a
                            href={`${admin}/collections/${options.linksSlug}?where[audience][equals]=${encodeURIComponent(id)}`}
                          >
                            {linkCount}
                          </a>
                        )}
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
          titles={Object.fromEntries(
            audiences.map((a) => [a.key, a.title ?? a.key]),
          )}
        />
      </Gutter>
    </DefaultTemplate>
  );
}
