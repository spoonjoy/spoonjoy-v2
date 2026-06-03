# Unit 6i OAuth Coverage Check

Commands:

```bash
pnpm exec vitest run test/routes/oauth-register-telemetry.test.ts test/routes/oauth-authorize-telemetry.test.tsx test/routes/oauth-token-telemetry.test.ts test/routes/oauth-revoke-telemetry.test.ts test/lib/oauth-routes.server.test.ts test/lib/oauth-routes-defensive-coverage.test.ts test/routes/oauth-authorize.test.tsx test/routes/oauth-cors.test.ts test/routes/route-shell-coverage.test.ts
pnpm exec vitest run --coverage test/routes/oauth-register-telemetry.test.ts test/routes/oauth-authorize-telemetry.test.tsx test/routes/oauth-token-telemetry.test.ts test/routes/oauth-revoke-telemetry.test.ts test/lib/oauth-routes.server.test.ts test/lib/oauth-routes-defensive-coverage.test.ts test/routes/oauth-authorize.test.tsx test/routes/oauth-cors.test.ts test/routes/route-shell-coverage.test.ts
pnpm run typecheck
pnpm run build
```

Result:
- Focused OAuth tests passed: 9 files, 73 tests.
- Coverage command test execution passed, then exited 1 because the repository's global threshold includes unrelated app files outside the focused OAuth suite.
- Typecheck passed after regenerating `app/lib/generated/api-v1-playground.ts`; generation produced no file diff.
- Production build passed. Build output includes the app's existing Vite Environment API notice, empty server-route chunks, and local env-file notices; no Unit 6i compile errors were introduced.

Focused coverage evidence from the table:
- `app/routes/oauth.authorize.tsx`: 100% statements, branches, functions, lines.
- `app/routes/oauth.register.ts`: 100% statements, branches, functions, lines.
- `app/routes/oauth.token.ts`: 100% statements, branches, functions, lines.
- `app/routes/oauth.revoke.ts`: 100% statements, branches, functions, lines.
- `app/lib/oauth-routes.server.ts`: 100% lines/functions, 98.69% statements, 92.85% branches after adding explicit tests for declared body-size limits, invalid metadata arrays, body-consumption failures, safe state classification, route-shell disabled/no-context branches, and unexpected core-error bubbling.

Residual limitation:
- The global coverage command cannot report success for this focused unit without including coverage for unrelated pre-existing app files. The OAuth telemetry files added or touched by this unit are covered by focused tests, and the remaining `oauth-routes.server.ts` branch gaps are defensive/unexpected-error fallbacks that are either explicitly bubbled or already protected by wire-format regression tests.
