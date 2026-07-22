# Doing: Homepage social card

**Status**: done
**Execution Mode**: direct
**Created**: 2026-07-21 11:59
**Planning**: ./2026-07-21-1150-planning-homepage-social-card.md
**Artifacts**: ./2026-07-21-1150-doing-homepage-social-card/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts only when the user explicitly requested interactive per-unit approval; otherwise convert this to `spawn` or `direct` unless a hard exception is present
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Give `https://spoonjoy.app/` a complete, crawler-readable Open Graph and Twitter preview backed by a real 1200×630 PNG so LinkedIn can render a branded Featured card instead of the current gray placeholder.

## Upstream Work Items
- None

## Completion Criteria
- [x] Homepage HTML exposes absolute canonical, `og:title`, `og:description`, `og:type=website`, `og:url`, `og:image`, `og:image:type=image/png`, image dimensions, and Twitter-card fields.
- [x] The declared social image is a valid 1200×630 PNG with a branded, legible design.
- [x] Production homepage HTML contains the expected metadata without Cloudflare challenge markers.
- [x] Production serves the declared image as `image/png`; its bytes have the PNG signature and a 1200×630 IHDR.
- [x] Homepage and image return real content rather than a Cloudflare challenge when requested with LinkedIn's crawler user agent.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings
- [x] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## TDD Requirements
**Strict TDD — no exceptions:**
1. **Tests first**: Write failing tests BEFORE any implementation
2. **Verify failure**: Run tests, confirm they FAIL (red)
3. **Minimal implementation**: Write just enough code to pass
4. **Verify pass**: Run tests, confirm they PASS (green)
5. **Refactor**: Clean up, keep tests green
6. **No skipping**: Never write implementation without failing test first

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header MUST start with status emoji (⬜ for new units).**

### ✅ Unit 0: Setup/Research
**What**: Capture baseline production responses with LinkedIn's crawler user agent, verify the current homepage metadata gap, and confirm Cloudflare's static-asset/deploy path.
**Output**: Baseline headers and HTML evidence in the artifacts directory.
**Acceptance**: Evidence shows the real homepage and PNG assets are crawler-accessible while the homepage lacks the complete social contract.

### ✅ Unit 1a: Homepage social metadata and raster card — Tests
**What**: Update `test/routes/index.test.tsx` to require the complete metadata contract and add a test that first asserts `public/og/spoonjoy-home.png` exists, then reads its bytes and asserts PNG signature plus 1200×630 IHDR dimensions.
**Output**: Tests that fail because metadata fields and the PNG asset do not yet exist.
**Acceptance**: The targeted test command fails through clean metadata and file-existence assertions rather than an unhandled `ENOENT`, setup, or mock error.

### ✅ Unit 1b: Homepage social metadata and raster card — Implementation
**What**: Add the metadata entries to `app/routes/_index.tsx`, create a non-executable static SVG source at `assets/og/spoonjoy-home.svg`, and commit its rasterized `public/og/spoonjoy-home.png` output; `meta()` remains the only new covered executable code.
**Output**: Complete homepage metadata and a 1200×630 PNG social card.
**Acceptance**: Targeted tests pass, the route builds without warnings, and metadata points only to absolute production URLs.

### ✅ Unit 1c: Homepage social metadata and raster card — Coverage & Refactor
**What**: Run coverage and the repository's complete validation gates, then refactor only if needed.
**Output**: Coverage and validation evidence in the artifacts directory.
**Acceptance**: New executable code is fully covered, all tests pass, typecheck/build succeed, and no warnings remain.

### ✅ Unit 1d: Homepage social card — Visual QA Dogfood
**What**: Apply the `visual-qa-dogfood` critique method to the standalone raster asset, capture the rendered image at full size and LinkedIn-card scale, inspect legibility, and maintain an absurdity ledger without treating the unchanged homepage route as a visual target.
**Output**: Image evidence and a closed absurdity ledger in the artifacts directory.
**Acceptance**: The card is branded and legible, with no ready or reviewer-gated visual findings.

### ✅ Unit 2: Delivery and production smoke
**What**: Cold-review the branch, open and merge the PR, verify the deployment for the merged commit, assert the production `og:image` value exactly matches the fetched asset URL, and probe homepage/image bytes with LinkedIn's crawler user agent.
**Output**: PR, deployment, and production smoke evidence.
**Acceptance**: Production HTML contains every expected tag without challenge markers, and the image returns `image/png` with valid 1200×630 PNG bytes.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./2026-07-21-1150-doing-homepage-social-card/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-21 11:59 Created from planning doc after cold-review convergence.
- 2026-07-21 12:05 Unit 0 complete: LinkedInBot received the real homepage and a valid PNG asset without Cloudflare challenge markers; the homepage exposed only its basic description and no canonical, Open Graph, or Twitter metadata. Unit review skipped because this was a read-only evidence capture.
- 2026-07-21 12:11 Unit 1a complete: targeted tests failed cleanly on the fourteen missing social metadata entries and the missing raster asset.
- 2026-07-21 12:19 Unit 1b complete: added the complete homepage metadata contract plus a branded 1200×630 raster card sourced from a committed static SVG; 20 targeted tests passed and the production build completed cleanly.
- 2026-07-21 12:28 Operator feedback correction: removed the invented faux-cookbook illustration and rebuilt the card around the real food photograph already used by Spoonjoy's guest homepage; 20 targeted tests remained green.
- 2026-07-21 12:40 Unit 1c complete: typecheck and production build passed cleanly; 8,112 application tests plus 13 worker tests passed with 100% statement, branch, function, and line coverage.
- 2026-07-21 12:50 Unit 1c cold-review findings closed: added explicit typecheck proof, applied all local D1 migrations, seeded the disposable e2e baseline, and passed all 63 Playwright tests.
- 2026-07-21 14:22 Unit 1d complete: captured native and LinkedIn-scale renders, closed the absurdity ledger, reran all 20 targeted tests, and passed a cold visual reviewer gate.
- 2026-07-21 15:08 PR #288 CI repair: a newly published DOMPurify advisory made the dependency gate red; pinned the first patched release, confirmed the old version reproduced the advisory and the fixed version was clean, reran every local gate with exact test-count parity, and passed a cold dependency review.
- 2026-07-21 17:41 Unit 2 complete: PR #288 merged as `faa6c9eba1b594b6a20b3df19c2db3fc3b8e48d4`; Sharp repair PR #289 merged as `193910eb7c54eb2689b91f4902bac16bd18cc448`; exact-head CI run `29877381557` and Production Deploy run `29878085678` succeeded; LinkedInBot received real HTTP 200 homepage/image responses with the exact metadata contract and a byte-identical 1200×630 PNG. Exact release-source, response, metadata, and image evidence is captured in `unit-2/`.
- 2026-07-21 17:46 Unit 2 cold review converged after aligning the captured homepage byte count with the normalized committed response artifact.
