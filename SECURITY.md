# Security

For vulnerabilities, use **GitHub → Security → Report a vulnerability** for this repository. Do not post credentials, auth cookies, private campaign data or exploit details in a public issue. If private reporting is unavailable, open an issue requesting a private contact without technical exploit details.

Version 0.1.x is the initial supported release line. Security fixes target its latest patch version.

The default collection requires authentication. CSV exports retain Payload's collection/field access checks and request context. Destination URLs are validated but never fetched by the server. There is no redirect endpoint. The optional origin allowlist controls which destinations may be saved; it does not provide network isolation for other code in your application.

An application's own hooks, access overrides and Local API calls with `overrideAccess: true` remain authoritative. Review these when integrating the plugin.
