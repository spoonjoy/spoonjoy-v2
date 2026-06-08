# Unit 5b Risotto Repair Evidence

## Result

Repaired the known `Mushroom Risotto` cover by writing a new immutable R2 object and updating only the known cover row.

- `recipeId`: `cmq35k4c10001zn0npvsmw05z`
- `coverId`: `cmq3fsajk0003060nmpiac587`
- Previous `imageUrl`: `/photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/1780815863103-232ecc1f-2bda-43ce-86ea-c91a10f6e008.jpeg`
- New `imageUrl`: `/photos/spoons/cl9rpod09000508la48fmmrbs/cmq35k4c10001zn0npvsmw05z/repair-20260608T063245Z-cw-upright.jpeg`

## Verification

- Final D1 update artifact: `unit5b-risotto-d1-update-final.txt`
  - `changes: 1`
  - `changed: 1`
- Final D1 readback artifact: `unit5b-risotto-d1-verify-final.txt`
  - `imageUrl` is the new repair URL.
  - `stylizedImageUrl` remains null.
  - `sourceType` remains `spoon`.
  - `sourceSpoonId` remains `cmq3fsai90001060no6ad14db`.
- Final R2 readback artifact: `unit5b-risotto-r2-verify-final.txt`
  - Direct R2 download succeeded.
- Served URL artifact: `unit5b-risotto-served-identify.txt`
  - `JPEG 3024x4032`
  - SHA-256 `679230c7fcc7b2da0dd626f2bb85fd14470d4020281919be83e55bcfe62720a1`
- R2 readback artifact: `unit5b-risotto-r2-identify-final.txt`
  - `JPEG 3024x4032`
  - SHA-256 `679230c7fcc7b2da0dd626f2bb85fd14470d4020281919be83e55bcfe62720a1`

The old immutable source object was not deleted.

## Retry Note

Initial R2 `put` attempts printed `Upload complete` but immediate `get` returned missing for the repair key. Before leaving the DB pointed at a missing object, the row was rolled back to the previous URL; artifacts `unit5b-risotto-d1-rollback*.txt` capture that rollback. Disposable probe objects then confirmed remote R2 writes worked for the same prefix and same file size. A final upload to the same repair key verified correctly, and only then was the guarded D1 update re-applied.

Disposable probe objects were deleted; cleanup artifacts:

- `unit5b-r2-write-probe-delete.txt`
- `unit5b-risotto-big-probe-delete.txt`
- `unit5b-risotto-prefix-probe-delete.txt`
