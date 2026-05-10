/**
 * Tests for the parseIngredients action in the step edit route.
 *
 * Unit 2a: Write failing tests for parse action in step edit route.
 * These tests verify the route-level integration of ingredient parsing:
 * - Route action accepts raw ingredient text with intent: parseIngredients
 * - Returns parsed ingredients on success
 * - Returns appropriate errors on failure
 * - Requires authentication
 * - Validates ownership
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Request as UndiciRequest, FormData as UndiciFormData } from 'undici'
import { db } from '~/lib/db.server'
import { createTestUser } from '../utils'
import { cleanupDatabase } from '../helpers/cleanup'

// Mock the session module to control authentication
vi.mock('~/lib/session.server', () => ({
  requireUserId: vi.fn(),
}))

// Mock the ingredient parsing module
vi.mock('~/lib/ingredient-parse.server', () => ({
  parseIngredients: vi.fn(),
  IngredientParseError: class IngredientParseError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
      super(message)
      this.name = 'IngredientParseError'
    }
  },
}))

import { requireUserId } from '~/lib/session.server'
import { parseIngredients, IngredientParseError } from '~/lib/ingredient-parse.server'
import { action } from '~/routes/recipes.$id.steps.$stepId.edit'

/**
 * Helper to extract data from React Router's data() response format.
 * The format is: { data: {...}, init: { status: number } | null, type: "DataWithResponseInit" }
 */
function extractActionData(result: any): { data: any; status?: number } {
  if (result?.type === 'DataWithResponseInit') {
    return {
      data: result.data,
      status: result.init?.status,
    }
  }
  // For redirects or other Response objects
  if (result instanceof Response) {
    return { data: null, status: result.status }
  }
  return { data: result, status: undefined }
}

