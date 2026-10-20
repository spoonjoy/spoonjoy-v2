# Building with Ouro HX, the way Spoonjoy does

Spoonjoy is a recipe app built on [Ouro HX](https://ourostack.github.io/ouro-ui/). Point an agent at this file and it should be able to build an app the same way. Every section links to the Spoonjoy file that does what it describes.

The short version:

1. Install HX items as source with the shadcn CLI, from a release tag, and never edit them.
2. Restyle HX through theme tokens and HX props, never by editing a component or styling its states in app CSS.
3. Build screens by composing HX components with your own data and domain logic. Use HX directly, with no local wrappers.
4. When HX has no component for something reusable, add it to HX first, then install it. Don't hand-roll it in the app.
5. Hold the app to that with two checks, a source rule and a census, and publish where every component comes from.

## 1. Install HX as source, from a release tag

HX ships through a shadcn registry, but it isn't a shadcn add-on. The registry is just how the files get to you. Each item installs as plain source under `app/components/ouro/` and `app/lib/ouro/`:

```sh
npx shadcn@4.21.1 add ourostack/ouro-ui/checklist#v1.1.0 ourostack/ouro-ui/number-field#v1.1.0
```

- **Pin the tag.** Spoonjoy installs from a release tag, never from `main`. The installed release is named in HX's own source (`app/lib/ouro/dev.ts`), and [`/ouro-provenance.json`](../app/generated/ouro-provenance.json) reports it.
- **Never edit installed files.** [`test/components/ui/design-system-hygiene.test.ts`](../test/components/ui/design-system-hygiene.test.ts) pins every installed file to the tag's bytes, so a local edit fails the build. To change a component, change it in HX and upgrade.
- **Install in CI.** Spoonjoy runs the CLI in GitHub Actions rather than on a laptop, so the files come from the public registry and nowhere else. [`.github/task21-v083-cli.mjs`](../.github/task21-v083-cli.mjs) lists the items and the tag's file hashes and fails on any difference. The workflow uploads the resulting patch, which is applied byte for byte.
- **Run HX's tests in your theme.** Each item ships with its tests. [`vitest.ouro.config.ts`](../vitest.ouro.config.ts) runs them in Chromium, WebKit and a touch phone with Spoonjoy's stylesheet loaded (`ouroTestProjects` from `app/lib/ouro/testing/vitest.ts`), so a component that breaks under your theme fails in your CI.

## 2. Theme through tokens

Spoonjoy's heavy cookbook look is all theme. Not one component is forked.

- **Colours.** HX reads shadcn's variable names (`--background`, `--primary`, `--ring`, …). [`app/styles/tailwind.css`](../app/styles/tailwind.css) maps each one onto Spoonjoy's palette (`--sj-*`) in a single block, so HX follows dark mode and print along with the rest of the app. [`test/styles/ouro-theme-mapping.test.ts`](../test/styles/ouro-theme-mapping.test.ts) checks that every foreground pair reaches 4.5:1 in both themes.
- **Shape and motion.** `--radius` sets HX's corners. The `--ouro-*` tokens set durations, easings, the press scale, the overlay layer and sheet shadows. Spoonjoy overrides only what differs, such as `--ouro-layer: 60`, which lifts dialogs above its tab bar.
- **Typography.** HX's `Heading` and `Text` take `size` and `tone`. The fonts come from the theme.
- **Never style a component's states in app CSS.** Rules like `.my-button:focus`, `[aria-checked]` or `data-[state=open]:` on app elements are what the source rule calls `control-state-style`. Every HX component already draws its own focus, pressed, checked, open and disabled states from the tokens.

## 3. Compose HX directly

A Spoonjoy file may do one of two things. It can compose HX components with Spoonjoy's data and domain logic, or it can be infrastructure (loaders, routing, storage). Import HX components where they're used. Don't wrap them in local `Button`, `Text` or `Link` components: a wrapper hides which HX component renders and becomes one more thing an agent copies.

Examples in Spoonjoy:

- **A step's ingredients** are an HX `Checklist`, given each ingredient's scaled amount as its `value` and its aisle as its `description`: [`app/components/recipe/IngredientList.tsx`](../app/components/recipe/IngredientList.tsx).
- **The recipe's scale** is an HX `NumberField` whose description is the scaled servings: [`app/components/recipe/RecipeHeader.tsx`](../app/components/recipe/RecipeHeader.tsx).
- **Cook mode** is a domain view built only from HX (`Checklist`, `NumberField`, `Pagination`, `Button`, `Text`), drawn from a `CookController` that knows nothing about routes: [`app/components/cook/RecipeCookView.tsx`](../app/components/cook/RecipeCookView.tsx). The recipe page and the Test Kitchen give it different controllers.
- **The shopping list** puts one checklist per aisle together from `ChecklistRoot` and `ChecklistItem`, because each row swipes to delete with HX `SwipeActions`. Its views and aisles are HX `SegmentedControl`s: [`app/routes/shopping-list.tsx`](../app/routes/shopping-list.tsx).
- **The Test Kitchen** is a whole page built this way, with X-ray (HX `Inspector`) behind an HX `Switch`: [`app/routes/test-kitchen.tsx`](../app/routes/test-kitchen.tsx).
- **Links go through the router.** `OuroProvider` in [`app/root.tsx`](../app/root.tsx) hands HX the app's link component, so HX `Link`, `Button href` and `Pagination` navigate with React Router.

Pass what HX asks for: required props are required, hint types guide you to the right one (`<Inspector open onOpenChange>`, not `isOpen`), and `className` is for layout only (margins, grid placement). HX warns in development about an appearance class.

## 4. When HX lacks a component

If the pattern could be reused in another app, it belongs in HX. That covers controls, layout pieces, status displays, pickers and feedback moments. The order is:

1. Add the general component to HX with HX's full bar: props-first API, control markers, motion, reduced motion, theme tokens, accessibility in three themes, Chromium/WebKit/touch tests, docs and a changes fragment.
2. Release it.
3. Install it in the app from the release tag and delete the app code it replaces.

Until the release ships, the app code that is waiting carries a `TODO(ouro-hx: <item>)` comment naming the HX item that will replace it, so nobody mistakes it for a pattern to copy. If HX's own tests fail under your theme, that's an HX bug: fix it in HX ([ouro-ui#122](https://github.com/ourostack/ouro-ui/pull/122) is one Spoonjoy found).

## 5. Hold the app to it

Two checks measure how much of the app is HX. Both only move one way.

- **The source rule** ([`scripts/hx-source-rules.mjs`](../scripts/hx-source-rules.mjs), `pnpm hx:source-rules`) reads app code with the TypeScript compiler and lists every hand-rolled control. That means raw `<button>`, `<a>`, `<input>`, `<select>` and `<textarea>`, handlers on plain elements, interactive roles, third-party control libraries, and control-state styling. Wrappers don't hide a control: it's counted wherever the wrapper is used. The list must equal [`test/scripts/hx-source-rules.baseline.json`](../test/scripts/hx-source-rules.baseline.json), and CI refuses any rise against the base branch's baseline.
- **The census** ([`e2e/journeys/support/hx-census.ts`](../e2e/journeys/support/hx-census.ts)) visits every page and every dialog, menu and sheet on it, in a real browser on a phone and a desktop. It records every control a person can reach, by role, name, HX marker (`data-ouro-control`) and context. A page that is *enrolled* fails on any control HX didn't render. The rest may only lose unmarked controls. Update its baseline from a CI run with `pnpm census:update <run-id>`.

[AGENTS.md](../AGENTS.md) explains both rules in full. "Done" means both baselines are empty and every census page is enrolled.

## 6. Show your work

- **`/ouro-provenance.json`** ([`scripts/generate-ouro-provenance.mjs`](../scripts/generate-ouro-provenance.mjs)) records the HX release and, for each page, the files it's built from and which of them render each HX item. Run `pnpm provenance:generate` after changing a page's imports. CI fails on a stale file.
- **X-ray.** Open [the Test Kitchen](https://spoonjoy.app/test-kitchen?xray) and HX's `Inspector` outlines every HX component on the page. Its list links each one to its HX docs and to the Spoonjoy file that renders it, at the commit that's running.
- **`/llms.txt`** greets agents and links all of this.
