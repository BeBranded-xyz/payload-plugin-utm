"use client";
import {
  CopyToClipboard,
  FieldLabel,
  Pill,
  SectionTitle,
  useConfig,
  useDocumentInfo,
  useField,
  useForm,
  useFormFields,
  useRowLabel,
  useTranslation,
} from "@payloadcms/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DefaultCellComponentProps, TextFieldClientProps } from "payload";
import {
  audienceDraftFromLink,
  audienceDocToRule,
  audienceRefIds,
  exampleCampaignQuery,
  isAudienceLive,
  parseAudienceManifest,
  resolveAudience,
  simulateCampaignUrl,
  summarizeDocument,
  variantPersonalization,
  type AudienceManifest,
  type SimulatedDocument,
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
    personalize: "Personalize the site for this link",
    attach: (name: string) => `Attach this link to “${name}”`,
    creating: "Creating the audience…",
    created:
      "Audience created and attached. Save this link, then on your pages use “Create a variant for…” to choose what these visitors see.",
    openAudience: "Open the audience",
    createError:
      "The audience could not be created. Check your permissions or create it from Campaign audiences.",
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
    personalize: "Personnaliser le site pour ce lien",
    attach: (name: string) => `Rattacher ce lien à « ${name} »`,
    creating: "Création de l’audience…",
    created:
      "Audience créée et rattachée. Enregistrez ce lien, puis sur vos pages utilisez « Créer une variante pour… » pour choisir ce que voient ces visiteurs.",
    openAudience: "Ouvrir l’audience",
    createError:
      "Impossible de créer l’audience. Vérifiez vos droits ou créez-la depuis Audiences de campagne.",
  },
};
const muted = { color: "var(--theme-elevation-600)", fontSize: 13 };

type AudiencePreviewProps = {
  locale?: "en" | "fr";
  siteUrl?: string;
  param?: string;
  draftRoute?: string;
  linksSlug?: string;
};
export function AudiencePreview({
  locale = "en",
  siteUrl,
  param = "utm_preview",
  draftRoute,
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
    previewHref(origin, cleanPath, param, key, draftRoute);
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
  const audienceField = useField<unknown>({ path: "audience" });
  const [creation, setCreation] = useState<
    | { status: "idle" }
    | { status: "busy" }
    | { status: "done"; id: string | number }
    | { status: "error" }
  >({ status: "idle" });
  const linkTitle = useFormFields(([fields]) =>
    typeof fields.title?.value === "string" ? fields.title.value : "",
  );
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
  const api = `${config.serverURL ?? ""}${config.routes.api}/${audiencesSlug}`;
  const createAudience = async () => {
    const draft = audienceDraftFromLink({ title: linkTitle, ...input });
    if (!draft) return;
    setCreation({ status: "busy" });
    for (let attempt = 1; attempt <= 5; attempt++) {
      const key = attempt === 1 ? draft.key : `${draft.key}-${attempt}`;
      try {
        const response = await fetch(api, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, key, priority: 0, state: "active" }),
        });
        if (response.ok) {
          const { doc } = (await response.json()) as {
            doc: { id: string | number };
          };
          audienceField.setValue(doc.id);
          setCreation({ status: "done", id: doc.id });
          return;
        }
        // 400 usually means the key is taken: try the next suffix.
        if (response.status !== 400) break;
      } catch {
        break;
      }
    }
    setCreation({ status: "error" });
  };
  const action = (label: string, onClick: () => void) => (
    <button
      type="button"
      className="btn btn--style-secondary btn--size-small"
      onClick={onClick}
    >
      {label}
    </button>
  );
  if (creation.status === "done")
    return (
      <div>
        {box("ok", text.created)}
        <a
          href={`${config.routes.admin}/collections/${audiencesSlug}/${creation.id}`}
        >
          {text.openAudience}
        </a>
      </div>
    );
  if (selectedId === undefined || selectedId === null || selectedId === "") {
    const resolvedDoc = resolved
      ? state.manifest.audiences.find((item) => item.key === resolved.key)
      : undefined;
    return (
      <div>
        {box(
          "info",
          resolved ? text.resolves(nameOf(resolved.key)!) : text.none,
        )}
        {resolvedDoc ? (
          action(text.attach(nameOf(resolvedDoc.key)!), () =>
            audienceField.setValue(resolvedDoc.id),
          )
        ) : creation.status === "busy" ? (
          <p style={muted}>{text.creating}</p>
        ) : (
          action(text.personalize, () => void createAudience())
        )}
        {creation.status === "error" && box("warn", text.createError)}
      </div>
    );
  }
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

