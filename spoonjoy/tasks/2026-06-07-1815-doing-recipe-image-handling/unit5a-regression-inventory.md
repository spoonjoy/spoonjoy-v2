# Unit 5a Regression Inventory

No additional automated regression test is needed for Unit 5a.

Existing coverage already pins the required behavior:

- `e2e/flows/recipe-image-handling.spec.ts`: uploads the asymmetric EXIF-orientation JPEG fixture through the browser create flow, reloads the saved recipe, and samples decoded image pixels to prove the image renders upright rather than merely asserting dimensions.
- `test/lib/spoon-cover-stylization.server.test.ts`: uses a deterministic mocked image runner and R2 mock to prove `scheduleSpoonCoverStylization` writes a generated `/photos/covers/...` URL into `RecipeCover.stylizedImageUrl`.
- `test/lib/spoonjoy-api-spoons.test.ts`: proves origin-cook spoon photos schedule stylization through `waitUntil`, fill `stylizedImageUrl` after awaiting the captured task, and preserve the raw cover when stylization cannot run.
- `test/lib/mcp/spoonjoy-tools.server.test.ts`: proves MCP `upload_recipe_image` followed by `create_recipe.imageUrl` and `update_recipe.imageUrl` creates raw covers immediately and schedules stylization; explicit local/test data URL fallback also fills `stylizedImageUrl` through the deterministic mocked runner.
- `test/lib/recipe-cover.server.test.ts` and `test/routes/api-v1-recipes.test.ts`: prove `stylizedImageUrl` takes precedence over raw `imageUrl` in cover resolution/API output.

These cover the requested stylized-cover replacement path through deterministic mocked image runner paths plus browser orientation e2e, so adding another narrowly identical test would be redundant.
