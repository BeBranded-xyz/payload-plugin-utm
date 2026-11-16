# Payload UTM

Create campaign links where your content already lives: in Payload CMS.

Live URL generation, one-click copy, reusable source/medium presets, a searchable campaign inventory and permission-aware CSV exports. No analytics account, redirect service or external API required.

**New in 0.2 (opt-in):** personalize your pages for the visitors those links bring. A dedicated hero for `utm_source=restaurant-a`, more e-commerce case studies for visitors referred by a partner agency, a creator's name on the home page for their UGC campaign — configured block by block in the Payload admin, rendered by Next.js without flicker. See [Personalize pages from your links](#personalize-pages-from-your-links-opt-in).

**Community plugin · MIT · Payload 3.92+ · React 19 · Node 22+**

## Install

```sh
pnpm add payload-plugin-utm        # stable: UTM links, generator, presets, CSV (0.1)
pnpm add payload-plugin-utm@beta   # 0.2 beta: adds page personalization and statistics
```

The default install stays on the stable 0.1 line until 0.2 is released; the beta is opt-in through the `beta` tag.

Add the plugin to your existing Payload configuration:

```ts
import { buildConfig } from "payload";
import { utmPlugin } from "payload-plugin-utm";

export default buildConfig({
  // Keep your database, auth collection, editor and other app settings.
  plugins: [
    utmPlugin({
      presets: [
        { label: "Newsletter", source: "newsletter", medium: "email" },
        {
          label: "Instagram story",
          source: "instagram",
          medium: "social",
          content: "story",
        },
      ],
    }),
  ],
});
```

Then run your normal `payload generate:importmap`, `payload generate:types` and database migration workflow. Generate migrations in **your application**: this plugin does not ship database-specific migrations.

## Use it

1. Open **Marketing → UTM campaigns**.
2. Enter a name and the source (`utm_source`), plus medium and campaign when you want them, or use a preset to fill source/medium.
3. Add a destination URL to get a link to share, and copy it.
4. Save it in your campaign inventory.
5. Search by campaign/source/medium, filter by status, or export saved campaigns as CSV.

Only `utm_source` is required. `utm_medium` and `utm_campaign` are recommended (GA4 reports "(not set)" without them); optional fields support `utm_id`, `utm_content` and `utm_term`. The destination is optional too: a campaign such as "visitors from our partner's footer" may have no link to share. Existing non-UTM query parameters and fragments are preserved. Old UTM parameters, including duplicates and mixed-case keys, are replaced.

The server always recalculates the saved URL. API clients cannot substitute a forged `generatedUrl`; partial updates preserve existing campaign parameters.

## Options

| Option               | Default            | What it does                                                                                                                                                          |
| -------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`            | `true`             | Disable the plugin without changing the app config.                                                                                                                   |
| `collectionSlug`     | `'utm-links'`      | Rename the collection. A conflicting slug throws a startup error.                                                                                                     |
| `relatedCollections` | none               | Add an optional relationship to your content collections. It does not replace the destination URL.                                                                    |
| `presets`            | `[]`               | Quick-fill buttons: `{ label, source, medium, content? }`.                                                                                                            |
| `locale`             | `'en'`             | English or French text for custom controls. Field labels support both through Payload's admin language.                                                               |
| `allowedOrigins`     | unrestricted       | Optional exact origin allowlist, e.g. `['https://example.com']`. An empty list denies all destinations. No paths, wildcards or trailing slashes.                      |
| `normalization`      | `'preserve'`       | Preserve case, lowercase values, or produce ASCII slugs with `'slug'`. Trims outer whitespace in every mode.                                                          |
| `csvExport`          | enabled, 1000 rows | `false` disables it. `{ maxRows: 5000 }` sets a cap between 1 and 10000. Oversized exports return HTTP 413 rather than silently truncating.                           |
| `overrides`          | none               | A function receiving and returning the generated `CollectionConfig`. Customize access, labels, fields, hooks and endpoints. Change the slug through `collectionSlug`. |

UTM values are case-sensitive in downstream tools. **No lowercasing happens by default.** Slug normalization removes non-ASCII characters; do not use it for campaigns whose names must retain non-Latin text. Required values that normalize to an empty string fail validation. Parameter values are limited to 512 characters; destination URLs to 8192.

### Multi-tenant apps

Install the UTM plugin **before** Payload's multi-tenant plugin so the latter can add its tenant field, access rules and filters:

```ts
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant";

