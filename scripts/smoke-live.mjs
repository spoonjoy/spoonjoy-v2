#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  buildApiToolRequest,
  buildMcpToolRequest,
  buildMcpToolsListRequest,
  parseApiToolPayload,
  parseMcpToolPayload,
  parseWranglerSecretNames,
  runImageCoverSmokeFlow,
} from './smoke-image-cover-live.mjs'
import {
  buildCleanupD1Args,
  buildQaR2DeleteArgs,
  buildQaR2GetArgs,
  buildSmokeReport,
  buildUserCountD1Args,
  isQaR2ObjectMissingError,
  parseD1CountOutput,
  parseSmokeArgs,
  readGitMetadata,
  shouldRunAppleOAuthCheck,
} from './smoke-live-helpers.mjs'

const execFileAsync = promisify(execFile)
const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const { chromium, expect } = requireFromCwd('@playwright/test')

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

async function cleanupD1(email, { targetEnv }) {
  const args = buildCleanupD1Args(email, { targetEnv })
  const { stdout, stderr } = await execFileAsync(
    'pnpm',
    args,
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 }
  )
  return { target: `${targetEnv} D1`, stdout, stderr }
}

async function verifyUserDeleted(email, { targetEnv }) {
  const args = buildUserCountD1Args(email, { targetEnv })
  const { stdout, stderr } = await execFileAsync(
    'pnpm',
    args,
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 }
  )
  const remaining = parseD1CountOutput(stdout)
  return { target: `${targetEnv} D1`, remaining, stdout, stderr }
}

async function responseJson(response, label) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} did not return JSON: ${text.slice(0, 200)}`)
  }
}

function createImageCoverAdapters(page, baseUrl) {
  let mcpId = 1

  return {
    async apiTool(operation, args, bearerToken) {
      const request = buildApiToolRequest(baseUrl, operation, args, bearerToken)
      const response = await page.request.post(request.url, request.options)
      const payload = await responseJson(response, `API tool ${operation}`)
      return parseApiToolPayload(payload)
    },
    async expectApiToolFailure(operation, args, bearerToken) {
      const request = buildApiToolRequest(baseUrl, operation, args, bearerToken)
      const response = await page.request.post(request.url, request.options)
      const payload = await responseJson(response, `API tool ${operation}`)
      if (response.ok() && payload?.ok !== false) {
        throw new Error(`Expected API tool ${operation} to fail, but it succeeded.`)
      }
      return {
        status: response.status(),
        payload,
        message: payload?.error?.message ?? payload?.message ?? response.statusText(),
      }
    },
    async mcpToolsList(bearerToken) {
      const request = buildMcpToolsListRequest(baseUrl, bearerToken, mcpId++)
      const response = await page.request.post(request.url, request.options)
      const payload = await responseJson(response, 'MCP tools/list')
      if (!response.ok() || payload?.error) {
        throw new Error(payload?.error?.message ?? `MCP tools/list failed with status ${response.status()}.`)
      }
      return payload.result
    },
    async mcpTool(name, args, bearerToken) {
      const request = buildMcpToolRequest(baseUrl, bearerToken, mcpId++, name, args)
      const response = await page.request.post(request.url, request.options)
      const payload = await responseJson(response, `MCP tool ${name}`)
      if (!response.ok()) {
        throw new Error(`MCP tool ${name} failed with status ${response.status()}.`)
      }
      return parseMcpToolPayload(payload)
    },
    async downloadPhotoBytes(imageUrl) {
      const response = await page.request.get(new URL(imageUrl, baseUrl).toString())
      if (!response.ok()) {
        throw new Error(`Could not download stored image ${imageUrl}: ${response.status()}`)
      }
      return new Uint8Array(await response.body())
    },
  }
}

async function listQaSecretNames() {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'wrangler', 'secret', 'list', '--env', 'qa'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 },
  )
  return parseWranglerSecretNames(stdout)
}

async function deleteQaR2Object(key) {
  await execFileAsync(
    'pnpm',
    buildQaR2DeleteArgs(key),
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 },
  )
}

async function verifyQaR2ObjectDeleted(key) {
  let found = false
  try {
    await execFileAsync(
      'pnpm',
      buildQaR2GetArgs(key),
      { encoding: 'buffer', maxBuffer: 1024 * 1024 * 8 },
    )
    found = true
  } catch (error) {
    if (isQaR2ObjectMissingError(error)) return
    throw new Error(`Could not verify QA R2 object deletion for ${key}.`, { cause: error })
  }
  if (found) {
    throw new Error(`QA R2 object still exists after cleanup: ${key}`)
  }
}

async function main() {
  const { baseUrl, includeImageCoverSmoke, outDir, shouldCleanup, targetEnv, target } = parseSmokeArgs(process.argv.slice(2), process.env)
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
    cleanupVerification: null,
    imageCoverSmoke: null,
    targetEnv,
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

    if (shouldRunAppleOAuthCheck(targetEnv)) {
      // Sign in with Apple regression guard (hits Apple's real authorize endpoint).
      await checkAppleOAuth(page, report)
    } else {
      report.apple = { skipped: true, reason: `${targetEnv} smoke does not run production Apple OAuth guard` }
    }

    if (includeImageCoverSmoke) {
      const adapters = createImageCoverAdapters(page, baseUrl)
      report.imageCoverSmoke = await runImageCoverSmokeFlow({
        baseUrl,
        email,
        recipeId,
        recipeTitle,
        stamp,
        maxPollAttempts: 30,
        pollDelayMs: 3_000,
        listQaSecretNames,
        apiTool: adapters.apiTool,
        expectApiToolFailure: adapters.expectApiToolFailure,
        mcpToolsList: adapters.mcpToolsList,
        mcpTool: adapters.mcpTool,
        readFileBytes: async (path) => new Uint8Array(await readFile(path)),
        downloadPhotoBytes: adapters.downloadPhotoBytes,
        deleteQaR2Object,
        verifyQaR2ObjectDeleted,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      })
    }
  } finally {
    await context.close()
    await browser.close()

    if (shouldCleanup) {
      try {
        report.cleanup = await cleanupD1(email, { targetEnv })
        report.cleanupVerification = await verifyUserDeleted(email, { targetEnv })
      } catch (error) {
        report.cleanup = {
          error: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      report.cleanup = { skipped: true, reason: '--keep-smoke-data' }
    }

    const artifact = buildSmokeReport({
      generatedAt: report.generatedAt,
      target,
      git: readGitMetadata(),
      created: {
        email,
        username,
        recipeTitle,
        recipeId: report.recipeId,
      },
      screenshots: report.screenshots,
      consoleErrors: report.consoleErrors,
      pageErrors: report.pageErrors,
      cleanup: report.cleanup,
      cleanupVerification: report.cleanupVerification,
      imageCoverSmoke: report.imageCoverSmoke,
      apple: report.apple,
      pushPublicKeyStatus: report.pushPublicKeyStatus,
    })
    writeFileSync(join(outDir, 'smoke-results.json'), JSON.stringify(artifact, null, 2))
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

  if (shouldCleanup && report.cleanupVerification?.remaining !== 0) {
    console.error(`Live smoke passed, but cleanup verification found ${report.cleanupVerification?.remaining} remaining smoke user(s).`)
    process.exitCode = 1
    return
  }

  console.log(join(outDir, 'smoke-results.json'))
}

await main()
