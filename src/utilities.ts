export const utmParameters = {
  source: "utm_source",
  medium: "utm_medium",
  campaign: "utm_campaign",
  campaignId: "utm_id",
  term: "utm_term",
  content: "utm_content",
} as const;
export type UtmKey = keyof typeof utmParameters;
export type UtmInput = { destination?: string | null } & Partial<
  Record<UtmKey, string | null>
>;
export type UtmUrlOptions = {
  /** Exact http(s) origins; omitted means any http(s) origin. */
  allowedOrigins?: readonly string[];
  /** UTM values are case-sensitive; preservation is the default. */
  normalization?: "preserve" | "lowercase" | "slug";
};
export function normalizeUtmValue(
  value: string,
  mode: UtmUrlOptions["normalization"] = "preserve",
): string {
  const trimmed = value.trim();
  if (mode === "lowercase") return trimmed.toLowerCase();
  if (mode === "slug")
    return trimmed
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return trimmed;
}
export function validateDestination(
  value: unknown,
  options: UtmUrlOptions = {},
): true | string {
  if (typeof value !== "string" || !value.trim())
    return "Enter a destination URL.";
  if (value.length > 8192)
    return "The destination URL must not exceed 8192 characters.";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Enter a complete http or https URL.";
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return "Use http or https without embedded credentials.";
  if (options.allowedOrigins && !options.allowedOrigins.includes(url.origin))
    return "This destination origin is not allowed.";
  return true;
}
/** Pure builder: invalid or incomplete input returns null. */
export function buildUtmUrl(
  input: UtmInput,
  options: UtmUrlOptions = {},
): string | null {
  if (validateDestination(input.destination, options) !== true) return null;
  const values: Partial<Record<UtmKey, string>> = {};
  for (const key of Object.keys(utmParameters) as UtmKey[]) {
    const raw = input[key];
    if (raw !== undefined && raw !== null && typeof raw !== "string")
      return null;
    if (typeof raw === "string") {
      if (raw.length > 512) return null;
      values[key] = normalizeUtmValue(raw, options.normalization);
    }
  }
  if (!values.source || !values.medium || !values.campaign) return null;
  const url = new URL(input.destination!.trim());
  for (const key of [...url.searchParams.keys()])
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  for (const key of Object.keys(utmParameters) as UtmKey[])
    if (values[key]) url.searchParams.set(utmParameters[key], values[key]!);
  return url.toString();
}
/** Generate variations without database writes. */
export function buildUtmVariants(
  base: UtmInput,
  variants: readonly Partial<UtmInput>[],
  options: UtmUrlOptions = {},
): string[] {
  return variants.map((variant, index) => {
    const url = buildUtmUrl({ ...base, ...variant }, options);
    if (!url)
      throw new Error(`UTM variant ${index + 1} is invalid or incomplete.`);
    return url;
  });
}
export const csvColumns = [
  "title",
  "destination",
  "source",
  "medium",
  "campaign",
  "campaignId",
  "term",
  "content",
  "generatedUrl",
  "state",
  "createdAt",
  "updatedAt",
] as const;
/** Quoted CSV, including spreadsheet formula neutralization. */
export function utmLinksToCsv(
  rows: readonly Record<string, unknown>[],
): string {
  const cell = (value: unknown): string => {
    let text = value == null ? "" : String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      csvColumns.join(","),
      ...rows.map((row) => csvColumns.map((key) => cell(row[key])).join(",")),
    ].join("\r\n") +
    "\r\n"
  );
}