plugins: [
  utmPlugin({ relatedCollections: ["pages", "posts"] }),
  multiTenantPlugin({
    collections: { "utm-links": {} },
    // Keep your normal tenant configuration.
  }),
];
```

The plugin itself is tenant-agnostic. There are no hardcoded collection names, tenants, domains or user roles. Include your normal tenant field when creating links through the API. Changing a collection slug or an existing app's normalization policy needs an application migration/data review.

### Custom access

All CRUD operations require `req.user` by default. Supply your own role checks through `overrides`:

```ts
utmPlugin({
  overrides: (collection) => ({
    ...collection,
    access: {
      ...collection.access,
      delete: ({ req }) => Boolean(req.user?.roles?.includes("admin")),
    },
  }),
});
```

Adapt the example to your generated user type. The CSV endpoint always requires authentication and runs with `overrideAccess: false`, forwarding the original request. Collection, field and multi-tenant access rules still apply. Application hooks run before the final URL calculation. If you replace core fields or add a `beforeChange` hook, you are responsible for maintaining the plugin's invariants.

## CSV export

Download from the link editor, or request:

```text
GET /api/utm-links/export-csv
GET /api/utm-links/export-csv?where[campaign][equals]=summer-launch
GET /api/utm-links/export-csv?where[tenant][equals]=123
```

Use your normal authenticated Payload session/API credentials and your app's API prefix. The editor download includes **all saved records the current user can read**, not just the current document or an implicit list-view selection. Add `where` filters to scope a campaign or tenant. Exported fields are fixed campaign metadata; internal notes and related document contents are not exported. Fields denied by field-level access appear empty.

CSV uses UTF-8 with a BOM, CRLF line endings and quoted cells. Values that could be interpreted as spreadsheet formulas are prefixed with an apostrophe. Responses are private and not cached. Archiving organizes the inventory: it does not deactivate links that have already been shared.

## Personalize pages from your links (opt-in)

The links you create above can now change what their visitors see. Visitors referred by another site without any UTM (a partner's blog, a directory) can be targeted too. Nothing below is active unless you pass `personalization`.

**One menu, one notion.** A **campaign** (Marketing → UTM campaigns) is a UTM link that can also personalize the site: tick **Personalize the site** in its tab, and its visitors are recognized by its UTM values (source, plus medium and campaign when set), or by the referring sites you list. Then, on a page, use _Create a variant for…_ on a block and edit the copy.

**Detected campaigns.** Above the campaign list, **Detected campaigns, not created yet** shows the UTM values and the referring sites (without UTM) that brought visitors in the last 30 days and match no campaign, with their arrivals. **Create the campaign** opens it pre-filled; tick _Personalize the site_ and create a variant for the page they land on.

### 1. Enable it

```ts
utmPlugin({
  personalization: {
    blocks: ["hero", "cta"], // or 'all'
  },
});
```

This adds a **Personalize the site** and a **Statistics** tab to UTM campaigns, a **Personalization** group to the listed blocks wherever they are used (collections, globals, nested blocks, `config.blocks`), and anonymous statistics (`stats: false` to opt out).

A campaign that personalizes the site is an **audience**:

- It is recognized by its **UTM values**: `utm_source`, plus `utm_medium` and `utm_campaign` when they are set on the campaign (a campaign with only a source covers every medium and campaign of it), **or** by one of its **referring sites** (`partner.com`, subdomains and `www.` included, or `partner.*` for any extension: `partner.fr`, `partner.co.uk`, not `partner.evil.com`), **or** by its optional **advanced rules** (any other URL parameter such as `?ref=partner`, `contains`, `starts with`…). Comparisons ignore case and outer whitespace.
- It has a `key` generated from its source and campaign (unique, editable), **pages it changes**, a priority (lower wins) and optional **campaign dates** (`startsAt` / `endsAt`): outside that window it is ignored, including for visitors who already have it in memory.
- **Audience content**: a display name, a tagline, a link (text + site path or `https://` URL: `linkLabel`, `linkUrl`) (and an image with `content: { imageCollection: 'media' }`, extra fields with `content.fields`), stored as `audienceContent`. Editors add their own texts without code under **Other texts** (a name such as `offer`, then a localized text): `getAudienceContent` returns them as top-level keys, so `{{audience.offer|Our offer}}` works like the built-in fields. Write `{{audience.displayName|our clients}}` in any block text and render with `fillAudienceTokens(block, await getAudienceContent(payload, audience))`. Values always come from the CMS, never from the URL, so nobody can make your site display arbitrary text.
- A **block** is visible to _everyone_ (default), _only these campaigns_ or _everyone except these campaigns_. Typical page: the default hero set to "except Restaurant A" and a second hero set to "only Restaurant A".

