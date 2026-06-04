# Unit 4a Red Evidence

Command:

```bash
pnpm exec vitest run test/routes/api.test.ts test/routes/route-shell-coverage.test.ts
```

Result: failed as expected before legacy API lifecycle telemetry is implemented.

Summary:

- `test/routes/api.test.ts`: the safe legacy REST telemetry contract could not find a `spoonjoy.legacy_api.request` event for the public health success case.
- `test/routes/route-shell-coverage.test.ts`: unexpected legacy REST errors still capture exceptions, but do not yet capture the lifecycle `spoonjoy.legacy_api.request` event through `waitUntil`.

Failure shape:

```text
expected undefined to match object { event: "spoonjoy.legacy_api.request", ... }
expected "vi.fn()" to be called with arguments: [ ObjectContaining{...}, ... ]
```
