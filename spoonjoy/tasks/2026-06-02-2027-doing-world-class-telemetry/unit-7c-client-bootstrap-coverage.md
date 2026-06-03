# Unit 7c Client PostHog Bootstrap Coverage

Command:

```bash
pnpm exec vitest run --coverage test/lib/analytics.test.ts test/entry-client-analytics.test.tsx
```

Result:
- Focused tests passed: 2 files, 10 tests.
- Coverage command exited 1 because the repository's global threshold includes unrelated app files outside the focused client bootstrap suite.

Focused coverage evidence from the table:
- `app/lib/analytics.ts`: 100% statements, branches, functions, and lines.

Notes:
- `app/entry.client.tsx` is validated by `test/entry-client-analytics.test.tsx` through import-time mocks for `posthog-js`, `@posthog/react`, `react-router/dom`, and `hydrateRoot`.
- `app/entry.client.tsx` is not included in the repository's current Vitest coverage include set (`app/lib`, `app/routes`, `app/components`, `app/hooks`), so the focused coverage table does not assign a per-file percentage to it.
- No refactor was needed. The existing bootstrap remains gated by `VITE_POSTHOG_KEY`, kill-switchable via `VITE_POSTHOG_DISABLED`, host-configurable, manual-pageview-only, exception-capture-enabled only when initialized, and session-recording masked.
