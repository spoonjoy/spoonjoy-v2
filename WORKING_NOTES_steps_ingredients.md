# Working Notes: Steps & Ingredients (stepOutputUse)

This document tracks research, decisions, and implementation notes for the stepOutputUse feature.

---

## Task Context

- **Active Task**: Slugger/Ouroboros task board entry for `steps_ingredients`
- **Planning Doc**: Slugger/Ouroboros task history (`ouro task board --agent slugger`)

### Key Decisions from Planning

1. **UI for Editing**: Multi-select dropdown (Listbox with `multiple={true}`)
2. **UI for Following**: Checklist pattern (same as ingredients)
3. **Display Order**: Title → Step Output Uses → Description → Ingredients
4. **Validation**: Can ONLY reference PREVIOUS steps (stepNum < current)
5. **Deletion Protection**: Block step deletion if used by another step
6. **Step Reordering**: PREVENT if it would break dependencies
7. **Schema Note**: Uses composite keys (recipeId + stepNum), NOT stepId
8. **Terminology**:
   - `outputStepNum` = step producing the output (the dependency)
   - `inputStepNum` = step using that output (the current step)

---

## Unit 0.0: HeadlessUI Listbox Documentation Review

**Date**: 2026-01-28
**Status**: Complete

### Key Findings

#### 1. Enabling Multiple Selection

Add the `multiple` prop to the Listbox component:

```tsx
<Listbox value={selectedItems} onChange={setSelectedItems} multiple>
```

**Current codebase issue**: `app/components/ui/listbox.tsx` has `multiple={false}` hardcoded on line 22. This needs to be made configurable in Unit 2.0.

#### 2. Value Structure: Single vs Multiple

| Mode | Value Type | Example |
|------|------------|---------|
| Single | `T` | `{ id: 1, name: 'Step 1' }` |
| Multiple | `T[]` | `[{ id: 1, name: 'Step 1' }, { id: 2, name: 'Step 2' }]` |

The `onChange` handler receives:
- **Single**: The selected item
- **Multiple**: The complete array of all selected items (not just the changed one)

#### 3. Rendering Selected Items

For multiple selection, map and join the selected items:

```tsx
<ListboxButton>
  {selectedPeople.map((person) => person.name).join(', ')}
</ListboxButton>
```

The `ListboxSelectedOption` component:
- Receives `options` prop (all available ListboxOption elements)
- Receives `placeholder` prop (shown when nothing selected)
- Automatically filters and displays selected items
- For multiple selection, displays comma-separated values

#### 4. Form Integration

With the `name` prop, hidden inputs are created automatically:

**Single selection:**
```html
<input type="hidden" name="step" value="1" />
```

**Multiple selection with objects:**
```html
<input type="hidden" name="steps[0][id]" value="1" />
<input type="hidden" name="steps[0][stepNum]" value="1" />
<input type="hidden" name="steps[1][id]" value="2" />
<input type="hidden" name="steps[1][stepNum]" value="2" />
```

**For stepOutputUse**: We likely want just the step numbers, so value should be the stepNum directly or use a simpler structure.

#### 5. UX Behavior Difference

- **Single selection**: Listbox closes after selecting an option
- **Multiple selection**: Listbox stays open, selecting toggles items in place

This is ideal for our use case where users may want to select multiple previous steps.

#### 6. TypeScript Considerations for Unit 2.0

The current Listbox component type signature:

```tsx
Omit<Headless.ListboxProps<typeof Fragment, T>, 'as' | 'multiple'>
```

For Unit 2.0, we need to:
1. Remove `'multiple'` from the Omit
2. Add `multiple?: boolean` to props
3. Handle the value type being `T | T[]` depending on mode
4. Update ListboxSelectedOption rendering for multiple items

### Implications for stepOutputUse Implementation

1. **Listbox modification (Unit 2.0)**: Add optional `multiple` prop, pass through to HeadlessUI
2. **Value structure**: Use simple stepNum values, not full step objects
3. **Display format**: "Step 1: Title, Step 2: Title" (comma-separated)
4. **Form submission**: Will create hidden inputs like `usesSteps[0]`, `usesSteps[1]`, etc.

### Open Questions for Later Units

- Should we display "(no title)" or just "Step X" when a step has no title?
- Review Redwood implementation in Unit 0.2 for display format decisions

---

## Unit 0.2: Redwood Spoonjoy Reference Review

**Date**: 2026-01-28
**Status**: Complete

### Overview

Reviewed the original Redwood implementation at `~/Projects/spoonjoy/` to understand step display patterns and cross-step reference handling.

### Key Files in Redwood Implementation

| File | Purpose |
|------|---------|
| `web/src/components/Recipe/RecipeComponent/Recipe.tsx` | Main step rendering |
| `web/src/components/IngredientsItemsList/IngredientsItemsList.tsx` | Ingredient & dependency display |
| `web/src/components/Recipe/RecipeForm/StepFormFrag.tsx` | Step form container |
| `web/src/components/Recipe/RecipeForm/StepOutputUsesFormFrag.tsx` | Cross-step dependency selector |
| `web/src/stores/ListItemsStore.ts` | Ingredient selection state |
| `api/db/schema.prisma` | Database schema with StepOutputUse model |

### Step Display Pattern

**Sequential rendering** - Each step renders one after another on the page:

```
Header Banner (image + recipe title/description)
  ↓
Scale Factor & Clear Progress buttons
  ↓
For each step:
  - Step separator dots (only between steps, not before step 1)
  - Step title: "step 1: [optional title]"
  - Ingredients grid
  - Step output uses list (if any)
  - Instructions paragraph
```

**No "show all steps together" pattern exists** - steps are always displayed sequentially, all expanded, no collapsible sections or comparison views.

### Cross-Step Reference Patterns (StepOutputUse)

**Database Model:**
```prisma
model StepOutputUse {
  id            String     @id
  recipeId      String
  outputStepNum Int        // Which step's output is being used
  outputOfStep  RecipeStep // Reference to source step
  inputStepNum  Int        // Which step is doing the using
  inputOfStep   RecipeStep // Reference to consuming step
}
```

**How It Works:**
- Step 2 can declare it uses the output from Step 1 via `stepOutputUses`
- Step 3 can use outputs from Step 1 and/or Step 2
- Only steps after the first can declare step output uses

**Validation Rule:**
Each step must have either ingredients OR stepOutputUses (at least one).

### UI Patterns for Step Ingredients/Outputs

**Display (Recipe.tsx):**
- Regular ingredients shown first via `<IngredientsItemsList listType="recipeIngredients">`
- Step output dependencies shown immediately after via `<IngredientsItemsList listType="stepOutputUses">`
- Different icons: BeakerIcon for ingredients, Square2StackIcon for step outputs

**Display Formatting:**
- `getIngredientItemInfo()` formats: `[quantity] [unit] [ingredientName]` (e.g., "1.5 cups chana dal")
- `getStepOutputUseItemInfo()` formats: `output of step [stepNum]: [stepTitle]` (e.g., "output of step 2: Blended mixture")

**Selection/Checkbox State:**
- Centralized store (`ListItemsStore.ts`) for checked/unchecked state
- "Clear progress" button resets all item states
- State persists across step navigation

### Edit Form Pattern (StepOutputUsesFormFrag.tsx)

