# Unit 3a Red State

Command:

```bash
pnpm exec vitest run test/routes/api-v1-telemetry.test.ts
```

Result:

- Failed as expected on 2026-06-03.
- 3 new tests failed because API v1 public/discovery requests do not schedule `waitUntil` telemetry or call `captureEvent` yet.

Representative failures:

```text
expected waitUntil to be called with Promise; calls: 0
expected safe spoonjoy.api_v1.request event; received undefined
```
