import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORIES_DIR = path.join(__dirname, '../stories')

const curatedRootStories = new Set([
  'AppFoundation.stories.tsx',
  'ConfirmationDialog.stories.tsx',
  'MobileNav.stories.tsx',
  'ProfilePhotoCropper.stories.tsx',
  'SpoonjoyLogo.stories.tsx',
])

const requiredStoryFiles = [
  'Introduction.mdx',
  'AppFoundation.stories.tsx',
  'ConfirmationDialog.stories.tsx',
  'MobileNav.stories.tsx',
  'SpoonjoyLogo.stories.tsx',
  'Pantry/BioCard.stories.tsx',
  'Pantry/PantryPage.stories.tsx',
  'Pantry/RecipeGrid.stories.tsx',
  'Recipe/Input/RecipeBuilder.stories.tsx',
  'Recipe/View/RecipeView.stories.tsx',
]

const removedStaleFiles = [
  'Alert.stories.tsx',
  'AuthLayout.stories.tsx',
  'Avatar.stories.tsx',
  'Badge.stories.tsx',
  'Button.stories.tsx',
  'Checkbox.stories.tsx',
  'Combobox.stories.tsx',
  'ComponentInventory.mdx',
  'DescriptionList.stories.tsx',
  'DesignTokens.mdx',
  'Dialog.stories.tsx',
  'Divider.stories.tsx',
  'DockCenter.stories.tsx',
  'DockContext.stories.tsx',
  'DockIndicator.stories.tsx',
  'DockItem.stories.tsx',
  'Dropdown.stories.tsx',
  'Fieldset.stories.tsx',
  'Heading.stories.tsx',
  'Input.stories.tsx',
  'Link.stories.tsx',
  'Listbox.stories.tsx',
  'Navbar.stories.tsx',
  'OAuth.stories.tsx',
  'Pagination.stories.tsx',
  'QuickActions.stories.tsx',
  'Radio.stories.tsx',
  'REORG-PLAN.md',
  'Select.stories.tsx',
  'Sidebar.stories.tsx',
  'SidebarLayout.stories.tsx',
  'SpoonDock.stories.tsx',
  'StackedLayout.stories.tsx',
  'Switch.stories.tsx',
  'Table.stories.tsx',
  'TailwindTest.stories.tsx',
  'Text.stories.tsx',
  'Textarea.stories.tsx',
  'ThemeToggle.stories.tsx',
  'UseRecipeDockActions.stories.tsx',
  'ValidationError.stories.tsx',
]

function getAllFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return getAllFiles(fullPath)
    return [fullPath]
  })
}

function storyPath(relativePath: string): string {
  return path.join(STORIES_DIR, relativePath)
}

function storyFiles(): string[] {
  return getAllFiles(STORIES_DIR)
    .filter((file) => /\.stories\.(t|j)sx?$/.test(file))
    .map((file) => path.relative(STORIES_DIR, file))
    .sort()
}

function readStory(relativePath: string): string {
  return fs.readFileSync(storyPath(relativePath), 'utf8')
}

describe('Storybook curation', () => {
  it('keeps the current curated product surfaces', () => {
    for (const file of requiredStoryFiles) {
      expect(fs.existsSync(storyPath(file)), `${file} should exist`).toBe(true)
    }
  })

  it('does not keep stale generic catalogs or internal dock dissections', () => {
    for (const file of removedStaleFiles) {
      expect(fs.existsSync(storyPath(file)), `${file} should not be in the curated Storybook`).toBe(false)
    }
  })

  it('keeps root-level stories limited to app-specific surfaces', () => {
    const unexpectedRootStories = storyFiles().filter((file) => !file.includes('/') && !curatedRootStories.has(file))

    expect(unexpectedRootStories).toEqual([])
  })

  it('keeps markdown docs limited to the curated introduction', () => {
    const markdownFiles = getAllFiles(STORIES_DIR)
      .filter((file) => /\.mdx?$/.test(file))
      .map((file) => path.relative(STORIES_DIR, file))
      .sort()

    expect(markdownFiles).toEqual(['Introduction.mdx'])
  })

  it('keeps every story file renderable by Storybook', () => {
    for (const file of storyFiles()) {
      const content = readStory(file)

      expect(content, `${file} should export a default meta object`).toMatch(/export default /)
      expect(content, `${file} should include a named story export`).toMatch(/^export const \w+/m)
    }
  })

  it('does not keep test-only story exports', () => {
    for (const file of storyFiles()) {
      const content = readStory(file)

      expect(content, `${file} should not contain Test_ exports or stories ending in Test`).not.toMatch(
        /^export const (?:Test_\w+|\w+Test):/m
      )
    }
  })

  it('does not preserve stale Button API examples', () => {
    for (const file of storyFiles()) {
      const content = readStory(file)

      expect(content, `${file} should not pass removed color props to Button`).not.toMatch(/<Button\b[^>]*\bcolor=/)
      expect(content, `${file} should not use the removed Button outline prop`).not.toMatch(/<Button\b[^>]*\boutline\b/)
      expect(content, `${file} should not refer to old buttonColor demo plumbing`).not.toContain('buttonColor')
      expect(content, `${file} should not advertise the retired exhaustive color catalog`).not.toContain('21 color')
    }
  })

  it('documents the current mobile IA instead of the retired five-item dock', () => {
    const content = readStory('MobileNav.stories.tsx')

    expect(content).toContain('New')
    expect(content).toContain('List')
    expect(content).toContain('LoggedOutHome')
    expect(content).not.toContain('CookbooksActive')
    expect(content).not.toContain('ProfileActive')
    expect(content).not.toContain('RecipesActive')
  })
})
