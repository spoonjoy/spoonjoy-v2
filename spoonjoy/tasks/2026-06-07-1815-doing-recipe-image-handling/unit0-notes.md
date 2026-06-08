# Unit 0 Notes

## Repo/Runtime Inventory

- Branch: `spoonjoy/adversarial-dx-review`.
- Photo serving route: `app/routes/photos.$.tsx` serves `/photos/<key>` from `PHOTOS` R2 with immutable cache headers and returns 503 when bucket is absent.
- Photo bucket binding: `wrangler.json` binds `PHOTOS` to remote bucket `spoonjoy-photos`.
- D1 binding: `wrangler.json` binds `DB` to database `spoonjoy`.
- Relevant schema:
  - `RecipeCover.imageUrl` is required string today; empty string is the pending/no-cover sentinel.
  - `RecipeCover.stylizedImageUrl` is nullable.
  - `RecipeCover.sourceType` is string and currently stores `ai-placeholder`, `import`, `chef-upload`, or `spoon`.
  - `RecipeCover.sourceSpoonId` points to `RecipeSpoon` with `onDelete: SetNull`.
  - `RecipeSpoon.photoUrl` can retain the same stored object as a spoon-origin cover.
  - `ImageGenLedger` tracks per-user `kind` quotas by bucket start.
- PostHog server helper: `app/lib/analytics-server.ts` provides `resolvePostHogServerConfig`, `captureException`, and `captureEvent`; payload filtering already drops unsafe nested/request data.
- MCP registry:
  - MCP tools are the operation list in `app/lib/spoonjoy-api.server.ts`, surfaced through `app/lib/mcp/spoonjoy-tools.server.ts`.
  - Current image-relevant operations are `create_recipe`, `update_recipe`, `create_spoon`, and `update_spoon`.
  - Upload tools do not exist yet.
- Test helpers:
  - `test/utils.ts` exports `createTestRoutesStub`, which wraps React Router `createRoutesStub` and injects `HydrateFallback` to avoid hydration warnings.
  - `test/utils.ts` exports faker-based unique factories: `createTestUser`, `createTestRecipe`, `createCookbookTitle`, `createUnitName`, `createIngredientName`, `createStepDescription`, and `createStepTitle`.
  - `test/utils.ts` exports idempotent DB helpers `getOrCreateUnit` and `getOrCreateIngredientRef`.
  - `test/helpers/cleanup.ts` is the cleanup entrypoint used by DB-backed tests.
- Current image storage issue:
  - `app/lib/image-storage.server.ts` has one shared `RECIPE_IMAGE_TYPES` that still includes GIF.
  - `stripJpegApp1Segments` strips all APP1 EXIF, so uploaded mobile JPEG orientation can be lost.

## OpenAI Image API Notes

Official docs used:

- `https://developers.openai.com/api/docs/guides/image-generation`
- OpenAPI spec `https://api.openai.com/v1/images/generations`
- OpenAPI spec `https://api.openai.com/v1/images/edits`

Current official behavior relevant to this task:

- Image generation examples read `result.data[0].b64_json` and decode base64 bytes directly.
- Image edit examples pass binary file inputs to `client.images.edit({ image: ... })`.
- The `/images/edits` OpenAPI description supports `multipart/form-data` with binary `image` and JSON with `images` references; for this task the plan uses multipart `File` inputs after validating source bytes.
- Both generation and edit responses use the same `ImagesResponse` shape containing `b64_json`.

## coverImageUrl Audit Summary

Raw grep output is saved in `coverImageUrl-rg.txt`.

Categorized app occurrences:

| File | Category | Notes |
| --- | --- | --- |
| `app/routes/_index.tsx` | null-safe | Types already allow `string | null`; display uses truthy guards. |
| `app/routes/recipes._index.tsx` | null-safe | Type already allows `string | null`; display uses truthy guards. |
| `app/routes/recipes.$id.tsx` | needs update/verify | Loader passes resolver output to `RecipeHeader`; verify type after resolver returns null. |
| `app/routes/recipes.$id.edit.tsx` | needs update | Loader/action/component pass value into `RecipeBuilder`, which currently expects string. |
| `app/routes/users.$identifier.tsx` | needs update | Local recipe type currently says `coverImageUrl: string`; change to nullable and keep guarded renders. |
| `app/routes/cookbooks.$id.tsx` | needs update | Row image render is guarded, but `coverImageUrls` aggregation must filter nulls. |
| `app/routes/og.recipes.$id.png.tsx` | needs update/verify | Must keep OG fallback art when resolver returns null. |
| `app/routes/og.cookbooks.$id.png.tsx` | needs update | Must filter or accept null recipe covers before cookbook OG rendering. |
| `app/lib/recipe-detail.server.ts` | needs update | Detail loader return should allow `coverImageUrl: string | null`. |
| `app/lib/spoonjoy-api.server.ts` | needs update | API/MCP summary/detail helpers should allow null cover URLs. |
| `app/lib/og-image.server.tsx` | needs update | Recipe OG path is null-aware; cookbook `coverImageUrls.filter((url) => url.length > 0)` is not null-safe. |
| `app/lib/og-metadata.ts` | null-safe | `coverImageUrl` already nullable; `coverImageUrls` remains string array after filtering upstream. |
| `app/lib/api-v1.server.ts` | intentional separate/null-safe | Has its own null cover resolver; API v1 tests already cover null paths. |
| `app/lib/api-v1-openapi.server.ts` | intentional schema/generated docs | Schema already marks `coverImageUrl` nullable and `coverImageUrls` as string array. |
| `app/lib/generated/api-v1-playground.ts` | generated | Generated by `pnpm run api:playground:generate`; do not hand-edit. |
| `app/components/recipe/RecipeHeader.tsx` | null-safe | Missing/empty cover renders placeholder UI; tests must assert no Chef RJ SVG leak. |
| `app/components/recipe/RecipeBuilder.tsx` | needs update | Props currently model cover URL as string/empty string; update or normalize null. |
| `app/components/recipe/RecipeImageUpload.tsx` | needs update | Missing image display works; accepted-format copy/accept list need update. |
| `app/components/recipe/SpoonsStrip.tsx` | null-safe | Uses optional/null cover URL and falls back to spoon photo. |
| `app/components/cookbook/CookbookCoverArt.tsx` | null-safe | Filters null/empty images before rendering. |
| `app/components/pantry/RecipeGrid.tsx` | null-safe | Truthy guard exists; type may need nullable alignment. |
| `app/components/pantry/CookbookCard.tsx` | intentional type | The component accepts already-filtered cookbook images with non-null URLs. |

## Risotto Findings

- Local `prisma/dev.db`: no recipe title matching `%risotto%`.
- Remote D1 read-only SELECT found exactly one affected row:
  - Recipe: `cmq35k4c10001zn0npvsmw05z`, title `Mushroom Risotto`, chef `cl9rpod09000508la48fmmrbs`.
  - Current cover: `cmq3fsajk0003060nmpiac587`.
  - Current `imageUrl`: `/photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/1780815863103-232ecc1f-2bda-43ce-86ea-c91a10f6e008.jpeg`.
  - Current `stylizedImageUrl`: null.
  - `sourceType`: `spoon`.
  - `sourceSpoonId`: `cmq3fsai90001060no6ad14db`.
- Remote R2 source object was downloaded read-only to `risotto-source.jpeg`.
- `identify` reports source object as JPEG 4032x3024, 2.8 MB, Orientation undefined, ICC/MPF profiles only.
- Visual inspection confirms source object is sideways; no recoverable EXIF Orientation tag remains.
- Local repair previews:
  - `risotto-rotated-ccw.jpeg`: wrong/upside-down.
  - `risotto-rotated-cw.jpeg`: correct upright deterministic repair direction.
- Destructive production repair is deferred to Unit 5b. The likely repair path is upload the clockwise-rotated bytes under a new immutable `/photos/...` key and update/create only the known risotto cover after validation.

## Selected Test Commands

Targeted unit/component/route tests:

```bash
pnpm exec vitest run \
  test/lib/image-storage.server.test.ts \
  test/lib/recipe-spoon.server.test.ts \
  test/components/recipe/RecipeImageUpload.test.tsx \
  test/components/recipe/SpoonDialog.test.tsx \
  test/routes/recipes-new.test.tsx \
  test/routes/recipes-id-edit.test.tsx \
  test/routes/recipes-id-spoons.test.tsx \
  test/routes/account-settings.test.tsx \
  test/components/account/ProfilePhotoField.test.tsx
```

Cover/OG/search/image generation/API/MCP targeted tests:

```bash
pnpm exec vitest run \
  test/lib/recipe-cover.server.test.ts \
  test/routes/og-routes.test.ts \
  test/lib/og-image.server.test.tsx \
  test/lib/recipe-fork.server.test.ts \
  test/lib/recipe-import.test.ts \
  test/lib/image-gen.server.test.ts \
  test/lib/ai-placeholder-cover.server.test.ts \
  test/lib/spoon-cover-stylization.server.test.ts \
  test/lib/analytics-server.test.ts \
  test/lib/search.server.test.ts \
  test/lib/mcp/spoonjoy-tools.server.test.ts \
  test/lib/mcp/http-mcp.server.test.ts \
  test/routes/mcp.test.ts \
  test/routes/api.test.ts \
  test/lib/spoonjoy-api-spoons.test.ts \
  test/routes/api-v1-recipes.test.ts
```

E2E image flow:

```bash
pnpm exec playwright test e2e/flows/recipe-image-handling.spec.ts
```

Final validation:

```bash
pnpm run typecheck
pnpm run test:coverage
pnpm run test:e2e
pnpm run build
```
