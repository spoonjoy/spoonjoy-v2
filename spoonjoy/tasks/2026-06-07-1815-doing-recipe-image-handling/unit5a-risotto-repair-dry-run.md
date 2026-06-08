# Unit 5a Risotto Repair Dry Run

## Target

- `recipeId`: `cmq35k4c10001zn0npvsmw05z`
- `coverId`: `cmq3fsajk0003060nmpiac587`
- Current `imageUrl`: `/photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/1780815863103-232ecc1f-2bda-43ce-86ea-c91a10f6e008.jpeg`
- Repair source file: `spoonjoy/tasks/2026-06-07-1815-doing-recipe-image-handling/risotto-rotated-cw.jpeg`
- New immutable R2 key: `spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/repair-20260608T063245Z-cw-upright.jpeg`
- New `imageUrl`: `/photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/repair-20260608T063245Z-cw-upright.jpeg`

## Preconditions

1. Unit 1-4 targeted tests, scoped coverage, typecheck, and build are green.
2. Remote D1 still has the same known cover row and current `imageUrl`.
3. The new R2 key does not already exist.

## Dry-Run Checks

```bash
pnpm exec wrangler d1 execute DB --remote --command "SELECT id, title FROM Recipe WHERE id = 'cmq35k4c10001zn0npvsmw05z'; SELECT id, recipeId, imageUrl, stylizedImageUrl, sourceType, sourceSpoonId FROM RecipeCover WHERE id = 'cmq3fsajk0003060nmpiac587';"

pnpm exec wrangler r2 object get spoonjoy-photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/repair-20260608T063245Z-cw-upright.jpeg --remote --file /tmp/spoonjoy-risotto-repair-preexisting.jpeg
```

The R2 get command is expected to return not found before repair.

## Repair Commands

```bash
pnpm exec wrangler r2 object put spoonjoy-photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/repair-20260608T063245Z-cw-upright.jpeg --remote --file spoonjoy/tasks/2026-06-07-1815-doing-recipe-image-handling/risotto-rotated-cw.jpeg --content-type image/jpeg

pnpm exec wrangler d1 execute DB --remote --command "UPDATE RecipeCover SET imageUrl = '/photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/repair-20260608T063245Z-cw-upright.jpeg', stylizedImageUrl = NULL WHERE id = 'cmq3fsajk0003060nmpiac587' AND recipeId = 'cmq35k4c10001zn0npvsmw05z' AND imageUrl = '/photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/1780815863103-232ecc1f-2bda-43ce-86ea-c91a10f6e008.jpeg'; SELECT changes() AS changed;"
```

## Verification Commands

```bash
pnpm exec wrangler d1 execute DB --remote --command "SELECT id, recipeId, imageUrl, stylizedImageUrl, sourceType, sourceSpoonId FROM RecipeCover WHERE id = 'cmq3fsajk0003060nmpiac587';"

pnpm exec wrangler r2 object get spoonjoy-photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/repair-20260608T063245Z-cw-upright.jpeg --remote --file /tmp/spoonjoy-risotto-repair-verify.jpeg
```

Only the known `RecipeCover` row is updated. The old immutable source object is not deleted.