- Uses HeadlessUI Listbox component with `multiple` prop for multi-select
- Dynamically generates available step options (all previous steps)
- Only rendered if `stepNum > 1` (first step can't have step output uses)
- Manages data via React Hook Form's `useFieldArray` and `useWatch` hooks

### Example Recipe Structure

From the Israeli Hummus recipe:
```
Step 1: Cook chana dal & baking soda
  - No step dependencies
  - Ingredients: 1.5 cups chana dal, 1 tsp baking soda

Step 2: Blend in food processor
  - USES: output of step 1 (cooked chana dal)
  - Ingredients: 0.5 tbsp salt, 2 tsp citric acid, 3 cloves garlic

Step 3: Add tahini and water
  - USES: output of step 2 (blended mixture)
  - Ingredients: 16 oz tahini, 1 cup cold water
```

### Decisions Confirmed for v2 Implementation

1. **Display format**: "output of step X: [title]" - matches Redwood pattern
2. **Step title fallback**: When a step has no title, just show "output of step X" (no "(no title)" suffix)
3. **Display order within step**: Title → Step Output Uses → Description → Ingredients (as planned)
4. **Multi-select for editing**: HeadlessUI Listbox with `multiple` prop (confirmed from Unit 0.0)
5. **Checklist for following**: Same pattern as ingredients with checkbox state

### Key Difference from v2 Schema

Redwood uses `stepNum` for relationships:
```prisma
outputStepNum Int
inputStepNum  Int
```

Our v2 also uses this pattern (composite keys with recipeId + stepNum), not separate stepId. This is confirmed as the correct approach.

---

## Unit 0.3: StepOutputUse Schema Analysis

**Date**: 2026-01-28
**Status**: Complete

### Model Definition (prisma/schema.prisma:109-123)

```prisma
/// Allow a step to refer to the output of another step. AKA, in step 3, use the outputs from step 1 and 2
model StepOutputUse {
  id            String     @id @default(cuid())
  recipeId      String
  outputStepNum Int
  outputOfStep  RecipeStep @relation(name: "output", fields: [recipeId, outputStepNum], references: [recipeId, stepNum], onDelete: Cascade)
  inputStepNum  Int
  inputOfStep   RecipeStep @relation(name: "input", fields: [recipeId, inputStepNum], references: [recipeId, stepNum], onDelete: Cascade)

  updatedAt DateTime @default(now()) @updatedAt

  @@unique([recipeId, outputStepNum, inputStepNum])
  @@index([recipeId, outputStepNum, inputStepNum])
  @@index([recipeId, outputStepNum])
  @@index([recipeId, inputStepNum])
}
```

### Fields and Types

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | Primary key, auto-generated CUID |
| `recipeId` | `String` | Foreign key to Recipe (shared across both step relations) |
| `outputStepNum` | `Int` | Step number of the step **producing** the output |
| `inputStepNum` | `Int` | Step number of the step **consuming** the output |
| `updatedAt` | `DateTime` | Auto-updated timestamp |

### Relations

#### To RecipeStep (Two Relations)

The model has **two distinct relations** to RecipeStep, both using composite keys:

1. **`outputOfStep`** (relation name: `"output"`)
   - Points to the step that **produces** the output
   - Composite FK: `[recipeId, outputStepNum]` → `[recipeId, stepNum]`
   - Corresponding inverse: `RecipeStep.usedBySteps`

2. **`inputOfStep`** (relation name: `"input"`)
   - Points to the step that **uses/consumes** the output
   - Composite FK: `[recipeId, inputStepNum]` → `[recipeId, stepNum]`
   - Corresponding inverse: `RecipeStep.usingSteps`

#### RecipeStep Inverse Relations (schema.prisma:99-100)

```prisma
model RecipeStep {
  // ...
  usingSteps  StepOutputUse[] @relation("input")   // Steps THIS step uses
  usedBySteps StepOutputUse[] @relation("output")  // Steps that use THIS step's output
}
```

### Key Terminology Clarification

This is critical for understanding the data flow:

| Term | Meaning | Example |
|------|---------|---------|
| `outputStepNum` | The step that **PRODUCES** something | Step 1 cooks the dal |
| `inputStepNum` | The step that **USES** the output | Step 2 blends the cooked dal |
| `outputOfStep` | Relation to the **source/producer** step | Points to Step 1 |
| `inputOfStep` | Relation to the **consumer** step | Points to Step 2 |

**Example**: "Step 2 uses the output of Step 1"
- `recipeId`: the recipe ID
- `outputStepNum`: 1 (Step 1 is the producer)
- `inputStepNum`: 2 (Step 2 is the consumer)

### Composite Keys and Constraints

#### Unique Constraint
```prisma
@@unique([recipeId, outputStepNum, inputStepNum])
```
Ensures each (recipe, source step, consuming step) combination exists only once. A step cannot declare it uses the same step's output multiple times.

#### Indexes for Query Performance
```prisma
@@index([recipeId, outputStepNum, inputStepNum])  // Full composite lookup
@@index([recipeId, outputStepNum])                // "What steps use this step's output?"
@@index([recipeId, inputStepNum])                 // "What steps does this step depend on?"
```

### Cascade Behavior

Both relations have `onDelete: Cascade`:
- When a RecipeStep is deleted, all StepOutputUse records referencing it (as either source or consumer) are automatically deleted
- This applies whether the step is the producer OR the consumer

**Important for UI**: The planning doc says "Block step deletion if used by another step" - this is a **UI-level validation**, not enforced at the database level. The database allows cascade deletion, but the UI should warn/prevent.

### No Direct Recipe Relation

Note: There is no direct `@relation` to Recipe, only through RecipeStep. The `recipeId` field exists to form composite foreign keys but doesn't have a `recipe Recipe @relation(...)` line.

### Validation Rules (UI Level, Not Schema)

These must be enforced in application code:

1. **Forward references only**: `outputStepNum < inputStepNum` (can only reference previous steps)
2. **No self-reference**: `outputStepNum !== inputStepNum` (can't use your own output)
3. **Same recipe**: Both steps must be in the same recipe (enforced by composite key structure)

### Query Patterns

**Get all steps that Step 3 depends on:**
```ts
const dependencies = await db.stepOutputUse.findMany({
  where: { recipeId, inputStepNum: 3 },
  include: { outputOfStep: true }
});
```

**Get all steps that depend on Step 1's output:**
```ts
const dependents = await db.stepOutputUse.findMany({
  where: { recipeId, outputStepNum: 1 },
  include: { inputOfStep: true }
});
```

**Get a step with its dependencies and dependents:**
```ts
const step = await db.recipeStep.findUnique({
  where: { recipeId_stepNum: { recipeId, stepNum: 2 } },
  include: {
    usingSteps: { include: { outputOfStep: true } },   // What this step uses
    usedBySteps: { include: { inputOfStep: true } }    // What uses this step
  }
});
```

---

## Unit 1.1: Step Routes Audit

**Date**: 2026-01-28
**Status**: Complete

### Overview

Audited the existing step-related routes to identify where stepOutputUse selection UI will integrate.

### Route 1: `app/routes/recipes.$id.steps.new.tsx` (Create Step)

#### Current Loader Data Structure

```ts
return { recipe, nextStepNum };
```

| Field | Type | Description |
|-------|------|-------------|
| `recipe` | `{ id, title, chefId, deletedAt, steps: [{ stepNum }] }` | Recipe with minimal step info |
| `nextStepNum` | `number` | Calculated as `max(stepNum) + 1` or `1` if no steps |

The loader fetches:
- Recipe basic info (id, title, chefId, deletedAt)
- Steps with only `stepNum` field (ordered desc, take 1) to calculate next step number

#### Current Action Handler

**Intent**: Creates a new step (no explicit intent, just POST)

**Flow**:
1. Validates user ownership
2. Validates `stepTitle` (optional) and `description` (required)
3. Creates `RecipeStep` with `recipeId`, `stepNum`, `stepTitle`, `description`
4. Redirects to `/recipes/{id}/steps/{stepId}/edit`

**Form Fields**:
- `stepTitle` (optional, max 100 chars)
- `description` (required, max 2000 chars)

#### Where stepOutputUse UI Should Go

**Location**: Between the step number display and the description field (lines 160-178)

**Current structure**:
```
Step Number display (lines 154-158)
  ↓
Form with:
  - stepTitle field
  - description field
  - Cancel/Submit buttons
```

**Proposed structure**:
```
Step Number display
  ↓
Form with:
  - stepTitle field
  - stepOutputUse selector (NEW) <-- Only if nextStepNum > 1
  - description field
  - Cancel/Submit buttons
```

#### Loader Changes Needed

1. **Load available previous steps for selection**:
   ```ts
   const previousSteps = await database.recipeStep.findMany({
     where: { recipeId: id, recipe: { deletedAt: null } },
     select: { stepNum: true, stepTitle: true },
     orderBy: { stepNum: 'asc' },
   });
   ```

2. **Update return value**:
   ```ts
   return { recipe, nextStepNum, previousSteps };
   ```

3. **Only show selector if `nextStepNum > 1`** (first step cannot have dependencies)

#### Action Changes Needed

1. **Parse stepOutputUse selections from form data**:
   - Form will submit multiple values like `usesSteps[0]`, `usesSteps[1]`, etc.
   - Or as a comma-separated string of step numbers

2. **Create StepOutputUse records** after step creation:
   ```ts
   for (const outputStepNum of selectedStepNums) {
     await database.stepOutputUse.create({
       data: {
         recipeId: id,
         outputStepNum,
         inputStepNum: nextStepNum,
       },
     });
   }
   ```

3. **Validation**:
   - Each selected step must exist and have `stepNum < nextStepNum`
   - No duplicate selections

---

### Route 2: `app/routes/recipes.$id.steps.$stepId.edit.tsx` (Edit Step)

#### Current Loader Data Structure

```ts
return { recipe, step };
```

| Field | Type | Description |
|-------|------|-------------|
| `recipe` | `{ id, title, chefId, deletedAt }` | Recipe basic info |
| `step` | Full step with `ingredients` (including `unit` and `ingredientRef`) | Step being edited |

The loader fetches:
- Recipe basic info
- Full step via `findUnique` with `include: { ingredients: { include: { unit, ingredientRef } } }`

#### Current Action Handlers

Multiple intents handled:

| Intent | Form Field | Action |
|--------|------------|--------|
| `delete` | `intent="delete"` | Deletes the step, redirects to recipe edit |
| `addIngredient` | `intent="addIngredient"` | Creates unit (if needed), ingredientRef (if needed), ingredient |
| `deleteIngredient` | `intent="deleteIngredient"` | Deletes ingredient by ID |
| (default) | No intent | Updates stepTitle and description |

#### Where stepOutputUse UI Should Go

**Location**: Between the step title field and description field (lines 282-315)

**Current structure**:
```
stepTitle field (lines 283-295)
  ↓
description field (lines 297-315)
  ↓
Save/Cancel buttons
  ↓
Delete Step button
  ↓
Ingredients section (add/list/delete)
```

**Proposed structure**:
```
stepTitle field
  ↓
stepOutputUse selector (NEW) <-- Only if step.stepNum > 1
  ↓
description field
  ↓
Save/Cancel buttons
  ↓
Delete Step button
  ↓
Ingredients section
```

#### Loader Changes Needed

1. **Load current step's stepOutputUse relations**:
   ```ts
   const step = await database.recipeStep.findUnique({
     where: { id: stepId },
     include: {
       ingredients: { include: { unit: true, ingredientRef: true } },
       usingSteps: {  // NEW
         include: { outputOfStep: { select: { stepNum: true, stepTitle: true } } },
         orderBy: { outputStepNum: 'asc' },
       },
     },
   });
   ```

2. **Load available previous steps** (steps with `stepNum < current step's stepNum`):
   ```ts
   const previousSteps = await database.recipeStep.findMany({
     where: {
       recipeId: id,
       stepNum: { lt: step.stepNum },
     },
     select: { stepNum: true, stepTitle: true },
     orderBy: { stepNum: 'asc' },
   });
   ```

3. **Update return value**:
   ```ts
   return { recipe, step, previousSteps };
   ```

#### Action Changes Needed

1. **Add new intent `updateStepOutputUses`** (or include in default update):
   - Parse selected step numbers from form
   - Delete existing StepOutputUse records for this step (as inputStepNum)
   - Create new StepOutputUse records for selected steps

2. **Validation for step deletion** (existing `delete` intent):
   - Before deleting, check if any other step depends on this step:
     ```ts
     const dependents = await database.stepOutputUse.count({
       where: { recipeId: id, outputStepNum: step.stepNum },
     });
     if (dependents > 0) {
       return data({ errors: { general: "Cannot delete: other steps depend on this step's output" } }, { status: 400 });
     }
     ```

3. **Form field for stepOutputUse**:
   - Multi-select Listbox submitting as `usesSteps[]` or similar
   - Value format: array of step numbers

---

### Summary of Changes Needed

| Route | Loader Changes | Action Changes | UI Changes |
|-------|----------------|----------------|------------|
| `steps.new.tsx` | Add `previousSteps` query | Create StepOutputUse records after step | Add multi-select before description |
| `steps.$stepId.edit.tsx` | Add `usingSteps` to step include, add `previousSteps` query | Add delete validation, add update logic | Add multi-select before description |

### Component Dependency

Both routes will need access to a multi-select Listbox component. Per Unit 0.0, the current `app/components/ui/listbox.tsx` has `multiple={false}` hardcoded and needs modification in Unit 2.0.

### Validation Rules to Implement

1. **Forward-only references**: `outputStepNum < inputStepNum` (UI should only show previous steps)
2. **No self-reference**: Implicitly handled by only showing previous steps
3. **Deletion protection**: Check `usedBySteps` count before allowing step deletion
4. **Same recipe**: Enforced by query filters (only query steps from same recipe)

---

## Unit 1.2: Recipe Detail Audit

**Date**: 2026-01-28
**Status**: Complete

### Overview

Audited the recipe detail view (`app/routes/recipes.$id.tsx`) to understand how steps are rendered and where stepOutputUse display will integrate.

### Current File Structure

**Location**: `app/routes/recipes.$id.tsx` (214 lines)

**Exports**:
- `loader` - Fetches recipe with steps and ingredients
- `action` - Handles recipe deletion (soft delete)
- `RecipeDetail` - Default component

### Current Loader Data Structure (lines 10-52)

```ts
const recipe = await database.recipe.findUnique({
  where: { id },
  include: {
    chef: { select: { id: true, username: true } },
    steps: {
      orderBy: { stepNum: "asc" },
      include: {
        ingredients: {
          include: {
            unit: true,
            ingredientRef: true,
          },
        },
      },
    },
  },
});

return { recipe, isOwner };
```

| Field | Type | Description |
|-------|------|-------------|
| `recipe.chef` | `{ id, username }` | Recipe author info |
| `recipe.steps` | Step[] | Steps ordered by stepNum ascending |
| `recipe.steps[].ingredients` | Ingredient[] | Each step's ingredients with unit/ingredientRef |
| `isOwner` | `boolean` | Whether current user owns the recipe |

### Current Step Rendering (lines 161-208)

**Component Structure**:
```
<Heading level={2}>Steps</Heading>
  ↓
(if no steps) Empty state with "Add Steps" button
  ↓
(if has steps) For each step:
  <div> (step card with border)
    ├── Step number badge (blue circle)
    ├── Step title (if exists) <Subheading>
    ├── Description <Text>
    └── Ingredients section (if has ingredients)
        ├── "Ingredients" header
        └── <ul> with ingredient items
```

**Current Display Order Within Each Step**:
```
1. Step number (in badge)
2. Step title (optional)
3. Description
4. Ingredients list
```

### Required Display Order for stepOutputUse

Per planning doc: **Title → Ingredients → Step Output Uses → Description**

But looking at the current structure and the Redwood patterns from Unit 0.2, the order should be:

```
1. Step number (in badge)
2. Step title (optional)
3. Step Output Uses (NEW - checklist showing dependencies)
4. Description
5. Ingredients list
```

**Note**: The planning doc says "Title → Ingredients → Step Output Uses → Description" but Unit 0.2 shows Redwood uses "Ingredients → Step Output Uses → Description". For the recipe detail view (read-only), I recommend:

```
1. Step number + title
2. Ingredients (things you need to gather)
3. Step Output Uses (outputs from previous steps you're using)
4. Description (the actual instructions)
```

This groups "inputs" (ingredients + step outputs) together before "instructions" (description).

### Where stepOutputUse Checklist Should Appear

**Location**: After the ingredients section, before the closing `</div>` of each step card (around line 204)

**Current code structure** (lines 191-205):
```tsx
{step.ingredients.length > 0 && (
  <div className="bg-gray-100 p-4 rounded mt-4">
    <Subheading level={4} className="m-0 mb-3 text-sm uppercase text-gray-500">
      Ingredients
    </Subheading>
    <ul className="m-0 pl-6">
      {step.ingredients.map((ingredient) => (
        <li key={ingredient.id}>
          {ingredient.quantity} {ingredient.unit.name} {ingredient.ingredientRef.name}
        </li>
      ))}
    </ul>
  </div>
)}
```

**Proposed addition** (after ingredients, before step card closes):
```tsx
{step.usingSteps && step.usingSteps.length > 0 && (
  <div className="bg-gray-100 p-4 rounded mt-4">
    <Subheading level={4} className="m-0 mb-3 text-sm uppercase text-gray-500">
      Using outputs from
    </Subheading>
    <ul className="m-0 pl-6">
      {step.usingSteps.map((use) => (
        <li key={use.id}>
          output of step {use.outputStepNum}
          {use.outputOfStep.stepTitle && `: ${use.outputOfStep.stepTitle}`}
        </li>
      ))}
    </ul>
  </div>
)}
```

### Loader Changes Needed

Add `usingSteps` to the steps include:

```ts
steps: {
  orderBy: { stepNum: "asc" },
  include: {
    ingredients: {
      include: {
        unit: true,
        ingredientRef: true,
      },
    },
    usingSteps: {  // NEW
      include: {
        outputOfStep: {
          select: { stepNum: true, stepTitle: true },
        },
      },
      orderBy: { outputStepNum: 'asc' },
    },
  },
},
```

### No Action Changes Needed

The recipe detail page's action only handles deletion. The stepOutputUse data is read-only on this page (editing happens in step edit routes audited in Unit 1.1).

### TypeScript Considerations

The loader return type will automatically include the new `usingSteps` field once added to the Prisma include. The component will need to handle:
- `step.usingSteps` array (may be empty)
- `step.usingSteps[].outputOfStep.stepNum` (always exists)
- `step.usingSteps[].outputOfStep.stepTitle` (optional, may be null)

### Visual Design Consistency

To match the ingredients section styling:
- Same `bg-gray-100 p-4 rounded mt-4` container
- Same `Subheading level={4}` for section header
- Same `<ul className="m-0 pl-6">` for list items

The header text should be "Using outputs from" (or similar) to differentiate from ingredients. Per Redwood patterns (Unit 0.2), each item displays as "output of step X: [title]".

### Checklist State (Future Enhancement)

The Redwood implementation has checkbox state for tracking progress through ingredients and step outputs. This is noted but not in scope for the current stepOutputUse implementation—it's a follow-on enhancement to add "recipe following" mode with checkable items.

---

## Unit 1.3: Validation Patterns Audit

**Date**: 2026-01-28
**Status**: Complete

### Overview

Reviewed `app/lib/validation.ts` to understand existing validation patterns and document the approach for StepOutputUse validation.

### File Location and Purpose

**Path**: `app/lib/validation.ts` (174 lines)
**Import**: `~/lib/validation.ts`
**Usage**: Shared validation for both client and server (no `.server.ts` suffix)

### ValidationResult Type Pattern

The codebase uses a discriminated union for validation results:

```ts
export type ValidationResult = { valid: true } | { valid: false; error: string }
```

**Pattern benefits**:
- Type-safe: Forces checking `valid` before accessing `error`
- Consistent: All validation functions return the same shape
- Composable: Easy to chain validations and collect errors

**Usage pattern**:
```ts
const result = validateTitle(title);
if (!result.valid) {
  return { errors: { title: result.error } };
}
```

### Constants Pattern

Length limits and range constraints are defined as exported constants:

```ts
// Field length limits
export const TITLE_MAX_LENGTH = 200
export const DESCRIPTION_MAX_LENGTH = 2000
export const STEP_DESCRIPTION_MAX_LENGTH = 5000
export const STEP_TITLE_MAX_LENGTH = 200
export const SERVINGS_MAX_LENGTH = 100
export const UNIT_NAME_MAX_LENGTH = 50
export const INGREDIENT_NAME_MAX_LENGTH = 100

// Quantity range limits
export const QUANTITY_MIN = 0.001
export const QUANTITY_MAX = 99999
```

**Pattern benefits**:
- Reusable in UI (for `maxLength` attributes)
- Single source of truth for limits
- Testable with known boundaries

### Existing Validation Functions

| Function | Required? | Validation Rules |
|----------|-----------|------------------|
| `validateTitle(title)` | Yes | Non-empty after trim, max 200 chars |
| `validateDescription(desc)` | No | Max 2000 chars if provided |
| `validateStepTitle(title)` | No | Max 200 chars if provided |
| `validateStepDescription(desc)` | Yes | Non-empty after trim, max 5000 chars |
| `validateServings(servings)` | No | Max 100 chars if provided |
| `validateQuantity(qty)` | Yes | Finite number, 0.001-99999 range |
| `validateUnitName(name)` | Yes | Non-empty after trim, max 50 chars |
| `validateIngredientName(name)` | Yes | Non-empty after trim, max 100 chars |
| `validateImageUrl(url)` | No | Valid HTTP/HTTPS URL if provided |

### Common Validation Patterns

#### 1. Required String Field
```ts
export function validateTitle(title: string): ValidationResult {
  const trimmed = title.trim()
  if (!trimmed) {
    return { valid: false, error: 'Title is required' }
  }
  if (trimmed.length > TITLE_MAX_LENGTH) {
    return { valid: false, error: 'Title must be 200 characters or less' }
  }
  return { valid: true }
}
```

#### 2. Optional String Field
```ts
export function validateDescription(description: string | null): ValidationResult {
  if (!description) {
    return { valid: true }  // Early return for empty/null
  }
  const trimmed = description.trim()
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    return { valid: false, error: 'Description must be 2,000 characters or less' }
  }
  return { valid: true }
}
```

#### 3. Numeric Range Field
```ts
export function validateQuantity(quantity: number): ValidationResult {
  if (!Number.isFinite(quantity)) {
    return { valid: false, error: 'Quantity must be a valid number' }
  }
  if (quantity < QUANTITY_MIN || quantity > QUANTITY_MAX) {
    return { valid: false, error: 'Quantity must be between 0.001 and 99,999' }
  }
  return { valid: true }
}
```

#### 4. URL Validation
```ts
export function validateImageUrl(url: string | null): ValidationResult {
  if (!url) return { valid: true }
  const trimmed = url.trim()
  if (!trimmed) return { valid: true }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Please enter a valid URL' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Please enter a valid URL' }
  }
}
```

### StepOutputUse Validation Requirements

Based on planning docs and schema analysis (Units 0.3, 1.1, 1.2), StepOutputUse needs these validations:

| Rule | Description | Where Enforced |
|------|-------------|----------------|
| Forward-only | `outputStepNum < inputStepNum` | UI + Action |
| No self-reference | `outputStepNum !== inputStepNum` | Implicit (UI only shows previous) |
| Valid step exists | Referenced step must exist in recipe | Action (DB query) |
| Same recipe | Both steps in same recipe | Implicit (composite key) |

### Proposed StepOutputUse Validation Function

Following the established patterns:

```ts
/**
 * Validates a step output use reference.
 * - outputStepNum must be less than inputStepNum (forward references only)
 * - outputStepNum must be positive (valid step number)
 */
export function validateStepOutputUse(
  outputStepNum: number,
  inputStepNum: number
): ValidationResult {
  if (!Number.isInteger(outputStepNum) || outputStepNum < 1) {
    return { valid: false, error: 'Invalid source step number' }
  }
  if (outputStepNum >= inputStepNum) {
    return { valid: false, error: 'Can only reference previous steps' }
  }
  return { valid: true }
}
```

**Note**: The "step exists" validation requires a database query and should happen in the action handler, not in the pure validation function.

### Validation in Action Handlers

Looking at existing routes (from Unit 1.1), validations are applied in actions like this:

```ts
// Example from recipes.$id.steps.new.tsx
const stepTitleResult = validateStepTitle(stepTitle);
if (!stepTitleResult.valid) {
  return data({ errors: { stepTitle: stepTitleResult.error } }, { status: 400 });
}

const descriptionResult = validateStepDescription(description);
if (!descriptionResult.valid) {
  return data({ errors: { description: descriptionResult.error } }, { status: 400 });
}
```

**Pattern**: Each validation returns immediately on failure with a field-specific error.

### Error Response Pattern

Actions return errors in this shape:
```ts
{ errors: { fieldName: "Error message" } }
```

For StepOutputUse, errors could be:
```ts
{ errors: { stepOutputUses: "Can only reference previous steps" } }
// or for deletion blocking:
{ errors: { general: "Cannot delete: other steps depend on this step's output" } }
```

### Key Takeaways for Implementation

1. **Follow ValidationResult pattern** - Return `{ valid: true }` or `{ valid: false, error: string }`
2. **Add constant if needed** - No new constants needed for stepOutputUse (it's relational, not length-based)
3. **Keep validation pure** - Database checks happen in action, not validation function
4. **UI enforces first** - Only show valid options (previous steps only)
5. **Action validates again** - Never trust client data; re-validate on server

---

## Unit 1.4: Test Patterns Audit

**Date**: 2026-01-28
**Status**: Complete

### Overview

Documented testing utilities and patterns used in the codebase by reviewing `test/routes/recipes-id-steps-id-edit.test.tsx`.

### Testing Stack

| Tool | Purpose |
|------|---------|
| **Vitest** | Test runner and assertion library |
| **React Testing Library** | Component rendering and DOM queries |
| **@faker-js/faker** | Generating unique test data |
| **undici** | Node.js HTTP client for Request/FormData in tests |
| **@testing-library/react** | `render`, `screen`, `fireEvent` utilities |

### Test File Structure

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen, fireEvent } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sessionStorage } from "~/lib/session.server";
import { faker } from "@faker-js/faker";

describe("Route Name", () => {
  let testUserId: string;
  // ... other test variables

  beforeEach(async () => {
    await cleanupDatabase();
    // Create test data
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => { /* loader tests */ });
  describe("action", () => { /* action tests */ });
  describe("component", () => { /* component tests */ });
});
```

### Key Test Utilities

#### 1. `createTestRoutesStub` (test/utils.ts)

Wrapper around React Router's `createRoutesStub` that adds `HydrateFallback` to suppress hydration warnings:

```ts
const Stub = createTestRoutesStub([
  {
    path: "/recipes/:id/steps/:stepId/edit",
    Component: EditStep,
    loader: () => mockData,
    action: () => ({ errors: { ... } }),
  },
]);

render(<Stub initialEntries={["/recipes/recipe-1/steps/step-1/edit"]} />);
```

#### 2. `cleanupDatabase()` (test/helpers/cleanup.ts)

Cleans up all test data in correct foreign key order. Called in `beforeEach` AND `afterEach`:

```ts
beforeEach(async () => {
  await cleanupDatabase();
  // Create fresh test data
});

afterEach(async () => {
  await cleanupDatabase();
});
```

**Deletion order** (most dependent first):
1. shoppingListItem → shoppingList
2. ingredient → recipeStep
3. recipeInCookbook → cookbook, recipe
4. ingredientRef, unit
5. userCredential, oAuth → user

#### 3. Faker-based Data Generators (test/utils.ts)

| Function | Returns |
|----------|---------|
| `createTestUser()` | `{ email, username, hashedPassword, salt }` |
| `createTestRecipe(chefId)` | `{ title, description, servings, chefId }` |
| `createUnitName()` | Unique unit name string |
| `createIngredientName()` | Unique ingredient name string |
| `createStepDescription()` | Unique step description string |
| `createStepTitle()` | Unique step title string |
| `createCookbookTitle()` | Unique cookbook title string |

#### 4. Idempotent Helpers (test/utils.ts)

For data that might already exist (prevents unique constraint errors):

```ts
const unit = await getOrCreateUnit(db, "cup");
const ingredientRef = await getOrCreateIngredientRef(db, "flour");
```

### Session Creation Pattern

For authenticated requests, create a session with the user ID:

```ts
const session = await sessionStorage.getSession();
session.set("userId", testUserId);
const setCookieHeader = await sessionStorage.commitSession(session);
const cookieValue = setCookieHeader.split(";")[0];

const headers = new Headers();
headers.set("Cookie", cookieValue);

const request = new UndiciRequest(url, { headers });
```

### Request Patterns

#### GET Request (Loader)
```ts
const request = new UndiciRequest(`http://localhost:3000/recipes/${recipeId}/steps/${stepId}/edit`, { headers });

const result = await loader({
  request,
  context: { cloudflare: { env: null } },
  params: { id: recipeId, stepId },
} as any);
```

#### POST Request (Action)
```ts
const formData = new UndiciFormData();
formData.append("description", "Updated step");
formData.append("intent", "delete");

const request = new UndiciRequest(url, {
  method: "POST",
  body: formData,
  headers,
});

const response = await action({
  request,
  context: { cloudflare: { env: null } },
  params: { id: recipeId, stepId },
} as any);
```

### Response Data Extraction

Helper function to handle React Router's `data()` response wrapper:

```ts
function extractResponseData(response: any): { data: any; status: number } {
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status || 200 };
  }
  if (response instanceof Response) {
    return { data: null, status: response.status };
  }
  return { data: response, status: 200 };
}

