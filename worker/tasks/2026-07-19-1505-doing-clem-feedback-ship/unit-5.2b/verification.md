# Unit 5.2b Verification

Verified 2026-07-23 09:10 PDT.

## Automated gates

- `git diff --check`: pass.
- Focused API, OpenAPI, route coverage, docs, shell, UI, and rejected-scope boundary suite: 8 files and 88 tests passed.
- Generated playground stability: pass; SHA-256 remained `5f32f79a72e63e720bb7a405bafea82eae882674f8225217214572556595409b` after regeneration.
- `pnpm run verify:clean:typecheck`: pass with zero warnings.
- `pnpm run verify:clean:build`: pass with zero warnings.

Fresh-eyes review found and fixed one retry bug before commit: a historical saved row attached to a soft-deleted recipe could make a failed `PUT` reservation appear recoverable and change the same-key retry from `404` to `200`. Save recovery now requires both the saved row and an active recipe; delete recovery still correctly proves desired-state absence without requiring the recipe to exist. The regression test failed at `200` before the fix and passes at stable `404` afterward.

## Visual QA

Surface: `/developers`, desktop 1440x1100 and mobile 390x844.

- [Desktop saved-recipe guide](./developers-saved-desktop.png): the new guide row is legible, aligned with adjacent rows, and its request sample does not clip or overflow.
- [Mobile saved-recipe guide](./developers-saved-mobile.png): heading, prose, paths, and JSON body wrap without horizontal overflow; the fixed bottom dock does not obscure the inspected row.
- Browser metrics: document width equaled viewport width at both sizes (`1440/1440`, `390/390`), HTTP status was 200, and the global error boundary was absent.

## Absurdity ledger

| Evidence/state | Observation | Disposition |
| --- | --- | --- |
| Initial local capture | The global error page appeared because the Cloudflare worker had `NODE_ENV=production` without a local `SESSION_SECRET` binding. | Fixed in the QA harness with a disposable `.dev.vars` binding; the file was removed after capture. No product change required. |
| First mobile target capture | The target was scrolled too low and the fixed dock covered the tail of the code block. | Fixed by centering the article and recapturing the final mobile evidence. |
| Final desktop and mobile captures | No clipping, overlap, incoherent spacing, unreadable wrapping, or stale capability copy found. | Accepted. |

The route change is documentation-only and visually follows the existing repeated guide-row pattern, so a separate visual-design reviewer was not required. The configured reviewer service was also unavailable because the account-level reviewer quota was exhausted; implementation review continues through the local adversarial and coverage gates in Unit 5.2c.
