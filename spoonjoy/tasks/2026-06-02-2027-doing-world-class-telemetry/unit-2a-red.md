# Unit 2a Red State

Commands:

```bash
pnpm run typecheck
pnpm exec vitest run test/routes/api-v1-shell.test.ts
```

Results:

- `pnpm run typecheck` exited 0 because this repo's typecheck does not include test files.
- The executable API v1 shell test failed as expected.
- 2 new tests failed because `apiV1WaitUntilFor` is not implemented/exported yet.
- 15 existing API v1 shell tests passed.

Representative failure:

```text
TypeError: apiV1WaitUntilFor is not a function
```