// ---------------------------------------------------------------------------
// Editor experience: shared audience loading, variants, badges, panel, view
// ---------------------------------------------------------------------------

type LoadedAudience = {
  id: string | number;
  key: string;
  title: string;
  state: string;
  startsAt?: string | null;
  endsAt?: string | null;
};
const audienceCache = new Map<string, Promise<LoadedAudience[]>>();

/** Loads every audience once per admin page (authenticated REST, access rules apply). */
function useAudiences(
  audiencesSlug: string,
): LoadedAudience[] | null | "error" {
  const { config } = useConfig();
  const url = `${config.serverURL ?? ""}${config.routes.api}/${audiencesSlug}?depth=0&limit=1000&pagination=false&sort=priority`;
  const [audiences, setAudiences] = useState<LoadedAudience[] | null | "error">(
    null,
  );
  useEffect(() => {
    let alive = true;
    let request = audienceCache.get(url);
    if (!request) {
      request = fetch(url, { credentials: "include" })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json() as Promise<{
            docs: Record<string, unknown>[];
          }>;
        })
        .then(({ docs }) =>
          docs.map((doc) => ({
            id: doc.id as string | number,
            key: String(doc.key ?? ""),
            title: String(doc.title ?? doc.key ?? doc.id),
            state: String(doc.state ?? "active"),
            startsAt: (doc.startsAt as string | null) ?? null,
            endsAt: (doc.endsAt as string | null) ?? null,
          })),
        );
      audienceCache.set(url, request);
      request.catch(() => audienceCache.delete(url));
    }
    request
      .then((list) => alive && setAudiences(list))
      .catch(() => alive && setAudiences("error"));
    return () => {
      alive = false;
    };
  }, [url]);
  return audiences;
}

const editorMessages = {
  en: {
    panelTitle: "Personalization",
    noBlocks: "No personalized block on this document yet.",
    defaultVisitor: "Default visitor",
    view: "View",
    blocks: (n: number) => `${n} block${n > 1 ? "s" : ""}`,
    pagePath: "Page path for previews",
    personalize: "Personalize a block…",
    block: "Block",
    forAudience: "For audience",
    create: "Create the variant",
    createHint:
      "Duplicates the block right below: the copy is shown only to this audience, the original no longer is.",
    created: "Variant created below the original. Edit it, then save.",
    noAudience: "Create an active audience first.",
    loadError: "Audiences could not be loaded.",
    only: (names: string) => `🎯 ${names}`,
    except: (names: string) => `Except ${names}`,
    none: "⚠ no audience",
    warn: {
      "no-audience": (block: string) =>
        `“${block}” is restricted to audiences but none is selected.`,
      "unknown-audience": (block: string) =>
        `“${block}” targets a deleted audience.`,
      "archived-audience": (block: string, a: string) =>
        `“${block}” targets “${a}”, which is archived.`,
      "expired-audience": (block: string, a: string) =>
        `“${block}” targets “${a}”, whose campaign has ended.`,
    },
    variantFor: "Create a variant for…",
    navLink: "Personalization",
    simulator: "URL simulator",
    simulatorHint:
      "Paste a campaign URL to see which audience it triggers and which personalized blocks visitors get.",
    simulate: "Campaign URL",
    simulateReferrer: "Referring site (optional), e.g. partner.com",
    invalidUrl: "This is not a valid URL.",
    resolved: (name: string) => `Audience: “${name}”`,
    noneResolved: "No audience: default content.",
    shown: "Shown",
    hidden: "Hidden",
    preview: "Open preview",
  },
  fr: {
    panelTitle: "Personnalisation",
    noBlocks: "Aucun bloc personnalisé sur ce document pour l’instant.",
    defaultVisitor: "Visiteur normal",
    view: "Voir",
    blocks: (n: number) => `${n} bloc${n > 1 ? "s" : ""}`,
    pagePath: "Chemin de la page pour l’aperçu",
    personalize: "Personnaliser un bloc…",
    block: "Bloc",
    forAudience: "Pour l’audience",
    create: "Créer la variante",
    createHint:
      "Duplique le bloc juste en dessous : la copie est réservée à cette audience, l’original ne lui est plus montré.",
    created: "Variante créée sous l’original. Modifiez-la puis enregistrez.",
    noAudience: "Créez d’abord une audience active.",
    loadError: "Impossible de charger les audiences.",
    only: (names: string) => `🎯 ${names}`,
    except: (names: string) => `Sauf ${names}`,
    none: "⚠ aucune audience",
    warn: {
      "no-audience": (block: string) =>
        `« ${block} » est réservé à des audiences mais aucune n’est choisie.`,
      "unknown-audience": (block: string) =>
        `« ${block} » cible une audience supprimée.`,
      "archived-audience": (block: string, a: string) =>
        `« ${block} » cible « ${a} », qui est archivée.`,
      "expired-audience": (block: string, a: string) =>
        `« ${block} » cible « ${a} », dont la campagne est terminée.`,
    },
    variantFor: "Créer une variante pour…",
    navLink: "Personnalisation",
    simulator: "Simulateur d’URL",
    simulatorHint:
      "Collez une URL de campagne pour voir l’audience déclenchée et les blocs personnalisés que verra le visiteur.",
    simulate: "URL de campagne",
    simulateReferrer: "Site de provenance (facultatif), ex. partenaire.com",
    invalidUrl: "Cette URL n’est pas valide.",
    resolved: (name: string) => `Audience : « ${name} »`,
    noneResolved: "Aucune audience : contenu par défaut.",
    shown: "Affichés",
    hidden: "Masqués",
    preview: "Ouvrir l’aperçu",
  },
};