Upgrading from 0.2.0-beta.1–3: the separate `utm-audiences` collection is gone; recreate each audience as a campaign (source, referring sites, advanced rules, content). Keep the same `key` so remembered visitors and statistics carry over.

`personalizationField()` is exported if you want the same control on array rows or custom places. Run `generate:importmap`, `generate:types` and your migrations as usual.

### 2. Add the middleware

Next.js 16 (`proxy.ts`, always on the Node.js runtime):

```ts
// proxy.ts
import { createPersonalizationMiddleware } from "payload-plugin-utm/next";

export const proxy = createPersonalizationMiddleware();

export const config = { matcher: ["/((?!api|admin|_next|.*\\..*).*)"] };
```

Next.js 15: same code in `middleware.ts`, exported as `middleware` instead of `proxy`.

It reads the active audiences from `GET /api/utm-links/manifest` (cached 60 s in memory, then served stale while one background refresh runs, so visitors never wait for it; 1.5 s timeout; on failure it serves the last rules or no personalization, never an error page). Only audiences that exist in the manifest are ever forwarded.

**Source memory.** On an _arrival_ (tracked campaign parameters, or a referrer from another site) the middleware stores, in one `httpOnly` cookie (`utm_memory`, 90 days):

- the **first** and **latest** arrivals (parameters, referring domain, date), for attribution;
- the arrival that selected the current audience.

Rules are re-evaluated on every request, so audiences created or edited later still apply. **A remembered audience stays until another audience replaces it, or until it expires**: a visitor referred by a partner who comes back through Google or by typing your URL still gets the partner version; arriving through another campaign that has its own audience switches to it. Internal navigation is never an arrival and never sets a cookie, so cached pages stay cacheable. UTM parameters are never propagated in internal links (that would split GA4 sessions). Read the memory in a Server Component with `getSourceMemory()`, e.g. to attach the original campaign to a lead form.

**For the current visit only.** Pass `cookie: { lifetime: "visit" }` when a partner version should show once, not every time the visitor comes back: the memory goes in a session cookie (`utm_visit`, no `Max-Age`, gone when the browser closes) and an arrival counts for 30 minutes (`cookie.maxAgeSeconds`). The visitor keeps the partner version from page to page during the visit, then sees the default site on the next visit unless they come through the link again. Switching an existing site to this mode deletes the former `utm_memory` cookie on the next request (`cookie.clearCookies` to list other names), so visitors who already carry it stop seeing the partner version at once. Use the same mode for the statistics: `personalization.stats.memoryLifetime: "visit"`.

**Same app as Payload? Read the manifest from the database.** By default the middleware fetches the manifest over HTTP from your own site, which can be slow when an instance starts. When the proxy runs in the same Next.js app as Payload (Node.js runtime, the default for `proxy.ts`), load it directly:

```ts
import config from "@payload-config";
import { getPayload } from "payload";
import { buildAudienceManifest } from "payload-plugin-utm";

createPersonalizationMiddleware({
  loadManifest: async () => buildAudienceManifest(await getPayload({ config })),
});
```

It returns exactly what the endpoint serves (same projection, pages and block paths), with the plugin's own settings. It is cached and refreshed in the background like the HTTP manifest.

Options: `manifestUrl` (absolute, for a separate CMS), `loadManifest` (Edge Config, KV, static JSON…), `secret` (paired with `personalization.manifest.secret`), `cacheTtlSeconds`, `cookie: false | { name, maxAgeSeconds, lifetime: "persistent" | "visit", clearCookies }`, `consent: (request) => boolean`, `rewrite`, `previewParam` (default `utm_preview`, `false` to disable).

