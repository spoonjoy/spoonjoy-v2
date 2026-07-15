# Planning: Recipe Photo Studio

**Status**: approved
**Created**: 2026-07-14 12:37

## Goal
Build Recipe Photo Studio as the owner-facing recipe-management workflow for adding, editorializing, regenerating, and controlling a recipe's single public cover photo across web, native Apple, and MCP/agent surfaces.

## Upstream Work Items
- None

## Scope

### In Scope
- Web owner UI under recipe management for first-photo and ongoing recipe-photo controls.
- Minimal first-photo flow: upload a real photo, optionally post it as a Spoon with Spoon fields, default editorialized recipe cover creation, immediate original-photo preview, processing/loading chip, and automatic swap to the editorialized cover when ready.
- Backend cover lifecycle support for upload, Spoon-origin covers, generated placeholder covers, regeneration with prompt additions, cover status polling, activation, archive, no-cover mode, and owner media validation.
- REST API v1 coverage for native clients, including the existing native `/api/v1/recipes/:id/image` upload contract, JSON cover creation where needed, idempotent `clientMutationId` behavior, and outgoing request-shape parity for native upload helpers.
- MCP/agent tool coverage for upload/generated/regenerate/status/activate/archive flows, including prompt additions.
- Native Apple Photo Studio surface that uses real backend contracts, preserves Spoon fields where the user is turning a photo into a Spoon, updates queued/offline upload metadata to carry the same choices, and keeps platform-native controls.
- Provenance and cover labels that avoid false "chef photo" language and generic "Spoonjoy cookbook" wording.
- Prompt lineage for AI placeholder and editorial regeneration flows, including bounded prompt additions.
- Tests, docs/API updates, OpenAPI/playground/generated contract checks where applicable, web visual QA, and native build/UI validation evidence.

### Out of Scope
- A public multi-photo recipe gallery, feed, likes/comments, or changing the public product model from one active recipe photo.
- Retroactively regenerating all legacy Spoonjoy photos in production.
- Provider-account setup, new AI provider procurement, billing changes, or secrets changes.
- A full standalone media library outside recipe management.
- Reworking unrelated recipe editing, cookbook, or auth flows.

## Completion Criteria
- [ ] Recipe management exposes a polished Photo Studio web workflow for no-photo and has-photo recipes.
- [ ] Uploading the first photo can create a Spoon with optional Spoon fields and defaults to creating an editorialized recipe cover while preserving the original photo on the Spoon.
- [ ] The active recipe photo shows the original immediately while editorialization is processing, displays a clear loading chip, and refreshes to the editorial variant when ready.
- [ ] Backend cover lifecycle supports upload, Spoon-origin cover creation, AI placeholder generation, regeneration with prompt additions, activation, archive, no-cover mode, status polling, and owner media validation.
- [ ] REST API v1 exposes the native-required real cover upload/create/regenerate/status contracts with request-shape tests and docs/OpenAPI/playground drift coverage.
- [ ] Native queued cover uploads preserve `clientMutationId`, Spoon-posting fields, activation choice, and editorialization choice without dropping staged media on validation or cancellation errors.
- [ ] MCP/agent tools expose the same core cover lifecycle, including generated placeholders and prompt additions.
- [ ] Native Apple Photo Studio uses the real backend contracts and platform-native upload/Spoon/detail/editorial controls.
- [ ] User-facing cover labels no longer say misleading "Chef photo" or generic "Spoonjoy cookbook" for all covers.
- [ ] Prompt additions and cover lineage are persisted and tested for AI placeholder/editorial generation paths.
- [ ] Web and native changes are merged, deployed/published to the applicable non-human-gated targets, and smoke-tested through their consuming surfaces.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None. Product decisions from the user are captured below; implementation-level ambiguity should go through reviewer gates unless it becomes a true credential/capability blocker.

## Decisions Made
- Keep one public recipe photo. Recipe Photo Studio can manage candidates and sources, but the public recipe still renders one active cover.
- Place Photo Studio under recipe management, not in the public recipe hero.
- The no-photo path should optimize for minimal clicks: add first photo, optionally expand Spoon details, save.
- Default first-photo behavior is `Post as Spoon` on, `Create editorial recipe photo` on, `Use as recipe photo` on, and cooked-at defaulting to now.
- The original user photo belongs on `RecipeSpoon.photoUrl` when posted as a Spoon; the recipe cover candidate should link back to that Spoon and use the editorial/stylized image as the preferred public cover when ready.
- While editorialization is processing, the app should show the original image with a loading chip and automatically refresh/swap once the editorial variant is ready.
- Prompt additions should be bounded directional input layered on top of the existing house style prompts, not an unrestricted replacement of the system prompt.
- Native work must use real Spoonjoy backend contracts in the same feature lifecycle rather than pointing at placeholder routes.
- MCP/agent support should mirror the real cover lifecycle so agents can create, inspect, regenerate, and activate recipe photos without bespoke database access.

## Context / References
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/prisma/schema.prisma`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-cover.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-detail.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-spoon.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoon-cover-stylization.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/ai-placeholder-cover.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/image-gen.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/recipe-image-assignment.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/api-v1.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/lib/spoonjoy-api.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeCoverHistory.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/SpoonDialog.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/components/recipe/RecipeHeader.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/routes/recipes.$id.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/routes/recipes.new.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/app/routes/recipes.$id.edit.tsx`
- `/Users/arimendelow/Projects/spoonjoy-v2-photo-studio/docs/api.md`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Apps/Spoonjoy/Shared/Views/RecipeCoverControlsView.swift`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Features/Covers/RecipeCoverControlsViewModel.swift`
- `/Users/arimendelow/Projects/spoonjoy-apple-photo-studio/Sources/SpoonjoyCore/Sync/NativeSyncEngine.swift`

## Notes
Existing web cover models already distinguish `RecipeCover.imageUrl`, `stylizedImageUrl`, `sourceType`, `sourceSpoonId`, `generationStatus`, and active recipe cover fields. Existing native code already expects an upload route at `/api/v1/recipes/:id/image`, but the web API currently lacks that implemented contract. Existing MCP tooling is ahead of REST for upload-to-cover, so REST, MCP, and native need to be brought into alignment.

## Progress Log
- 2026-07-14 12:37 Created
- 2026-07-14 12:37 Tinfoil hat pass tightened idempotency, native queued upload metadata, and ship/smoke criteria
- 2026-07-14 12:38 Approved after cold planning reviewer convergence
