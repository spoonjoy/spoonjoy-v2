# Unit 1.1b Verification

## Clean gates

- App coverage: 366 files and 7,292 tests passed; 100% across 17,805 statements, 13,933 branches, 3,598 functions, and 16,343 lines.
- Workers coverage: 1 file and 10 tests passed in the official Cloudflare pool; 100% statements, branches, functions, and lines.
- Playwright: 63 tests passed in the CI-equivalent serialized configuration against a dedicated production Worker server with browser diagnostics enforced. Each run copies the baseline into a unique Wrangler persistence directory; global teardown signals the recorded launcher, requires the exact OAuth cleanup result handshake, and waits for the run directory to disappear. A local five-worker run exposed one auth timeout after reaching the correct page; the focused auth spec then passed 7/7 and the complete CI-equivalent run passed 63/63.
- Typecheck, production build, generated-contract check, local migrations, and QA-local migrations passed through the warning-aware command wrapper.
- `actionlint`, `git diff --check`, and frozen-lockfile installation passed, with retained `unit-1.1b-*-reviewed.log` evidence for each command.
- Local QA cleanup reports zero active or deleted suspicious recipes, disposable users, disposable spoons, or cross-boundary blockers. The twelve historical E2E recipe IDs were hard-deleted exactly after proving no external recipe, cookbook, or search references; `PRAGMA foreign_key_check` is empty.
- Cleanup no longer infers OAuth ownership from client names or redirect URIs. E2E clients carry a unique run marker, are captured by exact client ID, and are deleted only inside the ephemeral run state. The broad cleanup path does not select or delete OAuth clients.
- Local D1 has zero persistent cleanup scratch tables. D1 rejects `TEMP` tables, so cleanup drops its bounded scratch schema before work, at successful completion, and from a CLI `finally` path; executable tests cover failure cleanup.
- Launcher results are retained only after a matching global-teardown request; startup failure before teardown removes both the run directory and sibling result marker. Aborted signal/removal waits revoke that request, falling back to marker deletion if the revocation overwrite fails, and the launcher re-checks ownership after writing so every race order removes the result. Dual teardown/revocation failures preserve both causes. The coordinated cleanup suite passes 21/21 at 100% coverage across 157 statements, 80 branches, 22 functions, and 140 lines. After the final 63/63 CI-equivalent Playwright run, port 5197 is unbound and `.wrangler/e2e-runs` is empty.
- The single Node SQLite initialization warning is filtered once by exact type, message, argument shape, and `node:sqlite` origin. Unrelated `ExperimentalWarning` sentinels fail in app and Workers lanes; benign line-leading `warning` prose passes; no broad `NODE_OPTIONS` warning suppression remains.
- `.dev.vars` is absent.

The corresponding `unit-1.1b-*.log` files are retained locally as ignored execution evidence. Failed attempts have distinct filenames and were not overwritten.

## Side finding

An early browser probe using a genuinely external OAuth callback produced a report-only CSP diagnostic because the authorization form is constrained by `form-action 'self'`. Unit 1.1b keeps its infrastructure test same-origin so it does not bless or suppress that diagnostic. Re-evaluate the external callback flow in the later OAuth/security boundary before product shipment.
