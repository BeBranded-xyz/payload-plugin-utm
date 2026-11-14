"use client";
import {
  CopyToClipboard,
  FieldLabel,
  useConfig,
  useDocumentInfo,
  useField,
  useFormFields,
} from "@payloadcms/ui";
import { useEffect, useMemo, useState } from "react";
import type { DefaultCellComponentProps, TextFieldClientProps } from "payload";
import {
  audienceDocToRule,
  exampleCampaignQuery,
  parseAudienceManifest,
  resolveAudience,
  type AudienceManifest,
} from "../personalization/match.js";
import type { UtmPreset } from "../types.js";
import {
  buildUtmUrl,
  validateDestination,
  type UtmInput,
  type UtmUrlOptions,
} from "../utilities.js";
const messages = {
  en: {
    copy: "Copy link",
    copied: "Link copied",
    open: "Open",
    placeholder: "Enter a destination, source, medium and campaign.",
    save: "Save to keep this link in your campaign inventory.",
    presets: "Quick fill",
    export: "Export saved links (CSV)",
  },
  fr: {
    copy: "Copier le lien",
    copied: "Lien copié",
    open: "Ouvrir",
    placeholder:
      "Renseignez la destination, la source, le support et la campagne.",
    save: "Enregistrez pour conserver ce lien dans le tableau.",
    presets: "Préremplir",
    export: "Exporter les liens enregistrés (CSV)",
  },
};
type ExtraProps = {
  locale?: "en" | "fr";
  presets?: UtmPreset[];
  policy?: UtmUrlOptions;
  collectionSlug?: string;
  csvExport?: boolean;
};
export function UtmUrlField({
  field,
  path,
  locale = "en",
  presets = [],
  policy = {},
  collectionSlug = "utm-links",
  csvExport = true,
}: TextFieldClientProps & ExtraProps) {
  const { config } = useConfig();
  const text = messages[locale];
  const source = useField<string>({ path: "source" });
  const medium = useField<string>({ path: "medium" });
  const content = useField<string>({ path: "content" });
  const input = useFormFields(([fields]) => {
    const result: UtmInput = {};
    for (const key of [
      "destination",
      "source",
      "medium",
      "campaign",
      "campaignId",
      "term",
      "content",
    ] as const) {
      const value = fields[key]?.value;
      result[key] = typeof value === "string" ? value : "";
    }
    return result;
  });
  const url = buildUtmUrl(input, policy);
  const id = `field-${path}`;
  return (
    <div className="field-type text">
      <FieldLabel htmlFor={id} label={field.label} />
      {presets.length > 0 && (
        <div
          role="group"
          aria-label={text.presets}
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}
        >
          {presets.map((preset, index) => (
            <button
              type="button"
              key={index}
              onClick={() => {
                source.setValue(preset.source);
                medium.setValue(preset.medium);
                if (preset.content !== undefined)
                  content.setValue(preset.content);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <input
        id={id}
        value={url ?? ""}
        readOnly
        placeholder={text.placeholder}
      />
      {url && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 8,
          }}
        >
          <CopyToClipboard
            value={url}
            defaultMessage={text.copy}
            successMessage={text.copied}
          />
          <a href={url} target="_blank" rel="noopener noreferrer">
            {text.open}
          </a>
        </div>
      )}
      <p style={{ color: "var(--theme-elevation-600)" }}>{text.save}</p>
      {csvExport && (
        <a href={`${config.routes.api}/${collectionSlug}/export-csv`} download>
          {text.export}
        </a>
      )}
    </div>
  );
}
export function UtmUrlCell({
  cellData,
  locale = "en",
}: DefaultCellComponentProps & Pick<ExtraProps, "locale">) {
  if (typeof cellData !== "string" || validateDestination(cellData) !== true)
    return null;
  const text = messages[locale];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <CopyToClipboard
        value={cellData}
        defaultMessage={text.copy}
        successMessage={text.copied}
      />
      <a href={cellData} target="_blank" rel="noopener noreferrer">
        {text.open}
      </a>
    </span>
  );
}

const audienceMessages = {
  en: {
    path: "Page path",
    preview: "Preview as this audience",
    previewDefault: "Preview default content",
    unsaved:
      "Save this audience to preview it. Rule changes reach the site within about a minute.",
    example: "Example campaign link parameters",
    links: "UTM links targeting this audience",
    none: "This link triggers no audience: visitors see the default content.",
    resolves: (name: string) => `This link shows the audience “${name}”.`,
    ok: (name: string) => `This link triggers “${name}”.`,
    mismatch: (wanted: string, actual: string | null) =>
      `This link does not trigger “${wanted}”: visitors will see ${
        actual ? `“${actual}”` : "the default content"
      }. Check its parameters, or the audience rules and priorities.`,
    archived: (name: string) =>
      `“${name}” is archived or has no valid rule: it is never shown.`,
    error: "Audiences could not be loaded to check this link.",
  },
  fr: {
    path: "Chemin de la page",
    preview: "Voir la page comme cette audience",
    previewDefault: "Voir le contenu par défaut",
    unsaved:
      "Enregistrez l’audience pour la prévisualiser. Les règles modifiées s’appliquent au site en une minute environ.",
    example: "Exemple de paramètres de lien de campagne",
    links: "Liens UTM qui ciblent cette audience",
    none: "Ce lien ne déclenche aucune audience : le visiteur voit le contenu par défaut.",
    resolves: (name: string) => `Ce lien affiche l’audience « ${name} ».`,
    ok: (name: string) => `Ce lien déclenche bien « ${name} ».`,
    mismatch: (wanted: string, actual: string | null) =>
      `Ce lien ne déclenche pas « ${wanted} » : le visiteur verra ${
        actual ? `« ${actual} »` : "le contenu par défaut"
      }. Vérifiez ses paramètres, ou les règles et priorités des audiences.`,
    archived: (name: string) =>
      `« ${name} » est archivée ou sans règle valide : elle n’est jamais affichée.`,
    error: "Impossible de charger les audiences pour vérifier ce lien.",
  },
};
const muted = { color: "var(--theme-elevation-600)", fontSize: 13 };

type AudiencePreviewProps = {
  locale?: "en" | "fr";
  siteUrl?: string;
  param?: string;
  linksSlug?: string;
};
export function AudiencePreview({
  locale = "en",
  siteUrl,
  param = "utm_preview",
  linksSlug = "utm-links",
}: AudiencePreviewProps) {
  const text = audienceMessages[locale];
  const { config } = useConfig();
  const { id } = useDocumentInfo();
  const [path, setPath] = useState("/");
  const [origin, setOrigin] = useState(siteUrl ?? "");
  useEffect(() => {
    if (!siteUrl) setOrigin(window.location.origin);
  }, [siteUrl]);
  const form = useFormFields(([fields]) => {
    const conditions: Record<string, Record<string, string>> = {};
    for (const [name, field] of Object.entries(fields)) {
      const match = /^conditions\.(\d+)\.(\w+)$/.exec(name);
      if (match && typeof field?.value === "string")
        (conditions[match[1]!] ??= {})[match[2]!] = field.value;
    }
    return {
      key: typeof fields.key?.value === "string" ? fields.key.value : "",
      match: fields.match?.value === "any" ? "any" : "all",
      conditions: JSON.stringify(
        Object.keys(conditions)
          .sort((a, b) => Number(a) - Number(b))
          .map((index) => conditions[index]!),
      ),
    } as const;
  });
  const example = useMemo(() => {
    const rows = JSON.parse(form.conditions) as Record<string, string>[];
    return exampleCampaignQuery(
      rows.map((row) => ({
        parameter:
          row.parameter === "custom"
            ? (row.customParameter ?? "")
            : (row.parameter ?? ""),
        operator: row.operator ?? "",
        value: row.value,
      })),
      form.match,
    );
  }, [form.conditions, form.match]);
  const cleanPath = "/" + path.trim().replace(/^\/+/, "");
  const url = (key: string) =>
    `${origin}${cleanPath}${cleanPath.includes("?") ? "&" : "?"}${encodeURIComponent(param)}=${encodeURIComponent(key)}`;
  return (
    <div className="field-type" style={{ display: "grid", gap: 8 }}>
      <FieldLabel label={locale === "fr" ? "Aperçu" : "Preview"} />
      {id && form.key ? (
        <>
          <label style={muted}>
            {text.path}
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <a href={url(form.key)} target="_blank" rel="noopener noreferrer">
            {text.preview}
          </a>
          <a href={url("default")} target="_blank" rel="noopener noreferrer">
            {text.previewDefault}
          </a>
        </>
      ) : (
        <p style={muted}>{text.unsaved}</p>
      )}
      {example && (
        <div>
          <p style={muted}>{text.example}</p>
          <code style={{ wordBreak: "break-all" }}>?{example}</code>
        </div>
      )}
      {id && (
        <a
          href={`${config.routes.admin}/collections/${linksSlug}?where[audience][equals]=${encodeURIComponent(String(id))}`}
        >
          {text.links}
        </a>
      )}
    </div>
  );
}

type AudienceDoc = { id: string | number; key?: string; title?: string };
type MatchNoticeProps = {
  locale?: "en" | "fr";
  audiencesSlug?: string;
  policy?: UtmUrlOptions;
};
export function AudienceMatchNotice({
  locale = "en",
  audiencesSlug = "utm-audiences",
  policy = {},
}: MatchNoticeProps) {
  const text = audienceMessages[locale];
  const { config } = useConfig();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; manifest: AudienceManifest; docs: AudienceDoc[] }
  >({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const query = "depth=0&limit=1000&sort=priority&pagination=false";
    fetch(
      `${config.serverURL ?? ""}${config.routes.api}/${audiencesSlug}?${query}`,
      { credentials: "include", signal: controller.signal },
    )
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ docs: Record<string, unknown>[] }>;
      })
      .then(({ docs }) =>
        setState({
          status: "ready",
          docs: docs as AudienceDoc[],
          manifest: parseAudienceManifest({
            audiences: docs
              .filter((doc) => doc.state === "active")
              .map(audienceDocToRule),
          }),
        }),
      )
      .catch((error: unknown) => {
        if ((error as Error)?.name !== "AbortError")
          setState({ status: "error" });
      });
    return () => controller.abort();
  }, [audiencesSlug, config.routes.api, config.serverURL]);
  const input = useFormFields(([fields]) => {
    const result: UtmInput & { audience?: unknown } = {};
    for (const key of [
      "destination",
      "source",
      "medium",
      "campaign",
      "campaignId",
      "term",
      "content",
    ] as const) {
      const value = fields[key]?.value;
      result[key] = typeof value === "string" ? value : "";
    }
    result.audience = fields.audience?.value;
    return result;
  });
  const url = buildUtmUrl(input, policy);
  if (!url) return null;
  if (state.status === "loading") return null;
  if (state.status === "error") return <p style={muted}>{text.error}</p>;
  const resolved = resolveAudience(new URL(url).searchParams, state.manifest);
  const nameOf = (key: string | null | undefined) =>
    state.docs.find((doc) => doc.key === key)?.title ?? key ?? null;
  const selectedId =
    input.audience && typeof input.audience === "object"
      ? (input.audience as { id?: unknown }).id
      : input.audience;
  const box = (tone: "ok" | "warn" | "info", message: string) => (
    <p
      role={tone === "warn" ? "alert" : "status"}
      style={{
        padding: "8px 12px",
        borderRadius: 4,
        fontSize: 13,
        background:
          tone === "ok"
            ? "var(--theme-success-100)"
            : tone === "warn"
              ? "var(--theme-warning-100)"
              : "var(--theme-elevation-50)",
      }}
    >
      {message}
    </p>
  );
  if (selectedId === undefined || selectedId === null || selectedId === "")
    return box(
      "info",
      resolved ? text.resolves(nameOf(resolved.key)!) : text.none,
    );
  const selected = state.manifest.audiences.find(
    (audience) => String(audience.id) === String(selectedId),
  );
  if (!selected)
    return box(
      "warn",
      text.archived(
        state.docs.find((doc) => String(doc.id) === String(selectedId))
          ?.title ?? String(selectedId),
      ),
    );
  const selectedName = nameOf(selected.key)!;
  return resolved?.key === selected.key
    ? box("ok", text.ok(selectedName))
    : box("warn", text.mismatch(selectedName, nameOf(resolved?.key)));
}
