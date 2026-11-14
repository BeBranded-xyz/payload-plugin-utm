# Changelog

## 0.2.0 — unreleased

Opt-in content personalization by campaign audience: `utm-audiences` collection (rules on UTM or custom URL parameters, priorities), block-level visibility (`personalization.blocks`), a public or secret-protected audience manifest, Next.js middleware (`payload-plugin-utm/next`) with last-touch cookie, consent gate and static rewrite mode, `filterPersonalizedBlocks`, and a `dataLayer` tracker. Nothing changes for installs that do not pass `personalization`. Design notes: `docs/personalization-spec.md`.

## 0.1.0 — 2026-11-02

Initial community release: Payload collection plugin, live generation/copy, EN/FR controls, optional presets and related content, searchable inventory and archiving, URL policy options, permission-aware bounded CSV export, and dependency-free helpers for campaign variants.

Includes tests for encoding, validation, server recomputation, access control, multi-tenant composition and CSV injection protections. No automatic analytics or visitor tracking.
