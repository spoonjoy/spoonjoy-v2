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

/**
 * Apple OAuth regression guard. Apple validates `redirect_uri` against the
 * Return URLs registered on the Service ID and rejects a mismatch with
 * `invalid_request` on its OWN sign-in screen — invisible to server-side tests.
 * This hits production's /auth/apple and then Apple's real authorize endpoint to
 * assert (a) we send the registered legacy path and (b) Apple actually accepts
 * it (renders the sign-in form, no invalid_request). Always targets the
 * registered public host so it stays meaningful regardless of --base-url.
 */
async function checkAppleOAuth(page, report) {
  const PROD = 'https://spoonjoy.app'
  const start = await page.request.get(`${PROD}/auth/apple`, { maxRedirects: 0 })
  const location = start.headers()['location'] ?? ''
  const authorize = new URL(location)
  const redirectUri = authorize.searchParams.get('redirect_uri') ?? ''
  report.apple = {
    authorizeHost: authorize.host,
    redirectUri,
    scope: authorize.searchParams.get('scope'),
    responseMode: authorize.searchParams.get('response_mode'),
  }
  // (a) We must send the registered RedwoodJS dbAuth-oauth Return URL.
  expect(authorize.host).toBe('appleid.apple.com')
  expect(redirectUri).toBe('https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple')
  expect(authorize.searchParams.get('response_mode')).toBe('form_post')
  // (b) Apple must actually accept it (renders the sign-in form, not an error).
  const apple = await page.request.get(location)
  const body = await apple.text()
  report.apple.appleAccepts = !body.includes('invalid_request') && body.includes('Sign in to Apple')
  expect(body.includes('invalid_request')).toBe(false)
  expect(body.includes('Sign in to Apple')).toBe(true)
}

function usesLocalD1(baseUrl) {
  const hostname = new URL(baseUrl).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

async function cleanupD1(email, { remote }) {
  const command = `DELETE FROM "User" WHERE email = ${sqlString(email)};`
  const args = ['exec', 'wrangler', 'd1', 'execute', 'DB']
  if (remote) {
    args.push('--remote')
  }
  args.push('--command', command)
  const { stdout, stderr } = await execFileAsync(
    'pnpm',
    args,
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 }
  )
  return { target: remote ? 'remote D1' : 'local D1', stdout, stderr }
}

async function main() {
  const baseUrl = arg('--base-url', process.env.SPOONJOY_SMOKE_BASE_URL ?? 'https://spoonjoy-v2.mendelow-studio.workers.dev')
  const outDir = arg('--out', 'live-smoke-artifacts')
  const shouldCleanup = !process.argv.includes('--keep-smoke-data')
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

    // Sign in with Apple regression guard (hits Apple's real authorize endpoint).
    await checkAppleOAuth(page, report)
  } finally {
    await context.close()
    await browser.close()

    if (shouldCleanup) {
      try {
        report.cleanup = await cleanupD1(email, { remote: !usesLocalD1(baseUrl) })
      } catch (error) {
        report.cleanup = {
          error: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      report.cleanup = { skipped: true, reason: '--keep-smoke-data' }
    }

    writeFileSync(join(outDir, 'smoke-results.json'), JSON.stringify(report, null, 2))
  }

  if (report.pageErrors.length > 0 || report.consoleErrors.length > 0) {
    console.error(`Live smoke found ${report.consoleErrors.length} console error(s) and ${report.pageErrors.length} page error(s).`)
    process.exitCode = 1
    return
  }

  if (shouldCleanup && report.cleanup?.error) {
    console.error(`Live smoke passed, but cleanup failed: ${report.cleanup.error}`)
    process.exitCode = 1
    return
  }

  console.log(join(outDir, 'smoke-results.json'))
}

await main()
