# Doing: Kitchen Navigation Reorg

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-07-13 14:22
**Planning**: ./2026-07-13-1405-planning-kitchen-nav-reorg.md
**Artifacts**: ./2026-07-13-1405-doing-kitchen-nav-reorg/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts only when the user explicitly requested interactive per-unit approval; otherwise convert this to `spawn` or `direct` unless a hard exception is present
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Make Spoonjoy's primary organization obvious across the web app and Apple native app: a signed-in cook can quickly find their own recipes, saved recipes, cookbooks, shopping list, fellow chefs, and global search without decoding the current mixed kitchen/index language.

## Upstream Work Items
- None

## Completion Criteria
- [ ] Signed-in web desktop navigation exposes exact labels/routes: `Kitchen` -> `/`, `My Recipes` -> `/my-recipes`, `Saved` or `Saved Recipes` -> `/saved-recipes`, `Cookbooks` -> `/cookbooks`, `Shopping List` -> `/shopping-list`, `Chefs` -> `/chefs`, and `Kitchen Search` -> `/search`.
- [ ] Web keeps `/recipes` as `Explore Recipes` / broader all-recipes browsing and does not reuse that label for the current user's authored recipes.
- [ ] Web My Recipes at `/my-recipes` shows recipes authored by the current user through `Recipe.chefId`, supports a local search/filter query, and provides a create-recipe action.
- [ ] Web Saved Recipes at `/saved-recipes` shows deduped recipes saved through cookbooks owned by the current user through `RecipeInCookbook` plus `Cookbook.authorId`, including the user's own recipes when saved in a cookbook, and supports a local search/filter query.
- [ ] Web Cookbooks at `/cookbooks` is a real owned-cookbooks surface based on `Cookbook.authorId`, supports a local search/filter query, and no longer redirects authenticated users to `/?tab=cookbooks`.
- [ ] Web Chefs at `/chefs` includes existing fellow-chef semantics from `app/lib/fellow-chefs.server.ts`, a "Chefs Using My Recipes" section, and a private chronological activity section that excludes shopping-list events.
- [ ] Web global search remains at `/search` with existing scopes `all`, `recipes`, `cookbooks`, `chefs`, and `shopping-list`; personal drawer search/filter inputs do not create a second global-search semantics.
- [ ] Web "Latest from the kitchen" copy is replaced with `On the Counter`, with deterministic selection from the current display recipe ordering and no false freshness claim.
- [ ] Web mobile navigation labels use kitchen terms (`My Kitchen`, `My Recipes`, `Saved`, `Cookbooks`, `Shopping List`, `Chefs`, `Search`) and the dock is visually glass/material-like while preserving fixed bottom safe-area behavior at 320-390px and desktop-hidden behavior at `lg`.
- [ ] Native compact iPhone `TabView` exposes exactly five tabs: `Kitchen`, `My Recipes`, `Saved`, `Cookbooks`, and `Shopping List`; `Search` is removed as a bottom tab and remains reachable via toolbar/menu/native `.searchable` path.
- [ ] Native regular-width `NavigationSplitView` sidebar exposes `Kitchen`, `My Recipes`, `Saved Recipes`, `Cookbooks`, `Shopping List`, `Chefs`, `Kitchen Search`, `Imports`, and `Settings`.
- [ ] Native My Recipes filters cached/displayed recipes to the current authenticated chef when `currentChefID` is known; signed-out or unavailable-current-chef fallback stays safe and non-crashing.
- [ ] Native Saved Recipes uses the same saved-through-cookbooks definition as web by deduping `contentState.cookbooks.flatMap(\\.recipes)` by recipe ID.
- [ ] Native tab bar/mobile navigation uses system material/translucent chrome (`UITabBarAppearance`/SwiftUI toolbar material) instead of the current opaque bone treatment, with tests proving translucency/material setup.
- [ ] Web `docs/design-language.md` and native `docs/native-design-language.md` document the finalized drawer names, saved-recipes definition, search posture, and mobile navigation behavior.
- [ ] Native screenshot validation runs against the highest available bootable iPhone simulator resolved by `.github/scripts/resolve-ios-simulator-destination.py` or a pinned `SPOONJOY_IOS_SIMULATOR_NAME`/`SPOONJOY_IOS_SIMULATOR_UDID`, records the resolved simulator name/UDID in artifacts or blocker logs, and runs macOS validation against `generic/platform=macOS`.
- [ ] Native route-matrix validation covers at least `kitchen`, `recipes`, `saved-recipes`, `cookbooks`, `shopping-list`, and `search` or the nearest supported route variants needed to prove the new compact tabs, regular sidebar, and toolbar search path.
- [ ] Native `design-review.json` for successful captures is schema-valid under `scripts/validate-design-review.rb` and includes `mobileScreenshot`, `desktopScreenshot`, `dynamicType`, `voiceOverLabels`, `keyboardNavigation`, `reduceMotion`, `contrast`, `kitchenTableHierarchy`, `noOverlap`, `screenshotRoute`, route-specific signed-in proof fields, and iOS/macOS `accessibilityProofArtifacts`.
- [ ] Native app-emitted accessibility proof uses `SPOONJOY_SCREENSHOT_ACCESSIBILITY_PROOF_PATH` or `SIMCTL_CHILD_SPOONJOY_SCREENSHOT_ACCESSIBILITY_PROOF_PATH`, includes `emittedBy: SpoonjoyApp`, expected bundle identifiers, `minimumTargetSize`, `textFits`, `noTinyClusters`, observed Dynamic Type and Reduce Motion values, route-specific `routeEvidence`, and `offlineIndicatorProof`.
- [ ] Native `routeEvidence` names actual visible anchors for VoiceOver labels, keyboard navigation targets, Dynamic Type text styles, contrast pairs, hierarchy anchors, and layout guards for each changed route; route-agnostic boolean-only proof is not accepted.
- [ ] Native `offlineIndicatorProof` names `OfflineStatusView`, visible states `offline`, `stale`, `queuedWork`, `syncFailure`, `conflict`, `blocker`, `destructiveConfirmation`, dismissible states `offline` and `stale`, severe states `queuedWork`, `syncFailure`, `conflict`, `blocker`, `destructiveConfirmation`, hidden states `synced` and `dismissed`, VoiceOver label proof, `Hide offline status` dismiss button proof, and severity-correct mapping.
- [ ] Native screenshot blockers produce schema-valid `design-review-blocked.json` under `scripts/validate-design-review-blocker.rb` and do not leave a partial `design-review.json`.
- [ ] Web visual validation captures mobile and desktop evidence for the home, personal drawers, search access, and mobile dock; any absurdity ledger entries for this task are closed or explicitly blocked with evidence.
- [ ] No OAuth files or behavior are edited except incidental imports/tests required by navigation compilation.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

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

