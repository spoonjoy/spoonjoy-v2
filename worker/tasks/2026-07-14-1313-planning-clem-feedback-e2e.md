# Planning: Clem Feedback E2E

**Status**: NEEDS_REVIEW
**Created**: 2026-07-14 13:15

## Goal
Ship every accepted part of Clem's feedback as coherent Spoonjoy primitives: reliable cross-device cooking, correct shopping-list restoration, private saved recipes, useful manual categorization, and neutral API metadata. Explicitly reject first-party import UI, premature AI categorization, and Pebble-specific work.

## Upstream Work Items
- `./2026-07-14-1313-clem-feedback-source.md` is the durable source-of-truth and item-by-item disposition.

## Scope

### In Scope
- Preserve the current navigation model unless testing demonstrates a concrete accessibility or reachability defect.
- Make shopping-list re-add and restore behavior consistent across web, REST v1, and MCP.
- Make authenticated cooking progress canonical in Cloudflare Durable Objects so one owner can continue a recipe across devices.
- Support start/resume, synchronized progress, scaling, completion, abandonment, safe retry, and owner-authorized disposable cleanup.
- Keep authenticated offline state as a recoverable local queue and anonymous progress local-only, with an explicit one-time adoption path.
- Pin active cooking progress to the recipe state that was started so later recipe edits never silently remap progress.
- Keep My Kitchen cook history and projections private to the owner.
- Add private saved recipes as a distinct product concept from cookbook membership, including private search and API access.
- Add manual categorization through one controlled course and owner-authored custom tags across authoring, filtering, search, REST, and MCP reads.
- Add backward-compatible neutral recipe metadata and detail-only quantity scaling to REST v1 and MCP recipe reads.
- Keep API contracts, generated references, agent tools, operational checks, and cleanup behavior aligned with the shipped product.
- Attest the exact deployed revision through public health checks.
- Validate on QA before merge, then verify the exact merged revision through automatic production deployment, live product checks, and cleanup.

### Out of Scope
- First-party import/upload UI for URLs, PDFs, cookbooks, or videos; existing agent/API import remains available.
- AI tag suggestion tables, endpoints, inference jobs, or review UI.
- Pebble-specific fields, routes, naming, documentation, or partner behavior.
- Public saved counts, collaborative cook sessions between different users, public cook history, or automatic social `RecipeSpoon` creation.
- Replacing freeform `servings`, changing existing v1 field types, or mutating stored recipes during scaling.
- Broad mobile dock redesign.
- Uncoordinated database-level hard deletion of non-disposable recipes/users and cross-user cook-session fan-out. Shipped product paths soft-delete recipes; disposable cleanup removes only its authorized test state.

