# Planning: Kitchen Navigation Reorg

**Status**: approved
**Created**: 2026-07-13 14:07

## Goal
Make Spoonjoy's primary organization obvious across the web app and Apple native app: a signed-in cook can quickly find their own recipes, saved recipes, cookbooks, shopping list, fellow chefs, and global search without decoding the current mixed kitchen/index language.

## Upstream Work Items
- None

## Scope

### In Scope
- Web app navigation and information architecture for signed-in users: My Kitchen, My Recipes, Saved Recipes, Cookbooks, Shopping List, Chefs, and Kitchen Search.
- Web personal drawer routes for authored recipes, saved recipes derived from owned cookbook memberships, owned cookbooks, shopping list, and chefs/activity using existing data model meanings.
- Web home kitchen refresh: keep the editorial visual treatment but replace the misleading "Latest from the kitchen" promise with an honest deterministic feature label.
- Web global search surfacing: keep one full Kitchen Search entry point with scopes, and add scoped search affordances inside personal drawers where useful.
- Web mobile navigation visual refresh using a progressive liquid-glass-style dock treatment while preserving safe-area behavior and the existing iOS Safari fixed-position stability guard.
- Native Apple compact navigation: iPhone tabs should be Kitchen, My Recipes, Saved, Cookbooks, and Shopping List; Search remains reachable through native search chrome/toolbars rather than occupying a tab.
- Native Apple regular-width navigation: expose the same kitchen drawers in the sidebar, including Chefs and Search.
- Native Apple saved-recipes surface derived from cookbook recipe membership, matching the web definition.
- Native Apple copy updates for "My Recipes", "Saved Recipes", "Shopping List", "Chefs", and the honest editorial feature label.
- Native Apple tab bar chrome iteration toward liquid-glass/material translucency using native UIKit/SwiftUI primitives.
- Web/native design-language documentation updates for the finalized kitchen drawer model and mobile navigation posture.
- Tests for changed web loaders/routes/navigation and native routing/navigation/design contracts.
- Web visual QA evidence for the signed-in home and new/changed drawer routes at mobile and desktop widths.
- Native visual QA evidence following `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/docs/native-design-language.md`, including `design-review.json` or fail-closed `design-review-blocked.json`, route screenshots, and app-emitted accessibility proof artifacts when the harness can run.
- Native screenshot harness updates if needed so changed routes have route-matrix support and route-specific accessibility proof.

### Out of Scope
- OAuth/auth flow changes; another agent is working there.
- Introducing a new bookmark/favorite/save database model.
- Public social feeds or shopping-list activity events.
- New privacy model, notification settings, or chef-relationship semantics beyond the existing fellow-chef/kitchen-visitor definitions.
- Production data migrations unless implementation discovers an unavoidable schema gap.
- App Store/TestFlight submission or external native release operations; local implementation, validation, branch push/PR, and web deploy/release through available repo tooling are in scope.

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
- [ ] Native route-matrix validation covers exact routes `kitchen`, `recipes`, `saved-recipes`, `cookbooks`, `shopping-list`, and `search`; if the current screenshot harness lacks `saved-recipes`, this task adds that support before visual QA.
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

## Open Questions
- None

## Decisions Made
- Use "My Kitchen" as the signed-in home/root concept, not as a peer tab.
- Use clear drawer labels over cute labels: My Recipes, Saved Recipes, Cookbooks, Shopping List, Chefs, Kitchen Search.
- Preserve `/recipes` as the broader Explore Recipes/all-recipes route while separating current-user authored recipes into `/my-recipes`.
- Define Saved Recipes as recipes in any cookbook owned by the current user, deduped by recipe ID; do not add a separate saved/bookmark model.
- Define My Recipes as recipes authored by the current user through `Recipe.chefId`.
- Define Cookbooks as cookbooks authored by the current user through `Cookbook.authorId`.
- Define Chefs from the existing fellow-chef and kitchen-visitor graph semantics in `app/lib/fellow-chefs.server.ts`.
- Add a private chronological chef activity view from recipe saves/spoons/forks around the user's kitchen; exclude shopping-list events.
- Keep one global Kitchen Search with scope chips, plus scoped drawer search/filter inputs for high-frequency personal drawers.
- Replace "Latest from the kitchen" with an honest editorial label such as "On the Counter" and deterministic selection from recently updated/displayable recipes.
- On iPhone native, remove Search from the bottom tab bar; keep Search reachable from the trailing compact toolbar menu item labeled `Search`, which opens the `.search(query:scope:)` route where native `.searchable` uses toolbar-principal placement and search scopes.
- Use system material/translucency for native liquid glass rather than a custom tab replacement.

## Context / References
- Web worktree: `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav` on branch `agent/kitchen-nav-reorg`.
- Native worktree: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav` on branch `agent/kitchen-nav-reorg`.
- Web schema: `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/prisma/schema.prisma`.
- Web fellow-chef semantics: `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/app/lib/fellow-chefs.server.ts`.
- Web home/editorial module: `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/app/routes/_index.tsx`.
- Web mobile dock: `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/app/components/navigation/mobile-nav.tsx` and `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/app/components/navigation/spoon-dock.tsx`.
- Web desktop navigation: `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/app/root.tsx`.
- Web search: `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/app/routes/search.tsx` and `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/app/lib/search.server.ts`.
- Web design language: `/Users/arimendelow/Projects/spoonjoy-v2-agent-kitchen-nav/docs/design-language.md`.
- Native route model: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/Sources/SpoonjoyCore/AppState/AppRoute.swift`.
- Native navigation shell: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/Apps/Spoonjoy/Shared/AppShell/PlatformNavigationView.swift`.
- Native iOS chrome setup: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/Apps/Spoonjoy/iOS/SpoonjoyiOSApp.swift`.
- Native recipe/cookbook models: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/Sources/SpoonjoyCore/RecipeCookbook/RecipeCookbook.swift`.
- Native design language: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/docs/native-design-language.md`.
- Native screenshot matrix: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/scripts/capture-native-screenshot-matrix.sh`, `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/scripts/capture-native-screenshots.sh`, `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/scripts/validate-design-review.rb`, and `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/scripts/validate-design-review-blocker.rb`.
- Native simulator resolver: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/.github/scripts/resolve-ios-simulator-destination.py`.

## Notes
The task intentionally favors obvious kitchen organization over creative naming. The implementation should avoid OAuth/auth churn and should preserve existing public recipe/cookbook URLs.
Native release submission is intentionally not part of this task because it can require human credentials and external Apple state; shipping here means committed, validated, pushed/PR-ready code plus web deployment through available repo tooling.

## Progress Log
- 2026-07-13 14:05 Created
- 2026-07-13 14:07 Created initial planning doc
- 2026-07-13 14:07 Tinfoil hat pass: added explicit documentation alignment coverage
- 2026-07-13 14:13 Addressed planning reviewer findings: concrete routes, native validation artifacts, and native release boundary
- 2026-07-13 14:18 Addressed second reviewer finding: full native design-review schema, route evidence, blocker, and simulator/macOS validation targets
- 2026-07-13 14:20 Planning approved after sub-agent reviewer convergence
- 2026-07-13 14:41 Tightened native compact search affordance and exact route-matrix coverage