// Usage:
const { data, status } = extractResponseData(response);
expect(status).toBe(400);
expect(data.errors.description).toBe("Step description is required");
```

### Assertion Patterns

#### Redirect/Error Response (throws)
```ts
await expect(
  loader({ request, context, params } as any)
).rejects.toSatisfy((error: any) => {
  expect(error).toBeInstanceOf(Response);
  expect(error.status).toBe(302);
  expect(error.headers.get("Location")).toContain("/login");
  return true;
});
```

#### Successful Response (returns)
```ts
const response = await action({ request, context, params } as any);
expect(response).toBeInstanceOf(Response);
expect(response.status).toBe(302);
expect(response.headers.get("Location")).toBe(`/recipes/${recipeId}/edit`);
```

#### Component Rendering
```ts
expect(await screen.findByRole("heading", { name: "Edit Step 1" })).toBeInTheDocument();
expect(screen.getByLabelText(/Step Title/)).toHaveValue("Prep the Ingredients");
expect(screen.getByRole("button", { name: "Delete Step" })).toBeInTheDocument();
expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/recipes/recipe-1/edit");
```

### Mocking Pattern

For database error testing:

```ts
const originalUpdate = db.recipeStep.update;
db.recipeStep.update = vi.fn().mockRejectedValue(new Error("Database connection failed"));

