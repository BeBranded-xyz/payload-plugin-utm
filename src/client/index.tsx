"use client";
import {
  CopyToClipboard,
  FieldLabel,
  useConfig,
  useField,
  useFormFields,
} from "@payloadcms/ui";
import type { DefaultCellComponentProps, TextFieldClientProps } from "payload";
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