## Completion Criteria
- [ ] Every line of the feedback source has an implemented or explicitly rejected disposition.
- [ ] Shopping re-add behavior matches the state matrix across web, REST v1, and MCP under repeated and concurrent calls.
- [ ] Workers-runtime tests prove deterministic user/recipe arbitration, first-writer/server-wins adoption, post-purge replay fencing, stale-delete isolation, SQLite DO persistence, attempt isolation, revision conflict/rebase, mutation dedupe, ordered alarms, purge barriers, private no-store responses, hibernation WebSockets, and the full Worker 101 response path.
- [ ] Two authenticated clients start/resume one session and synchronize step, checklist, and scale state; anonymous progress remains local-only.
- [ ] Recipe edits display pinned-state choices and never silently remap progress.
- [ ] My Kitchen cook/saved sections are owner-only for owner, authenticated visitor, and anonymous visitor cases.
- [ ] Completion and abandon clear resume state, preserve private history as intended, and create no RecipeSpoon/social side effect.
- [ ] SavedRecipe migration/backfill and all four cookbook membership writers obey the compatibility contract.
- [ ] Saved search is viewer-scoped without global-index leakage; private saved endpoints and entitled personalized `isSaved` projections are no-store, public-read-only bearer principals receive `isSaved: null` without private lookup, and only no-principal anonymous projections retain partitioned public caching.
- [ ] Manual course/custom tags author, filter, search, and project through REST and MCP recipe reads without any AI suggestion surface.
- [ ] REST v1 and MCP recipe-read additions pass compatibility, OpenAPI, contract, generator, tool-schema, list/detail/search/native-sync/write/cookbook, shared-math, and transport-parity tests.
- [ ] Current mobile dock remains stable; changed UI passes desktop/mobile visual QA with no overlap or unreachable controls.
- [ ] After the exact merge SHA is deployed, production visual dogfood covers every changed UI family on mobile/desktop plus the three guest-home viewports, with screenshot/live evidence, passing metrics, and a closed absurdity ledger before final cleanup.
- [ ] QA deploy, two-client smoke, purge, and residue inspection pass before merge.
- [ ] QA `/health` attests the exact PR head immediately before merge; the merge SHA's successful canonical CI push triggers the selected production `workflow_run`, whose promoted canary artifact attests the exact source/tree/Worker version, and canonical `/health` attests that SHA before readiness/web/API smoke and cleanup pass.
- [ ] All tests and builds pass with zero warnings and 100% coverage on all new code, including `workers/**` and every task-owned executable script.
- [ ] Cleanup proves disposable relational/content-bearing state zero and separately records the exact retained identifier-bearing DO arbitration metadata; no evidence calls retained metadata product-data zero or physically erased.
- [ ] If UI/rendering/layout changed: `visual-qa-dogfood` evidence is captured, every absurdity ledger is closed, and automated visual metrics pass.
- [ ] After every product/Desk/archive/runtime terminal proof passes, reserve and attempt the exact Slugger handoff through the durable external notification journal. At most one spawn is permitted; observed zero/nonzero and crash-window uncertainty are reported truthfully, and no delivery/exactly-once claim is made for an uncertain reservation.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- Use strict red-green-refactor delivery; failing-test evidence is retained without committing or pushing an intentionally failing tree. For this task only, this product/repository rule governs over generic Work Planner/Work Doer phase-commit and per-unit-status instructions: each `a` red phase is executed and evidenced but remains uncommitted, the matching `a` tests and `b` implementation land together in one green atomic commit with both statuses, and the `c` verification phase receives its own evidence/status commit. This changes checkpoint timing only and does not waive test-first execution, reviewer gates, or any verification.
- No coverage exclusion or threshold bypass applies to new code.
- Cover success, error, boundary, retry, race, recovery, null, and empty branches.
- Exercise Cloudflare-specific behavior in the real Workers runtime.
- Include every touched executable and shared module in coverage and typecheck gates.
- The doing-owned execution contract defines the exact measured registry, commands, artifacts, and warning rules.

## Open Questions
- None. Ari delegated the product decisions in chat. Human input is needed only for unavailable Cloudflare/GitHub credentials, a billing/capability limitation, or an unsafe destructive production action.

## Decisions Made
- Shopping restoration is one shared behavior across web, REST v1, and MCP. Re-adding checked or deleted items restores them predictably, while repeated and concurrent mutations preserve one coherent list.
- Authenticated cooking is Cloudflare Durable Object-canonical so progress can continue across devices. D1 remains the owner-private query/history projection, authenticated client storage remains a non-canonical offline queue, and anonymous progress remains local-only.
- Cook sessions pin a recipe snapshot. Recipe edits never silently remap an active session, completion and abandonment do not create social activity, and owner-authorized purge removes disposable content while retaining only declared arbitration metadata.
- SavedRecipe is private canonical save state, separate from cookbook membership. Search and API projections are viewer-scoped, public counts do not ship, and personalized reads remain private and non-cacheable.
- Manual controlled course plus owner-authored custom tags ship now. AI categorization is deferred until a proposal/review model and deliberate UX exist.
- REST v1 and MCP receive backward-compatible neutral recipe metadata and detail-only scaling. Existing public field types and stored recipe quantities remain unchanged; private isSaved is REST-only and entitlement-gated.
- Current navigation remains unless testing proves an accessibility or reachability defect. Changed product surfaces receive desktop/mobile visual QA; no broad dock redesign ships.
- Import remains agent/API-only. No first-party import surface, Pebble-specific behavior, automatic RecipeSpoon creation, public cook history, or cross-user collaborative cooking ships.
- Delivery is exact-SHA and Cloudflare-first: validate in the Workers runtime, deploy and clean QA before merge, merge only reviewed green code, then verify the automatic production workflow, canonical health, live product/API behavior, and residue cleanup.
- Release execution is evidence-driven and crash-recoverable. Provider outages wait durably rather than becoming code repairs; true code/configuration defects use reviewed repair successors; task/track/archive finality precedes the single truthfully recorded Slugger handoff attempt.
- The exact implementation authority is the doing-owned `./2026-07-14-1313-doing-clem-feedback-e2e/EXECUTION-CONTRACT.md`. It preserves all schemas, CLI vectors, storage bytes, ordering, crash recovery, and terminal protocols formerly embedded here; the doing units own their red/green/verification delivery.