try {
  // Test code
} finally {
  db.recipeStep.update = originalUpdate;  // Always restore
}
```

### Test Organization by Category

The test file organizes tests into logical groups:

```
describe("Route Name", () => {
  describe("loader", () => {
    it("should redirect when not logged in")
    it("should return data when logged in as owner")
    it("should throw 403 when non-owner tries to access")
    it("should throw 404 for non-existent recipe")
    it("should throw 404 for soft-deleted recipe")
    it("should include related data in response")
  });

  describe("action", () => {
    it("should redirect when not logged in")
    it("should throw 403 when non-owner tries to update")
    it("should return validation error when field is empty")
    it("should return validation error for boundary violations")
    it("should successfully update and redirect")

    describe("specific intent", () => {
      // Intent-specific tests
    });
  });

  describe("component", () => {
    it("should render form with data")
    it("should render empty state")
    it("should show/hide elements on interaction")
  });
});
```

### Key Test Patterns Summary

| Pattern | Purpose |
|---------|---------|
| `beforeEach` + `afterEach` cleanup | Isolated tests, no state leakage |
| `faker` + alphanumeric suffix | Guaranteed unique test data |
| `getOrCreateUnit/IngredientRef` | Idempotent reference data |
| `sessionStorage.getSession()` | Create authenticated requests |
| `UndiciRequest` + `UndiciFormData` | HTTP requests in Node.js tests |
| `extractResponseData()` | Handle React Router data wrapper |
| `rejects.toSatisfy()` | Assert on thrown Response objects |
| `createTestRoutesStub` | Component tests with routing |
| `screen.findByRole` | Async element queries |
| `vi.fn().mockRejectedValue()` | Simulate errors |

---

## Unit 6.6: Performance — Query Review

**Date**: 2026-01-28
**Status**: Complete

### Overview

Reviewed all database queries added for the stepOutputUse feature to identify potential performance issues including N+1 query patterns, missing indexes, and unnecessary data loading.

### Query Files Reviewed

| File | Functions | Purpose |
|------|-----------|---------|
| `app/lib/step-output-use-queries.server.ts` | `loadRecipeStepOutputUses()`, `loadStepDependencies()`, `checkStepUsage()` | Read queries |
| `app/lib/step-output-use-mutations.server.ts` | `deleteExistingStepOutputUses()`, `createStepOutputUses()` | Write operations |
| `app/lib/step-deletion-validation.server.ts` | `validateStepDeletion()` | Deletion validation |
| `app/lib/step-reorder-validation.server.ts` | `validateStepReorder()`, `validateStepReorderOutgoing()`, `validateStepReorderComplete()` | Reorder validation |
| `app/routes/recipes.$id.steps.new.tsx` | loader, action | New step creation |
| `app/routes/recipes.$id.steps.$stepId.edit.tsx` | loader, action | Step editing |
| `app/routes/recipes.$id.edit.tsx` | action (reorderStep intent) | Step reordering |

### Index Analysis

**StepOutputUse table indexes (prisma/schema.prisma:119-122):**

```prisma
@@unique([recipeId, outputStepNum, inputStepNum])  // Unique constraint
@@index([recipeId, outputStepNum, inputStepNum])   // Full composite lookup
@@index([recipeId, outputStepNum])                 // "What steps use this output?"
@@index([recipeId, inputStepNum])                  // "What steps does this use?"
```

**Finding**: ✅ **Indexes are correctly configured.** All queries filter by `recipeId` combined with either `outputStepNum` or `inputStepNum`, which matches the available indexes.

### Query-by-Query Analysis

#### 1. `loadRecipeStepOutputUses(recipeId)` — step-output-use-queries.server.ts:9-18

```ts
db.stepOutputUse.findMany({
  where: { recipeId },
  include: {
    outputOfStep: {
      select: { stepNum: true, stepTitle: true },
    },
  },
  orderBy: [{ inputStepNum: "asc" }, { outputStepNum: "asc" }],
});
```

**Finding**: ✅ **Efficient.** Single query with join. Uses `recipeId` filter which can use the index prefix. The `include` with `select` only fetches needed fields from the related RecipeStep.

#### 2. `loadStepDependencies(recipeId, stepNum)` — step-output-use-queries.server.ts:28-42

```ts
db.stepOutputUse.findMany({
  where: { recipeId, inputStepNum: stepNum },
  include: {
    outputOfStep: {
      select: { stepNum: true, stepTitle: true, id: true },
    },
  },
  orderBy: { outputStepNum: "asc" },
});
```

**Finding**: ✅ **Efficient.** Uses `@@index([recipeId, inputStepNum])` directly. The unnecessary `id: true` in select is harmless (RecipeStep.id isn't used in the return mapping) but minimal overhead.

#### 3. `checkStepUsage(recipeId, stepNum)` — step-output-use-queries.server.ts:52-66

```ts
db.stepOutputUse.findMany({
  where: { recipeId, outputStepNum: stepNum },
  include: {
    inputOfStep: {
      select: { stepNum: true, stepTitle: true },
    },
  },
  orderBy: { inputStepNum: "asc" },
});
```

**Finding**: ✅ **Efficient.** Uses `@@index([recipeId, outputStepNum])` directly. Properly fetches only needed fields.

#### 4. `deleteExistingStepOutputUses(recipeId, inputStepNum)` — step-output-use-mutations.server.ts:11-23

```ts
db.stepOutputUse.deleteMany({
  where: { recipeId, inputStepNum },
});
```

**Finding**: ✅ **Efficient.** Uses `@@index([recipeId, inputStepNum])` for the delete. `deleteMany` is a single operation.

#### 5. `createStepOutputUses(recipeId, inputStepNum, outputStepNums)` — step-output-use-mutations.server.ts:34-54

```ts
db.stepOutputUse.createMany({
  data: outputStepNums.map((outputStepNum) => ({
    recipeId,
    inputStepNum,
    outputStepNum,
  })),
});
```

**Finding**: ✅ **Efficient.** Uses `createMany` for batch insert instead of individual creates. Handles empty array case by returning early.

#### 6. `validateStepReorderComplete()` — step-reorder-validation.server.ts:208-220

```ts
const [incomingResult, outgoingResult] = await Promise.all([
  validateStepReorder(recipeId, currentStepNum, newPosition),
  validateStepReorderOutgoing(recipeId, currentStepNum, newPosition),
]);
```

**Finding**: ✅ **Optimized with parallel execution.** Runs both validations concurrently via `Promise.all()`. Each inner validation may short-circuit (return early without DB query) based on position check.

### Loader Query Analysis

#### `recipes.$id.steps.new.tsx` loader (lines 25-75)

**Queries**:
1. Fetch recipe with steps (only stepNum, desc order, take 1) — for nextStepNum calculation
2. Conditionally fetch availableSteps (only if nextStepNum > 1)

```ts
// Query 1: Recipe with last step
const recipe = await database.recipe.findUnique({
  where: { id },
  select: {
    id: true, title: true, chefId: true, deletedAt: true,
    steps: {
      select: { stepNum: true },
      orderBy: { stepNum: "desc" },
      take: 1,  // Only need max stepNum
    },
  },
});

