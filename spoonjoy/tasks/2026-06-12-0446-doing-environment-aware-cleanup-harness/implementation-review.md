FINDINGS

BLOCKER: QA R2 apply could delete non-disposable user namespaces for note-matched spoons. `disposable_spoons` includes spoons by note regardless of `chefId`, but the R2 candidate SQL previously marked `/photos/spoons/${chefId}/...` and `/photos/spoons/${chefId}/uploads/...` as delete without requiring `chefId IN disposable_users`.

MAJOR: Broad QA cleanup did not remove generated cover R2 objects under the app's generated namespace. The app writes generated images to `covers/...`, while cleanup only deleted recipe-namespaced cover URLs.

MAJOR: Dry-run blocker reporting was a hardcoded zero. `cleanup:remote:qa` dry-run could report zero blockers without running the cross-boundary blocker checks that apply later uses.

MAJOR: The D1 blocker preflight mutated database/schema state before refusal by slicing `buildApplySql()`, creating helper tables and search tables before reporting blockers.

MINOR: Artifact hygiene was not clean across committed logs; `git diff --check main...HEAD` reported trailing whitespace and blank EOF in older generated evidence logs.
