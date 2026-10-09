import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { m, motion } from 'motion/react'
import { describe, expect, it, vi } from 'vitest'
import { LazyLayoutGroup } from '~/components/motion/lazy-motion'

const ROOT = resolve(__dirname, '../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('Motion loading', () => {
  it('depends on one motion library', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.dependencies.motion).toBeDefined()
    expect(pkg.dependencies['framer-motion']).toBeUndefined()
    const importers = sourceFiles(join(ROOT, 'app')).filter((file) =>
      /from ['"]framer-motion['"]/.test(readFileSync(file, 'utf8')),
    )
    expect(importers).toEqual([])
  })

  it('keeps the full motion component out of the recipe page and the shopping list', () => {
    for (const file of ['app/components/recipe/IngredientList.tsx', 'app/routes/shopping-list.tsx']) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      expect(source, file).not.toMatch(/<motion\./)
      expect(source, file).toContain('LazyLayoutGroup')
    }
  })

  it('renders m components and loads the animation features on demand', async () => {
    render(
      <LazyLayoutGroup id="list">
        <m.ul data-testid="lazy-list" layout="position" />
      </LazyLayoutGroup>,
    )
    expect(screen.getByTestId('lazy-list').tagName).toBe('UL')
    const features = await import('~/components/motion/motion-features')
    await waitFor(() => expect(features.default).toBeDefined())
  })

  it('refuses a full motion component inside the group', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <LazyLayoutGroup>
          <motion.div />
        </LazyLayoutGroup>,
      ),
    ).toThrow()
    error.mockRestore()
  })
})
