# Building with Ouro HX, the way Spoonjoy does

Spoonjoy is a recipe app built on [Ouro HX](https://ourostack.github.io/ouro-ui/). Point an agent at this file and it should be able to build an app the same way. The sections link to the Spoonjoy files that do what they describe.

The short version:

1. Install HX items as source with the shadcn CLI, from a release tag, and leave them as the release wrote them.
2. Restyle HX through theme tokens and HX props, not by editing a component or styling its states in app CSS.
3. Build screens by composing HX components with your own data and domain logic. Use HX directly, without local wrappers.
4. When HX has no component for something reusable, add it to HX first, then install it. Don't hand-roll it in the app.
5. Hold the app to that with a source rule and a census, and publish where the components come from.

## 1. Install HX as source, from a release tag

HX ships through a shadcn registry, but it isn't a shadcn add-on. The registry is just how the files get to you. An item installs as plain source under `app/components/ouro/` and `app/lib/ouro/`:

```sh
npx shadcn@4.21.1 add ourostack/ouro-ui/checklist#v1.2.0 ourostack/ouro-ui/number-field#v1.2.0
```

- **Pin the tag.** Install from a release tag, not from `main`. HX's own source names the installed release (`app/lib/ouro/dev.ts`), and [`/ouro-provenance.json`](../app/generated/ouro-provenance.json) reports it.[^tag]
- **Leave installed files alone.** [`test/components/ui/design-system-hygiene.test.ts`](../test/components/ui/design-system-hygiene.test.ts) pins every installed file to the tag's bytes against [`.github/ouro-hx-installed.json`](../.github/ouro-hx-installed.json), whatever its folder or type (components, specs, the census and source-rule kits, the claims checker), and refuses an unpinned file in HX's folders, so a local edit fails the build.[^pinned] To change a component, change it in HX and upgrade.
- **Install in CI.** Spoonjoy runs the CLI in GitHub Actions rather than on a laptop, so the files come from the public registry. [`.github/task21-v083-cli.mjs`](../.github/task21-v083-cli.mjs) lists the items, checks the CLI's output against the same map of the tag's hashes, and fails when the CLI writes anything else.[^cli] The workflow uploads the resulting patch, which is applied byte for byte.
- **Run HX's tests in your theme.** An item's `-tests` item installs its tests beside it. [`vitest.ouro.config.ts`](../vitest.ouro.config.ts) runs them in Chromium, WebKit and a touch phone with Spoonjoy's stylesheet loaded (`ouroTestProjects` from `app/lib/ouro/testing/vitest.ts`), so a component that breaks under your theme fails in your CI.[^ouro-tests]

## 2. Theme through tokens

Spoonjoy's heavy cookbook look is theme, not forked components.[^pinned]

- **Colours.** HX reads shadcn's variable names (`--background`, `--primary`, `--ring`, …). [`app/styles/tailwind.css`](../app/styles/tailwind.css) maps them onto Spoonjoy's palette (`--sj-*`) in a single block, so HX follows dark mode and print along with the rest of the app. [`test/styles/ouro-theme-mapping.test.ts`](../test/styles/ouro-theme-mapping.test.ts) checks that the foreground pairs reach 4.5:1 in both themes.[^contrast]
- **Shape and motion.** `--radius` sets HX's corners. The `--ouro-*` tokens set durations, easings, the press scale, the overlay layer and sheet shadows. Override only what differs, as Spoonjoy sets `--ouro-layer: 60` to lift dialogs above its tab bar.[^layer]
- **Typography.** HX's `Heading` and `Text` take `size` and `tone`. The fonts come from the theme: `--font-heading` gives HX's headings Spoonjoy's display serif. Text's tone is `default` unless you say otherwise, so secondary copy says `tone="muted"` where it's written.
- **Leave a component's states to the component.** Rules like `.my-button:focus`, `[aria-checked]` or `data-[state=open]:` on app elements are what the source rule calls `control-state-style`. HX components draw their own focus, pressed, checked, open and disabled states from the tokens.

## 3. Compose HX directly

A Spoonjoy file either composes HX components with Spoonjoy's data and domain logic, or is infrastructure (loaders, routing, storage). Import HX components where they're used. Don't wrap them in local `Button`, `Text` or `Link` components: a wrapper hides which HX component renders and becomes one more thing an agent copies.

Examples in Spoonjoy:

- **A step's ingredients** are an HX `Checklist`, given the ingredients' scaled amounts as their `value` and their aisles as their `description`: [`app/components/recipe/IngredientList.tsx`](../app/components/recipe/IngredientList.tsx).[^examples]
- **The recipe's scale** is an HX `NumberField` whose description is the scaled servings: [`app/components/recipe/RecipeHeader.tsx`](../app/components/recipe/RecipeHeader.tsx).[^examples]
- **Cook mode** is a domain view built from HX (`Checklist`, `NumberField`, `Pagination`, `Button`, `Text`), drawn from a `CookController` that knows nothing about routes: [`app/components/cook/RecipeCookView.tsx`](../app/components/cook/RecipeCookView.tsx). The recipe page and the Test Kitchen give it different controllers.
- **The shopping list** puts one checklist per aisle together from `ChecklistRoot` and `ChecklistItem`, because its rows swipe to delete with HX `SwipeActions`. Its views and aisles are HX `SegmentedControl`s: [`app/routes/shopping-list.tsx`](../app/routes/shopping-list.tsx).[^examples]
- **The Test Kitchen** is a whole page built this way, with X-ray (HX `Inspector`) behind an HX `Switch`: [`app/routes/test-kitchen.tsx`](../app/routes/test-kitchen.tsx).[^examples]
- **Links go through the router.** `OuroProvider` in [`app/root.tsx`](../app/root.tsx) hands HX the app's link component, so HX `Link`, `Button href` and `Pagination` navigate with React Router.[^router]

Pass what HX asks for: required props are required, hint types guide you to the right one (`<Inspector open onOpenChange>`, not `isOpen`), and `className` is for layout (margins, grid placement). HX warns in development about a class that sets appearance.[^appearance]

## 4. When HX lacks a component

If the pattern could be reused in another app, it belongs in HX. That covers controls, layout pieces, status displays, pickers and feedback moments. The order is:

1. Add the general component to HX with HX's full bar: props-first API, control markers, motion, reduced motion, theme tokens, accessibility in three themes, Chromium, WebKit and touch tests, docs and a changes fragment.
2. Release it.
3. Install it in the app from the release tag and delete the app code it replaces.

Until the release ships, mark the app code that is waiting with a `TODO(ouro-hx: <item>, ourostack/ouro-ui#<issue>)` comment naming the HX item that will replace it and the open HX issue it waits on, so nobody mistakes it for a pattern to copy. When the installed release already has the item and a later pull request adopts it, the marker names that pull request instead (`spoonjoy/spoonjoy-v2#<number>`); a marker never waits for an item the release has.[^markers] If HX's own tests fail under your theme, that's an HX bug: fix it in HX ([ouro-ui#122](https://github.com/ourostack/ouro-ui/pull/122 "verify:urlOk(https://github.com/ourostack/ouro-ui/pull/122)") is one Spoonjoy found).

## 5. Hold the app to it

A source rule and a census measure how much of the app is HX, and both may only move toward HX.

- **The source rule** is HX's `ouro-source-rules` kit ([`scripts/ouro-source-rules.mjs`](../scripts/ouro-source-rules.mjs), `pnpm hx:source-rules`, settings in [`ouro-source-rules.json`](../ouro-source-rules.json)), installed from the release tag like any HX item. It reads app code with the TypeScript compiler and lists the hand-rolled controls: raw `<button>`, `<a>`, `<input>`, `<select>` and `<textarea>`, handlers on plain elements, interactive roles, third-party control libraries, and control-state styling. A wrapper doesn't hide a control: it's counted where the wrapper is used.[^wrapper] The list must equal [`ouro-source-rules.baseline.json`](../ouro-source-rules.baseline.json), and CI refuses a rise against the base branch's baseline.[^ratchet]
- **The census** is HX's `ouro-census` kit ([`e2e/ouro-census/`](../e2e/ouro-census/)), given Spoonjoy's list of pages in [`e2e/journeys/support/hx-census.ts`](../e2e/journeys/support/hx-census.ts) by [`e2e/journeys/hx-census.journey.ts`](../e2e/journeys/hx-census.journey.ts). It visits the pages and the dialogs, menus and sheets on them, in a real browser on a phone and a desktop, and records the controls a person can reach, by role, name, HX marker (`data-ouro-control`) and context. A page that is *enrolled* fails on a control HX didn't render; the rest may only lose unmarked controls.[^census] Update its baseline from a CI run with `pnpm census:update <run-id>`.

[AGENTS.md](../AGENTS.md) explains both rules in full. Spoonjoy is done when both baselines are empty and the census enrols its pages.

## 6. Show your work

- **`/ouro-provenance.json`** ([`scripts/generate-ouro-provenance.mjs`](../scripts/generate-ouro-provenance.mjs)) records the HX release and, for a page, the files it's built from and which of them render which HX item.[^provenance] Run `pnpm provenance:generate` after changing a page's imports; CI fails on a stale file.[^provenance-check]
- **X-ray.** Open [the Test Kitchen](https://spoonjoy.app/test-kitchen?xray) and HX's `Inspector` outlines the HX components on the page. Its list links a component to its HX docs and to the Spoonjoy file that renders it, at the commit that's running.[^xray]
- **`/llms.txt`** greets agents and links the Test Kitchen, the source, this guide, the provenance, the API and MCP.[^llms]

[^tag]: test:test/scripts/generate-ouro-provenance.test.ts::files and items > reads the installed release from HX's own source verify:testExists(test/scripts/generate-ouro-provenance.test.ts::files and items > reads the installed release from HX's own source) verify:equals(app/generated/ouro-provenance.json#ouroTag)=v1.2.0
[^pinned]: test:test/components/ui/design-system-hygiene.test.ts::Spoonjoy UI design-system hygiene > pins every file the HX CLI installed, in every folder and of every type, to the tag's bytes verify:testExists(test/components/ui/design-system-hygiene.test.ts::Spoonjoy UI design-system hygiene > pins every file the HX CLI installed, in every folder and of every type, to the tag's bytes) verify:testExists(test/components/ui/design-system-hygiene.test.ts::Spoonjoy UI design-system hygiene > keeps no unpinned file in the folders HX installs into)
[^cli]: .github/task21-v083-cli.mjs verify:fileLine(.github/task21-v083-cli.mjs, /assert\.deepEqual\(receipt\.after, expected, "CLI output must match the qualified public tag"\);/) verify:fileLine(.github/task21-v083-cli.mjs, /"Only qualified installed paths may change"/)
[^ouro-tests]: vitest.ouro.config.ts verify:fileLine(vitest.ouro.config.ts, /const projects = ouroTestProjects\(\{/) verify:fileLine(vitest.ouro.config.ts, /css: "\.\/app\/styles\/tailwind\.css"/)
[^contrast]: test:test/styles/ouro-theme-mapping.test.ts::Ouro UI's theme mapping onto Spoonjoy's palette > maps every shadcn token Ouro UI reads to a Spoonjoy variable verify:testExists(test/styles/ouro-theme-mapping.test.ts::Ouro UI's theme mapping onto Spoonjoy's palette > maps every shadcn token Ouro UI reads to a Spoonjoy variable) verify:fileLine(test/styles/ouro-theme-mapping.test.ts, /passes 4\.5:1 for/)
[^markers]: test:test/hx-markers.test.ts::TODO(ouro-hx) markers > name the open HX issue or the stack pull request behind them, and never wait for a shipped item verify:testExists(test/hx-markers.test.ts::TODO(ouro-hx) markers > name the open HX issue or the stack pull request behind them, and never wait for a shipped item)
[^layer]: app/styles/tailwind.css verify:fileLine(app/styles/tailwind.css, /^  --ouro-layer: 60;$/)
[^examples]: app/components/recipe/IngredientList.tsx verify:fileLine(app/components/recipe/IngredientList.tsx, /import \{ Checklist, type ChecklistItemData \} from '~\/components\/ouro\/checklist\/checklist'/) verify:fileLine(app/components/recipe/RecipeHeader.tsx, /import \{ NumberField \} from '~\/components\/ouro\/number-field\/number-field'/) verify:fileLine(app/routes/shopping-list.tsx, /import \{ SwipeActions \} from "~\/components\/ouro\/swipe-actions\/swipe-actions";/) verify:fileLine(app/routes/shopping-list.tsx, /import \{ SegmentedControl \} from "~\/components\/ouro\/segmented-control\/segmented-control";/) verify:fileLine(app/routes/test-kitchen.tsx, /import \{ Inspector \} from "~\/components\/ouro\/inspector\/inspector";/) verify:fileLine(app/routes/test-kitchen.tsx, /import \{ Switch \} from "~\/components\/ouro\/switch\/switch";/)
[^router]: app/root.tsx verify:fileLine(app/root.tsx, /<OuroProvider linkComponent=\{/)
[^appearance]: app/lib/ouro/class-name-check.ts verify:fileLine(app/lib/ouro/class-name-check.ts, /Returns the first class that sets appearance \(or alignment\)/)
[^wrapper]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L737 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L737)
[^ratchet]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1401 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1401) verify:fileLine(.github/workflows/ci.yml, /pnpm run hx:source-rules --base "\$\(git rev-parse HEAD\^1\)"/)
[^census]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L162 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L162) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L331)
[^provenance]: test:test/scripts/generate-ouro-provenance.test.ts::buildProvenance > records the release, the root, and every page with its sources and the HX it renders verify:testExists(test/scripts/generate-ouro-provenance.test.ts::buildProvenance > records the release, the root, and every page with its sources and the HX it renders)
[^provenance-check]: test:test/scripts/generate-ouro-provenance.test.ts::main > writes the manifest, then checks it is current, and fails once it is stale verify:testExists(test/scripts/generate-ouro-provenance.test.ts::main > writes the manifest, then checks it is current, and fails once it is stale) verify:fileLine(package.json, /pnpm run provenance:generate --check/)
[^xray]: test:test/lib/ouro-provenance.test.ts::sourceHrefFor > links the one file of the page that renders an item, at the running commit verify:testExists(test/lib/ouro-provenance.test.ts::sourceHrefFor > links the one file of the page that renders an item, at the running commit) verify:testExists(test/routes/test-kitchen.test.tsx::Test Kitchen > opens X-ray on arrival with ?xray)
[^llms]: test:test/routes/llms-txt.test.ts::/llms.txt > says hello in plain text and links the Test Kitchen, the source, the API, MCP and the provenance verify:testExists(test/routes/llms-txt.test.ts::/llms.txt > says hello in plain text and links the Test Kitchen, the source, the API, MCP and the provenance)
