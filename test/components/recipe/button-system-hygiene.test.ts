import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const RECIPE_BUTTON_SURFACE_FILES = [
  'app/components/recipe/StepEditorCard.tsx',
  'app/components/recipe/ManualIngredientInput.tsx',
  'app/components/recipe/ParsedIngredientList.tsx',
  'app/components/recipe/ParsedIngredientRow.tsx',
  'app/components/recipe/IngredientParseInput.tsx',
  'app/components/recipe/RecipeImageUpload.tsx',
  'app/components/recipe/StepDependencySelector.tsx',
  'app/components/recipe/SaveToCookbookDropdown.tsx',
]

const THEME_FILE = 'app/styles/tailwind.css'

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8')
}

describe('recipe button system hygiene', () => {
  it('uses a square cookbook control radius instead of a pill token', () => {
    const content = readSourceFile(THEME_FILE)

    expect(content).toContain('--sj-radius-control: 0.375rem;')
    expect(content, 'shared recipe controls should not inherit a global pill radius').not.toContain(
      '--sj-radius-control: 999px;'
    )
  })

  it.each(RECIPE_BUTTON_SURFACE_FILES)(
    '%s does not carry copied Catalyst button layers',
    (filePath) => {
      const content = readSourceFile(filePath)

      expect(content, `${filePath} should use shared button styles, not copied base styles`).not.toMatch(
        /\bbutton(?:Base|Solid|Action|Red|Outline)Styles\b/
      )
      expect(content, `${filePath} should not render old pseudo-element button shells`).not.toContain(
        'before:rounded-[calc(var(--radius-lg)-1px)]'
      )
      expect(content, `${filePath} should not render old pseudo-element button shells`).not.toContain(
        'after:rounded-[calc(var(--radius-lg)-1px)]'
      )
    }
  )

  it.each(RECIPE_BUTTON_SURFACE_FILES)(
    '%s keeps recipe action controls on the Spoonjoy radius scale',
    (filePath) => {
      const content = readSourceFile(filePath)

      expect(content, `${filePath} should not use pill radii for recipe action controls`).not.toContain(
        'rounded-full'
      )
    }
  )
})
