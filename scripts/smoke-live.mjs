#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const { chromium, expect } = requireFromCwd('@playwright/test')

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function screenshot(page, outDir, name) {
  await page.waitForLoadState('load').catch(() => null)
  await page.waitForTimeout(250)
  const path = join(outDir, `${name}.png`)
  await page.screenshot({ path, fullPage: true })
  return path
}

async function gotoApp(page, url) {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(250)
}

async function replaceControlledText(locator, value) {
  await locator.click()
  await locator.fill('')
  await locator.pressSequentially(value)
}

async function cleanupRemoteD1(email) {
  const command = `DELETE FROM "User" WHERE email = ${sqlString(email)};`
  const { stdout, stderr } = await execFileAsync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'DB', '--remote', '--command', command],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 }
  )
  return { stdout, stderr }
}

async function main() {
  const baseUrl = arg('--base-url', process.env.SPOONJOY_SMOKE_BASE_URL ?? 'https://spoonjoy-v2.mendelow-studio.workers.dev')
  const outDir = arg('--out', 'live-smoke-artifacts')
  const shouldCleanupRemote = process.argv.includes('--remote-cleanup')
  const stamp = Date.now().toString(36)
  const email = `codex-smoke-${stamp}@example.com`
  const username = `codex_smoke_${stamp}`
  const password = `Smoke-${stamp}-1234`
  const recipeTitle = `Codex smoke skillet ${stamp}`
  const report = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    email,
    username,
    recipeTitle,
    screenshots: [],
    consoleErrors: [],
    pageErrors: [],
    cleanup: null,
  }

  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  })
  const page = await context.newPage()

  page.on('console', (message) => {
    if (message.type() === 'error') {
      report.consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => report.pageErrors.push(error.message))

  try {
    await gotoApp(page, new URL('/signup', baseUrl).toString())
    await expect(page.getByRole('heading', { name: /sign up/i })).toBeVisible()
    await page.locator('input[name="email"]:visible').fill(email)
    await page.locator('input[name="username"]:visible').fill(username)
    await page.locator('input[name="password"]:visible').fill(password)
    await page.locator('input[name="confirmPassword"]:visible').fill(password)
    await page.getByRole('button', { name: /sign up/i }).first().click()
    await page.waitForURL((url) => !url.pathname.startsWith('/signup'), { timeout: 15_000 })
    await gotoApp(page, new URL('/recipes', baseUrl).toString())
    report.screenshots.push(await screenshot(page, outDir, '01-recipes-after-signup'))

    await gotoApp(page, new URL('/recipes/new', baseUrl).toString())
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
    const titleInput = page.locator('input[placeholder="e.g., Chocolate Chip Cookies"]:visible')
    await replaceControlledText(titleInput, recipeTitle)
    await expect(titleInput).toHaveValue(recipeTitle)
    await replaceControlledText(page.locator('input[placeholder="e.g., 4 servings"]:visible'), '2')
    await page.getByRole('button', { name: /add step/i }).first().click()
    await replaceControlledText(page.locator('textarea[placeholder="Describe what to do in this step..."]:visible'), 'Warm the pan, add the rice, and cook until fragrant.')

    const aiSwitch = page.getByRole('switch', { name: /AI Parse/i }).first()
    if (await aiSwitch.isVisible()) {
      await aiSwitch.click()
    }

    await replaceControlledText(page.locator('input[name="quantity"]:visible'), '1')
    await replaceControlledText(page.locator('input[name="unit"]:visible'), 'cup')
    await replaceControlledText(page.locator('input[name="ingredientName"]:visible'), 'rice')
    await page.getByRole('button', { name: /^add ingredient$/i }).first().click()
    await page.getByRole('button', { name: /^save$/i }).first().click()
    await expect(page.getByRole('button', { name: /create recipe/i })).not.toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('button', { name: /create recipe/i }).click()
    await page.waitForURL(/\/recipes\/(?!new$)[A-Za-z0-9_-]+$/, { timeout: 20_000 })
    const recipeUrl = new URL(page.url())
    const recipeId = recipeUrl.pathname.split('/').pop()
    report.recipeId = recipeId
    await expect(page.getByRole('heading', { name: recipeTitle })).toBeVisible({ timeout: 10_000 })
    report.screenshots.push(await screenshot(page, outDir, '02-recipe-detail'))

    await gotoApp(page, new URL(`/recipes/${recipeId}#cook`, baseUrl).toString())
    await expect(page.getByTestId('cook-mode-panel')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Step 1 of 1')).toBeVisible()
    await page.getByRole('checkbox', { name: 'rice' }).click()
    await expect(page.getByRole('checkbox', { name: 'rice' })).toHaveAttribute('aria-checked', 'true')
    report.screenshots.push(await screenshot(page, outDir, '03-cook-mode'))

    await gotoApp(page, new URL(`/recipes/${recipeId}`, baseUrl).toString())
    const addToListResponse = page.waitForResponse((response) => {
      const request = response.request()
      return request.method() === 'POST' && new URL(response.url()).pathname.startsWith('/shopping-list')
    }, { timeout: 15_000 })
    await page.getByTestId('recipe-header-list-action').click()
    expect((await addToListResponse).ok()).toBe(true)
    await expect(page.getByTestId('recipe-header-list-action')).toContainText(/in list/i, { timeout: 10_000 })

    await gotoApp(page, new URL('/shopping-list', baseUrl).toString())
    await expect(page.getByTestId('shopping-list-checklist-board')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('checkbox', { name: 'rice' })).toBeVisible({ timeout: 10_000 })
    report.screenshots.push(await screenshot(page, outDir, '04-shopping-list'))

    await gotoApp(page, new URL('/account/settings', baseUrl).toString())
    await expect(page.getByRole('heading', { name: /account settings/i })).toBeVisible({ timeout: 10_000 })
    report.screenshots.push(await screenshot(page, outDir, '05-account-settings'))

    const pushResponse = await page.request.get(new URL('/api/push/public-key', baseUrl).toString())
    report.pushPublicKeyStatus = pushResponse.status()
    const isLocalhost = new URL(baseUrl).hostname === 'localhost'
    expect(pushResponse.ok() || (isLocalhost && pushResponse.status() === 500)).toBe(true)
  } finally {
    await context.close()
    await browser.close()

    if (shouldCleanupRemote) {
      try {
        report.cleanup = await cleanupRemoteD1(email)
      } catch (error) {
        report.cleanup = {
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    writeFileSync(join(outDir, 'smoke-results.json'), JSON.stringify(report, null, 2))
  }

  if (report.pageErrors.length > 0 || report.consoleErrors.length > 0) {
    console.error(`Live smoke found ${report.consoleErrors.length} console error(s) and ${report.pageErrors.length} page error(s).`)
    process.exitCode = 1
    return
  }

  if (shouldCleanupRemote && report.cleanup?.error) {
    console.error(`Live smoke passed, but remote cleanup failed: ${report.cleanup.error}`)
    process.exitCode = 1
    return
  }

  console.log(join(outDir, 'smoke-results.json'))
}

await main()
