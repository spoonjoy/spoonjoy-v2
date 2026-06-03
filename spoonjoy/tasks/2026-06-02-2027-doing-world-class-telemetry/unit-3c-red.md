Unit 3c red evidence

- Added authenticated API v1 telemetry tests for:
  - session-authenticated `GET /api/v1/tokens`
  - personal bearer `GET /api/v1/shopping-list`
  - OAuth bearer `GET /api/v1/shopping-list/sync`
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts` failed as expected: 3 failed, 3 passed.
- All three failures were missing `spoonjoy.api_v1.request` capture inputs for the private authenticated read paths.
- Privacy assertions cover user email, username, session cookie, bearer token, token prefix, credential name, raw Authorization text, and query cursor text.