function translateLabel(label: unknown, language: string): string {
  if (typeof label === "string") return label;
  if (label && typeof label === "object") {
    const record = label as Record<string, unknown>;
    const value = record[language] ?? record.en ?? Object.values(record)[0];
    if (typeof value === "string") return value;
  }
  return "";
}

const isLive = (audience: LoadedAudience, now = new Date()) =>
  audience.state === "active" && isAudienceLive(audience, now);

/** Duplicate a block/array row and split its personalization between original and copy. */
function useCreateVariant(fieldName: string) {
  const { dispatchFields, setModified } = useForm();
  return useCallback(
    (
      rowPath: string,
      current: { mode?: unknown; audiences?: unknown },
      audience: LoadedAudience,
      blockName?: string,
    ) => {
      const cut = rowPath.lastIndexOf(".");
      const parentPath = rowPath.slice(0, cut);
      const index = Number(rowPath.slice(cut + 1));
      if (!parentPath || !Number.isInteger(index)) return;
      const values = variantPersonalization(current, audience.id);
      // Keep the database ID type (numbers on SQL adapters).
      const toId = (id: string) =>
        typeof audience.id === "number" && /^\d+$/.test(id) ? Number(id) : id;
      dispatchFields({
        type: "DUPLICATE_ROW",
        path: parentPath,
        rowIndex: index,
      });
      const copyPath = `${parentPath}.${index + 1}`;
      const update = (path: string, value: unknown, visible?: boolean) =>
        dispatchFields({
          type: "UPDATE",
          path,
          value,
          ...(visible === undefined ? {} : { passesCondition: visible }),
        });
      update(`${rowPath}.${fieldName}.mode`, values.original.mode);
      update(
        `${rowPath}.${fieldName}.audiences`,
        values.original.audiences.map(toId),
        values.original.mode !== "all",
      );
      update(`${copyPath}.${fieldName}.mode`, "only");
      update(`${copyPath}.${fieldName}.audiences`, [audience.id], true);
      update(
        `${copyPath}.blockName`,
        blockName ? `${blockName} · ${audience.title}` : audience.title,
      );
      setModified(true);
    },
    [dispatchFields, fieldName, setModified],
  );
}

type EditorBlock = {
  path: string;
  blockType: string;
  blockName?: string;
  mode: "all" | "only" | "except";
  audienceIds: string[];
  rawAudiences: unknown;
};

/** Personalized rows found in the live form state. */
function useEditorBlocks(fieldName: string): EditorBlock[] {
  const serialized = useFormFields(([fields]) => {
    const suffix = `.${fieldName}.mode`;
    const rows: EditorBlock[] = [];
    for (const [path, field] of Object.entries(fields)) {
      if (!path.endsWith(suffix)) continue;
      const rowPath = path.slice(0, -suffix.length);
      const cut = rowPath.lastIndexOf(".");
      const parent = fields[rowPath.slice(0, cut)] as
        | { rows?: { blockType?: string }[] }
        | undefined;
      const index = Number(rowPath.slice(cut + 1));
      const rawAudiences = fields[`${rowPath}.${fieldName}.audiences`]?.value;
      const blockName = fields[`${rowPath}.blockName`]?.value;
      rows.push({
        path: rowPath,
        blockType:
          parent?.rows?.[index]?.blockType ??
          String(fields[`${rowPath}.blockType`]?.value ?? ""),
        blockName:
          typeof blockName === "string" && blockName ? blockName : undefined,
        mode:
          field?.value === "only" || field?.value === "except"
            ? field.value
            : "all",
        audienceIds: audienceRefIds(rawAudiences),
        rawAudiences,
      });
    }
    return JSON.stringify(rows);
  });
  return useMemo(() => JSON.parse(serialized) as EditorBlock[], [serialized]);
}

