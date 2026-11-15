/**
 * Optional GA4 figures per campaign (Google Analytics Data API, read-only):
 * sessions and key events of the last 30 days for a source / medium / campaign.
 * Server only. No dependency: the service-account JWT is signed with node:crypto.
 */
import { createSign } from "node:crypto";
import type { Endpoint } from "payload";

export type Ga4Options = {
  /** Numeric GA4 property ID, e.g. "410476274". */
  propertyId: string;
  /** Service account with "Viewer" access on the property. */
  credentials?: { client_email: string; private_key: string };
  /** Or bring your own token (Workload Identity, gcloud…). */
  getAccessToken?: () => Promise<string>;
  /** Cache of the figures, default 3600 s. */
  cacheTtlSeconds?: number;
};

let token: { value: string; expires: number; email: string } | null = null;

async function serviceAccountToken(
  credentials: NonNullable<Ga4Options["credentials"]>,
): Promise<string> {
  if (
    token &&
    token.email === credentials.client_email &&
    token.expires > Date.now()
  )
    return token.value;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(credentials.private_key.replace(/\\n/g, "\n"), "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`GA4 token HTTP ${response.status}`);
  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  token = {
    value: data.access_token,
    expires: Date.now() + (data.expires_in - 120) * 1000,
    email: credentials.client_email,
  };
  return token.value;
}

const cache = new Map<
  string,
  { value: { sessions: number; keyEvents: number }; expires: number }
>();

/** Sessions and key events for exact (case-insensitive) UTM values, last 30 days. */
export async function ga4CampaignFigures(
  options: Ga4Options,
  campaign: { source: string; medium?: string; campaign?: string },
): Promise<{ sessions: number; keyEvents: number }> {
  const cacheKey = JSON.stringify([options.propertyId, campaign]);
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  const accessToken = options.getAccessToken
    ? await options.getAccessToken()
    : await serviceAccountToken(options.credentials!);
  const filter = (fieldName: string, value: string) => ({
    filter: {
      fieldName,
      stringFilter: { matchType: "EXACT", value, caseSensitive: false },
    },
  });
  const expressions = [
    filter("sessionSource", campaign.source),
    ...(campaign.medium ? [filter("sessionMedium", campaign.medium)] : []),
    ...(campaign.campaign
      ? [filter("sessionCampaignName", campaign.campaign)]
      : []),
  ];
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(options.propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        metrics: [{ name: "sessions" }, { name: "keyEvents" }],
        dimensionFilter: { andGroup: { expressions } },
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error(`GA4 HTTP ${response.status}`);
  const data = (await response.json()) as {
    rows?: { metricValues?: { value?: string }[] }[];
  };
  const values = data.rows?.[0]?.metricValues ?? [];
  const value = {
    sessions: Number(values[0]?.value ?? 0) || 0,
    keyEvents: Number(values[1]?.value ?? 0) || 0,
  };
  cache.set(cacheKey, {
    value,
    expires: Date.now() + (options.cacheTtlSeconds ?? 3600) * 1000,
  });
  return value;
}

const clean = (value: unknown) =>
  typeof value === "string" && value.trim() && value.length <= 200
    ? value.trim()
    : undefined;

/** `GET /api/<campaigns>/ga4?source=&medium=&campaign=`: signed-in users only. */
export function ga4Endpoint(options: Ga4Options): Endpoint {
  return {
    path: "/ga4",
    method: "get",
    handler: async (req) => {
      if (!req.user)
        return Response.json({ error: "Unauthorized." }, { status: 401 });
      const source = clean(req.query?.source);
      if (!source)
        return Response.json({ error: "source is required." }, { status: 400 });
      try {
        const figures = await ga4CampaignFigures(options, {
          source,
          medium: clean(req.query?.medium),
          campaign: clean(req.query?.campaign),
        });
        return Response.json(figures, {
          headers: { "Cache-Control": "private, max-age=300" },
        });
      } catch (error) {
        req.payload.logger.error({
          err: error,
          msg: "utmPlugin: GA4 report failed",
        });
        return Response.json({ error: "GA4 unavailable." }, { status: 502 });
      }
    },
  };
}
