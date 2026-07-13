# Spoonjoy Design Language

Status: design direction for the next UI rebuild.

## Diagnosis

The current interface has a palette, but it does not yet have a visual language.

The visible product still reads as a generic dashboard because it gives every object the same treatment: a small app nav, a centered title block, segmented tabs, and a uniform grid of rounded image cards. That structure is usable in a CRUD admin tool, but Spoonjoy is not an admin tool. It is a kitchen archive, a cooking log, and a personal cookbook.

The palette pass helped remove arbitrary color, but it did not solve the deeper problems:

- The shell competes with the food instead of receding.
- The kitchen page has no lead object, no editorial hierarchy, and no sense of a book, table, or feed.
- Recipe and cookbook objects are visually interchangeable.
- Rounded corners are decorative instead of semantic.
- Cards are being used as the default container, not as a meaningful object.
- Dark mode currently makes the whole app feel like an old dashboard instead of a night kitchen.

## Research Inputs

- The Mendelow Cooking artifact defines the product as a "social recipe platform with AI-enhanced food photography" and explicitly says the app is built around "food-first design - a visual feed, user profiles, grocery lists organized by store, step-by-step cooking mode, and search": https://mendelow.studio/projects/mendelow-cooking
- The same artifact says the AI photo transformation should preserve the original dish and scene while applying editorial lighting and color grading. That makes the photo the product object, not decoration: https://mendelow.studio/projects/mendelow-cooking
- Catalyst should be treated as owned component infrastructure. Tailwind describes it as a kit for moving fast "without compromising on your own vision" and as a starter kit for building your own component system: https://tailwindcss.com/plus/ui-kit
- Apple HIG emphasizes hierarchy, harmony, and consistency, and its layout guidance says to use visual weight, balance, and alignment to communicate importance. Spoonjoy currently fails this by flattening everything into equal cards: https://developer.apple.com/design/human-interface-guidelines/
- Cookbook editorial references consistently pair atmospheric food photography with strong typography, structured grids, and pages where text and image have an authored relationship, not a generic grid: https://www.indesignskills.com/inspiration/cookbook-design/

## Direction

Spoonjoy should become a living cookbook, not a recipe dashboard.

The design language is **The Kitchen Table**: quiet bone paper, charcoal ink, editorial food photography, cookbook margins, recipe notes, and object-specific surfaces. The app should feel like opening a modern cookbook that happens to be interactive.

This is not skeuomorphic. It should not look like fake paper, fake leather, or a scrapbook. It should borrow cookbook behavior: spreads, margins, covers, captions, indexes, sections, provenance, and usable cooking instructions.

## Non-Negotiables

1. Food leads.
   Every primary page needs one dominant food, cookbook, list, or cooking object. If a page has no lead object, it needs a deliberate index/list structure.

2. No default cards.
   A card is allowed only when it represents a real object:
   - recipe cover
   - cookbook cover
   - shopping receipt/list
   - modal sheet
   - notification/toast

3. No section cards.
   Page sections are layouts, spreads, bands, shelves, indexes, or lists. They are not cards inside pages.

4. No equal-weight grids as the primary experience.
   Grids can exist as indexes, but one item should usually lead. Use featured recipe plus index, shelf plus list, split spread, or magazine masonry before a uniform grid.

5. Rounded corners are semantic.
   - `0px`: page edges, table rows, dividers, image masks inside dense indexes.
   - `4px`: cookbook covers, thumbnails, small media.
   - `8px`: panels, modals, dense objects, list containers.
   - `999px`: only pills, avatars, toggles, and true controls.
   Anything above `8px` requires a named exception and should be rare.

6. Color is role-bound.
   - Bone: page and paper.
   - Charcoal: text, primary controls, structural lines.
   - Brass: selection, provenance, warmth, editorial emphasis.
   - Tomato: destructive or high-intent creation moments. Do not use it as general decoration.
   - Herb: cooked/success/origin-cook states.
   - Photo overlay: only on photography.

7. Typography has jobs.
   - Display serif: recipe names, cookbook titles, major page titles.
   - Body serif: descriptions, notes, instructions.
   - Condensed UI sans: nav, metadata, labels, compact controls.
   No type style is allowed just because it looks nice.

8. The UI must work in a kitchen.
   Large tap targets, high contrast, scannable instructions, stable layouts, no tiny target clusters for primary flows.

## Page Model

### Public Home

Use an editorial product opener:

