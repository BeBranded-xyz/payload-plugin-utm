# Changelog

## 0.2.0 — unreleased (0.2.0-beta.4 on npm under the `beta` tag)

0.2.0-beta.4, one menu: **UTM campaigns** replace UTM links + campaign audiences. A campaign carries a *Personalize the site* tab (recognized by its UTM values, OR referring sites, OR advanced rules; generated `key`; pages; content as `audienceContent`; dates; priority) and a *Statistics* tab. Only `utm_source` is required; medium, campaign and destination are optional. **Detected campaigns, not created yet** above the list (UTM values and referring sites without a campaign, one-click creation). Statistics are on by default with personalization. Rules support OR groups (`groups` in the manifest). Breaking for earlier betas: no `utm-audiences` collection, `personalization.audiencesSlug` removed, endpoints moved to `/api/utm-links/manifest` and `/api/utm-links/stats`, `getAudienceContent` reads campaigns.

0.2.0-beta.3: `buildAudienceManifest(payload)` reads the manifest from the database (same output as the endpoint, plugin settings stored on `config.custom`), for proxies running in the same app as Payload: no HTTP round trip, no slow first request when an instance starts.

0.2.0-beta.2, security: request paths are normalized with a linear scan (the previous regexes could be slowed down by URLs with thousands of slashes, on every request through the middleware); audience token fallbacks are bounded; slug normalization and admin preview links hardened. No API change; upgrade from beta.1 recommended.

0.2.0-beta.1, from the BeBranded site integration: **Pages it changes** on audiences (code mode limits variants without blocks), `rewrite.localePrefixes` (variant segment behind a locale, direct hits redirected), built-in audience link (`linkLabel`, `linkUrl`), referring site `partner.*` on any extension, manifest served stale while it refreshes in the background, statistics resolve `auto` audiences from the source-memory cookie, tracker `onView` callback; `auto` is a reserved audience key.

Opt-in content personalization by campaign audience: `utm-audiences` collection (rules on UTM or custom URL parameters, priorities), block-level visibility (`personalization.blocks`), a public or secret-protected audience manifest, Next.js middleware (`payload-plugin-utm/next`) with last-touch cookie, consent gate and static rewrite mode, `filterPersonalizedBlocks`, and a `dataLayer` tracker. Also: Next.js 16 `proxy.ts` support, `revalidatePersonalizedRoutes()` and `afterAudienceChange` for static variants, admin preview (`?utm_preview=`), an optional audience on UTM links with a live match check, campaign dates on audiences, and the editor experience: Personalization sidebar panel, one-click block variants, audience badges in block headers, and a Personalization admin view with consistency checks and a URL simulator (`payload-plugin-utm/rsc`, optional peer `@payloadcms/next`). Nothing changes for installs that do not pass `personalization`. Design notes: `docs/personalization-spec.md`.

Provenance: referring-site conditions (domains, subdomains included), a `utm_memory` source-memory cookie (first, latest and audience-selecting arrival, 90 days, re-evaluated on every request, sticky until another audience replaces it; written only on arrivals), `getSourceMemory()`, audience content fields with `{{audience.field|fallback}}` tokens (`fillAudienceTokens`, `getAudienceContent`), per-audience page paths in the manifest so static mode only rewrites pages that change (`personalization.paths`), "Personalize the site for this link" from a UTM link, and a referrer input in the URL simulator.

Composition: `createPersonalizationResolver()` returns the decision (audience, headers, cookie, variant path) for sites that already have a proxy with their own rewrites; `createPersonalizationMiddleware()` is now a thin layer over it. Code mode: `<Personalized only/except>` Server Component (`payload-plugin-utm/react`) for pages written in React rather than Payload blocks.

Before the beta: localized audience content and per-locale page paths; draft previews (`createDraftPreviewRoute`, `preview.draftRoute`); opt-in anonymous statistics in the Personalization view (entries, views and personalized views per audience and page, entry sources) with detection of UTM used on the site but not created in Payload; `utm:personalization` window event and `utm_variant` in the dataLayer; `<SourceMemoryFields />` / `sourceMemoryFields()` for lead forms; cookie declaration in the README.

Found by the demo app (`dev/`): the memory cookie was URI-encoded twice (Next encodes cookie values; old cookies still read), the paths scan now follows the configured locale fallback like rendered pages, the draft preview route no longer imports `next/navigation` (unparsable in Turbopack route handlers), the tracker no longer counts a view twice under React Strict Mode nor records admin previews, and the editor panel no longer flags audiences as deleted while they load.

## 0.1.1 — 2026-11-14

Documentation only: the package is now on the npm registry; the README installs it with `pnpm add payload-plugin-utm` and mentions the `beta` tag. No code change.

## 0.1.0 — 2026-11-02

Initial community release: Payload collection plugin, live generation/copy, EN/FR controls, optional presets and related content, searchable inventory and archiving, URL policy options, permission-aware bounded CSV export, and dependency-free helpers for campaign variants.

Includes tests for encoding, validation, server recomputation, access control, multi-tenant composition and CSV injection protections. No automatic analytics or visitor tracking.
