# Graphic Fiction AI

Graphic Fiction AI is currently configured for **free beta / trial mode** on Cloudflare Workers.

## Current Cloudflare setup

- Workers AI is enabled through the `AI` binding in `wrangler.jsonc`.
- The production handler runs AI chat and design-assistant requests through Workers AI.
- Image generation/enhancement also uses the Workers AI binding.
- Trial mode is enabled in `src/production-handler.js` with user-facing beta notices.
- Cloudflare Artifacts is **not** required by the current application.
- The current beta architecture does not require adding a paid Artifacts dependency.

## Important

Cloudflare's free AI allowance is usage-based. The application should remain in beta mode while usage is monitored so that the project does not unexpectedly move into paid usage.

For production billing, subscriptions, and paid features, enable those separately rather than changing the beta AI configuration.

