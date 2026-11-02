# Roadmap

These are proposals, not shipped features or commitments. Feedback and real use cases will guide priority.

## Next candidates

- **Campaign entities and shared conventions:** reusable campaign IDs, source/medium dictionaries, warnings about inconsistent spellings, and optional naming policies.
- **Bulk creation in the admin:** paste a list of destinations or select channel variants; preview every generated row before saving transactionally.
- **Filtered export from the list view:** export the exact current filters and selected tenant, with a visible row count and cap.
- **QR codes:** generate locally from saved campaign URLs, with downloads and no external tracking provider.
- **Accessibility and languages:** browser automation, keyboard-only testing, RTL and community translations.

## Optional integrations

- **GA4 adapter:** read-only reporting by campaign ID/source/medium, date ranges, cache controls, explicit property configuration and an honest distinction between attribution and raw clicks.
- **Short-link adapter:** optional, separate service with destination validation, expiration, abuse controls and privacy-aware counters. Direct links remain the default.
- **Import workflow:** validate CSV, show duplicates and row errors, preview before writes, preserve tenant access, and make retries safe.

## Quality work

- Matrix tests for additional supported Payload versions and database adapters.
- An isolated runnable demo and browser screenshots.
- npm trusted publishing once a maintainer connects the npm package.

We will not turn on visitor tracking, external analytics requests or data collection by installing the base plugin.
