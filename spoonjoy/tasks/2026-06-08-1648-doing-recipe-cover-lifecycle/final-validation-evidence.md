# Final Validation Evidence

Date: 2026-06-09

This file is the tracked evidence record for final validation. Raw command logs were also saved locally under this task artifact directory, but `*.log` is ignored by repo policy, so the durable proof lines are copied here.

## History Invariant Focused Tests

Command:
```bash
pnpm exec vitest --run test/components/recipe/RecipeCoverHistory.test.tsx test/routes/recipes-id.test.tsx
```

Completed: 2026-06-09 02:01 America/Los_Angeles
Exit code: 0

Key output:
```text
test/components/recipe/RecipeCoverHistory.test.tsx (3 tests)
test/routes/recipes-id.test.tsx (105 tests)
Test Files  2 passed (2)
Tests  108 passed (108)
```

Verified behavior:
- Cover history serializes `archivedAt` so the client can enforce server mutability rules.
- `status="ready"` rows with `archivedAt` are shown as archived and cannot be used, regenerated, or archived again.
- Unknown/non-ready statuses are labeled unavailable and cannot be activated.

## Strict Coverage

Command:
```bash
pnpm run test:coverage
```

Completed: 2026-06-09 01:54 America/Los_Angeles
Exit code: 0

Key output:
```text
Test Files  296 passed (296)
Tests  5815 passed (5815)
All files          |     100 |      100 |     100 |     100 |
```

## Playwright E2E

Command:
```bash
pnpm run test:e2e
```

Completed: 2026-06-09 01:58 America/Los_Angeles
Exit code: 0

Key output:
```text
[chromium] ... Recipe image handling ... uploaded EXIF-oriented recipe photos remain upright after save and reload
59 passed (24.9s)
```

Note: an immediately prior full e2e attempt had one transient auth URL-assertion timeout while already showing the expected `/recipes` page in the Playwright snapshot. The focused auth rerun passed `6/6`, and the subsequent full rerun passed `59/59`.

## Browser Smoke

Command:
```bash
node --input-type=module <browser smoke script>
```

Completed: 2026-06-09 01:50 America/Los_Angeles
Exit code: 0

Key output:
```text
[browser-smoke] screenshot 01-awaiting-first-chef-photo
[browser-smoke] screenshot 02-text-only-spoon-no-cover
[browser-smoke] screenshot 03-first-photo-auto-cover
[browser-smoke] screenshot 04-later-photo-opt-in-cover
[browser-smoke] screenshot 05-set-no-cover
[browser-smoke] screenshot 06-verbatim-cover-reselected
[browser-smoke] completed {}
```

Tracked artifacts:
- `browser-smoke/01-awaiting-first-chef-photo.png`
- `browser-smoke/02-text-only-spoon-no-cover.png`
- `browser-smoke/03-first-photo-auto-cover.png`
- `browser-smoke/04-later-photo-opt-in-cover.png`
- `browser-smoke/05-set-no-cover.png`
- `browser-smoke/06-verbatim-cover-reselected.png`
- `browser-smoke/browser-smoke-events.json`

Verified behavior:
- New no-photo owner recipe shows `Awaiting first chef photo` and no fake image fallback.
- Text-only first chef cook leaves the placeholder in place.
- First chef photo cook shows upload progress and disables the submit button while posting.
- First chef photo auto-seeds an active cover with provenance.
- Later chef photo requires explicit `Use this photo as recipe cover` opt-in.
- Owner can browse cover history and spoon photos.
- Owner can set no cover, then reselect a verbatim `Chef photo` original after editorial failure.

The browser smoke artifacts predate the final archived-row client guard by a few minutes. That guard is covered by the focused history tests above, strict coverage, and the full Playwright rerun.

## Deploy Preflight

Command:
```bash
pnpm run deploy:preflight
```

Completed: 2026-06-09 01:58 America/Los_Angeles
Exit code: 0

Key output:
```text
PASS image provider documentation: README/deployment docs must explain image provider fallback env and Gemini setup.
PASS remote D1 migrations: Remote D1 is up to date -- no pending migrations.
Deployment preflight passed.
```

## Targeted MCP And Spoon API

Command:
```bash
pnpm exec vitest --run test/lib/mcp/spoonjoy-tools.server.test.ts test/lib/spoonjoy-api-spoons.test.ts
```

Completed: 2026-06-09 01:58 America/Los_Angeles
Exit code: 0

Key output:
```text
test/lib/spoonjoy-api-spoons.test.ts (84 tests)
test/lib/mcp/spoonjoy-tools.server.test.ts (48 tests)
Test Files  2 passed (2)
Tests  132 passed (132)
```

## Production Build

Command:
```bash
pnpm run build
```

Completed: 2026-06-09 01:58 America/Los_Angeles
Exit code: 0

Key output:
```text
Generated app/lib/generated/api-v1-playground.ts
vite v7.3.1 building client environment for production...
built in 3.51s
vite v7.3.1 building ssr environment for production...
built in 4.28s
```

## Cleanup

Commands:
```bash
pnpm run cleanup:qa -- --apply
pnpm run cleanup:qa -- --dry-run
```

Completed: 2026-06-09 01:59 America/Los_Angeles
Exit code: 0

Key dry-run output:
```text
active suspicious recipes: 0
disposable users: 0
disposable spoons: 0
e2e oauth clients: 0
```
