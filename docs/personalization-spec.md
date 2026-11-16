# Spec — UTM content personalization (v0.2)

Status: implemented on `feat/utm-personalization` as an **opt-in** module. Installing the plugin without the `personalization` option changes nothing.

## Goal

Let editors show a different block (hero, CTA, testimonials…) to visitors arriving from a given campaign, e.g. `utm_source=restaurant-a`, configured in the Payload admin, rendered by Next.js without client-side flicker and without losing static caching.

## Prior art reviewed

- **@focus-reactive/payload-plugin-ab (MIT, v2.10)**: page-level variants duplicated in the same collection, traffic percentages, a path-keyed *manifest* written by hooks to a storage adapter (Payload global or Vercel Edge Config), and Next.js middleware that rewrites to the variant with sticky cookies. Built for random split testing, not rules.
- **Croct**: hosted audiences + slots. Fits the need but is paid per MAU and external.
- **Vercel flags "precompute" pattern**: middleware encodes the decision in a path segment so each combination stays statically cacheable.

Kept from FocusReactive: the manifest read by middleware (no database round trip per page), sticky cookie, rewrite. Changed: rules instead of percentages, **block-level** visibility instead of duplicated pages, reusable **audiences**.

## Model

### Audiences collection (`utm-audiences`)

| Field | Notes |
| --- | --- |
| `title` | Editor label ("Visitors from Restaurant A") |
| `key` | Unique, `^[a-z0-9][a-z0-9-]{0,63}$`, `default` reserved. Used in cookie, header and rewrite path |
| `match` | `all` (AND) or `any` (OR) |
| `conditions[]` | `parameter` (utm_source, utm_medium, utm_campaign, utm_id, utm_content, utm_term or `custom` + `customParameter`), `operator` (`equals`, `notEquals`, `in`, `contains`, `startsWith`, `exists`), `value` |
| `priority` | Lower wins when several audiences match |
| `state` | `active` / `archived`; only active audiences are published in the manifest |

Comparisons trim values and ignore case. `in` takes a comma-separated list.

### Block visibility

`personalization: { blocks: ['hero', 'cta'] }` (or `'all'`) adds a `personalization` group to those blocks wherever they are used (collections, globals, nested fields, `config.blocks` references):

- `mode`: `all` (default), `only` (shown only to the selected audiences), `except` (hidden from them)
- `audiences`: relationship to `utm-audiences`

Editors place "Hero Restaurant A" (`only` → restaurant-a) next to the default hero (`except` → restaurant-a). No field duplication, works with any block shape. `personalizationField()` is exported for arrays or custom places.

## Runtime

1. **Manifest** — `GET /api/utm-audiences/manifest` returns `{ version: 1, audiences: [{ id, key, priority, match, conditions }] }` for active audiences. Optional bearer `secret`; optional `tenantField` lets the middleware request `?tenant=<id>`. No other query filters (the endpoint bypasses access control, so arbitrary `where` would be an oracle on private fields).
2. **Middleware** — `createPersonalizationMiddleware()` from `payload-plugin-utm/next`, edge-safe:
   - loads the manifest (in-memory TTL cache, 60 s; serves stale data or no personalization on error — never breaks the site);
   - if the URL carries any `utm_*` or referenced custom parameter → evaluates audiences (**last touch**); otherwise reuses the cookie if its key still exists in the manifest;
   - forwards `x-utm-audience` / `x-utm-audience-id` request headers (incoming copies are stripped);
   - sets / clears the cookie (`utm_audience`, 30 days, httpOnly, SameSite=Lax) unless `cookie: false` or `consent()` returns false;
   - optional `rewrite: { prefix: '/utm-audience' }` → `/utm-audience/<key>/<path>` so each audience variant is a cacheable static route; direct hits on the prefix are redirected to the public path.
3. **Rendering** — `getActiveAudience()` (dynamic mode, reads the header) or the `[audience]` route param (rewrite mode), then `filterPersonalizedBlocks(blocks, audience)`.
4. **Measurement** — optional `<PersonalizationTracker audience=… />` (`payload-plugin-utm/tracker`) pushes one `utm_personalization` event to `window.dataLayer`.

## Security & privacy

- Only keys present in the manifest ever reach a header, cookie or rewrite path: no raw visitor input in routing, so no cache poisoning or unbounded variants.
- The cookie stores only an audience key. Depending on jurisdiction it may need consent: `consent(request)` gate and `cookie: false` (landing-page-only personalization) are provided.
- Search engines crawl URLs without UTM → default content. Rewritten variant routes should emit the public canonical.

## Added before release

