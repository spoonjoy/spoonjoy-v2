# Unit 0 Setup / Research

Captured: 2026-07-13 15:16 America/Los_Angeles

## Worktrees

Web worktree:

```text
$ git status --short --branch
## agent/kitchen-nav-reorg

$ git rev-parse --abbrev-ref HEAD && git rev-parse HEAD
agent/kitchen-nav-reorg
84a5065d21877b75e4419426be0e2041fb2e9f12
```

Native worktree:

```text
$ git status --short --branch
## agent/kitchen-nav-reorg

$ git rev-parse --abbrev-ref HEAD && git rev-parse HEAD
agent/kitchen-nav-reorg
b1d2495a3306b98306e71e667bc3725d291cea99
```

## Skill Freshness

Repo-local source-of-truth skill files are not present in the web worktree:

```text
diff: subagents/work-planner.md: No such file or directory
diff: subagents/work-doer.md: No such file or directory
```

Per `AGENTS.md`, continue with installed local skills when repo-local source files are absent.

## Web Targets

Primary source targets:

- `app/routes.ts`
- `app/root.tsx`
- `app/routes/_index.tsx`
- `app/routes/my-recipes.tsx`
- `app/routes/saved-recipes.tsx`
- `app/routes/chefs.tsx`
- `app/routes/cookbooks._index.tsx`
- `app/components/navigation/mobile-nav.tsx`
- `app/components/navigation/spoon-dock.tsx`
- `app/styles/tailwind.css`
- `app/lib/fellow-chefs.server.ts`
- `docs/design-language.md`

Primary test targets:

- `test/routes/my-recipes.test.tsx`
- `test/routes/saved-recipes.test.tsx`
- `test/routes/chefs.test.tsx`
- `test/routes/cookbooks-index.test.tsx`
- `test/routes/index.test.tsx`
- `test/root-navbar.test.tsx`
- `test/components/navigation/mobile-nav.test.tsx`
- `test/lib/fellow-chefs.server.test.ts`
- `e2e/flows/spoondock-responsive.spec.ts`

Shared constraints:

- Do not edit OAuth routes or OAuth behavior.
- Keep `/recipes` as broader Explore Recipes / all public recipes.
- Personal drawer routes require auth through `requireUserId(request, "/login", env)`.
- Saved Recipes stays derived from owned cookbook membership; no bookmark model or schema migration planned.

## Native Targets

Primary source targets:

- `Sources/SpoonjoyCore/AppState/AppRoute.swift`
- `Sources/SpoonjoyCore/Features/RecipeCatalog/RecipeCatalogRepository.swift`
- `Sources/SpoonjoyCore/Features/RecipeCatalog/RecipeCatalogViewModel.swift`
- `Apps/Spoonjoy/Shared/AppShell/PlatformNavigationView.swift`
- `Apps/Spoonjoy/Shared/Views/RecipesView.swift`
- `Apps/Spoonjoy/Shared/Views/SavedRecipesView.swift`
- `Apps/Spoonjoy/iOS/SpoonjoyiOSApp.swift`
- `Apps/Spoonjoy/Shared/Components/ScreenshotAccessibilityProofWriter.swift`
- `Spoonjoy.xcodeproj/project.pbxproj`
- `scripts/capture-native-screenshots.sh`
- `scripts/capture-native-screenshot-matrix.sh`
- `docs/native-design-language.md`

Primary test targets:

- `Tests/SpoonjoyCoreTests/AppStateTests.swift`
- `Tests/SpoonjoyCoreTests/NativeMobileDesignContractTests.swift`
- `Tests/SpoonjoyCoreTests/KitchenRecipesStructureContractTests.swift`
- `Tests/SpoonjoyCoreTests/RecipeCatalogDetailTests.swift`

Native constraints:

- `Chefs` is first-class: `AppSection.chefs`, `AppRoute.chefs`, `stateIdentifier == "chefs"`.
- Compact tabs are exactly Kitchen, My Recipes, Saved, Cookbooks, Shopping List.
- Search is an auxiliary compact route opened by toolbar/menu, not a bottom tab.
- My Recipes and Saved Recipes are snapshot/current-chef personal drawers and must not fall back to public recipe catalog data.
- Register any new Swift view in both iOS and macOS Xcode project sources.

## Validation Commands

Web:

```bash
pnpm run typecheck
pnpm run test:coverage
pnpm run build
pnpm exec playwright test e2e/flows/spoondock-responsive.spec.ts
```

Native:

```bash
swift test --disable-xctest --parallel -Xswiftc -warnings-as-errors
swift test --enable-code-coverage --disable-xctest --parallel -Xswiftc -warnings-as-errors
ruby scripts/enforce-swift-coverage.rb --coverage-json "$(swift test --show-codecov-path)" --minimum 100 --include 'Sources/SpoonjoyCore'
scripts/verify-native-scenarios.sh --stage final
xcodebuild test -project Spoonjoy.xcodeproj -scheme "Spoonjoy iOS" -configuration BootstrapDebug -destination "$(python3 .github/scripts/resolve-ios-simulator-destination.py)" CODE_SIGNING_ALLOWED=NO GCC_TREAT_WARNINGS_AS_ERRORS=YES
xcodebuild test -project Spoonjoy.xcodeproj -scheme "Spoonjoy macOS" -configuration BootstrapDebug -destination 'generic/platform=macOS' CODE_SIGNING_ALLOWED=NO GCC_TREAT_WARNINGS_AS_ERRORS=YES
```

Visual QA:

```bash
pnpm run dev -- --host 127.0.0.1
SPOONJOY_SCREENSHOT_MATRIX_ROUTES=kitchen,recipes,saved-recipes,cookbooks,shopping-list,chefs,search scripts/capture-native-screenshot-matrix.sh --artifact-root ./2026-07-13-1405-doing-kitchen-nav-reorg/unit-6d/native --unit-slug kitchen-nav
```
