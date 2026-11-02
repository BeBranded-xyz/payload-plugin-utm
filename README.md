# Payload UTM

Create campaign links where your content already lives: in Payload CMS.

Live URL generation, one-click copy, reusable source/medium presets, a searchable campaign inventory and permission-aware CSV exports. No analytics account, redirect service or external API required.

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

This is a **link-management plugin**, not an attribution platform. It does not record clicks, inject tracking scripts, proxy/shorten URLs, collect visitors, or retrieve GA4 statistics. Direct campaign links work independently of Payload after you copy them. Whether a destination records UTM traffic depends on that site's analytics setup.

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