// Query 2: Available steps (only if not first step)
const availableSteps = nextStepNum > 1
  ? await database.recipeStep.findMany({
      where: { recipeId: id, stepNum: { lt: nextStepNum } },
      select: { stepNum: true, stepTitle: true },
      orderBy: { stepNum: "asc" },
    })
  : [];
```

**Finding**: ✅ **Efficient.**
- First query uses `take: 1` optimization to avoid loading all steps
- Second query only runs when needed (conditional)
- Both use appropriate indexes (`recipeId` on Recipe, `recipeId + stepNum` on RecipeStep)

#### `recipes.$id.steps.$stepId.edit.tsx` loader (lines 51-116)

**Queries**:
1. Fetch recipe basic info
2. Fetch step with ingredients and usingSteps
3. Fetch availableSteps (previous steps)

```ts
// Query 1: Recipe
const recipe = await database.recipe.findUnique({
  where: { id },
  select: { id: true, title: true, chefId: true, deletedAt: true },
});

// Query 2: Step with relations
const step = await database.recipeStep.findUnique({
  where: { id: stepId },
  include: {
    ingredients: {
      include: { unit: true, ingredientRef: true },
    },
    usingSteps: {
      include: {
        outputOfStep: { select: { stepNum: true, stepTitle: true } },
      },
      orderBy: { outputStepNum: "asc" },
    },
  },
});