## Context / References
- `./2026-07-14-1313-clem-feedback-source.md` is the item-by-item feedback disposition.
- `./2026-07-14-1313-doing-clem-feedback-e2e/EXECUTION-CONTRACT.md` is the doing-owned exact technical authority.
- `./2026-07-14-1313-doing-clem-feedback-e2e/UNIT-29.2-DETAIL.md` preserves granular release test, implementation, and verification ownership.
- The current product already has local cooking progress, Cloudflare Worker infrastructure, owner kitchen views, search, cookbook membership, REST v1, and MCP recipe-read surfaces that this work extends.
- Integrated current-main architecture and regression tests remain binding.
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Wrangler environments](https://developers.cloudflare.com/durable-objects/reference/environments/)
- [GitHub workflow-run REST](https://docs.github.com/en/rest/actions/workflow-runs)

## Notes
The task is deliberately broad because the feedback describes an end-to-end product boundary. Delivery stays reviewable through strict TDD units, atomic commits, QA-before-merge sequencing, and a final continuation scan rather than by dropping any accepted thread.

## Progress Log
- 2026-07-14 13:15 Created.
- 2026-07-14 13:24 Initial planning approved after two review rounds.
- 2026-07-15 Latest-model and upstream audits reopened the task for full product, privacy, compatibility, runtime, cleanup, and delivery hardening.
- 2026-07-15 through 2026-07-17 repeated independent planning and doing reviews closed product and release ambiguities while preserving every accepted/rejected feedback disposition.
- 2026-07-16 current main was integrated and its overlapping architecture and regression gates became permanent constraints.
- 2026-07-16 through 2026-07-17 Quality Rounds 13-52 repeatedly reopened review as new execution, evidence, security, recovery, and terminal-delivery findings emerged.
- 2026-07-17 Quality Round 53 returned 15 findings, 12 unique. Detailed implementation contracts moved out of planning into the doing-owned execution contract; Unit29.2 was split into independently executable red/green/verification groups; predecessor, locator, URL, capability, coverage, Git, cleanup, terminal-command, and Slugger contracts were repaired directly.
- 2026-07-17 Quality restarts at Round 54 on a fresh synchronized checkpoint.
- 2026-07-17 Quality Round 54 returned process/executor, schema/security, and terminal/archive findings. The task-specific red-first checkpoint override is now explicit; planning retains only product scope/acceptance while the doing-owned execution contract closes every technical finding. Quality restarts at Round 55.
- 2026-07-17 Quality Round 55 returned process/executor, schema/security, and terminal/archive findings. The doing authority now separates pre-merge fixes from post-merge successors, closes coverage/reviewer/continuation schemas, uses descriptor-only D1 secrets, publishes Slugger only after remote readback, and journals command/resource cleanup crash boundaries. Quality restarts on the repaired checkpoint.
- 2026-07-17 Quality Round 56 returned process/executor, schema/security, and terminal/archive findings. The doing authority now covers Unit36 pre-merge disposition, every owning-unit wait/blocker, post-Unit37 terminal retry/wait/repair, remote-delete response loss, atomic worktree teardown, exact Desk Git publication, and the non-self-hashed coverage summary. Quality restarts on the repaired checkpoint.
- 2026-07-17 Quality Round 57 returned process/executor, schema/security, and terminal/archive findings. The doing authority now gives terminal-origin repair a passed-run branch, represents agent-mode pre-merge failures, makes terminal waits/blockers resumable, fixes production D1 secret acquisition, keeps successor evidence manifest-owned, synchronizes archive retry schemas, totalizes terminal failure codes, fixes all Slugger paths, and fast-forwards an initially stale clean Desk main. Quality restarts on the repaired checkpoint.
- 2026-07-17 Quality Round 58 returned process/executor, schema/security, and terminal/archive findings. The doing authority now defines deterministic full-key successor bootstrap, a runs-empty pre-release manifest and eight delivery phases, epoch-scoped agent recovery, honest probe/operator blocker resolution, manifest-owned successor waits, collision-free terminal evidence and retry hashes, already-archived predecessor repair, acyclic provisional validation/index/final receipt ordering, post-receipt Desk-control cleanup/Slugger failure handling, and a total cleanup failure-code table. Quality restarts on the repaired checkpoint.
- 2026-07-17 Quality Round 59 returned process/executor, schema/security, and terminal/archive findings plus the parent audit. The doing authority now uses owner-qualified retry keys, typed pre-release and terminal manifest registries, source-containing successor bootstrap commits, invocation-bound planner/doer attempts, total terminal evidence and cleanup codes, domain-specific wait/blocker recovery, disposition-frozen archive state, non-colliding leaf/relay receipts, and state-specific archived predecessor closed sets. Quality restarts on the repaired checkpoint.
- 2026-07-17 Quality Round 60 returned process/executor, schema/security, and terminal/archive findings plus the parent audit. The doing authority now registers terminal worktree cleanup, fully serializes terminal snapshots/evidence, includes sanitizer codes, closes wait/blocker crash prefixes, carries archive state plus checkpoint through lineage, separates stage-kind from terminal-kind archive states, distinguishes consumed from created repair indexes, defines all eight successor phase matrices, and journals every source write/index/commit/ref boundary. Quality restarts on the repaired checkpoint.
- 2026-07-17 Quality Round 61 returned process/executor, schema/security, and terminal/archive findings plus the parent audit. The doing authority now defines every artifact/process/failure payload; reuses terminal-kind cleanup; preserves immutable terminal result prefixes; gives Desk-control retries ordinals; closes prepared/archive-generation states; freezes the final result/link schemas; makes successor bootstrap, task seed, paused agent dispatch, prompts, handoff, and implementation evidence deterministic; and binds trusted tools, provider parsers, coverage classification, and smoke pass oracles. Quality restarts on the repaired checkpoint.
- 2026-07-17 Round 61's final parent-integrity pass found fourteen additional executable-contract gaps. The final authority now closes successful-result payloads, wrapper-owned control state, acyclic disposition-containing track payload attestation, prepared-first bootstrap, authorized paused agents, registered suite/review handoff evidence, set-bound prompts, actual uncommitted red trees, deterministic one-file API and A/B lifecycle smoke, OS-specific process probes, numeric provider caps, independent repaired-intermediate paths, and same-generation/no-second-delivery Slugger retries. Quality restarts only after this complete checkpoint.
- 2026-07-18 Round 61's seven cold-gate closure passes converged after fresh process/executor and successor/archive verification. The final authority now also totalizes manifest-first gate/child aborts and terminalization, owner-local planner/track process envelopes, product lease evidence retention, track lease observation and private-index bytes, scan/receipt lineage, exact suite producer prefixes, reconciled pre/post-state proof, commit-authority receipts, and registry-bound successor command plans/evidence. A synchronized full quality round follows this checkpoint.
- 2026-07-18 Quality Round 62 returned five findings across process/executor, terminal/archive, and schema/security lenses: live successor agents lacked cancellation authority; successor producer TDD lived after implementation; bootstrap push response loss had no observable fence; Work Doer could mutate canonical promoted documents without exact recovery state; and all-tombstone migration survivors were accidentally retimed. The repaired authority now owns persisted role-bound cancellation with finite waits, Unit29.2.5 red-first producer coverage, ordinal bootstrap push outcomes, registered product runtime transitions plus exact Desk ledgers/checkpoints, immutable canonical documents, and branch-specific migration timestamps. Quality restarts on the synchronized repaired checkpoint.
- 2026-07-18 Quality Round 63 returned six unique findings across its three cold lenses: Work Doer dispatch did not authenticate its runtime target; transition response-loss receipts/retries were incomplete; bootstrap retries could not adopt retained local state; implementation reviews reused singleton paths; an all-tombstone survivor could change behind an old cursor; and native tied sort/filter comparators disagreed. The repaired authority now binds the runtime path through prompt/intent/receipt/result, separates transition retries from doer attempts with exact outcomes, defines bootstrap create/adopt/conflict matrices, qualifies every implementation-review attempt, preserves all-tombstone survivors byte-for-byte, and mandates one UTF-8 BINARY cursor comparator. Quality restarts on a fresh synchronized checkpoint.
- 2026-07-18 Quality Round 64 returned ten unique process, schema, and terminal findings. The repaired authority now observes missing branches with exact ls-remote exit semantics; terminalizes review findings and spontaneous suite/review failures; adds the exact unit-recording action and emits receipts at their actual pushed commits; caps cancellation globally; authorizes release through one immutable receipt; owns reopen transforms before dispatch; derives finding ownership from exact successor path blocks; freezes review templates/set hashes; and gives BlobState a bounded canonical base64 representation. Quality restarts on a fresh synchronized checkpoint.
- 2026-07-18 Quality Round 65 returned ten unique process, schema, and terminal findings. The repaired authority now groups red-first a+b work into one pushed checkpoint without committing a red tree; retains failed bootstrap fetch observations; types runtime probes and interrupted-suite retries; limits implementation findings to deterministically owned repo paths; rolls branch conflicts into a fresh successor without mutating shared state or asking for ownership; freezes the surviving spawn-gate source before validator cleanup; and gives final ArchiveValidation attempts the exact TrackArchive proof required by their receipt/envelope. Quality restarts on a fresh synchronized checkpoint.
- 2026-07-18 Quality Round 66 returned eight unique process, schema, and terminal findings. The repaired authority now authenticates spawn-gate bytes through two no-follow source descriptors rather than a mutable path; models absent/paused probes and invalid completed output for every runtime owner; gives interrupted planner retries literal prompt authority; makes branch conflict and rollover legal, derived, cross-linked journal states; freezes checkpoint hash preimages; bootstraps terminal execution through a retained standalone bundle before canonical ownership; and publishes an acyclic track-move fence before host-only state. Quality restarts on a fresh synchronized checkpoint.
- 2026-07-18 Quality Round 67 returned nine unique process, schema, and terminal findings. The repaired authority now gives grouped red evidence an exact coordinator action and crash protocol; defines planner/doer runtime output bytes; persists typed rollover collisions; executes all binaries and script entries through authenticated descriptors; removes terminal bootstrap's mutable build graph; journals bootstrap process ownership; proves canonical main attachment/ref/index/worktree state; and gives track-fence publication complete schemas, concurrent descendant rebasing, and a non-human fresh-scan outcome. Quality restarts on a fresh synchronized checkpoint.
- 2026-07-18 Quality Round 68 returned twelve unique process, schema, and terminal findings. The repaired authority now gives every successor command one coordinator-owned descriptor effect and ordered multi-red evidence; closes descriptor fd/secret/version/spawn identities; registers root and recursive terminal launch artifacts; makes recursive launch and retained bootstrap cleanup crash-recoverable; freezes each track-fence publication attempt as an immutable receipt; and expands rollover absence to Git worktree registration plus every Desk-prefix blob. Quality restarts on a fresh synchronized checkpoint.
- 2026-07-18 Quality Round 69 returned eleven unique process, schema, and terminal findings. The repaired authority now gives Work Doer a durable activation/request/exchange handshake; qualifies every command artifact and retry; preserves descriptor process evidence; recovers secret writes by generation; closes terminal artifact phases and cleanup-member bytes; accepts exact fence descendants; removes every local rollover ancestor; and makes a preloaded external cleaner's completion receipt the sole final terminal result. Quality restarts on a fresh synchronized checkpoint.