### ⬜ Unit 0: Setup/Research
**What**: Reconfirm clean worktrees, inspect exact route/test files, and record validation commands for both repos before edits. Keep OAuth files out of the write set.
**Output**: Artifact notes under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-0/` covering repo status, relevant test targets, and any discovered shared-file constraints.
**Acceptance**: `git status --short --branch` is captured for web and native worktrees; target files and commands are listed; no code files are edited in this unit.

### ⬜ Unit 1a: Web Kitchen Drawers — Tests
**What**: Write failing tests for `/my-recipes`, `/saved-recipes`, `/cookbooks`, and `/chefs` loader/UI behavior in `test/routes/*`, plus navigation expectations in `test/root-navbar.test.tsx` or the existing root/mobile navigation tests.
**Output**: Failing web tests in `test/routes/my-recipes.test.tsx`, `test/routes/saved-recipes.test.tsx`, updated `test/routes/cookbooks-index.test.tsx`, `test/routes/chefs.test.tsx`, and navigation tests; red-test logs saved under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-1a/`.
**Acceptance**: Focused web tests fail red because routes, loader data, labels, or redirect behavior do not yet match the new drawer model.

### ⬜ Unit 1b: Web Kitchen Drawers — Implementation
**What**: Add route entries in `app/routes.ts`; implement `app/routes/my-recipes.tsx`, `app/routes/saved-recipes.tsx`, `app/routes/chefs.tsx`; replace `app/routes/cookbooks._index.tsx` redirect with owned-cookbooks UI; update `app/root.tsx` and `app/components/navigation/mobile-nav.tsx` labels/routes.
**Output**: Web route/navigation source changes in `app/routes.ts`, `app/routes/my-recipes.tsx`, `app/routes/saved-recipes.tsx`, `app/routes/chefs.tsx`, `app/routes/cookbooks._index.tsx`, `app/root.tsx`, and `app/components/navigation/mobile-nav.tsx`; green focused-test logs saved under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-1b/`.
**Acceptance**: Unit 1a focused tests pass green; `/recipes` remains broader Explore Recipes; no OAuth route/source files are modified.

### ⬜ Unit 1c: Web Kitchen Drawers — Coverage & Refactor
**What**: Add or extend helpers only where they remove duplication for drawer loaders/cards/search filtering, and cover empty, unauthenticated, duplicate saved recipe, and non-owner cases.
**Output**: Covered helper/test updates plus coverage or focused-test logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-1c/`.
**Acceptance**: Focused route/navigation tests pass with coverage for all new loader/helper branches; code remains aligned with existing React Router/Tailwind patterns.

### ⬜ Unit 2a: Web Search, Editorial Module, And Mobile Glass — Tests
**What**: Write failing tests for `On the Counter` copy/aria label in `app/routes/_index.tsx`, global search reachability, drawer local search/filter behavior, and `SpoonDock`/`MobileNav` glass classes and small-screen-safe labels.
**Output**: Failing updates in index/search/drawer/mobile navigation tests and red logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-2a/`.
**Acceptance**: Focused tests fail red on current `Latest from the kitchen`, old mobile labels, missing drawer search/filtering, or old dock surface.

### ⬜ Unit 2b: Web Search, Editorial Module, And Mobile Glass — Implementation
**What**: Replace misleading editorial copy in `app/routes/_index.tsx`; preserve deterministic featured recipe selection; add scoped filter/search inputs to personal drawers; update `app/components/navigation/spoon-dock.tsx` and CSS in `app/styles/tailwind.css` for progressive glass/material treatment with safe fallback.
**Output**: Source changes in `_index`, drawer route components, `SpoonDock`, `MobileNav`, and Tailwind/CSS plus green focused-test logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-2b/`.
**Acceptance**: Unit 2a tests pass; mobile dock stays fixed-bottom, safe-area-aware, `lg:hidden`, and usable at 320-390px.

### ⬜ Unit 2c: Web Search, Editorial Module, And Mobile Glass — Coverage & Refactor
**What**: Run focused web tests for index, search, navigation, and drawer routes; refactor only local UI duplication introduced by Units 1-2.
**Output**: Focused test and coverage logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-2c/`, with any local refactor commits documented in the progress log.
**Acceptance**: Focused web route/component tests are green, no warnings, and new helpers have branch/edge coverage.

### ⬜ Unit 3a: Native Route Model And Saved Recipes — Tests
**What**: Write failing Swift tests for `AppRoute.savedRecipes`, `AppSection.savedRecipes`, state identifier round-trip, current-chef filtering for My Recipes, saved-recipes dedupe from `Cookbook.recipes`, and sidebar/compact tab source contracts.
**Output**: Failing Swift tests in `Tests/SpoonjoyCoreTests/AppStateTests.swift`, recipe-catalog/view-model tests, and/or native design contract tests; red logs saved under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-3a/`.
**Acceptance**: Focused Swift tests fail red against the current native route model and tab/sidebar definitions.

### ⬜ Unit 3b: Native Route Model And Saved Recipes — Implementation
**What**: Update `Sources/SpoonjoyCore/AppState/AppRoute.swift`; add saved-recipes view model/surface code in `Sources/SpoonjoyCore/Features/RecipeCatalog` if needed; add `Apps/Spoonjoy/Shared/Views/SavedRecipesView.swift`; register any new Swift view in both iOS and macOS sources in `Spoonjoy.xcodeproj/project.pbxproj`; update `Apps/Spoonjoy/Shared/Views/RecipesView.swift` for "My Recipes" copy/filtering; wire destinations in `Apps/Spoonjoy/Shared/AppShell/PlatformNavigationView.swift`.
**Output**: Native route/model/view source changes and green focused Swift logs saved under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-3b/`.
**Acceptance**: Unit 3a tests pass; saved recipes are deduped from cookbook membership; My Recipes is safe when `currentChefID` is nil.

### ⬜ Unit 3c: Native Route Model And Saved Recipes — Coverage & Refactor
**What**: Cover empty saved-recipes, duplicate recipes across cookbooks, signed-out/current-chef-unavailable fallback, and route parsing rejection of unsafe identifiers.
**Output**: Additional Swift tests and coverage/focused-test logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-3c/`.
**Acceptance**: Focused Swift coverage for new route/view-model code is complete and tests stay green with warnings as errors.

### ⬜ Unit 4a: Native Navigation And Liquid Glass — Tests
**What**: Update/add failing tests in `Tests/SpoonjoyCoreTests/NativeMobileDesignContractTests.swift`, `Tests/SpoonjoyCoreTests/KitchenRecipesStructureContractTests.swift`, and related source-contract tests for five compact tabs, regular sidebar labels, toolbar search access, `On the Counter`, and translucent/material tab bar appearance.
**Output**: Failing native source-contract tests and red logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-4a/`.
**Acceptance**: Focused native design-contract tests fail red on current Search tab, opaque tab bar, old labels, and old editorial copy.

### ⬜ Unit 4b: Native Navigation And Liquid Glass — Implementation
**What**: Update compact `TabView` and sidebar in `PlatformNavigationView.swift`; keep search available through toolbar/menu/native `.searchable`; update `Apps/Spoonjoy/iOS/SpoonjoyiOSApp.swift` to use translucent/material `UITabBarAppearance`; update native route titles and labels.
**Output**: Native navigation/chrome source changes and green focused native design-contract logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-4b/`.
**Acceptance**: Unit 4a tests pass; bottom tabs are exactly Kitchen, My Recipes, Saved, Cookbooks, Shopping List; Search is reachable from toolbar/menu.

### ⬜ Unit 4c: Native Navigation And Liquid Glass — Coverage & Refactor
**What**: Run focused native tests for app state, navigation contracts, and design contracts; refactor duplication in title/label mapping only if tests show repeated fragile strings.
**Output**: Focused native test logs and any local refactor diff notes under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-4c/`.
**Acceptance**: Focused native tests pass with warnings as errors and no route/tab source-contract holes.

### ⬜ Unit 5a: Web/Native Design Docs And Screenshot Contract — Tests
**What**: Write failing source-contract tests for web `docs/design-language.md`, native `docs/native-design-language.md`, and native screenshot route/proof support for `saved-recipes` if the existing harness lacks it.
**Output**: Failing docs/harness source-contract tests and red logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-5a/`.
**Acceptance**: Tests fail red until docs and harness/proof route anchors include the kitchen drawer model, saved-recipes definition, search posture, and mobile navigation behavior.

### ⬜ Unit 5b: Web/Native Design Docs And Screenshot Contract — Implementation
**What**: Update web/native design docs; update `scripts/capture-native-screenshots.sh`, `scripts/capture-native-screenshot-matrix.sh`, and `Apps/Spoonjoy/Shared/Components/ScreenshotAccessibilityProofWriter.swift` only if needed for `saved-recipes`/new route evidence and design-review validation.
**Output**: Documentation and screenshot/proof harness source changes plus green source-contract logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-5b/`.
**Acceptance**: Unit 5a tests pass; native design-review validator accepts successful captures or schema-valid blockers for the new/changed routes.

### ⬜ Unit 5c: Web/Native Design Docs And Screenshot Contract — Coverage & Refactor
**What**: Run native screenshot-contract tests and documentation source-contract tests; refactor proof route evidence tables only to keep route-specific anchors maintainable.
**Output**: Contract test logs and route-evidence refactor notes under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-5c/`.
**Acceptance**: Contract tests pass and no route uses route-agnostic proof.

### ⬜ Unit 6a: Cross-Surface Validation — Capture
**What**: Run full or near-full validation suites before final visual QA: web `pnpm run typecheck`, `pnpm run test:coverage`, selected Playwright if available; native `swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors`, `swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors`, coverage enforcement, Xcode builds/tests where local Xcode permits, and `scripts/verify-native-scenarios.sh --stage final`.
**Output**: Raw validation logs, coverage paths, and any native blocker JSON paths under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-6a/`.
**Acceptance**: Validation results are captured without making source changes in this unit; every failure is classified as implementation fix, test expectation fix, or true local capability blocker.

### ⬜ Unit 6b: Cross-Surface Validation — Targeted Fixes
**What**: Address failures classified in Unit 6a with the smallest targeted test/code/doc changes, preserving TDD for any behavior bug and avoiding new unrelated scope.
**Output**: Fix commits and focused rerun logs under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-6b/`, or a note that no implementation/test fixes were needed.
**Acceptance**: Each Unit 6a non-capability failure has a corresponding fix and focused green rerun, or a documented reason it was reclassified as a capability blocker.

### ⬜ Unit 6c: Cross-Surface Validation — Final Rerun
**What**: Rerun the full/near-full validation suite after targeted fixes, including web typecheck/coverage and native Swift/Xcode/scenario commands available in this runtime.
**Output**: Final validation logs and coverage/blocker artifacts under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-6c/`.
**Acceptance**: Required web/native validation passes with no warnings, except true local Xcode/simulator capability blockers are represented by schema-valid blocker artifacts.

### ⬜ Unit 6d: Cross-Surface Visual QA Dogfood
**What**: Start web dev server and capture mobile/desktop screenshots for home, `/my-recipes`, `/saved-recipes`, `/cookbooks`, `/chefs`, `/search`, and mobile dock; run native screenshot matrix for changed routes with design-review validation or fail-closed blocker artifacts.
**Output**: Web screenshots, native route-matrix JSON, native `design-review.json` or `design-review-blocked.json`, and absurdity ledger under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-6d/`.
**Acceptance**: Web screenshots show no overlapping text or broken nav; native `design-review.json` or `design-review-blocked.json` artifacts validate; absurdity ledger for this task is closed or blocked with evidence.

### ⬜ Unit 6e: Final Git And Commit Hygiene
**What**: Review both worktrees for unrelated changes, verify no OAuth files were edited, commit any remaining logical changes atomically, and capture final `git status --short --branch` plus `git diff --stat`.
**Output**: Final git hygiene logs and commit list under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-6e/`.
**Acceptance**: Both worktrees have only intended changes committed or explicitly documented; no unrelated/OAuth changes are included.

### ⬜ Unit 6f: Push, PR, And Available Deploy
**What**: Push web and native branches; create/update PRs where repo tooling supports it; run available web deployment/release steps if credentials/tooling allow; record any true credential/capability blockers.
**Output**: Push logs, PR URLs/IDs, deploy logs or blocker notes under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-6f/`.
**Acceptance**: Branches are pushed and PR/deploy status is recorded; any unavailable external operation is classified as a true credential/capability blocker with exact command/output.

### ⬜ Unit 6g: QA Cleanup And Slugger Notification
**What**: Run local disposable QA cleanup checks where applicable and notify Slugger with `ouro msg --to slugger "Done: ..."` after implementation/shipping status is recorded.
**Output**: QA cleanup logs and Slugger notification output under `./2026-07-13-1405-doing-kitchen-nav-reorg/unit-6g/`.
**Acceptance**: Cleanup checks report no Codex-created residue or document any true blockers; Slugger notification succeeds.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./2026-07-13-1405-doing-kitchen-nav-reorg/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-13 14:22 Created from planning doc
- 2026-07-13 14:31 Addressed granularity review: added unit outputs and split validation/final shipping units
- 2026-07-13 14:36 Added native Xcode project membership requirement for new Swift view files
