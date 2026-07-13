# Planning: Kitchen Navigation Reorg

**Status**: drafting
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
- Visual QA evidence for changed web and native UI surfaces.

### Out of Scope
- OAuth/auth flow changes; another agent is working there.
- Introducing a new bookmark/favorite/save database model.
- Public social feeds or shopping-list activity events.
- New privacy model, notification settings, or chef-relationship semantics beyond the existing fellow-chef/kitchen-visitor definitions.
- Production data migrations unless implementation discovers an unavoidable schema gap.

## Completion Criteria
- [ ] Signed-in web users have clear top-level access to My Kitchen, My Recipes, Saved Recipes, Cookbooks, Shopping List, Chefs, and Kitchen Search.
- [ ] Web My Recipes shows recipes authored by the current user.
- [ ] Web Saved Recipes shows deduped recipes saved through the current user's cookbooks, including recipes written by the user when saved in a cookbook.
- [ ] Web Cookbooks is a real owned-cookbooks surface rather than a redirect back to a confusing tab.
- [ ] Web Chefs includes existing fellow-chef semantics plus a chronological private activity view that excludes shopping-list events.
- [ ] Web search is reachable globally and personal drawers expose scoped search/filtering without fragmenting search semantics.
- [ ] Web "Latest from the kitchen" copy is replaced with an honest editorial module label and deterministic selection.
- [ ] Web mobile navigation uses kitchen-focused labels and a stable liquid-glass-style treatment across small screens.
- [ ] Native iPhone navigation uses Kitchen, My Recipes, Saved, Cookbooks, and Shopping List tabs, with Search reachable through toolbar/native search.
- [ ] Native regular-width navigation exposes the full kitchen drawer set, including Chefs and Search.
- [ ] Native saved-recipes surface uses the same saved-through-cookbooks definition as web.
- [ ] Native tab bar/mobile navigation uses material/translucent system chrome instead of the current opaque bone treatment.
- [ ] Web/native docs reflect the finalized drawer names, saved-recipes definition, search posture, and mobile navigation behavior.
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
- [ ] Native App Store/TestFlight shipping may require credentials or an external release pipeline unavailable in this runtime; if so, complete local implementation, tests, branch push/PR, and record the release blocker as the only non-local step.

## Decisions Made
- Use "My Kitchen" as the signed-in home/root concept, not as a peer tab.
- Use clear drawer labels over cute labels: My Recipes, Saved Recipes, Cookbooks, Shopping List, Chefs, Kitchen Search.
- Define Saved Recipes as recipes in any cookbook owned by the current user, deduped by recipe ID; do not add a separate saved/bookmark model.
- Define My Recipes as recipes authored by the current user through `Recipe.chefId`.
- Define Cookbooks as cookbooks authored by the current user through `Cookbook.authorId`.
- Define Chefs from the existing fellow-chef and kitchen-visitor graph semantics in `app/lib/fellow-chefs.server.ts`.
- Add a private chronological chef activity view from recipe saves/spoons/forks around the user's kitchen; exclude shopping-list events.
- Keep one global Kitchen Search with scope chips, plus scoped drawer search/filter inputs for high-frequency personal drawers.
- Replace "Latest from the kitchen" with an honest editorial label such as "On the Counter" and deterministic selection from recently updated/displayable recipes.
- On iPhone native, keep Search reachable through toolbar/native search rather than a bottom tab, so the five tabs map to kitchen drawers.
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
- Native route model: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/Sources/SpoonjoyCore/AppState/AppRoute.swift`.
- Native navigation shell: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/Apps/Spoonjoy/Shared/AppShell/PlatformNavigationView.swift`.
- Native iOS chrome setup: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/Apps/Spoonjoy/iOS/SpoonjoyiOSApp.swift`.
- Native recipe/cookbook models: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/Sources/SpoonjoyCore/RecipeCookbook/RecipeCookbook.swift`.
- Native design language: `/Users/arimendelow/Projects/spoonjoy-apple-agent-kitchen-nav/docs/native-design-language.md`.

## Notes
The task intentionally favors obvious kitchen organization over creative naming. The implementation should avoid OAuth/auth churn and should preserve existing public recipe/cookbook URLs.

## Progress Log
- 2026-07-13 14:05 Created
- 2026-07-13 14:07 Created initial planning doc
- 2026-07-13 14:07 Tinfoil hat pass: added explicit documentation alignment coverage