// Query 3: Available steps
const availableSteps = await database.recipeStep.findMany({
  where: { recipeId: id, stepNum: { lt: step.stepNum } },
  select: { stepNum: true, stepTitle: true },
  orderBy: { stepNum: "asc" },
});
```

**Finding**: ✅ **Acceptable.** Three sequential queries, but:
- Query 1 and 2 could potentially be combined, but would complicate error handling (recipe not found vs step not found)
- Query 3 depends on step.stepNum from Query 2
- All queries use proper indexes
- No N+1 pattern (all uses `include` not loops)

**Potential optimization (not recommended)**: Could combine recipe + step queries if using raw SQL with joins, but this adds complexity without significant gain for typical recipe sizes.

### N+1 Query Pattern Check

**Finding**: ✅ **No N+1 patterns detected.** All queries use:
- `include` for eager loading related data in a single query
- `findMany` with batch operations, not loops with individual queries
- `createMany` for batch inserts

### Unnecessary Data Loading Check

**Finding**: ✅ **Minimal unnecessary data.** Most queries use `select` to limit returned fields. Minor observations:

1. `loadStepDependencies()` includes `id: true` in select but doesn't use it — harmless, 1 string field
2. Loaders fetch complete ingredient data (unit, ingredientRef names) which is needed for display

### Action Query Analysis

#### `recipes.$id.steps.$stepId.edit.tsx` action — delete intent (lines 153-167)

```ts
// Validation query
const validationResult = await validateStepDeletion(id, step.stepNum);
// → internally calls checkStepUsage() — single query

// Delete operation
await database.recipeStep.delete({ where: { id: stepId } });
// → CASCADE deletes StepOutputUse records automatically
```

**Finding**: ✅ **Efficient.** Validation uses single query. Deletion relies on CASCADE for related cleanup.

#### `recipes.$id.edit.tsx` action — reorderStep intent (lines 99-155)

```ts
// Validation
const validationResult = await validateStepReorderComplete(id, step.stepNum, targetStepNum);
// → runs two queries in parallel

// Target step lookup
const targetStep = await database.recipeStep.findUnique({
  where: { recipeId_stepNum: { recipeId: id, stepNum: targetStepNum } },
});

