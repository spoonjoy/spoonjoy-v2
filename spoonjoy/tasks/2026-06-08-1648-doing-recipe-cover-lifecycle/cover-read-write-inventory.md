# Recipe Cover Read/Write Inventory

Created for Unit 0 of `2026-06-08-1648-doing-recipe-cover-lifecycle.md`.

## Data Model And Migrations

| Path | Current Behavior | Change Unit |
| --- | --- | --- |
| `prisma/schema.prisma` | `Recipe` has `covers: RecipeCover[]`; `RecipeSpoon` has `covers: RecipeCover[]`; `RecipeCover` has `imageUrl`, optional `stylizedImageUrl`, `sourceType`, optional `sourceSpoonId`, and `createdAt`. There is no explicit active cover, cover variant, cover mode, status, archive state, generation status, or active-cover relation. | Unit 1 |
| `prisma/migrations/20260511133335_s1_add_spoon_cover_ledger/migration.sql` | Original Prisma migration creates `RecipeSpoon`, `RecipeCover`, and `ImageGenLedger`; `RecipeCover` is append-only with newest-row index. | Unit 1 |
| `prisma/migrations/20260511134214_s1_drop_recipe_imageurl/migration.sql` | Backfills `RecipeCover` rows from old `Recipe.imageUrl` and drops `Recipe.imageUrl`; no active cover pointer is written. | Unit 1 |
| `migrations/0008_s1_spoon_foundation.sql` | Root D1 migration creates the same spoon/cover ledger, backfills from `Recipe.imageUrl`, and drops that column. Production deploy uses root numbered SQL migrations through Wrangler. | Unit 1 |
| `migrations/0006_search_document_fts.sql` | Search document table stores `imageUrl` as denormalized metadata. | Unit 3 |
| `migrations/0000_init.sql`, `migrations/0004_reseed.sql` | Historical root migrations still contain old `Recipe.imageUrl` setup/seed shape. They remain historical, but new root migration must preserve upgrade from current deployed schema. | Unit 1 |
| `prisma/seed.ts` | Seed data has recipe `imageUrl` properties and creates `RecipeCover` rows with `sourceType: "chef-upload"`; no active cover state is populated. | Unit 4 |

## Core Cover Helpers And Jobs

| Path | Current Behavior | Change Unit |
| --- | --- | --- |
| `app/lib/recipe-cover.server.ts` | `createCover` appends a cover row; `listCoversForRecipe` and `getCurrentCover` order by newest; `getRecipeCoverImageUrl` sorts covers and returns the newest row's `stylizedImageUrl`, then `imageUrl`, else `null`. Empty newest rows hide older valid covers. | Unit 1 |
| `app/lib/ai-placeholder-cover.server.ts` | Creates fallback data via `createFallbackPlaceholderCover`; `scheduleAiPlaceholderCover` updates an existing cover row's `imageUrl` after generation. Failures leave the row as-is and emit telemetry. There is no active-cover race check. | Unit 4 |
| `app/lib/spoon-cover-stylization.server.ts` | `scheduleSpoonCoverStylization` generates an editorial cover and updates `RecipeCover.stylizedImageUrl`. Failures leave `stylizedImageUrl` null and log/capture telemetry. There is no status field and no activation rule. | Unit 6 |
| `app/lib/image-gen-telemetry.server.ts` | Captures provider/source telemetry for image generation. Source types currently match `chef-upload`, `spoon`, and `ai-placeholder` flows. | Unit 6 |

## Web Route Loaders And Actions

| Path | Current Behavior | Change Unit |
| --- | --- | --- |
| `app/routes/recipes.new.tsx` | New recipe action creates a `chef-upload` cover for uploads and immediately schedules stylization; without an upload it creates an empty `ai-placeholder` cover and schedules placeholder generation. No active state exists. | Unit 4 |
| `app/routes/recipes.$id.edit.tsx` | Loader computes `coverImageUrl` through `getRecipeCoverImageUrl`. Action reads `recipe.covers[0]` as current cover for cleanup decisions, creates upload covers, schedules stylization, and creates empty placeholder covers on clear-image. | Unit 4 |
| `app/lib/recipe-detail.server.ts` | Recipe detail loader includes covers ordered newest-first and derives `coverImageUrl` with `getRecipeCoverImageUrl`. `handleCreateSpoon` creates a `sourceType: "spoon"` cover for origin-cook spoon photos and schedules stylization inline. | Units 2, 7 |
| `app/routes/recipes.$id.tsx` | Consumes `coverImageUrl` from `recipe-detail.server` and passes it to `RecipeHeader`; renders `SpoonDialog` with `isOriginCookCandidate`. | Units 2, 7, 8, 9 |
| `app/routes/recipes._index.tsx` | Public recipe index fetches newest-ordered covers and maps them through `getRecipeCoverImageUrl`. | Unit 2 |
| `app/routes/_index.tsx` | Home page fetches newest-ordered recipe covers and cookbook recipe covers; uses `getRecipeCoverImageUrl` for hero/cards. | Unit 2 |
| `app/routes/users.$identifier.tsx` | Profile page fetches newest-ordered covers for recipes, cookbook recipes, and recent spoon recipe cards; uses `getRecipeCoverImageUrl`. | Unit 2 |
| `app/routes/cookbooks.$id.tsx` | Cookbook page fetches newest-ordered covers for cookbook recipes; derives `coverImageUrl` and `coverImageUrls` with `getRecipeCoverImageUrl`. | Unit 2 |
| `app/routes/search.tsx` | Search page renders `SearchResult.imageUrl` directly in result cards and has no cover provenance badge. | Unit 2 |
| `app/routes/og.recipes.$id.png.tsx` | Open Graph recipe route fetches newest-ordered covers and calls `getRecipeCoverImageUrl` before rendering. | Unit 3 |
| `app/routes/og.cookbooks.$id.png.tsx` | Open Graph cookbook route fetches newest-ordered recipe covers and maps them through `getRecipeCoverImageUrl`. | Unit 3 |

