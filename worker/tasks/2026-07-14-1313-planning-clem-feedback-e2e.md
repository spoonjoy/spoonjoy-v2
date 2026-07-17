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
- Use strict red-green-refactor delivery; failing-test evidence is retained without committing an intentionally failing tree.
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
