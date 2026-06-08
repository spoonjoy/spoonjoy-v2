# Local QA data cleanup

Date: 2026-06-08

Scope: local Miniflare D1 only. No remote D1 or production data was mutated.

## Command

```bash
pnpm cleanup:qa
pnpm cleanup:qa -- --apply
pnpm cleanup:qa
```

The cleanup script always invokes `wrangler d1 execute DB --local`.

## Before

Dry-run counts before applying cleanup:

| Item | Count |
| --- | ---: |
| active suspicious recipes | 13 |
| already deleted suspicious recipes | 5 |
| disposable users | 22 |
| disposable spoons | 12 |
| E2E OAuth clients | 20 |

Patterns included `codex-*`, `codex-smoke-*`, `e2e *`, `Mobile Dock Save *`, fork variation titles, e2e spoon notes, passkey test users, and `E2E OAuth Client` rows.

## After

Dry-run counts after applying cleanup and after the final full Playwright e2e run:

| Item | Count |
| --- | ---: |
| active suspicious recipes | 0 |
| already deleted suspicious recipes | 34 |
| disposable users | 0 |
| disposable spoons | 0 |
| E2E OAuth clients | 0 |

The 34 already-deleted recipes remain soft-deleted for app-level deletion semantics.
