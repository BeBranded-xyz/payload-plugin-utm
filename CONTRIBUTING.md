# Contributing

Open an issue describing the problem or proposal before a large change. For a fix, include a minimal reproduction, Payload/UI versions and database adapter. Do not include credentials, DSNs, private customer data or production exports.

Use Node 22+ and pnpm 10.28.0. Run `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm pack`. Add behavioral tests for URL manipulation, server hooks or authorization whenever those change. Keep the server, client and dependency-free utilities entry points separate.

Preserve public field names across minor releases. Schema changes need migration guidance; the consuming application owns its migrations. Keep analytics connectors and short-link services optional so a basic installation remains dependency-light.

Tests must not need a live database, paid service or secret. Browser/adapter integrations are welcome as optional test fixtures. Explain what you verified in each PR. By submitting a contribution, you agree to license it under the repository's MIT license.
