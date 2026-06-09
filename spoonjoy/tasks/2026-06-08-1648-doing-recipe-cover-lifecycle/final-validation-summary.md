# Final Validation Summary: Recipe Cover Lifecycle

Date: 2026-06-09

## Post-Fix Bug Found By Browser Smoke

The final browser smoke found one real issue after the main implementation: when local editorial generation failed, a cover that still had a raw chef photo was shown as unavailable. That violated the product decision that editorialized generation is optional and uploaded/verbatim chef photos remain valid covers.

Fix:
- `app/lib/recipe-cover.server.ts` now allows activation of a ready cover's available original image even if `generationStatus="failed"`.
- `app/components/recipe/RecipeCoverHistory.tsx` labels that state as `Editorial failed` and keeps the original chef-photo variant selectable.
- Regression tests were added in `test/lib/recipe-cover.server.test.ts` and `test/components/recipe/RecipeCoverHistory.test.tsx`.

## Final Green Evidence

- Canonical tracked evidence: `final-validation-evidence.md`.
- Raw command logs were saved locally as ignored `.log` artifacts; the tracked evidence file contains the durable command, exit-code, timestamp, and key pass-line record.

- `pnpm exec vitest --run test/components/recipe/RecipeCoverHistory.test.tsx test/routes/recipes-id.test.tsx`
  - Evidence: `final-validation-evidence.md`
  - Result: 108/108 focused history-loader tests passed after the archived-row invariant fix.
- `pnpm run test:coverage`
  - Evidence: `final-validation-evidence.md`
  - Result: 296 files passed, 5815 tests passed, 100% statements/branches/functions/lines.
- `pnpm run test:e2e`
  - Evidence: `final-validation-evidence.md`
  - Result: 59/59 Playwright tests passed after a full rerun, including uploaded EXIF-oriented recipe photos remaining upright.
- Browser smoke
  - Screenshots: `browser-smoke/01-awaiting-first-chef-photo.png` through `browser-smoke/06-verbatim-cover-reselected.png`
  - Result: verified no-photo placeholder, first text-only chef cook leaves placeholder, first chef photo auto-seeds cover with upload progress and disabled submit, later chef photo explicit opt-in, cover history, manual no-cover, and verbatim chef-photo reselect.
- `pnpm run deploy:preflight`
  - Evidence: `final-validation-evidence.md`
  - Result: passed; remote D1 migrations up to date.
- `pnpm exec vitest --run test/lib/mcp/spoonjoy-tools.server.test.ts test/lib/spoonjoy-api-spoons.test.ts`
  - Evidence: `final-validation-evidence.md`
  - Result: 132/132 tests passed.
- `pnpm run build`
  - Evidence: `final-validation-evidence.md`
  - Result: production client and server builds passed.

## Cleanup Evidence

- `final-validation-evidence.md`: 0 active suspicious recipes, 0 disposable users, 0 disposable spoons, 0 e2e OAuth clients after the final post-validation cleanup.

## Provider/Operational Notes

- Remote D1 migration `0018_recipe_cover_lifecycle.sql` has been applied.
- Deploy preflight confirms image provider fallback documentation and Gemini setup documentation are present.
- In local no-provider/editorial-failure mode, raw chef photos remain usable and clearly marked separately from editorialized output.