// Three updates for swap (using temp stepNum)
await database.recipeStep.update({ ... });  // Move to temp
await database.recipeStep.update({ ... });  // Move target to original
await database.recipeStep.update({ ... });  // Move from temp to target
```

**Finding**: ✅ **Acceptable.** The three sequential updates are necessary due to unique constraint on `[recipeId, stepNum]`. SQLite handles ON UPDATE CASCADE for StepOutputUse records automatically.

**Note**: The comment in the code correctly documents this: "SQLite's ON UPDATE CASCADE automatically updates StepOutputUse references when RecipeStep.stepNum changes".

### Summary of Findings

| Category | Status | Notes |
|----------|--------|-------|
| **Indexes** | ✅ Correct | All query patterns have matching indexes |
| **N+1 Patterns** | ✅ None found | All use `include` or batch operations |
| **Unnecessary Data** | ✅ Minimal | Queries use `select` appropriately |
| **Parallel Execution** | ✅ Used | `validateStepReorderComplete` uses `Promise.all()` |
| **Batch Operations** | ✅ Used | `createMany`, `deleteMany` for bulk operations |
| **CASCADE Behavior** | ✅ Correct | Relies on DB CASCADE for cleanup |

### Recommendations

**No changes required.** The query patterns are well-optimized for the use case:

1. Recipes typically have 5-20 steps, so step-related queries are inherently bounded
2. StepOutputUse records per recipe are typically < 50 (each step uses 0-3 previous steps)
3. Indexes cover all filter patterns used
4. No loops with individual queries (would cause N+1)

The current implementation balances simplicity with performance appropriately for the expected data volumes.

---

## Unit 6.7: Performance — Optimize Queries

**Date**: 2026-01-28
**Status**: Complete

### Overview

Reviewed performance findings from Unit 6.6 to determine if any query optimizations were needed.

### Unit 6.6 Findings Summary

The Unit 6.6 performance review was comprehensive and found:

| Category | Status | Notes |
|----------|--------|-------|
| **Indexes** | ✅ Correct | All query patterns have matching indexes |
| **N+1 Patterns** | ✅ None found | All use `include` or batch operations |
| **Unnecessary Data** | ✅ Minimal | Queries use `select` appropriately |
| **Parallel Execution** | ✅ Used | `validateStepReorderComplete` uses `Promise.all()` |
| **Batch Operations** | ✅ Used | `createMany`, `deleteMany` for bulk operations |
| **CASCADE Behavior** | ✅ Correct | Relies on DB CASCADE for cleanup |

### Why No Optimizations Are Needed

1. **Bounded data volumes**: Recipes typically have 5-20 steps, and StepOutputUse records per recipe are typically < 50

2. **Proper index coverage**: The StepOutputUse table has three indexes covering all access patterns:
   - `@@index([recipeId, outputStepNum, inputStepNum])` — Full composite lookup
   - `@@index([recipeId, outputStepNum])` — "What steps use this output?"
   - `@@index([recipeId, inputStepNum])` — "What steps does this use?"

3. **No N+1 query patterns**: All queries use:
   - Prisma `include` for eager loading
   - `findMany` with batch operations (not loops)
   - `createMany` / `deleteMany` for bulk operations

4. **Appropriate use of `select`**: Queries fetch only needed fields when loading related data

5. **Parallel execution where beneficial**: `validateStepReorderComplete()` runs both validation queries concurrently

### Conclusion

The current implementation is already well-optimized. No code changes were required for Unit 6.7.

**Test verification**:
- All 2042 tests pass
- 100% test coverage maintained
- Zero warnings

---

## Unit 6.8: Documentation & Examples

**Date**: 2026-01-28
**Status**: Complete

### Feature Overview

The **stepOutputUse** feature allows recipe steps to declare dependencies on the output of previous steps. For example, in a hummus recipe:
- Step 1: Cook chickpeas
- Step 2: Blend chickpeas (uses output from Step 1)
- Step 3: Add tahini and mix (uses output from Step 2)

This creates a clear dependency chain that:
1. Documents the workflow for users following the recipe
2. Prevents accidental deletion of steps that other steps depend on
3. Prevents step reordering that would break dependency chains

---

### Database Schema

**Model**: `StepOutputUse` (prisma/schema.prisma:109-123)

```prisma
model StepOutputUse {
  id            String     @id @default(cuid())
  recipeId      String
  outputStepNum Int        // Step that PRODUCES the output
  outputOfStep  RecipeStep @relation(name: "output", ...)
  inputStepNum  Int        // Step that USES the output
  inputOfStep   RecipeStep @relation(name: "input", ...)
  updatedAt     DateTime   @default(now()) @updatedAt

  @@unique([recipeId, outputStepNum, inputStepNum])
  @@index([recipeId, outputStepNum, inputStepNum])
  @@index([recipeId, outputStepNum])
  @@index([recipeId, inputStepNum])
}
```

**Terminology**:
| Term | Meaning | Example |
|------|---------|---------|
| `outputStepNum` | Step that PRODUCES output | Step 1 (cooks chickpeas) |
| `inputStepNum` | Step that USES output | Step 2 (blends chickpeas) |
| `outputOfStep` | Relation to producer step | RecipeStep with stepNum=1 |
| `inputOfStep` | Relation to consumer step | RecipeStep with stepNum=2 |

**RecipeStep inverse relations**:
```prisma
model RecipeStep {
  usingSteps  StepOutputUse[] @relation("input")   // Steps THIS step uses
  usedBySteps StepOutputUse[] @relation("output")  // Steps that use THIS step
}
```

---

### Validation Rules

#### 1. Forward References Only
**Rule**: `outputStepNum < inputStepNum`

Steps can only reference **previous** steps. Step 3 can use outputs from Steps 1 or 2, but not Step 4.

**Implementation**: `app/lib/validation.ts`
```typescript
export function validateStepReference(
  outputStepNum: number,
  inputStepNum: number
): ValidationResult {
  if (!Number.isInteger(outputStepNum) || outputStepNum < 1) {
    return { valid: false, error: "Invalid step number" };
  }
  if (outputStepNum >= inputStepNum) {
    return { valid: false, error: "Can only reference previous steps" };
  }
  return { valid: true };
}
```

#### 2. Deletion Protection
**Rule**: Cannot delete a step if other steps depend on its output.

**Implementation**: `app/lib/step-deletion-validation.server.ts`
```typescript
export async function validateStepDeletion(
  recipeId: string,
  stepNum: number
): Promise<ValidationResult> {
  const usedBy = await checkStepUsage(recipeId, stepNum);
  if (usedBy.length === 0) {
    return { valid: true };
  }
  // Returns error listing dependent steps
  return {
    valid: false,
    error: `Cannot delete Step ${stepNum} because it is used by ${formatStepList(usedBy)}`,
  };
}
```

**Error messages**:
- "Cannot delete Step 1 because it is used by Step 2"
- "Cannot delete Step 1 because it is used by Steps 2 and 3"
- "Cannot delete Step 1 because it is used by Steps 2, 3, and 4"

#### 3. Reorder Protection
**Rule**: Cannot reorder steps if it would break dependency chains.

Two directions validated:

1. **Incoming dependencies**: Can't move a step forward past steps that depend on it
2. **Outgoing dependencies**: Can't move a step backward before its dependencies

**Implementation**: `app/lib/step-reorder-validation.server.ts`
```typescript
// Validates both directions in parallel
export async function validateStepReorderComplete(
  recipeId: string,
  currentStepNum: number,
  newPosition: number
): Promise<ValidationResult> {
  const [incomingResult, outgoingResult] = await Promise.all([
    validateStepReorder(recipeId, currentStepNum, newPosition),      // Incoming
    validateStepReorderOutgoing(recipeId, currentStepNum, newPosition), // Outgoing
  ]);
  // Combines errors if both fail
}
```

**Error messages**:
- "Cannot move Step 1 to position 3 because Steps 2 and 3 use its output"
- "Cannot move Step 3 to position 1 because it uses output from Steps 1 and 2"

---

### UI Components

#### StepOutputUseDisplay (Read-Only Display)
**Location**: `app/components/StepOutputUseDisplay.tsx`

Displays step dependencies in the recipe detail view.

```tsx
<StepOutputUseDisplay usingSteps={step.usingSteps ?? []} />
```

**Rendering**:
- Only renders if `usingSteps` array is non-empty
- Displays as gray box with bullet list (matches ingredients styling)
- Format: "output of step X: [title]" or "output of step X" if no title

**Example output**:
```
Using outputs from:
• output of step 1: Cook chickpeas
• output of step 2: Blend mixture
```

#### Multi-Select Listbox (Editing)
**Location**: `app/components/ui/listbox.tsx`

Used in step create/edit forms to select previous steps.

```tsx
<Listbox
  name="usesSteps"
  multiple={true}
  value={selectedSteps}
  onChange={setSelectedSteps}
  aria-label="Select previous steps"
  placeholder="Select previous steps (optional)"