describe('recipes.$id.steps.$stepId.edit - parseIngredients action', () => {
  let testUser: { id: string }
  let testRecipe: { id: string }
  let testStep: { id: string; stepNum: number }
  let mockContext: any

  beforeEach(async () => {
    // Create test user
    const userData = createTestUser()
    testUser = await db.user.create({
      data: userData,
    })

    // Create test recipe
    testRecipe = await db.recipe.create({
      data: {
        title: 'Test Recipe for Parsing',
        chefId: testUser.id,
      },
    })

    // Create test step
    testStep = await db.recipeStep.create({
      data: {
        recipeId: testRecipe.id,
        stepNum: 1,
        description: 'Mix ingredients',
      },
    })

    // Mock context for Cloudflare D1 compatibility
    mockContext = {
      cloudflare: {
        env: null,
      },
    }

    // Default: user is authenticated
    vi.mocked(requireUserId).mockResolvedValue(testUser.id)
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupDatabase()
  })

  describe('successful parsing', () => {
    it('parses single ingredient text and returns structured data', async () => {
      const parsedIngredients = [
        { quantity: 2, unit: 'cup', ingredientName: 'flour' },
      ]
      vi.mocked(parseIngredients).mockResolvedValue(parsedIngredients)

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data } = extractActionData(result)
      expect(data.parsedIngredients).toEqual(parsedIngredients)
      expect(data.errors).toBeUndefined()
    })

    it('parses multiple ingredients from multi-line text', async () => {
      const parsedIngredients = [
        { quantity: 2, unit: 'cup', ingredientName: 'flour' },
        { quantity: 0.5, unit: 'tsp', ingredientName: 'salt' },
        { quantity: 3, unit: 'whole', ingredientName: 'eggs' },
      ]
      vi.mocked(parseIngredients).mockResolvedValue(parsedIngredients)

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour\n1/2 tsp salt\n3 eggs')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data } = extractActionData(result)
      expect(data.parsedIngredients).toHaveLength(3)
      expect(data.parsedIngredients).toEqual(parsedIngredients)
    })

    it('returns empty array for empty input', async () => {
      vi.mocked(parseIngredients).mockResolvedValue([])

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data } = extractActionData(result)
      expect(data.parsedIngredients).toEqual([])
    })

    it('returns empty array for whitespace-only input', async () => {
      vi.mocked(parseIngredients).mockResolvedValue([])

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '   \n\t  ')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data } = extractActionData(result)
      expect(data.parsedIngredients).toEqual([])
    })
  })

  describe('error handling', () => {
    it('returns error when LLM parsing fails', async () => {
      vi.mocked(parseIngredients).mockRejectedValue(
        new IngredientParseError('Failed to parse ingredients')
      )

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data, status } = extractActionData(result)
      expect(status).toBe(400)
      expect(data.errors.parse).toBeDefined()
      expect(data.parsedIngredients).toBeUndefined()
    })

    it('returns error when API key is missing', async () => {
      vi.mocked(parseIngredients).mockRejectedValue(
        new IngredientParseError('OpenAI API key is required')
      )

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data, status } = extractActionData(result)
      expect(status).toBe(400)
      expect(data.errors.parse).toBeDefined()
    })

    it('returns error when rate limited', async () => {
      vi.mocked(parseIngredients).mockRejectedValue(
        new IngredientParseError('Rate limit exceeded')
      )

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data, status } = extractActionData(result)
      expect(status).toBe(400)
      expect(data.errors.parse).toBeDefined()
    })

    it('handles non-IngredientParseError errors gracefully', async () => {
      vi.mocked(parseIngredients).mockRejectedValue(new Error('Unexpected error'))

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data, status } = extractActionData(result)
      expect(status).toBe(500)
      expect(data.errors.parse).toBeDefined()
    })
  })

  describe('authentication and authorization', () => {
    it('requires authentication', async () => {
      vi.mocked(requireUserId).mockRejectedValue(
        new Response('Unauthorized', { status: 401 })
      )

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      await expect(
        action({
          request,
          params: { id: testRecipe.id, stepId: testStep.id },
          context: mockContext,
        } as any)
      ).rejects.toThrow()
    })

    it('rejects parsing for non-owner', async () => {
      // Create another user
      const otherUser = await db.user.create({
        data: createTestUser(),
      })
      vi.mocked(requireUserId).mockResolvedValue(otherUser.id)

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      try {
        await action({
          request,
          params: { id: testRecipe.id, stepId: testStep.id },
          context: mockContext,
        } as any)
        expect.fail('Expected action to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(Response)
        const response = error as Response
        expect(response.status).toBe(403)
        expect(await response.text()).toBe('Unauthorized')
      }
    })

    it('rejects parsing for deleted recipe', async () => {
      // Soft-delete the recipe
      await db.recipe.update({
        where: { id: testRecipe.id },
        data: { deletedAt: new Date() },
      })

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      try {
        await action({
          request,
          params: { id: testRecipe.id, stepId: testStep.id },
          context: mockContext,
        } as any)
        expect.fail('Expected action to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(Response)
        const response = error as Response
        expect(response.status).toBe(404)
        expect(await response.text()).toBe('Recipe not found')
      }
    })

    it('rejects parsing for non-existent recipe', async () => {
      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      try {
        await action({
          request,
          params: { id: 'non-existent-recipe-id', stepId: testStep.id },
          context: mockContext,
        } as any)
        expect.fail('Expected action to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(Response)
        const response = error as Response
        expect(response.status).toBe(404)
        expect(await response.text()).toBe('Recipe not found')
      }
    })

    it('rejects parsing for non-existent step', async () => {
      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      try {
        await action({
          request,
          params: { id: testRecipe.id, stepId: 'non-existent-step-id' },
          context: mockContext,
        } as any)
        expect.fail('Expected action to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(Response)
        const response = error as Response
        expect(response.status).toBe(404)
        expect(await response.text()).toBe('Step not found')
      }
    })

    it('rejects parsing for step that belongs to different recipe', async () => {
      // Create another recipe with a step
      const anotherRecipe = await db.recipe.create({
        data: {
          title: 'Another Recipe',
          chefId: testUser.id,
        },
      })
      const anotherStep = await db.recipeStep.create({
        data: {
          recipeId: anotherRecipe.id,
          stepNum: 1,
          description: 'Another step',
        },
      })

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      // Use step from another recipe
      try {
        await action({
          request,
          params: { id: testRecipe.id, stepId: anotherStep.id },
          context: mockContext,
        } as any)
        expect.fail('Expected action to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(Response)
        const response = error as Response
        expect(response.status).toBe(404)
        expect(await response.text()).toBe('Step not found')
      }
    })
  })

  describe('API key retrieval', () => {
    it('uses OPENAI_API_KEY from environment', async () => {
      const parsedIngredients = [
        { quantity: 2, unit: 'cup', ingredientName: 'flour' },
      ]
      vi.mocked(parseIngredients).mockResolvedValue(parsedIngredients)

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      // Verify parseIngredients was called with centralized parser env
      expect(parseIngredients).toHaveBeenCalledWith(
        '2 cups flour',
        expect.any(Object)
      )
    })

    it('retrieves API key from Cloudflare env when available', async () => {
      const parsedIngredients = [
        { quantity: 2, unit: 'cup', ingredientName: 'flour' },
      ]
      vi.mocked(parseIngredients).mockResolvedValue(parsedIngredients)

      // Mock Cloudflare context with API key
      const cfContext = {
        cloudflare: {
          env: {
            OPENAI_API_KEY: 'cf-test-api-key',
          },
        },
      }

      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', '2 cups flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: cfContext,
      } as any)

      expect(parseIngredients).toHaveBeenCalledWith(
        '2 cups flour',
        expect.objectContaining({
          OPENAI_API_KEY: 'cf-test-api-key',
        })
      )
    })
  })

  describe('input validation', () => {
    it('handles missing ingredientText field', async () => {
      const formData = new UndiciFormData()
      formData.set('intent', 'parseIngredients')
      // ingredientText is not set

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data } = extractActionData(result)
      // Should either parse empty string or return validation error
      // If treating missing as empty, parseIngredients should be called with ''
      // If validating, should return an error
      expect(
        data.parsedIngredients !== undefined || data.errors !== undefined
      ).toBe(true)
    })
  })

  describe('does not interfere with other intents', () => {
    it('addIngredient intent still works', async () => {
      const formData = new UndiciFormData()
      formData.set('intent', 'addIngredient')
      formData.set('quantity', '2')
      formData.set('unitName', 'cup')
      formData.set('ingredientName', 'flour')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      const { data } = extractActionData(result)
      expect(data.success).toBe(true)
      expect(parseIngredients).not.toHaveBeenCalled()
    })

    it('delete intent still works', async () => {
      const formData = new UndiciFormData()
      formData.set('intent', 'delete')

      const request = new UndiciRequest('http://test.com/recipes/123/steps/456/edit', {
        method: 'POST',
        body: formData,
      })

      // This will redirect on success
      const result = await action({
        request,
        params: { id: testRecipe.id, stepId: testStep.id },
        context: mockContext,
      } as any)

      // Should redirect to recipe edit page
      expect(result.status).toBe(302)
      expect(parseIngredients).not.toHaveBeenCalled()
    })
  })
})