## Server API, Search, Import, Fork, And MCP

| Path | Current Behavior | Change Unit |
| --- | --- | --- |
| `app/lib/api-v1.server.ts` | Defines local `coverImageUrl(covers)` helper that returns `covers[0].stylizedImageUrl` or `covers[0].imageUrl`; recipe and cookbook endpoints select newest-ordered covers and expose only URLs. | Unit 3 |
| `app/lib/api-v1-openapi.server.ts` | Public OpenAPI schemas/examples document `coverImageUrl` and `coverImageUrls` only; no provenance fields. | Unit 3 |
| `app/lib/search.server.ts` | Search indexing counts and hashes `RecipeCover`; loads all covers, groups by recipe, then calls `getRecipeCoverImageUrl` for result `imageUrl`. Search metadata changes when any cover row changes. | Unit 3 |
| `app/lib/recipe-import.server.ts` | Import path can create `sourceType: "import"` covers from extracted assets and `sourceType: "ai-placeholder"` covers when needed. Recipe includes covers ordered newest-first. No active state. | Unit 5 |
| `app/lib/recipe-fork.server.ts` | Fork path loads source covers ordered newest-first, copies only `source.covers[0]` as `sourceType: "chef-upload"` with `stylizedImageUrl: null`, and does not preserve active state/provenance. | Unit 5 |
| `app/lib/spoonjoy-api.server.ts` | MCP/API formatting uses `getRecipeCoverImageUrl` for recipe/cookbook/spoon responses. `create_recipe`, `update_recipe`, `create_spoon`, and `update_spoon` create covers and schedule stylization. `import_recipe_from_url` and `fork_recipe` call import/fork flows. `list_spoons_for_recipe` and `list_spoons_by_chef` return recipe cover URLs. `TOOL_ANNOTATIONS` must include every new operation. | Units 10, 11, 12 |
| `app/lib/recipe-spoon.server.ts` | `createRecipeSpoon` requires a photo for origin-cook spoons. List helpers include recipe covers ordered newest-first for derived `coverImageUrl`. | Unit 7 |
| `app/lib/og-image.server.tsx` | Pure renderer for supplied `coverImageUrl`/`coverImageUrls`; no direct DB reads. It may not need active-cover logic beyond route inputs. | Unit 3 |

## UI Components

| Path | Current Behavior | Change Unit |
| --- | --- | --- |
| `app/components/recipe/RecipeHeader.tsx` | Accepts `coverImageUrl`; renders image when present, otherwise placeholder with `ImageOff` and text `No image available`. No provenance badge prop. | Units 2, 8 |
| `app/components/recipe/SpoonDialog.tsx` | For `isOriginCookCandidate`, sets `requiresPhoto=true`, shows `Photo required for your own cook.`, blocks submit without a photo, and already shows upload/saving progress with disabled controls. No cover opt-in field. | Unit 7 |
| `app/components/pantry/RecipeGrid.tsx` | Card grid accepts `coverImageUrl` only and renders image/fallback. No provenance badge prop. | Unit 2 |
| `app/components/cookbook/CookbookCoverArt.tsx` | Filters cookbook images by non-empty `coverImageUrl` and renders a collage; no provenance metadata. | Unit 2 |
| `app/components/recipe/RecipeImageUpload.tsx` | Recipe form upload component shows existing cover/preview or upload placeholder. It will need to cooperate with verbatim vs editorialized cover choices once edit/new flows change. | Units 4, 8 |

## Test Surfaces Already Covering Old Behavior

| Path | Current Behavior | Change Unit |
| --- | --- | --- |
| `test/lib/recipe-cover.server.test.ts` | Asserts newest-row behavior, stylized-before-image URL choice, and null for empty latest cover. These tests should be replaced/expanded for active cover selection and backfill semantics. | Unit 1 |
| `test/models/recipe-cover.test.ts` | Covers existing `RecipeCover` model fields/indexes only. | Unit 1 |
| `test/scripts/migration-0008-*.test.ts` | Covers existing root D1 migration behavior for spoon/cover ledger and old imageUrl backfill/drop. New migration needs analogous script coverage. | Unit 1 |
| `test/routes/recipes-id-edit.test.tsx`, `test/routes/recipes-id-spoons.test.tsx`, `test/lib/mcp/spoonjoy-tools.server.test.ts`, `test/lib/spoonjoy-api-spoons.test.ts` | Assert current cover creation/update/stylization behavior and newest-row assumptions across web and MCP. These are primary red/green targets for Units 4, 7, 10, 11, and 12. | Units 4, 7, 10, 11, 12 |
| `test/routes/api-v1-*.test.ts`, `test/lib/search.server.test.ts`, `test/routes/og-routes.test.ts` | Assert public API, search, and OG cover URL behavior. These need active-cover and provenance coverage. | Unit 3 |