function previewHref(
  origin: string,
  path: string,
  param: string,
  key: string,
  draftRoute?: string,
): string {
  const clean = "/" + path.trim().replace(/^\/+/, "");
  if (draftRoute)
    return `${origin}${draftRoute}?path=${encodeURIComponent(clean)}&${encodeURIComponent(param)}=${encodeURIComponent(key)}`;
  return `${origin}${clean}${clean.includes("?") ? "&" : "?"}${encodeURIComponent(param)}=${encodeURIComponent(key)}`;
}

function useOrigin(siteUrl?: string) {
  const [origin, setOrigin] = useState(siteUrl ?? "");
  useEffect(() => {
    if (!siteUrl) setOrigin(window.location.origin);
  }, [siteUrl]);
  return origin;
}

type PanelProps = {
  locale?: "en" | "fr";
  audiencesSlug?: string;
  previewParam?: string | null;
  siteUrl?: string;
  draftRoute?: string;
  blockLabels?: Record<string, unknown>;
  fieldName?: string;
};

/** Sidebar panel on documents that contain personalized blocks. */
export function PersonalizationPanel({
  locale = "en",
  audiencesSlug = "utm-audiences",
  previewParam = "utm_preview",
  siteUrl,
  draftRoute,
  blockLabels = {},
  fieldName = "personalization",
}: PanelProps) {
  const text = editorMessages[locale];
  const { i18n } = useTranslation();
  const audiences = useAudiences(audiencesSlug);
  const blocks = useEditorBlocks(fieldName);
  const createVariant = useCreateVariant(fieldName);
  const slug = useFormFields(([fields]) =>
    typeof fields.slug?.value === "string" ? fields.slug.value : "",
  );
  const [path, setPath] = useState<string | null>(null);
  const origin = useOrigin(siteUrl);
  const [selectedBlock, setSelectedBlock] = useState("");
  const [selectedAudience, setSelectedAudience] = useState("");
  const [done, setDone] = useState(false);
  const pagePath = path ?? (slug && slug !== "home" ? `/${slug}` : "/");
  const labelOf = (block: EditorBlock, index: number) =>
    block.blockName ||
    `${translateLabel(blockLabels[block.blockType], i18n.language) || block.blockType} #${index + 1}`;
  const list = Array.isArray(audiences) ? audiences : [];
  const summary = summarizeDocument(blocks, list);
  const live = list.filter((audience) => isLive(audience));
  const used = list.filter((audience) => summary.counts[String(audience.id)]);
  const block = blocks.find((item) => item.path === selectedBlock);
  const audience = live.find((item) => String(item.id) === selectedAudience);
  return (
    <div className="field-type" style={{ display: "grid", gap: 10 }}>
      <FieldLabel label={text.panelTitle} />
      {audiences === "error" && <p style={muted}>{text.loadError}</p>}
      {blocks.length === 0 && <p style={muted}>{text.noBlocks}</p>}
      {used.map((item) => (
        <div
          key={String(item.id)}
          style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
        >
          <span>
            {item.title}{" "}
            <span style={muted}>
              · {text.blocks(summary.counts[String(item.id)]!)}
            </span>
          </span>
          {previewParam && (
            <a
              href={previewHref(
                origin,
                pagePath,
                previewParam,
                item.key,
                draftRoute,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              👁 {text.view}
            </a>
          )}
        </div>
      ))}
      {previewParam && blocks.length > 0 && (
        <>
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
          >
            <span>{text.defaultVisitor}</span>
            <a
              href={previewHref(
                origin,
                pagePath,
                previewParam,
                "default",
                draftRoute,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              👁 {text.view}
            </a>
          </div>
          <label style={muted}>
            {text.pagePath}
            <input
              value={pagePath}
              onChange={(event) => setPath(event.target.value)}
              style={{ width: "100%" }}
            />
          </label>
        </>
      )}
      {summary.warnings.map((warning, index) => {
        const target = blocks.findIndex((item) => item.path === warning.path);
        const name =
          target >= 0 ? labelOf(blocks[target]!, target) : warning.path;
        const audienceName =
          list.find((item) => String(item.id) === warning.audienceId)?.title ??
          warning.audienceId ??
          "";
        return (
          <p
            key={index}
            role="alert"
            style={{ ...muted, color: "var(--theme-warning-750)" }}
          >
            ⚠ {text.warn[warning.kind](name, audienceName)}
          </p>
        );
      })}
      {blocks.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer" }}>{text.personalize}</summary>
          {live.length === 0 ? (
            <p style={muted}>{text.noAudience}</p>
          ) : (
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <label style={muted}>
                {text.block}
                <select
                  value={selectedBlock}
                  onChange={(event) => {
                    setSelectedBlock(event.target.value);
                    setDone(false);
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="">—</option>
                  {blocks.map((item, index) => (
                    <option key={item.path} value={item.path}>
                      {labelOf(item, index)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={muted}>
                {text.forAudience}
                <select
                  value={selectedAudience}
                  onChange={(event) => {
                    setSelectedAudience(event.target.value);
                    setDone(false);
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="">—</option>
                  {live.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!block || !audience}
                onClick={() => {
                  if (!block || !audience) return;
                  createVariant(
                    block.path,
                    { mode: block.mode, audiences: block.rawAudiences },
                    audience,
                    block.blockName,
                  );
                  setSelectedBlock("");
                  setDone(true);
                }}
              >
                {text.create}
              </button>
              <p style={muted}>{done ? text.created : text.createHint}</p>
            </div>
          )}
        </details>
      )}
    </div>
  );
}

type BlockActionProps = {
  path: string;
  locale?: "en" | "fr";
  audiencesSlug?: string;
  fieldName?: string;
};

/** "Create a variant for…" inside each personalized block. */
export function BlockVariantAction({
  path,
  locale = "en",
  audiencesSlug = "utm-audiences",
  fieldName = "personalization",
}: BlockActionProps) {
  const text = editorMessages[locale];
  const audiences = useAudiences(audiencesSlug);
  const createVariant = useCreateVariant(fieldName);
  const suffix = `.${fieldName}.variantAction`;
  const rowPath = path?.endsWith(suffix) ? path.slice(0, -suffix.length) : "";
  const current = useFormFields(([fields]) => ({
    mode: fields[`${rowPath}.${fieldName}.mode`]?.value,
    audiences: fields[`${rowPath}.${fieldName}.audiences`]?.value,
    blockName: fields[`${rowPath}.blockName`]?.value,
  }));
  const [done, setDone] = useState(false);
  if (!rowPath || !Array.isArray(audiences)) return null;
  const live = audiences.filter((audience) => isLive(audience));
  if (!live.length) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
      }}
    >
      <select
        aria-label={text.variantFor}
        value=""
        onChange={(event) => {
          const audience = live.find(
            (item) => String(item.id) === event.target.value,
          );
          if (!audience) return;
          createVariant(
            rowPath,
            { mode: current.mode, audiences: current.audiences },
            audience,
            typeof current.blockName === "string"
              ? current.blockName
              : undefined,
          );
          setDone(true);
        }}
      >
        <option value="">{text.variantFor}</option>
        {live.map((item) => (
          <option key={String(item.id)} value={String(item.id)}>
            {item.title}
          </option>
        ))}
      </select>
      <span style={muted}>{done ? text.created : text.createHint}</span>
    </div>
  );
}

type BlockLabelProps = {
  locale?: "en" | "fr";
  audiencesSlug?: string;
  blockLabel?: unknown;
  showBlockName?: boolean;
  fieldName?: string;
};

/** Block header: number, block type, editable name and an audience badge. */
export function PersonalizedBlockLabel({
  locale = "en",
  audiencesSlug = "utm-audiences",
  blockLabel,
  showBlockName = true,
  fieldName = "personalization",
}: BlockLabelProps) {
  const text = editorMessages[locale];
  const { path, rowNumber } = useRowLabel<unknown>();
  const { i18n } = useTranslation();
  const { disabled } = useForm();
  const audiences = useAudiences(audiencesSlug);
  // A string keeps the selector stable, so headers only re-render when they change.
  const serialized = useFormFields(
    ([fields]) =>
      `${String(fields[`${path}.${fieldName}.mode`]?.value ?? "all")}|${audienceRefIds(
        fields[`${path}.${fieldName}.audiences`]?.value,
      ).join(",")}`,
  );
  const [mode, idList = ""] = serialized.split("|");
  const value = { mode };
  const ids = idList ? idList.split(",") : [];
  const names = ids
    .map(
      (id) =>
        (Array.isArray(audiences)
          ? audiences.find((item) => String(item.id) === id)?.title
          : undefined) ?? "…",
    )
    .join(", ");
  const badge =
    value.mode === "only" || value.mode === "except"
      ? ids.length
        ? value.mode === "only"
          ? text.only(names)
          : text.except(names)
        : text.none
      : null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className="blocks-field__block-number">
        {String((rowNumber ?? 0) + 1).padStart(2, "0")}
      </span>
      <Pill className="blocks-field__block-pill" pillStyle="white" size="small">
        {translateLabel(blockLabel, i18n.language)}
      </Pill>
      {showBlockName && (
        <SectionTitle path={`${path}.blockName`} readOnly={disabled} />
      )}
      {badge && (
        <Pill
          size="small"
          pillStyle={
            !ids.length
              ? "warning"
              : value.mode === "only"
                ? "success"
                : "light-gray"
          }
        >
          {badge}
        </Pill>
      )}
    </span>
  );
}

/** Nav link to the Personalization admin view. */
export function PersonalizationNavLink({
  locale = "en",
  path = "/personalization",
}: {
  locale?: "en" | "fr";
  path?: string;
}) {
  const { config } = useConfig();
  return (
    <a className="nav__link" href={`${config.routes.admin}${path}`}>
      <span className="nav__link-label">
        🎯 {editorMessages[locale].navLink}
      </span>
    </a>
  );
}

type SimulatorProps = {
  locale?: "en" | "fr";
  manifest: AudienceManifest;
  documents: (SimulatedDocument & { href?: string })[];
  previewParam?: string | null;
  siteUrl?: string;
  draftRoute?: string;
  titles?: Record<string, string>;
};

/** Paste a campaign URL, see the audience and the blocks each document shows. */
export function PersonalizationSimulator({
  locale = "en",
  manifest,
  documents,
  previewParam = "utm_preview",
  siteUrl,
  draftRoute,
  titles = {},
}: SimulatorProps) {
  const text = editorMessages[locale];
  const [url, setUrl] = useState("");
  const [referrer, setReferrer] = useState("");
  const fallbackOrigin = useOrigin(siteUrl);
  const result =
    url.trim() || referrer.trim()
      ? simulateCampaignUrl(
          url.trim() || "/",
          manifest,
          documents,
          new Date(),
          referrer,
        )
      : null;
  let previewUrl: string | null = null;
  if (result?.ok && previewParam) {
    try {
      const parsed = new URL(
        url.trim(),
        fallbackOrigin || "https://example.invalid",
      );
      const origin = /^https?:\/\//i.test(url.trim())
        ? parsed.origin
        : fallbackOrigin;
      previewUrl = previewHref(
        origin,
        parsed.pathname,
        previewParam,
        result.audience?.key ?? "default",
        draftRoute,
      );
    } catch {
      previewUrl = null;
    }
  }
  return (
    <section style={{ marginTop: 32 }}>
      <h2>{text.simulator}</h2>
      <p style={muted}>{text.simulatorHint}</p>
      <label style={{ display: "grid", gap: 4, maxWidth: 720 }}>
        {text.simulate}
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.example.com/menu?utm_source=restaurant-a&utm_medium=qr"
        />
      </label>
      <label style={{ display: "grid", gap: 4, maxWidth: 720, marginTop: 8 }}>
        {text.simulateReferrer}
        <input
          value={referrer}
          onChange={(event) => setReferrer(event.target.value)}
          placeholder="coudac.com"
        />
      </label>
      {result && !result.ok && <p role="alert">{text.invalidUrl}</p>}
      {result?.ok && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <strong>
            {result.audience
              ? text.resolved(
                  titles[result.audience.key] ?? result.audience.key,
                )
              : text.noneResolved}
          </strong>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              {text.preview}
            </a>
          )}
          {result.documents.map((doc) => {
            const href = documents.find((item) => item.id === doc.id)?.href;
            return (
              <div key={doc.id}>
                {href ? <a href={href}>{doc.title}</a> : doc.title}
                <div style={muted}>
                  {text.shown}: {doc.shown.join(", ") || "—"}
                </div>
                <div style={muted}>
                  {text.hidden}: {doc.hidden.join(", ") || "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
