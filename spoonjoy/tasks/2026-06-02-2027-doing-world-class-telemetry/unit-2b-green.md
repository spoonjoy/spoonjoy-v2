# Unit 2b Green State

Commands:

```bash
pnpm exec vitest run test/routes/api-v1-shell.test.ts
pnpm run build
```

Results:

- `test/routes/api-v1-shell.test.ts`: 17 passed.
- `pnpm run build`: exited 0.
- API v1 route args now type `context.cloudflare.ctx.waitUntil`.
- `apiV1WaitUntilFor` returns a bound scheduler when present and `undefined` when Workers context is unavailable.