- Next.js 16 `proxy.ts` (Node.js runtime; the module-level manifest cache then persists across requests).
- `afterAudienceChange` hook + `revalidatePersonalizedRoutes()` (revalidates the rewrite prefix as a layout).
- Preview: `?utm_preview=<key|default>` forces an audience for one request without touching the cookie; admin panel with path input, example campaign parameters and a link to the targeting UTM links.
- UTM links: optional `audience` relationship and a sidebar check that resolves the link's parameters against active audiences (priorities included) via the authenticated REST API, so it works even when the manifest is secret.

## Editor experience (inspired by FocusReactive's in-editor Variants panel and admin dashboard)

- **Campaign dates**: optional `startsAt` / `endsAt` on audiences, published in the manifest. `resolveAudience` and `findAudience` skip audiences outside their window (end exclusive), so an ended campaign stops for remembered visitors too; staleness is bounded by the middleware cache TTL.
- **Sidebar panel** (`ui` field `utmPersonalizationPanel`) injected into every collection/global whose fields contain a targeted block (also through tabs, groups, arrays and nested blocks). It reads the live form state, so it reflects unsaved edits.
- **One-click variants**: `DUPLICATE_ROW` on the block's parent field, then `UPDATE` of both personalization groups (and the copy's `blockName`). The split is the pure `variantPersonalization()`: everyone → except [A]; except […] → except […, A]; only […, A] → only […]. IDs keep the database type (numbers on SQL adapters).
- **Block header badge**: a `Label` component that re-renders Payload's default header (number, block pill, editable `blockName`) plus an audience pill. Never applied to blocks that customize `Label` or `Block`.
- **Admin view** (`payload-plugin-utm/rsc#PersonalizationView`, wrapped in `DefaultTemplate`): local API with `overrideAccess: false` and the request user; default `find` (no `draft` flag), `select` limited to the top-level fields that can hold personalized blocks, 200 documents per collection. Pure helpers `collectPersonalizedBlocks`, `summarizeDocument`, `consistencyAlerts` and `simulateCampaignUrl` hold the logic and are unit-tested.

## Provenance (added before release)

Origin of the need: on the BeBranded site, the first referring site (coudac.com, 323 sessions over 180 days) arrives **without UTM** (`coudac.com / referral` in GA4). URL parameters alone cannot target it.

- **Referring site condition**: `$referrer` parameter in the manifest; the admin stores `referrer`. Domains are normalized (scheme, `www.`, port, path removed) and match subdomains.
- **Source memory cookie** `utm_memory` (JSON, ≤ 12 tracked params of ≤ 200 chars, referring host, epoch seconds): `f` first arrival, `l` latest arrival, `s` arrival that selected the audience. An *arrival* is a request with tracked parameters (UTM + custom parameters used by rules) or an external referrer; same-site referrers and direct visits are not. Rule: the audience is re-resolved from `s` on each request; a new arrival replaces `s` only when it matches an audience (sticky). Expiry 90 days from `s.t`. The cookie is written only on arrivals (no Set-Cookie on internal navigation, so CDN caching is preserved), forwarded to Server Components via `x-utm-source-memory`. Without consent: neither read nor written.
- **No UTM propagation** in internal links: GA4 treats internal UTM clicks as new campaign sessions.
- **Audience content**: `content` group (displayName, tagline, optional image, extra fields) and `{{audience.<field>|fallback}}` tokens filled by `fillAudienceTokens()` over any block data, Lexical JSON included. Raw URL values are never rendered (abuse, unbounded cache variants).
- **Targeted rewrite**: with `personalization.paths`, the manifest scans configured collections/globals, collects personalized blocks (`mode` ≠ all) and lists public paths per audience. The middleware rewrites only listed paths. Any scan failure or overflow omits `paths` → rewrite everything (never lose a variant). Startup error when a personalized collection has no resolver.
- **From a UTM link**: "Personalize the site for this link" creates an audience (`utm_source` + `utm_campaign` [+ `utm_content`] equals) with a slug key (suffixed on conflict) and attaches it.

## Composition and code mode (added before release)

Found on the BeBranded site: pages are hand-written React components (no Payload blocks yet) and `proxy.ts` already rewrites every request (internal `/en` locale segment, hosts, Markdown). A middleware that returns its own response cannot be nested there.

- **`createPersonalizationResolver(options)`** (same options as the middleware) returns a decision, not a response: `audience`, `requestHeaders` (spoofed copies stripped), `redirect` (direct prefix hit), `variant` / `variantPath(path)` (static segment, only for targeted public paths), `cookie` and `apply(response)`. `createPersonalizationMiddleware` is built on it, so both behave identically.
- **`<Personalized only|except audience? fallback?>`** (`payload-plugin-utm/react`): async Server Component; reads the middleware headers when `audience` is omitted, or takes the static route param. The pure rule is `matchesAudienceKeys`. Content still comes from the audience (`getAudienceContent`), never from the URL.

## Beta readiness

