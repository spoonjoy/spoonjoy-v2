# Risotto Data Audit

## Local

- Query: `SELECT ... FROM Recipe LEFT JOIN RecipeCover ... WHERE lower(r.title) LIKE '%risotto%'`.
- Result: no rows in `prisma/dev.db`.
- Raw output: `risotto-local-devdb.txt`.

## Remote Read-Only D1

- Command output: `risotto-remote-d1.txt`.
- Matched one recipe:
  - `recipeId`: `cmq35k4c10001zn0npvsmw05z`
  - `title`: `Mushroom Risotto`
  - `chefId`: `cl9rpod09000508la48fmmrbs`
  - `coverId`: `cmq3fsajk0003060nmpiac587`
  - `sourceType`: `spoon`
  - `sourceSpoonId`: `cmq3fsai90001060no6ad14db`
  - `imageUrl`: `/photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/1780815863103-232ecc1f-2bda-43ce-86ea-c91a10f6e008.jpeg`
  - `stylizedImageUrl`: null

## Remote R2 Read

- Source object fetched read-only to `risotto-source.jpeg`.
- Metadata saved to `risotto-source-identify.txt`.
- `identify` summary:
  - JPEG, 4032x3024
  - Orientation undefined
  - ICC and MPF profiles present
  - size around 2.8 MB

## Repair Direction

- The stored source has no usable EXIF orientation, so the original EXIF cannot be recovered.
- `risotto-rotated-cw.jpeg` is visually upright.
- `risotto-rotated-ccw.jpeg` is not upright.
- Unit 5b should write a new immutable key for the clockwise-rotated bytes and update only the known risotto cover after validation.