>
  {availableSteps.map((step) => (
    <ListboxOption key={step.stepNum} value={step.stepNum}>
      <ListboxLabel>
        Step {step.stepNum}{step.stepTitle ? `: ${step.stepTitle}` : ""}
      </ListboxLabel>
    </ListboxOption>
  ))}
</Listbox>
```

**Key features**:
- `multiple={true}` enables checkbox-style selection
- Dropdown stays open after selecting (unlike single-select)
- Selected items display comma-separated in button
- Form submission creates hidden inputs: `usesSteps[0]`, `usesSteps[1]`, etc.

---

### Route Integration

#### Create Step (`app/routes/recipes.$id.steps.new.tsx`)

**Loader**:
- Calculates `nextStepNum` (max existing + 1, or 1 if no steps)
- Loads `availableSteps` only if `nextStepNum > 1` (first step can't have dependencies)

**Action**:
1. Validates step title and description
2. Parses `usesSteps` form data (array of step numbers)
3. Validates each selected step via `validateStepReference()`
4. Creates `RecipeStep`
5. Creates `StepOutputUse` records for selected steps
6. Redirects to edit step page

**UI**:
- "Uses Output From" field hidden for first step
- Multi-select Listbox shows all previous steps

#### Edit Step (`app/routes/recipes.$id.steps.$stepId.edit.tsx`)

**Loader**:
- Loads step with `usingSteps` relation (current dependencies)
- Loads `availableSteps` (steps with stepNum < current)

**Action (default intent)**:
1. Updates step title and description
2. Deletes existing `StepOutputUse` records (replace pattern)
3. Creates new `StepOutputUse` records for selected steps

**Action (delete intent)**:
1. Validates deletion via `validateStepDeletion()`
2. Returns error if other steps depend on this one
3. Deletes step if validation passes (CASCADE handles cleanup)

**UI**:
- Listbox initializes with current dependencies
- Delete button shows error feedback if deletion blocked

#### Edit Recipe — Step Reorder (`app/routes/recipes.$id.edit.tsx`)

**Action (reorderStep intent)**:
1. Validates reorder via `validateStepReorderComplete()`
2. Returns error if reorder would break dependencies
3. Performs three-step swap using temp stepNum
4. SQLite `ON UPDATE CASCADE` automatically updates `StepOutputUse` references

---

### Server-Side Functions

#### Query Functions (`app/lib/step-output-use-queries.server.ts`)

```typescript
// Load all dependencies for a recipe (for display)
loadRecipeStepOutputUses(recipeId: string)

// Load what steps a given step depends on (for editing)
loadStepDependencies(recipeId: string, stepNum: number)

// Check what steps depend on a given step (for deletion validation)
checkStepUsage(recipeId: string, stepNum: number)
```

#### Mutation Functions (`app/lib/step-output-use-mutations.server.ts`)

```typescript
// Delete all dependencies for a step (before update)
deleteExistingStepOutputUses(recipeId: string, inputStepNum: number)

// Batch create dependencies
createStepOutputUses(recipeId: string, inputStepNum: number, outputStepNums: number[])
```

---

### Usage Examples

#### Example 1: Creating a Recipe with Dependencies

```
1. Create recipe "Israeli Hummus"

2. Add Step 1: "Cook chickpeas"
   - Description: "Boil chickpeas with baking soda until soft"
   - No dependencies (first step)

3. Add Step 2: "Blend chickpeas"
   - Description: "Process in food processor until smooth"
   - Uses: Step 1 ✓

4. Add Step 3: "Add tahini"
   - Description: "Stream in tahini and water while blending"
   - Uses: Step 2 ✓
```

**Resulting StepOutputUse records**:
| recipeId | outputStepNum | inputStepNum |
|----------|---------------|--------------|
| hummus-1 | 1 | 2 |
| hummus-1 | 2 | 3 |

#### Example 2: Attempting Invalid Operations

**Deleting Step 1**:
```
User clicks "Delete Step" on Step 1
→ System checks: Steps 2 depends on Step 1
→ Error: "Cannot delete Step 1 because it is used by Step 2"
→ Step not deleted
```

**Moving Step 1 to position 3**:
```
User clicks "Move Down" twice on Step 1
→ System checks: Would pass Steps 2 and 3
→ Step 2 uses Step 1's output
→ Error: "Cannot move Step 1 to position 3 because Step 2 uses its output"
→ Step not moved
```

**Moving Step 3 to position 1**:
```
User clicks "Move Up" twice on Step 3
→ System checks: Step 3 depends on Step 2
→ Would move before its dependency
→ Error: "Cannot move Step 3 to position 1 because it uses output from Step 2"
→ Step not moved
```

#### Example 3: Editing Dependencies

```
User editing Step 3 (currently uses Step 2)
→ Listbox shows: [Step 1, Step 2] with Step 2 selected
→ User selects Step 1 additionally
→ Form submits: usesSteps=[1, 2]
→ Action:
   1. Deletes existing: StepOutputUse where inputStepNum=3
   2. Creates new: StepOutputUse(1→3), StepOutputUse(2→3)
→ Step 3 now uses outputs from both Steps 1 and 2
```

---

### Display Order in Recipe Detail

For each step in the recipe detail view:

```
1. Step number badge (blue circle)
2. Step title (optional)
3. Step Output Uses (via StepOutputUseDisplay) ← NEW
4. Description
5. Ingredients list
```

The step output uses section only appears if the step has dependencies.

---

### Testing Coverage

| Test File | Purpose |
|-----------|---------|
| `test/routes/edit-dependencies-e2e.test.tsx` | E2E tests for editing dependencies |
| `test/routes/step-deletion-protection-e2e.test.tsx` | Deletion protection tests |
| `test/routes/step-reorder-protection-e2e.test.tsx` | Reorder protection tests |
| `test/routes/recipes-id-steps-new.test.tsx` | New step creation with dependencies |
| `test/routes/recipes-id-steps-id-edit.test.tsx` | Edit step with dependencies |
| `test/routes/recipe-with-dependencies-e2e.test.tsx` | Full recipe workflow |
| `test/lib/validation.test.ts` | `validateStepReference()` function |
| `test/lib/step-deletion-validation.test.ts` | Deletion validation |
| `test/lib/step-reorder-validation.test.ts` | Reorder validation |

All tests achieve **100% coverage** with **zero warnings**.

---

### Performance Characteristics

**Optimizations implemented**:
1. **Proper indexes**: All query patterns have matching database indexes
2. **No N+1 queries**: All use Prisma `include` for eager loading
3. **Batch operations**: Uses `createMany`, `deleteMany` for bulk operations
4. **Parallel validation**: `validateStepReorderComplete()` runs both checks via `Promise.all()`
5. **Conditional loading**: Loaders only fetch `availableSteps` when needed

**Data volume expectations**:
- Typical recipes: 5-20 steps
- StepOutputUse records per recipe: < 50
- No performance concerns at expected volumes

---

### Implementation Files Summary

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | StepOutputUse model definition |
| `app/lib/validation.ts` | `validateStepReference()` function |
| `app/lib/step-deletion-validation.server.ts` | Deletion validation |
| `app/lib/step-reorder-validation.server.ts` | Reorder validation |
| `app/lib/step-output-use-queries.server.ts` | Query functions |
| `app/lib/step-output-use-mutations.server.ts` | Mutation functions |
| `app/components/StepOutputUseDisplay.tsx` | Read-only display component |
| `app/components/ui/listbox.tsx` | Multi-select UI component |
| `app/routes/recipes.$id.tsx` | Recipe detail (display) |
| `app/routes/recipes.$id.steps.new.tsx` | Create step (with dependencies) |
| `app/routes/recipes.$id.steps.$stepId.edit.tsx` | Edit step (with dependencies) |
| `app/routes/recipes.$id.edit.tsx` | Recipe edit (step reordering) |

---

## Feature Complete

The stepOutputUse feature is fully implemented with:
- ✅ Database schema with proper relations and indexes
- ✅ Validation rules (forward-only, deletion protection, reorder protection)
- ✅ UI components (display and editing)
- ✅ Route integration (create, edit, delete, reorder)
- ✅ Comprehensive test coverage (100%)
- ✅ Performance optimization
- ✅ Documentation