**Already have a proxy?** Sites that rewrite or redirect in `proxy.ts` (locale segment, several hosts, Markdown versions…) keep it and ask the plugin for a decision only. `createPersonalizationResolver()` takes the same options and returns the audience, the request headers to forward, the source-memory cookie and the static variant segment; your code builds the response:

```ts
// proxy.ts
import { NextResponse, type NextRequest } from "next/server";
import { createPersonalizationResolver } from "payload-plugin-utm/next";

const personalize = createPersonalizationResolver({
  rewrite: { prefix: "utm-audience" },
});

export async function proxy(request: NextRequest) {
  const decision = await personalize(request);
  if (decision.redirect) return NextResponse.redirect(decision.redirect, 308);
  const url = request.nextUrl.clone();
  url.pathname = decision.variantPath(`/en${url.pathname}`); // your own rewrite, then the audience segment
  return decision.apply(
    NextResponse.rewrite(url, {
      request: { headers: decision.requestHeaders },
    }),
  );
}
```

`variantPath()` prefixes the path only when this public page has content for the audience (`decision.variant`); place the segment wherever your route tree expects it. If you put it behind a locale segment (`/fr/utm-audience/<key>`), list the locales in `rewrite: { localePrefixes: ['fr', 'en'] }` so direct hits there are redirected too (`decision.redirect`). `apply()` sets the cookie on the response you return; forward `requestHeaders` on every branch (`NextResponse.next({ request: { headers } })` included) or Server Components will not see the audience.

### 3. Render

**Dynamic pages** (simplest; the page is rendered per request):

```tsx
import {
  filterPersonalizedBlocks,
  getActiveAudience,
} from "payload-plugin-utm/next";

const audience = await getActiveAudience();
const blocks = filterPersonalizedBlocks(page.layout, audience);
```

**Static pages**: `createPersonalizationMiddleware({ rewrite: { prefix: 'utm-audience' } })` rewrites `/menu?utm_source=…` to `/utm-audience/<key>/menu`, so each audience variant is cached like any static page. Add a route such as `app/(site)/utm-audience/[audience]/[[...slug]]/page.tsx` that renders the same page with `filterPersonalizedBlocks(page.layout, audienceFromParam(params.audience))`, and emit the public URL as canonical. Visitors without an audience keep the normal route; direct visits to the prefix are redirected (308). In this mode, query with `depth ≥ 1` so audiences are populated with their `key`.

**Pages written in code** (no Payload blocks): keep audiences and their content in Payload and mark what changes with `<Personalized>`, a Server Component from `payload-plugin-utm/react`:

```tsx
import { Personalized } from "payload-plugin-utm/react";
import { getAudienceContent } from "payload-plugin-utm";
import { getActiveAudience } from "payload-plugin-utm/next";

<Personalized only="coudac" fallback={<DefaultBadge />}>
  <ReferralBadge />
</Personalized>;

// Text and image from the audience's Content tab, edited in the admin:
const content = await getAudienceContent(payload, await getActiveAudience());
```

`only` and `except` take one key or a list. Without an `audience` prop it reads the middleware headers (dynamic rendering); in static mode pass `audience={audienceFromParam(params.audience)}` (or `null` on the default route) so the page stays static. New partners then need an audience in the admin, not a deployment, as long as the component targets them (`only={['coudac', 'lafabriquedunet']}`, or render `content.displayName` for any audience).

**Only vary the pages that change.** Tell the plugin your public paths and the manifest lists, per audience, the pages with content for it; the middleware then rewrites only those, and every other page stays one shared cached version:

```ts
personalization: {
  blocks: ['hero'],
  paths: { collections: { pages: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`) } },
}
```

With localization enabled, the resolver is called once per locale with `{ doc, locale }` and the document read in that locale, so a variant that exists only in French lists only the French path: `({ doc, locale }) => \`${locale === 'fr' ? '/fr' : ''}/${doc.slug}\``.

**Code mode, or extra pages:** fill an audience's **Pages it changes** (`/`, `/fr`…) in the admin. Those paths are added to the manifest (to the ones found in blocks, if any), so only these pages get a variant, without code. An audience with no pages and no personalized block keeps every page varied.

