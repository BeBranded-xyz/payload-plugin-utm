# Payload UTM

Create campaign links where your content already lives: in Payload CMS.

Live URL generation, one-click copy, reusable source/medium presets, a searchable campaign inventory and permission-aware CSV exports. No analytics account, redirect service or external API required.

**New in 0.2 (opt-in):** personalize your pages for the visitors those links bring. A dedicated hero for `utm_source=restaurant-a`, more e-commerce case studies for visitors referred by a partner agency, a creator's name on the home page for their UGC campaign — configured block by block in the Payload admin, rendered by Next.js without flicker. See [Personalize pages from your links](#personalize-pages-from-your-links-opt-in).

**Community plugin · MIT · Payload 3.92+ · React 19 · Node 22+**

## Install

Version 0.1.0 is distributed as a built package in [GitHub Releases](https://github.com/BeBranded-xyz/payload-plugin-utm/releases). It is **not published to the npm registry yet**.

```sh
pnpm add https://github.com/BeBranded-xyz/payload-plugin-utm/releases/download/v0.1.0/payload-plugin-utm-0.1.0.tgz
```

Add the plugin to your existing Payload configuration:

```ts
import { buildConfig } from 'payload'
import { utmPlugin } from 'payload-plugin-utm'

export default buildConfig({
  // Keep your database, auth collection, editor and other app settings.
  plugins: [
    utmPlugin({
      presets: [
        { label: 'Newsletter', source: 'newsletter', medium: 'email' },
        { label: 'Instagram story', source: 'instagram', medium: 'social', content: 'story' },
      ],
    }),
  ],
})
```

Then run your normal `payload generate:importmap`, `payload generate:types` and database migration workflow. Generate migrations in **your application**: this plugin does not ship database-specific migrations.

## Use it

1. Open **Marketing → UTM links**.
2. Enter a name and a complete destination URL.
3. Fill in source, medium and campaign, or use a preset to fill source/medium.
4. Copy the URL immediately, then save it in your campaign inventory.
5. Search by campaign/source/medium, filter by status, or export saved links as CSV.

The three required parameters are `utm_source`, `utm_medium` and `utm_campaign`. Optional fields support `utm_id`, `utm_content` and `utm_term`. Existing non-UTM query parameters and fragments are preserved. Old UTM parameters, including duplicates and mixed-case keys, are replaced.

The server always recalculates the saved URL. API clients cannot substitute a forged `generatedUrl`; partial updates preserve existing campaign parameters.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Disable the plugin without changing the app config. |
| `collectionSlug` | `'utm-links'` | Rename the collection. A conflicting slug throws a startup error. |
| `relatedCollections` | none | Add an optional relationship to your content collections. It does not replace the destination URL. |
| `presets` | `[]` | Quick-fill buttons: `{ label, source, medium, content? }`. |
| `locale` | `'en'` | English or French text for custom controls. Field labels support both through Payload's admin language. |
| `allowedOrigins` | unrestricted | Optional exact origin allowlist, e.g. `['https://example.com']`. An empty list denies all destinations. No paths, wildcards or trailing slashes. |
| `normalization` | `'preserve'` | Preserve case, lowercase values, or produce ASCII slugs with `'slug'`. Trims outer whitespace in every mode. |
| `csvExport` | enabled, 1000 rows | `false` disables it. `{ maxRows: 5000 }` sets a cap between 1 and 10000. Oversized exports return HTTP 413 rather than silently truncating. |
| `overrides` | none | A function receiving and returning the generated `CollectionConfig`. Customize access, labels, fields, hooks and endpoints. Change the slug through `collectionSlug`. |

UTM values are case-sensitive in downstream tools. **No lowercasing happens by default.** Slug normalization removes non-ASCII characters; do not use it for campaigns whose names must retain non-Latin text. Required values that normalize to an empty string fail validation. Parameter values are limited to 512 characters; destination URLs to 8192.

### Multi-tenant apps

Install the UTM plugin **before** Payload's multi-tenant plugin so the latter can add its tenant field, access rules and filters:

```ts
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'

plugins: [
  utmPlugin({ relatedCollections: ['pages', 'posts'] }),
  multiTenantPlugin({
    collections: { 'utm-links': {} },
    // Keep your normal tenant configuration.
  }),
]
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
      delete: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
    },
  }),
})
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

**Quickest path:** open a saved UTM link → **Personalize the site for this link**. An audience matching its source and campaign is created and attached. Then, on a page, use *Create a variant for…* on a block and edit the copy.

### 1. Enable it

```ts
utmPlugin({
  personalization: {
    blocks: ['hero', 'cta'], // or 'all'
  },
})
```

This adds **Marketing → Campaign audiences** and a **Personalization** group to the listed blocks, wherever they are used (collections, globals, nested blocks, `config.blocks`).

- An **audience** has a unique `key`, conditions on `utm_source`, `utm_medium`, `utm_campaign`, `utm_id`, `utm_content`, `utm_term`, any other URL parameter or the **referring site** (`equals`, `is not`, `one of`, `contains`, `starts with`, `is present`), an all/any switch, a priority (lower wins) and optional **campaign dates** (`startsAt` / `endsAt`): outside that window the audience is ignored, including for visitors who already have it in memory. Comparisons ignore case and outer whitespace.
- **Referring site** conditions take a domain (`partner.com`, subdomains and `www.` included). Browsers usually send only the origin, which is enough. Some links send nothing (apps, `rel="noreferrer"`): for an important partner, combine *referring site is partner.com* **or** *utm_source is partner* with "any condition".
- **Audience content**: a display name, a tagline (and an image with `content: { imageCollection: 'media' }`, extra fields with `content.fields`). Write `{{audience.displayName|our clients}}` in any block text and render with `fillAudienceTokens(block, await getAudienceContent(payload, audience))`. Values always come from the CMS, never from the URL, so nobody can make your site display arbitrary text.
- A **block** is visible to *everyone* (default), *only these audiences* or *everyone except these audiences*. Typical page: the default hero set to "except Restaurant A" and a second hero set to "only Restaurant A".

`personalizationField()` is exported if you want the same control on array rows or custom places. Run `generate:importmap`, `generate:types` and your migrations as usual.

### 2. Add the middleware

Next.js 16 (`proxy.ts`, always on the Node.js runtime):

```ts
// proxy.ts
import { createPersonalizationMiddleware } from 'payload-plugin-utm/next'

export const proxy = createPersonalizationMiddleware()

export const config = { matcher: ['/((?!api|admin|_next|.*\\..*).*)'] }
```

Next.js 15: same code in `middleware.ts`, exported as `middleware` instead of `proxy`.

It reads the active audiences from `GET /api/utm-audiences/manifest` (cached 60 s in memory, 1.5 s timeout; on failure it serves the last rules or no personalization, never an error page). Only audiences that exist in the manifest are ever forwarded.

**Source memory.** On an *arrival* (tracked campaign parameters, or a referrer from another site) the middleware stores, in one `httpOnly` cookie (`utm_memory`, 90 days):

- the **first** and **latest** arrivals (parameters, referring domain, date), for attribution;
- the arrival that selected the current audience.

Rules are re-evaluated on every request, so audiences created or edited later still apply. **A remembered audience stays until another audience replaces it, or until it expires**: a visitor referred by a partner who comes back through Google or by typing your URL still gets the partner version; arriving through another campaign that has its own audience switches to it. Internal navigation is never an arrival and never sets a cookie, so cached pages stay cacheable. UTM parameters are never propagated in internal links (that would split GA4 sessions). Read the memory in a Server Component with `getSourceMemory()`, e.g. to attach the original campaign to a lead form.

Options: `manifestUrl` (absolute, for a separate CMS), `loadManifest` (Edge Config, KV, static JSON…), `secret` (paired with `personalization.manifest.secret`), `cacheTtlSeconds`, `cookie: false | { name, maxAgeSeconds }`, `consent: (request) => boolean`, `rewrite`, `previewParam` (default `utm_preview`, `false` to disable).

**Already have a proxy?** Sites that rewrite or redirect in `proxy.ts` (locale segment, several hosts, Markdown versions…) keep it and ask the plugin for a decision only. `createPersonalizationResolver()` takes the same options and returns the audience, the request headers to forward, the source-memory cookie and the static variant segment; your code builds the response:

```ts
// proxy.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createPersonalizationResolver } from 'payload-plugin-utm/next'

const personalize = createPersonalizationResolver({ rewrite: { prefix: 'utm-audience' } })

export async function proxy(request: NextRequest) {
  const decision = await personalize(request)
  if (decision.redirect) return NextResponse.redirect(decision.redirect, 308)
  const url = request.nextUrl.clone()
  url.pathname = decision.variantPath(`/en${url.pathname}`) // your own rewrite, then the audience segment
  return decision.apply(NextResponse.rewrite(url, { request: { headers: decision.requestHeaders } }))
}
```

`variantPath()` prefixes the path only when this public page has content for the audience (`decision.variant`); place the segment wherever your route tree expects it. `apply()` sets the cookie on the response you return; forward `requestHeaders` on every branch (`NextResponse.next({ request: { headers } })` included) or Server Components will not see the audience.

### 3. Render

**Dynamic pages** (simplest; the page is rendered per request):

```tsx
import { filterPersonalizedBlocks, getActiveAudience } from 'payload-plugin-utm/next'

const audience = await getActiveAudience()
const blocks = filterPersonalizedBlocks(page.layout, audience)
```

**Static pages**: `createPersonalizationMiddleware({ rewrite: { prefix: 'utm-audience' } })` rewrites `/menu?utm_source=…` to `/utm-audience/<key>/menu`, so each audience variant is cached like any static page. Add a route such as `app/(site)/utm-audience/[audience]/[[...slug]]/page.tsx` that renders the same page with `filterPersonalizedBlocks(page.layout, audienceFromParam(params.audience))`, and emit the public URL as canonical. Visitors without an audience keep the normal route; direct visits to the prefix are redirected (308). In this mode, query with `depth ≥ 1` so audiences are populated with their `key`.

**Pages written in code** (no Payload blocks): keep audiences and their content in Payload and mark what changes with `<Personalized>`, a Server Component from `payload-plugin-utm/react`:

```tsx
import { Personalized } from 'payload-plugin-utm/react'
import { getAudienceContent } from 'payload-plugin-utm'
import { getActiveAudience } from 'payload-plugin-utm/next'

<Personalized only="coudac" fallback={<DefaultBadge />}>
  <ReferralBadge />
</Personalized>

// Text and image from the audience's Content tab, edited in the admin:
const content = await getAudienceContent(payload, await getActiveAudience())
```

`only` and `except` take one key or a list. Without an `audience` prop it reads the middleware headers (dynamic rendering); in static mode pass `audience={audienceFromParam(params.audience)}` (or `null` on the default route) so the page stays static. New partners then need an audience in the admin, not a deployment, as long as the component targets them (`only={['coudac', 'lafabriquedunet']}`, or render `content.displayName` for any audience).

**Only vary the pages that change.** Tell the plugin your public paths and the manifest lists, per audience, the pages with content for it; the middleware then rewrites only those, and every other page stays one shared cached version:

```ts
personalization: {
  blocks: ['hero'],
  paths: { collections: { pages: ({ doc }) => (doc.slug === 'home' ? '/' : `/${doc.slug}`) } },
}
```

Every collection or global that uses a personalized block needs a resolver (startup error otherwise). If the scan fails or exceeds `paths.limit` (2000 documents per collection), the manifest omits paths and every page is rewritten, so variants are never lost.

**Keeping static variants fresh.** Your pages' existing `revalidatePath('/menu')` hooks do not reach `/utm-audience/<key>/menu`. Call `revalidatePersonalizedRoutes()` (from `payload-plugin-utm/next`) next to them, and when audiences change:

```ts
import { revalidatePersonalizedRoutes } from 'payload-plugin-utm/next'

utmPlugin({
  personalization: {
    blocks: ['hero'],
    afterAudienceChange: () => revalidatePersonalizedRoutes(),
  },
})
```

It invalidates every route under the prefix; variants are regenerated on their next visit. Errors thrown by `afterAudienceChange` (e.g. when a seed script runs outside Next.js) are logged and never fail the save.

### Preview and campaign links

- Each audience has an **Aperçu / Preview** panel: enter a page path and open it as that audience or as the default visitor. It uses `?utm_preview=<key>` (or `default`), which the middleware honours for that request only, without changing the visitor's cookie. Set `personalization.preview: { siteUrl: 'https://www.example.com' }` when the admin is on another origin, `preview.param` if you renamed `previewParam`, or `preview: false` to hide it. Anyone can use the parameter; it only shows content that is already public.
- The panel also suggests the campaign parameters that trigger the audience and links to the UTM links that target it.
- With personalization on, **UTM links** get an optional *Personalized audience* field. The sidebar tells editors which audience the link will actually trigger (priorities included) and warns when it does not trigger the selected one or when that audience is archived. When the link triggers no audience, **Personalize the site for this link** creates one from its source, campaign (and content) and attaches it; when it already triggers one, a button attaches it.

### Editor experience

- **Personalization panel** in the sidebar of every collection or global that uses a personalized block: audiences used on the document with their block count, 👁 preview as each audience or as the default visitor (the page path is pre-filled from a `slug` field when there is one), and warnings for blocks restricted to no audience, to a deleted or archived audience, or to an ended campaign.
- **Create a variant in one click**, from the panel ("Personalize a block…") or from the *Create a variant for…* menu inside each block: the block is duplicated right below it, the copy is shown **only** to the chosen audience and the original stops showing to it (it becomes "everyone except…", or the audience is added to/removed from its existing list). Edit the copy, then save as usual.
- **Badges in block headers**: "🎯 Restaurant A", "Except Restaurant A" or "⚠ no audience", next to the block number, type and editable name. Blocks that already define `admin.components.Label` or `admin.components.Block` keep their own header.
- **Personalization view** at `/admin/personalization` (nav link 🎯 *Personalization*): every audience with its status (active, scheduled, ended, archived), the documents and number of blocks it changes, its UTM links and priority; a list of consistency checks (unused audiences, blocks targeting archived or deleted audiences, UTM links that do not trigger their audience); and a **URL simulator**: paste a campaign URL (and optionally a referring site) to see the audience it triggers and which personalized blocks each document shows or hides, with a preview link. The view reads documents through Payload's default `find` (no `draft` flag) with the signed-in user's permissions (first 200 documents per collection). Move it with `personalization.adminView: { path: '/campaigns' }` or remove it with `adminView: false`.

The view uses `DefaultTemplate` from `@payloadcms/next`, already installed in any app that serves the Payload admin with Next.js.

### Measurement, privacy, SEO

- `<PersonalizationTracker audience={key} />` from `payload-plugin-utm/tracker` pushes `{ event: 'utm_personalization', utm_audience }` to `window.dataLayer`. Nothing else is sent anywhere.
- The `utm_memory` cookie stores campaign parameters, referring domains and dates (no identifier, no IP). Personalization and attribution cookies usually require consent in the EU: use `consent: (request) => …` to read your consent cookie, or `cookie: false`. Without consent the memory is neither read nor written and only the landing request is personalized.
- Crawlers request URLs without UTM parameters and therefore index the default content.
- The manifest is public by default (it exposes keys and rule values, which already appear in your campaign URLs). Set `personalization.manifest.secret` (≥ 16 chars) to require a bearer token, and `manifest.tenantField` to serve one manifest per tenant via `?tenant=<id>`.

## Utilities without React or Payload

The `utilities` entry point has no runtime dependencies and can be used in scripts or other frameworks:

```ts
import { buildUtmUrl, buildUtmVariants } from 'payload-plugin-utm/utilities'

const base = {
  destination: 'https://example.com/article/?ref=menu#details',
  source: 'instagram',
  medium: 'social',
  campaign: 'summer-launch',
}

buildUtmUrl(base)
// https://example.com/article/?ref=menu&utm_source=instagram&utm_medium=social&utm_campaign=summer-launch#details

buildUtmVariants(base, [
  { content: 'bio' },
  { source: 'newsletter', medium: 'email', content: 'button' },
])
```

`buildUtmUrl` returns `null` for invalid/incomplete input. `buildUtmVariants` throws with the 1-based index of an invalid variant; it never writes to your database. `validateDestination`, `normalizeUtmValue`, `utmLinksToCsv` and `utmParameters` are also exported.

## Scope and compatibility

This is a **link-management plugin**, not an attribution platform. It does not record clicks, inject tracking scripts, proxy/shorten URLs, collect visitors, or retrieve GA4 statistics. The opt-in personalization module sets a first-party source-memory cookie only when you add its middleware. Direct campaign links work independently of Payload after you copy them. Whether a destination records UTM traffic depends on that site's analytics setup.

Tested with Payload/UI 3.92.0 and React 19.2.6. CI tests the package on Node 22 and 24. A Postgres/Next.js consumer build is also verified during initial release validation; broader database/browser compatibility should be verified in your app before rollout. Use Payload and `@payloadcms/ui` versions that match each other.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm pack
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md) and [ROADMAP.md](ROADMAP.md). PRs improving accessibility, translations, adapters and test coverage are welcome.

Built by [BeBranded](https://github.com/BeBranded-xyz). Licensed under [MIT](LICENSE).