- Left: literal product name, short value proposition, two actions.
- Right: one full-height food photograph treated as the hero object, with restrained captioning.
- Below the fold: visible hint of "phone to editorial" and product screenshots.

No centered hero card. No decorative orbs. No split card layout.

### Logged-In Kitchen

This is the current worst surface and should be rebuilt first.

New structure:

- Full-width bone page with a thin cookbook index rail.
- Header is a quiet masthead: avatar, kitchen name, counts, actions.
- Main area is an asymmetric spread:
  - left column: "On the Counter" lead recipe with large photo, title, note/provenance/action.
  - right column: compact recipe index with thumbnails, not cards.
  - lower band: cookbook shelf, where each cookbook looks like a cover/spine object.
- Tabs should be replaced with an index switch or segmented text control only if the content genuinely needs hiding. Prefer showing recipes and cookbooks together because they are different objects, not mutually exclusive dashboards.

### Main Kitchen Navigation

Signed-in navigation must use plain kitchen words and stable routes:

- `Kitchen` -> `/`
- `My Recipes` -> `/my-recipes`
- `Saved Recipes` -> `/saved-recipes`
- `Cookbooks` -> `/cookbooks`
- `Shopping List` -> `/shopping-list`
- `Chefs` -> `/chefs`
- `Kitchen Search` -> `/search`

`/recipes` remains the broader `Explore Recipes` index, not the signed-in cook's authored drawer.

Saved Recipes are recipes saved through cookbooks owned by the signed-in cook. That includes the cook's own recipes when they have saved them into one of their cookbooks. It does not mean every recipe the cook wrote.

Global search stays at `/search` with scopes for all, recipes, cookbooks, chefs, and shopping list. The personal drawer filters are local filters for the current drawer; they do not create a second search system.

The mobile dock stays small and glass/material-like: `My Kitchen`, create, `My Recipes`, `Shopping List`, and a `Pantry drawer` affordance. The Pantry drawer contains `My Recipes`, `Saved Recipes`, `Cookbooks`, `Shopping List`, `Chefs`, and `Kitchen Search`.

### Recipe Detail

Treat the recipe as a cookbook spread:

- Hero photo or cover on one side.
- Title, provenance, spoon/fork/save actions, and metadata in a strong editorial block.
- Ingredients as a receipt-like vertical list.
- Steps as numbered method sections with clear step-output dependency affordances.
- Spoons are a cooking log, not comments. They belong as a timeline or field notes section.

### Search

Search is an index, not a landing page:

- Large search field at top like a cookbook index.
- Results grouped by type with clear visual grammar.
- Recipes get thumbnail rows.
- Cookbooks get cover rows.
- Chefs get profile rows.
- Shopping list gets receipt rows.

### Shopping List

Make it a grocery receipt and store-run tool:

- Dense list, large check targets, store/category grouping.
- Almost no photography.
- No ornamental cards.

### Account/Settings

Settings can remain Catalyst-like:

- Quiet forms.
- 8px panels.
- Strong labels.
- No editorial flourishes.

## Components To Build

- `KitchenMasthead`: identity, counts, primary actions.
- `RecipeLead`: one dominant recipe object with large image and editorial caption.
- `RecipeIndex`: compact thumb/title/metadata rows.
- `CookbookShelf`: horizontal or wrapped shelf of cookbook cover objects.
- `CookbookCover`: book-like object, not a card.
- `ReceiptList`: shopping-list and ingredient-list primitive.
- `EditorialSpread`: shared two-column page primitive.
- `ObjectActions`: small consistent icon button set using Catalyst accessibility patterns.

## Implementation Rules

- Keep Catalyst controls for accessibility, focus, keyboard behavior, and API structure.
- Strip Catalyst visual defaults where they fight the product language.
- Build page composition with CSS grid and stable aspect ratios.
- Do not invent a new component for every page. Build the object primitives above, then reuse them.
- Every route should be reviewed against one question: what is the lead object?

## First Implementation Slice

The first real slice should be the logged-in kitchen page because it is the page currently proving the design failure.

Scope:

1. Replace the logged-in `/` layout with `KitchenMasthead`, `RecipeLead`, `RecipeIndex`, and `CookbookShelf`.
2. Remove tab-first structure from the kitchen page.
3. Remove `sj-photo-tile` as the generic recipe-card default on this route.
4. Tighten radius tokens to the semantic scale above.
5. Verify desktop and mobile screenshots in Safari or Playwright before commit.

This should be one PR. After that, recipe detail and search should follow.
