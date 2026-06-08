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

## After initial cleanup

Dry-run counts after applying cleanup during the first pass:

| Item | Count |
| --- | ---: |
| active suspicious recipes | 0 |
| already deleted suspicious recipes | 34 |
| disposable users | 0 |
| disposable spoons | 0 |
| E2E OAuth clients | 0 |

The already-deleted recipes remain soft-deleted for app-level deletion semantics.

## Final pass

Later E2E runs created fresh disposable local residue. The local cleanup script was run again:

```bash
pnpm cleanup:qa
pnpm cleanup:qa -- --apply
pnpm cleanup:qa
```

Final local dry-run counts:

| Item | Count |
| --- | ---: |
| active suspicious recipes | 0 |
| already deleted suspicious recipes | 54 |
| disposable users | 0 |
| disposable spoons | 0 |
| E2E OAuth clients | 0 |

## Production check

Production remote D1 was checked separately before any mutation. Five old `codex-smoke-*` users each owned one already-soft-deleted smoke recipe with one inline SVG placeholder cover and no active recipes, spoons, cookbooks, credentials, OAuth rows, or passkeys. Those five disposable users, their five smoke recipes, five recipe steps, five ingredients, and five placeholder covers were hard-deleted.

Final production counters:

| Item | Count |
| --- | ---: |
| active suspicious recipes | 0 |
| any suspicious recipes | 0 |
| disposable users | 0 |
| disposable spoons | 0 |
| E2E OAuth clients | 0 |
| smoke placeholder covers | 0 |
