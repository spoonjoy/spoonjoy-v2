# Unit 8d: PostHog Secret And Build Env Setup

## Checks Performed

Cloudflare secret names only:

```bash
pnpm exec wrangler secret list --format=json
```

Sanitized result:

- `POSTHOG_KEY`: missing
- `SESSION_SECRET`: present
- `VAPID_PUBLIC_KEY`: present
- `VAPID_PRIVATE_KEY`: present
- `VAPID_SUBJECT`: present

Local env files checked for variable names only:

- `.env.local`: `VITE_POSTHOG_KEY` missing, `POSTHOG_KEY` missing
- `.env`: `VITE_POSTHOG_KEY` missing, `POSTHOG_KEY` missing
- `.dev.vars`: absent

`wrangler.json` does not commit `POSTHOG_KEY` or `VITE_POSTHOG_KEY`, which is the correct secret posture.

## Outcome

The PostHog project key is not available in this workspace or in Cloudflare Worker secrets, so `wrangler secret put POSTHOG_KEY` could not be completed without inventing or exposing a secret value.

The deployment remains safe: telemetry is disabled by default when `POSTHOG_KEY` and `VITE_POSTHOG_KEY` are absent.

## Remaining External Setup

To enable capture:

1. Obtain the PostHog project API key from PostHog project settings.
2. Set Worker runtime telemetry with `wrangler secret put POSTHOG_KEY`.
3. Provide the same public project key to the environment running `pnpm run build` as `VITE_POSTHOG_KEY`.
4. Keep `POSTHOG_DISABLED` and `VITE_POSTHOG_DISABLED` unset or false-ish unless intentionally disabling telemetry.

No secret values were printed, committed, or written to artifacts.
