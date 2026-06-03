Unit 3g red evidence

- Added API v1 rate-limit/error telemetry tests for:
  - token rate-limit denial before auth
  - authentication required
  - invalid token
  - insufficient scope with a known bearer principal
  - method not allowed
  - unknown path with generic route template
  - internal error lifecycle telemetry without stack/message leakage
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts` failed as expected: 3 failed, 11 passed.
- Failures show:
  - rate-limited responses emit no lifecycle telemetry yet
  - insufficient-scope telemetry does not preserve known bearer principal metadata
  - internal-error responses emit no lifecycle telemetry yet
- Privacy assertions cover bearer tokens, token prefixes, token names, IP addresses, arbitrary unknown path text, raw Authorization text, cookie text, stack traces, and exception messages.
