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

## Out of scope (next)

Referrer / geo / language conditions; Edge Config adapter; percentage A/B within an audience.
