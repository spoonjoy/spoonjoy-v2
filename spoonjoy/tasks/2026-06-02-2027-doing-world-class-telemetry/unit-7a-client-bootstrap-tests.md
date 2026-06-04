# Unit 7a Client PostHog Bootstrap Tests

Command:

```bash
pnpm exec vitest run test/lib/analytics.test.ts test/entry-client-analytics.test.tsx
```

Result:
- Passed: 2 files, 10 tests.
- The new tests passed immediately against the existing implementation.

Coverage of the Unit 7a contract:
- Missing or blank `VITE_POSTHOG_KEY` skips `posthog.init`.
- Truthy `VITE_POSTHOG_DISABLED` skips `posthog.init`.
- Configured `VITE_POSTHOG_HOST` is trimmed and passed as `api_host`.
- PostHog initializes with manual pageviews (`capture_pageview: false`), page leave capture, exception capture, and masked session recording.
- The app still hydrates when PostHog initialization is skipped.
- `toAnalyticsPageUrl` keeps only origin and pathname, excluding query strings and hashes.

Red-test note:
- Unit 7a did not produce a red failure because `app/lib/analytics.ts` and `app/entry.client.tsx` already satisfy the requested bootstrap/privacy contract. Unit 7b should record the existing implementation as sufficient unless a later reviewer finds a gap.
