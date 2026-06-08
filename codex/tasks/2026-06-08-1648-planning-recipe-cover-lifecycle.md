# Planning: Recipe Cover Lifecycle

**Status**: drafting
**Created**: 2026-06-08 16:48

## Goal
Make Spoonjoy recipe imagery explicit, provenance-aware, and controllable across web UI and MCP. Recipes should distinguish pure AI placeholders, uploaded photos, imported photos, and editorialized chef photos while letting chefs browse, choose, and retain cover history.

## Upstream Work Items
- None

## Scope

### In Scope
- Replace implicit newest-cover selection with an explicit active recipe cover model used by recipe pages, cards, search, cookbooks, Open Graph metadata, public API formatting, and MCP formatting.
- Add cover provenance metadata that can distinguish pure AI generated covers from editorialized photos, verbatim uploaded photos, and imported photos.
- Add a safe schema/data migration that backfills the currently displayed newest non-empty cover as active while preserving existing cover history.
- Update no-photo recipe placeholders so they read as intentional awaiting-cover states rather than broken/corrupted image states.
- Make first chef spoon photos optional; when a recipe has no active real cover and the chef includes a spoon photo, auto-create an editorialized cover from that photo.
- Allow chefs to keep an uploaded image verbatim as the active cover without generating an editorialized variant.
- Add an owner-facing cover history/browser for all covers on a recipe with current/provenance labels and controls to set active, generate/regenerate editorialized variants, and remove/archive covers.
- Add a recipe spoon image browser or picker that lets the owner review spoon photos available for cover use.
- Add MCP/API operations to list recipe covers, list recipe spoon images, create cover candidates from uploads/spoons, set the active recipe cover explicitly, regenerate editorialized covers, remove/archive covers, and inspect generation status.
- Update recipe import, recipe fork, recipe edit/clear-image, AI placeholder generation, search indexing, API v1 recipe output, and cookbook cover aggregation paths so none of them reintroduce newest-row cover selection.
- Preserve PostHog exception capture for image-generation failures and make new failure paths observable.
- Update tests for schema, cover selection, UI states, web mutations, MCP tools, error paths, and end-to-end cover flows.

### Out of Scope
- Building a new email notification system.
- Allowing non-owners to change a recipe's public cover.
- Making non-owner spoon photos auto-update a recipe cover.
- GIF upload support.
- Replacing the existing Gemini/OpenAI image provider stack.
- Redesigning unrelated recipe, spoon, cookbook, search, or profile layouts beyond image/provenance surfaces.

## Completion Criteria
- [ ] New recipes without a real cover show an intentional awaiting-cover state and never show the Chef RJ placeholder as a recipe cover fallback.
- [ ] Public recipe surfaces show a provenance badge for the active cover.
- [ ] Owner recipe surfaces provide cover history controls for active cover selection, verbatim uploaded cover use, editorial generation/regeneration, and cover removal/archive.
- [ ] First chef spoon can be logged without a photo; first chef spoon with a photo auto-seeds an editorialized cover only when the recipe has no active real cover.
- [ ] Later chef spoons can opt in to cover creation with explicit UI and do not replace a manually chosen active cover unless requested.
- [ ] MCP exposes explicit cover and spoon-image browsing/activation operations with provenance, generation status, idempotency, and safe permission checks.
- [ ] Existing APIs and loaders no longer derive current cover from newest row ordering.
- [ ] Pure AI generated, uploaded verbatim, imported, and editorialized-photo covers are distinguishable in database rows, web UI, public API, and MCP responses.
- [ ] Placeholder, import, edit, fork, and stylization jobs cannot silently replace a manually selected active cover.
- [ ] Search index metadata and Open Graph output use the explicit active cover and remain correct after cover changes.
- [ ] Image generation failures remain visible via PostHog exception capture and user-facing failure states.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- [ ] None. Product decisions for required photo behavior, provenance visibility, manual cover choice, cover retention, and MCP authority were resolved in chat on 2026-06-08.

## Decisions Made
- First chef spoon photos are optional. A chef may log a text-only first cook; photo upload should be prominent when no real cover exists.
- Pure AI placeholders are allowed but provisional. They must be labeled as pure AI generated and should be superseded automatically by the first chef editorialized photo unless the chef has manually chosen a cover.
- Cover provenance should be visible publicly on main recipe cards/pages and exposed through owner UI and MCP/API metadata.
- Once a chef explicitly chooses an active cover, automation may create cover candidates but must not silently replace the active cover.
- Chefs can set a cover to the verbatim uploaded image; editorialized generation is optional except the first-chef-photo/no-real-cover auto-seed path.
- Old covers should be retained by default, browsable, restorable, and removable/archivable.
- MCP can list and generate candidates with write scope, but active-cover changes require an explicit operation such as `set_active_recipe_cover`.

## Context / References
- `prisma/schema.prisma` currently has `RecipeCover` rows with `imageUrl`, `stylizedImageUrl`, `sourceType`, and `sourceSpoonId`, but no explicit active cover pointer or status.
- `app/lib/recipe-cover.server.ts` currently selects the current cover by newest row ordering in `getCurrentCover` and `getRecipeCoverImageUrl`.
- `app/lib/recipe-detail.server.ts` currently creates a spoon-sourced cover only when `result.isOriginCook && result.spoon.photoUrl`.
- `app/lib/recipe-spoon.server.ts` currently rejects origin-cook spoons without a photo.
- `app/lib/spoonjoy-api.server.ts` currently supports `upload_recipe_image`, `upload_spoon_photo`, `create_spoon`, `update_spoon`, `list_spoons_for_recipe`, and `list_spoons_by_chef`, but has no explicit cover listing or active-cover mutation tools.
- `app/components/recipe/RecipeHeader.tsx` currently renders "No image available" when no cover image URL is present.
- `app/components/recipe/SpoonDialog.tsx` currently communicates "Photo required for your own cook" and has no cover opt-in control.
- `app/lib/search.server.ts`, `app/lib/api-v1.server.ts`, recipe index/profile/cookbook routes, and Open Graph helpers should be checked for direct cover ordering assumptions during implementation.
- `app/lib/recipe-fork.server.ts` and `app/lib/recipe-import.server.ts` create or copy cover rows and must preserve provenance and active-cover semantics.

## Notes
Implementation should prefer a single `RecipeCover` history model with explicit status/provenance over a separate candidate model unless code inspection shows a separate model is materially simpler. Backfill should choose the currently displayed newest non-empty cover as active while preserving older rows. If adding `Recipe.activeCoverId`, avoid a required cyclic relation between `Recipe` and `RecipeCover`; use nullable active-cover state and explicit write helpers. Background jobs should check active-cover/manual-selection state at completion time before activating any generated cover.

## Progress Log
- 2026-06-08 16:48 Created
- 2026-06-08 16:50 Tightened scope after tinfoil pass