- **Locales**: `content.displayName` / `content.tagline` are localized; the paths scan reads every locale with the configured fallback (as pages render it) and calls the resolver with `{ doc, locale }`.
- **Draft preview**: `createDraftPreviewRoute({ config })` (`payload-plugin-utm/preview`) authenticates the Payload user from the request cookies, accepts only same-site paths and valid keys, enables draft mode, redirects with `?utm_preview=`. Admin links use `preview.draftRoute` when set.
- **Statistics** (`personalization.stats`, off by default): `<PersonalizationTracker stats />` posts a `text/plain` beacon (no preflight) per page view; the audiences collection's `POST /stats` endpoint validates it (active keys only, bounded labels, optional origin allowlist, 2 KB body) and stores one row without identifier in a hidden collection (`create` denied to the API). Entry = first view of a page load with no same-site referrer; source = `utm_source`, else referring domain. Retention purge amortized (1 % of writes). The admin view aggregates up to `reportLimit` rows in memory (`summarizeViews`), and `unregisteredCampaigns` compares UTM entries with saved links (case-insensitive; missing medium/campaign in traffic match any).
- **Consent**: no CMP integration by design; the README declares `utm_memory` for site owners' consent managers.

## 0.2.0-beta.1 (BeBranded site integration)

- `pages` (text, hasMany, validated public paths) on audiences: normalized and merged with scanned block paths in the manifest; alone, they make `paths` present so only those pages are rewritten.
- `rewrite.localePrefixes`: `/<locale>/<prefix>/<key>/rest` redirects to `/<locale>/rest`.
- `content.linkLabel` (localized) and `content.linkUrl` (`isSafeAudienceLink`: same-site path or http(s) URL).
- `domainMatches`: `name.*` matches `(^|.)name(.(co|com|org|net|ac|gov|edu))?.tld`.
- Manifest: one in-flight refresh per URL; expired entries are returned immediately (stale-while-revalidate); first load still awaits.
- Stats: `audience: "auto"` resolved server-side with `updateSourceMemory` over the active rules (cached 60 s) and the `utm_memory` cookie; never counted as personalized. `auto` joins `default` as a reserved key.
- Tracker: optional `audience` (`auto` when omitted), `onView(detail)`.

## 0.2.0-beta.3

- `buildAudienceManifest(payload, options?)`: the endpoint's logic as a function (fixed projection, manual pages, block paths); settings (`audiencesSlug`, `limit`, `paths`) stored on `config.custom.utmPersonalizationManifest`. Measured on the BeBranded site (`next start`): first request after start 0.57 s including render, then ~10 ms; the build bundles Payload into the Node.js proxy.

## 0.2.0-beta.4: campaigns

- No audiences collection: the links collection (labelled *UTM campaigns*) is wrapped in tabs (Link / Personalize the site / Statistics); title and sidebar fields stay outside. `campaignPersonalization()` reuses the audience field definitions (key, pages, content renamed `audienceContent`, dates, priority, advanced `match` + `conditions`), shown only when `personalize` is checked.
- Rule derivation (`audienceDocToRule` on a doc with `source`): groups = [UTM equals (source, medium and campaign when set)], one group per referring domain, advanced rules (one group if `all`, one per condition if `any`). `audienceMatches` evaluates OR of ANDs when `groups` is present; `conditions` keeps the flat list for tracked parameters.
- Key: generated in `beforeValidate` from `source[-campaign]` when personalization is on and the key is empty, suffixed `-2…` on conflict.
- Manifest, stats endpoint and `getAudienceContent` filter `personalize = true`.
- Detection (`DetectedCampaigns`, `beforeList`): entries of the last 30 days; `unregisteredCampaigns` (a campaign without medium/campaign covers all of them) and `unregisteredReferrers` (search engines and known referring domains left out); creation through the authenticated REST API, then redirect to the new campaign.

## 0.2.0-beta.5: analytics

- Conversions: `{ type: "conversion", name }` beacons stored as rows with `conversion` (indexed), `entry: false`; audience resolved like `auto`, source / medium / campaign from the memory's latest arrival (`conversionSource`). Never counted as page views (`summarizeViews` skips them).
- Dashboard (`buildDashboard`): current and previous period read in one query; days filled; campaigns grouped by audience, else `source / medium / campaign`; landing pages from entries.
- Setup check (`installChecks`): no views; last view ≥ 3 days; ≥ 20 views from one path; ≥ 3 entries with a personalized campaign's `utm_source` recorded as default while no entry was recognized; personalized campaigns without pages.
- List: `arrivals30d` virtual number field with a client Cell (one count request per row), `personalize` Cell with badges.
- GA4: `ga4.ts`, RS256 JWT with `node:crypto`, `runReport` with exact case-insensitive filters on sessionSource / sessionMedium / sessionCampaignName, metrics sessions + keyEvents, 30 days, memory cache 1 h; `GET /api/<campaigns>/ga4` (authenticated).

## Out of scope (next)

Geo / language conditions; Edge Config adapter; percentage A/B within an audience.
