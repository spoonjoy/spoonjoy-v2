Unit 3e red evidence

- Added API v1 mutation/validation telemetry tests for:
  - shopping-list item create, check, and delete
  - token list, create, and revoke
  - idempotency replay, conflict, and in-progress outcomes
  - malformed JSON and missing shopping item not-found errors
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts` failed as expected: 4 failed, 7 passed.
- Success-path failures show existing lifecycle events lack controlled `operation` and idempotency metadata.
- Error-path failures show validation/not-found branches do not yet emit request lifecycle telemetry.
- Privacy assertions cover shopping item names, unit names, token names, returned token secrets, token prefixes, raw clientMutationId values, raw JSON bodies, query/referrer secrets, and actual path ids.