Every collection or global that uses a personalized block needs a resolver (startup error otherwise). If the scan fails or exceeds `paths.limit` (2000 documents per collection), the manifest omits paths and every page is rewritten, so variants are never lost.

**Keeping static variants fresh.** Your pages' existing `revalidatePath('/menu')` hooks do not reach `/utm-audience/<key>/menu`. Call `revalidatePersonalizedRoutes()` (from `payload-plugin-utm/next`) next to them, and when audiences change:

```ts
import { revalidatePersonalizedRoutes } from "payload-plugin-utm/next";

utmPlugin({
  personalization: {
    blocks: ["hero"],
    afterAudienceChange: () => revalidatePersonalizedRoutes(),
  },
});
```

It invalidates every route under the prefix; variants are regenerated on their next visit. Errors thrown by `afterAudienceChange` (e.g. when a seed script runs outside Next.js) are logged and never fail the save.

### Preview and campaign links

- Each personalized campaign has an **Aperçu / Preview** panel: enter a page path and open it as that audience or as the default visitor. It uses `?utm_preview=<key>` (or `default`), which the middleware honours for that request only, without changing the visitor's cookie. Set `personalization.preview: { siteUrl: 'https://www.example.com' }` when the admin is on another origin, `preview.param` if you renamed `previewParam`, or `preview: false` to hide it. Anyone can use the parameter; it only shows content that is already public.
- The **Statistics** tab of a campaign shows, over 30 days, arrivals with its UTM values and, when it personalizes the site, the arrivals recognized as it, its visitors' page views and personalized views.

**Previewing drafts.** By default, preview links open the published page. To preview unsaved variants (Next.js draft mode), add one route to your app and point the admin at it:

```ts
// app/api/utm-preview/route.ts
import config from "@payload-config";
import { createDraftPreviewRoute } from "payload-plugin-utm/preview";

export const GET = createDraftPreviewRoute({ config });
```

```ts
personalization: {
  preview: {
    draftRoute: "/api/utm-preview";
  }
}
```

The route accepts only users signed in to Payload on that domain (otherwise 401), redirects only to same-site paths, enables draft mode and adds `?utm_preview=<key>`. Your pages read drafts when `(await draftMode()).isEnabled` (`draft: true` in `payload.find`), as in Payload's website template. If the admin runs on another host, set Payload's `auth.cookies.domain` to the parent domain so the site sees the session.

**Multilingual sites.** Audience _Display name_ and _Tagline_ are localized fields; pass the locale to `getAudienceContent(payload, audience, { locale })`.

### Editor experience

- **Personalization panel** in the sidebar of every collection or global that uses a personalized block: audiences used on the document with their block count, 👁 preview as each audience or as the default visitor (the page path is pre-filled from a `slug` field when there is one), and warnings for blocks restricted to no audience, to a deleted or archived audience, or to an ended campaign.
- **Create a variant in one click**, from the panel ("Personalize a block…") or from the _Create a variant for…_ menu inside each block: the block is duplicated right below it, the copy is shown **only** to the chosen audience and the original stops showing to it (it becomes "everyone except…", or the audience is added to/removed from its existing list). Edit the copy, then save as usual.
- **Live Preview as a campaign**: when the collection has Payload's `admin.livePreview`, a 🎯 menu in the Live Preview toolbar reloads the preview as the default visitor or as any personalizing campaign, and keeps that choice when you save or switch locale. It adds `?utm_preview=<key>` to your Live Preview URL, so point `livePreview.url` at the draft route (`/api/utm-preview?path=/…`) to see unsaved drafts.
- **Badges in block headers**: "🎯 Restaurant A", "Except Restaurant A" or "⚠ no audience", next to the block number, type and editable name. Blocks that already define `admin.components.Label` or `admin.components.Block` keep their own header.
- **Personalization view** at `/admin/personalization` (nav link 🎯 _Personalization_): every audience with its status (active, scheduled, ended, archived), the documents and number of blocks it changes, its UTM links and priority; a list of consistency checks (unused audiences, blocks targeting archived or deleted audiences, UTM links that do not trigger their audience); and a **URL simulator**: paste a campaign URL (and optionally a referring site) to see the audience it triggers and which personalized blocks each document shows or hides, with a preview link. The view reads documents through Payload's default `find` (no `draft` flag) with the signed-in user's permissions (first 200 documents per collection). Move it with `personalization.adminView: { path: '/campaigns' }` or remove it with `adminView: false`.

