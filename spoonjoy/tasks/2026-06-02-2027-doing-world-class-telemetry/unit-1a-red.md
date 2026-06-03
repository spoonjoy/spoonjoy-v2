# Unit 1a Red State

Command:

```bash
pnpm exec vitest run test/lib/analytics-server.test.ts
```

Result:

- Failed as expected on 2026-06-03.
- 7 new tests failed because `buildCaptureEventPayload` and `captureEvent` are not implemented/exported yet.
- 20 existing analytics-server tests still passed.

Representative failure:

```text
TypeError: buildCaptureEventPayload is not a function
TypeError: captureEvent is not a function
```
