# Changelog

## 0.2.0 — unreleased

Opt-in content personalization by campaign audience: `utm-audiences` collection (rules on UTM or custom URL parameters, priorities), block-level visibility (`personalization.blocks`), a public or secret-protected audience manifest, Next.js middleware (`payload-plugin-utm/next`) with last-touch cookie, consent gate and static rewrite mode, `filterPersonalizedBlocks`, and a `dataLayer` tracker. Also: Next.js 16 `proxy.ts` support, `revalidatePersonalizedRoutes()` and `afterAudienceChange` for static variants, admin preview (`?utm_preview=`), an optional audience on UTM links with a live match check, campaign dates on audiences, and the editor experience: Personalization sidebar panel, one-click block variants, audience badges in block headers, and a Personalization admin view with consistency checks and a URL simulator (`payload-plugin-utm/rsc`, optional peer `@payloadcms/next`). Nothing changes for installs that do not pass `personalization`. Design notes: `docs/personalization-spec.md`.

Provenance: referring-site conditions (domains, subdomains included), a `utm_memory` source-memory cookie (first, latest and audience-selecting arrival, 90 days, re-evaluated on every request, sticky until another audience replaces it; written only on arrivals), `getSourceMemory()`, audience content fields with `{{audience.field|fallback}}` tokens (`fillAudienceTokens`, `getAudienceContent`), per-audience page paths in the manifest so static mode only rewrites pages that change (`personalization.paths`), "Personalize the site for this link" from a UTM link, and a referrer input in the URL simulator.

## 0.1.0 — 2026-11-02

Initial community release: Payload collection plugin, live generation/copy, EN/FR controls, optional presets and related content, searchable inventory and archiving, URL policy options, permission-aware bounded CSV export, and dependency-free helpers for campaign variants.

Includes tests for encoding, validation, server recomputation, access control, multi-tenant composition and CSV injection protections. No automatic analytics or visitor tracking.