The view uses `DefaultTemplate` from `@payloadcms/next`, already installed in any app that serves the Payload admin with Next.js.

### Statistics

On with personalization (`stats: false` to opt out). **Put the tracker on every page** (root layout or page template), not only on personalized ones: arrivals on blog posts and other pages are what the dashboard and the detected campaigns are built from.

- **Dashboard** in the Personalization view (7, 30 or 90 days, each compared with the previous period): arrivals, page views, personalized views, conversions and conversion rate; arrivals per day with conversions; top campaigns (arrivals, conversions, rate) and top landing pages.
- **Setup check** at the top of the view: no view recorded, none recently, views from a single page (tracker on one template only), visitors arriving with a personalized campaign's UTM values but not recognized (middleware / proxy not running), personalized campaigns without _Pages it changes_.
- **Campaigns list**: status badges (_Personalizes_, _Link only_, _Scheduled_, _Ended_, _Archived_) and an _Arrivals (30 days)_ column (computed, not stored; add it from _Columns_ if your list already has saved columns).
- **Detected campaigns** above the list, with their most frequent landing page and two buttons: _Create the campaign_, or _Create and personalize /landing-page_ (personalization ticked, page filled).
- **Conversions**: call `trackConversion('Contact form submit')` (from `payload-plugin-utm/tracker`) when a lead form is sent or a call booked. Each conversion is attributed to the visitor's campaign and latest arrival, read server side from the source-memory cookie; the campaign's _Statistics_ tab and the dashboard show arrivals → conversions → rate.
- **GA4 (optional)**: `personalization.ga4: { propertyId: '123456789', credentials: { client_email, private_key } }` (a service account with _Viewer_ access on the property, or `getAccessToken: async () => token`) adds GA4 sessions and key events of the last 30 days to each campaign's _Statistics_ tab (Data API, read-only, cached 1 h, signed-in users only).

Also in the view:

- per audience: **entries** (first page of a visit), page views and **personalized views** (pages that showed content for that audience);
- per page: views by audience, split between the personalized and the default version;
- where entries come from: `utm_source` (with campaign) or the referring site, and the audience they got;
- **UTM used but not created in Payload**: `utm_source` / `utm_medium` / `utm_campaign` combinations seen on visits that match no saved UTM link (built by hand, by an ad platform or a partner), so you can create them and keep campaigns consistent.

Views are recorded by the tracker, so add it to your pages (or root layout; it follows client-side navigation):

```tsx
import { PersonalizationTracker } from "payload-plugin-utm/tracker";

<PersonalizationTracker
  audience={audience?.key ?? null}
  variant={pageHasVariant}
  stats
/>;
```

```tsx
"use client";
import { trackConversion } from "payload-plugin-utm/tracker";

<form onSubmit={() => trackConversion("Contact form submit")}>…</form>;
```

On pages that do not know the audience (static pages without a variant), omit `audience`: the endpoint resolves it from the `utm_memory` cookie sent with the beacon (`stats.cookieName` if you renamed it). `onView={(view) => track('Personalized view', view)}` calls your analytics from a Client Component.

Each view is one row (day, audience, path, version shown; source, medium and campaign on entries) in a hidden `utm-personalization-views` collection: no identifier, no IP, no user agent, no cookie. The endpoint (`POST /api/utm-links/stats`) only accepts active audience keys and bounded labels; restrict it with `stats.allowedOrigins`. Rows older than `stats.retentionDays` (180) are deleted; the view aggregates up to `stats.reportLimit` (50 000) rows. Counts are page views, not unique visitors, and miss visitors who block the request.

### Measurement, privacy, SEO

- `<PersonalizationTracker audience={key} />` (`payload-plugin-utm/tracker`) pushes `{ event: 'utm_personalization', utm_audience, utm_variant }` to `window.dataLayer` (`dataLayer={false}` to skip) and dispatches a `utm:personalization` window event, so any analytics tool can listen, e.g. Vercel Analytics:

  ```ts
  window.addEventListener("utm:personalization", (e) =>
    track("Personalized view", e.detail),
  );
  ```

