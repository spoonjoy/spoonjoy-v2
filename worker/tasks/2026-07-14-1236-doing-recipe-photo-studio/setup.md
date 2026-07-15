# Unit 0 Setup/Research

## Worktrees
- Web/backend task worktree: `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio`
  - Branch: `worker/recipe-photo-studio`
  - Upstream: `origin/worker/recipe-photo-studio`
  - Status at setup: clean
- Native task worktree: `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio`
  - Branch: `worker/recipe-photo-studio`
  - Upstream: `origin/worker/recipe-photo-studio`
  - Status at setup: clean

## Retained Worktree
- `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback` exists on `worker/clem-feedback-e2e`.
- It is ahead of `origin/main` by 15 commits, so it is not safe to remove during this task.

## Primary Web Targets
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/prisma/schema.prisma`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/prisma/migrations/20260714123600_recipe_cover_prompt_lineage/migration.sql`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/migrations/0023_recipe_cover_prompt_lineage.sql`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/image-gen.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/ai-placeholder-cover.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoon-cover-stylization.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-cover.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1-openapi.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/mcp/spoonjoy-tools.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipePhotoStudio.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeCoverHistory.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeHeader.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/smoke-live.mjs`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/scripts/smoke-image-cover-live.mjs`

## Primary Native Targets
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/API/NativeAPIRequests.swift`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/API/APITransport.swift`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Sync/NativeSyncEngine.swift`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Offline/MutationQueue.swift`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Features/Covers/RecipeCoverControlsViewModel.swift`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Cache/NativeMediaStagingPolicy.swift`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Apps/Spoonjoy/Shared/Views/RecipeCoverControlsView.swift`

## Command Matrix
- Web focused tests: `pnpm run api:playground:generate && pnpm exec vitest run <tests> --fileParallelism=false`
- Web focused coverage with logs: `bash -o pipefail -c 'pnpm exec vitest run <tests> --coverage --fileParallelism=false 2>&1 | tee <log>'`
- Web build: `pnpm run build`
- Web final validation: `pnpm test -- --run --fileParallelism=false`, `pnpm run test:coverage`, `pnpm run build`, `pnpm run cleanup:qa`
- Native focused tests: `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter '<filters>'`
- Native focused coverage with logs: `bash -o pipefail -c "swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors --filter '<filters>' 2>&1 | tee <log>"`
- Native full matrix: `scripts/validate-native-local.sh --artifact-root <artifact-root>`
- Native warning scan: `scripts/fail-on-warning.rb --log <log>`
- Production deploy/smoke: `pnpm run deploy:auto`, `pnpm run deploy:preflight`, `pnpm run smoke:api`
- QA MCP/image smoke: `node scripts/smoke-live.mjs --target-env qa --base-url https://spoonjoy-v2-qa.mendelow-studio.workers.dev --out worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/deploy/mcp-smoke --include-image-cover-smoke`

## Local Capability Notes
- Repo-local `subagents/work-planner.md` and `subagents/work-doer.md` were not present, so installed local work-suite skills were used.
- No current local Xcode or Cloudflare capability blocker has been proven yet; native and deploy blockers will be recorded in their validation units if encountered.
