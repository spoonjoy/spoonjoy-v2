import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { m, motion } from 'motion/react'
import { Component, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LazyLayoutGroup, loadMotionFeatures } from '~/components/motion/lazy-motion'

const ROOT = resolve(__dirname, '../../..')

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <p>refused</p> : this.props.children
  }
}

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

  it('retries a features chunk that fails once', async () => {
    const features = { renderer: () => null }
    const load = vi.fn().mockRejectedValueOnce(new TypeError('Importing a module script failed.')).mockResolvedValue(features)
    await expect(loadMotionFeatures(load)).resolves.toBe(features)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('leaves the features unloaded, without an error, when the chunk keeps failing', async () => {
    const load = vi.fn().mockRejectedValue(new TypeError('Importing a module script failed.'))
    const pending = Symbol('pending')
    const settled = loadMotionFeatures(load).then(() => 'resolved', () => 'rejected')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(Promise.race([settled, Promise.resolve(pending)])).resolves.toBe(pending)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('refuses a full motion component inside the group', () => {
    // React hands the caught render error to onCaughtError instead of logging it.
    const caught: unknown[] = []
    render(
      <Boundary>
        <LazyLayoutGroup>
          <motion.div />
        </LazyLayoutGroup>
      </Boundary>,
      { onCaughtError: (error) => caught.push(error) },
    )
    expect(screen.getByText('refused')).toBeInTheDocument()
    expect(caught).toHaveLength(1)
    expect(String(caught[0])).toMatch(/strict/i)
  })
})