- **Lead forms**: `<SourceMemoryFields />` (`payload-plugin-utm/react`) renders hidden inputs with the visitor's first, latest and audience-selecting arrival (`first_utm_source`, `first_referrer`, `latest_at`…), or use `sourceMemoryFields(await getSourceMemory())`. These values come from the visitor's URL: store them as text, never as HTML.
- The `utm_memory` cookie stores campaign parameters, referring domains and dates (no identifier, no IP). Personalization and attribution cookies usually require consent in the EU: use `consent: (request) => …` to read your consent cookie, or `cookie: false`. Without consent the memory is neither read nor written and only the landing request is personalized.
- **Cookie declaration.** The plugin does not integrate with any consent manager: declare the cookie in yours (Axeptio, Didomi, Cookiebot, FlowConsent…) and wire `consent` to its decision.

  | Name         | Purpose                                                                                                                           | Duration                           | Type                                                                   |
  | ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
  | `utm_memory` | Remembers the campaign or referring site a visitor arrived from, to keep showing the matching page version and to attribute leads | 90 days (`cookie.maxAgeSeconds`)   | First-party, `httpOnly`, `SameSite=Lax`; personalization / measurement |
  | `utm_visit`  | Same, for the current visit only (`cookie.lifetime: "visit"`, replaces `utm_memory`)                                              | Session (arrival valid 30 minutes) | First-party, `httpOnly`, `SameSite=Lax`; personalization / measurement |

  The statistics and the tracker set no cookie.

- Crawlers request URLs without UTM parameters and therefore index the default content.
- The manifest is public by default (it exposes keys and rule values, which already appear in your campaign URLs). Set `personalization.manifest.secret` (≥ 16 chars) to require a bearer token, and `manifest.tenantField` to serve one manifest per tenant via `?tenant=<id>`.

## Utilities without React or Payload

The `utilities` entry point has no runtime dependencies and can be used in scripts or other frameworks:

```ts
import { buildUtmUrl, buildUtmVariants } from "payload-plugin-utm/utilities";

const base = {
  destination: "https://example.com/article/?ref=menu#details",
  source: "instagram",
  medium: "social",
  campaign: "summer-launch",
};

buildUtmUrl(base);
// https://example.com/article/?ref=menu&utm_source=instagram&utm_medium=social&utm_campaign=summer-launch#details

buildUtmVariants(base, [
  { content: "bio" },
  { source: "newsletter", medium: "email", content: "button" },
]);
```

`buildUtmUrl` returns `null` for invalid/incomplete input. `buildUtmVariants` throws with the 1-based index of an invalid variant; it never writes to your database. `validateDestination`, `normalizeUtmValue`, `utmLinksToCsv` and `utmParameters` are also exported.

## Scope and compatibility

This is a **link-management plugin**, not an attribution platform. It does not record clicks, inject tracking scripts, proxy/shorten URLs, collect visitors, or retrieve GA4 statistics. The opt-in personalization module sets a first-party source-memory cookie only when you add its middleware. Direct campaign links work independently of Payload after you copy them. Whether a destination records UTM traffic depends on that site's analytics setup.

Works with Payload 3.92+ and Payload 4 (tested on 4.0.0-beta.9 with Next 16.4 and React 19.3): CI runs the full checks on Payload 3 (Node 22 and 24) and on the Payload 4 beta. On Payload 4, the plugin's own collections keep the 3.x schema (no versions, no `createdBy`/`updatedBy`) unless you enable them with `overrides`. A Postgres/Next.js consumer build is also verified during initial release validation; broader database/browser compatibility should be verified in your app before rollout. Use Payload and `@payloadcms/ui` versions that match each other.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm pack
```

**Demo app** (`dev/`, Payload + Next.js 16 + SQLite, French and English, drafts, statistics on): `pnpm build && pnpm dev`, then open `http://localhost:3000/admin` (seeded user `dev@example.com` / `test`, local demo only). It uses the built `dist/`, so rebuild after changing `src/`. Try `/?utm_source=coudac`, a visit with `Referer: https://coudac.com`, `/en`, the Personalization view and the 👁 preview links.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md) and [ROADMAP.md](ROADMAP.md). PRs improving accessibility, translations, adapters and test coverage are welcome.

Built by [BeBranded](https://github.com/BeBranded-xyz). Licensed under [MIT](LICENSE).
