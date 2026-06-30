import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_GEMINI_TEXT_TIMEOUT_MS,
  geminiGenerateJson,
  GeminiTextError,
} from '~/lib/gemini-text.server'

/**
 * Tests for the generic Gemini structured-JSON text adapter.
 *
 * Every test injects a fake `fetchImpl` so no network is touched. The adapter's
 * only guarantee is "a non-empty JSON string came back"; these tests pin each
 * failure mode it converts into a {@link GeminiTextError} (timeout, transport,
 * non-2xx, non-JSON body, empty content) plus the happy path.
 */

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { value: { type: 'string' } },
  required: ['value'],
}

function buildConfig(overrides: Partial<{ fetchImpl: typeof fetch; timeoutMs: number }> = {}) {
  return {
    apiKey: 'test-google-api-key',
    model: DEFAULT_GEMINI_TEXT_MODEL,
    timeoutMs: DEFAULT_GEMINI_TEXT_TIMEOUT_MS,
    ...overrides,
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function geminiTextPayload(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] }
}

describe('geminiGenerateJson', () => {
  it('exposes sane defaults', () => {
    expect(DEFAULT_GEMINI_TEXT_MODEL).toBe('gemini-2.5-flash')
    expect(DEFAULT_GEMINI_TEXT_TIMEOUT_MS).toBe(8_000)
  })

  it('returns the concatenated candidate text on a successful response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(geminiTextPayload('{"value":"ok"}')))

    const result = await geminiGenerateJson({
      config: buildConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      systemPrompt: 'system',
      userText: 'user',
      responseSchema: RESPONSE_SCHEMA,
    })

    expect(result).toBe('{"value":"ok"}')

    // Verify the request shape: URL carries the (encoded) model + endpoint, and
    // the body wires the prompts and structured-output schema.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, requestInit] = fetchImpl.mock.calls[0]
    expect(url).toContain(`/models/${DEFAULT_GEMINI_TEXT_MODEL}:generateContent`)
    expect(requestInit.method).toBe('POST')
    expect(requestInit.headers['x-goog-api-key']).toBe('test-google-api-key')
    const body = JSON.parse(requestInit.body as string)
    expect(body.system_instruction.parts[0].text).toBe('system')
    expect(body.contents[0].parts[0].text).toBe('user')
    expect(body.generationConfig.responseSchema).toEqual(RESPONSE_SCHEMA)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('concatenates text parts of the first candidate, skipping parts with no text', async () => {
    // The middle part has no `text` key, exercising the `part.text ?? ""` branch.
    const payload = {
      candidates: [{ content: { parts: [{ text: 'a' }, {}, { text: 'b' }] } }],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload))

    const result = await geminiGenerateJson({
      config: buildConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      systemPrompt: 'system',
      userText: 'user',
      responseSchema: RESPONSE_SCHEMA,
    })

    expect(result).toBe('ab')
  })

  it('throws GeminiTextError with the google status/code on a non-2xx JSON error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { message: 'quota exceeded', status: 'RESOURCE_EXHAUSTED' } },
        { status: 429, statusText: 'Too Many Requests' }
      )
    )

    await expect(
      geminiGenerateJson({
        config: buildConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }),
        systemPrompt: 'system',
        userText: 'user',
        responseSchema: RESPONSE_SCHEMA,
      })
    ).rejects.toMatchObject({
      name: 'GeminiTextError',
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
    })
  })

  it('falls back to statusText when the non-2xx response has no JSON error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('not json', { status: 503, statusText: 'Service Unavailable' })
    )

    try {
      await geminiGenerateJson({
        config: buildConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }),
        systemPrompt: 'system',
        userText: 'user',
        responseSchema: RESPONSE_SCHEMA,
      })
      expect.fail('Should have thrown')
    } catch (error) {
      const geminiError = error as GeminiTextError
      expect(geminiError).toBeInstanceOf(GeminiTextError)
      expect(geminiError.status).toBe(503)
      // No google error object -> code defaults to the stringified HTTP status,
      // and the message uses statusText.
      expect(geminiError.code).toBe('503')
      expect(geminiError.message).toContain('Service Unavailable')
    }
  })

  it('maps a non-abort fetch rejection to a network GeminiTextError', async () => {
    const cause = new Error('socket hang up')
    const fetchImpl = vi.fn().mockRejectedValue(cause)

    try {
      await geminiGenerateJson({
        config: buildConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }),
        systemPrompt: 'system',
        userText: 'user',
        responseSchema: RESPONSE_SCHEMA,
      })
      expect.fail('Should have thrown')
    } catch (error) {
      const geminiError = error as GeminiTextError
      expect(geminiError).toBeInstanceOf(GeminiTextError)
      expect(geminiError.code).toBe('network')
      expect(geminiError.message).toBe('Gemini request failed')
      expect((geminiError as { cause?: unknown }).cause).toBe(cause)
    }
  })

  it('maps an aborted (timed-out) fetch to a timeout GeminiTextError', async () => {
    // Simulate the timeout: the fetch rejects only after the AbortController
    // fires, so `controller.signal.aborted` is true in the catch.
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
    )

    try {
      await geminiGenerateJson({
        config: buildConfig({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          timeoutMs: 1,
        }),
        systemPrompt: 'system',
        userText: 'user',
        responseSchema: RESPONSE_SCHEMA,
      })
      expect.fail('Should have thrown')
    } catch (error) {
      const geminiError = error as GeminiTextError
      expect(geminiError).toBeInstanceOf(GeminiTextError)
      expect(geminiError.code).toBe('timeout')
      expect(geminiError.message).toBe('Gemini request timed out')
    }
  })

  it('throws GeminiTextError when the OK response body is not JSON', async () => {
    const badJsonResponse = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token')),
    }
    const fetchImpl = vi.fn().mockResolvedValue(badJsonResponse)

    try {
      await geminiGenerateJson({
        config: buildConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }),
        systemPrompt: 'system',
        userText: 'user',
        responseSchema: RESPONSE_SCHEMA,
      })
      expect.fail('Should have thrown')
    } catch (error) {
      const geminiError = error as GeminiTextError
      expect(geminiError).toBeInstanceOf(GeminiTextError)
      expect(geminiError.status).toBe(200)
      expect(geminiError.message).toContain('non-JSON')
    }
  })

  it('throws GeminiTextError when candidates are missing (empty content)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}))

    await expect(
      geminiGenerateJson({
        config: buildConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }),
        systemPrompt: 'system',
        userText: 'user',
        responseSchema: RESPONSE_SCHEMA,
      })
    ).rejects.toMatchObject({
      name: 'GeminiTextError',
      status: 200,
      message: 'Gemini returned empty content',
    })
  })

  it('throws empty-content GeminiTextError when candidate text is blank', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(geminiTextPayload('   ')))

    await expect(
      geminiGenerateJson({
        config: buildConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }),
        systemPrompt: 'system',
        userText: 'user',
        responseSchema: RESPONSE_SCHEMA,
      })
    ).rejects.toMatchObject({ message: 'Gemini returned empty content' })
  })

  it('uses the global fetch when no fetchImpl is provided', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(geminiTextPayload('{"value":"global"}')))

    try {
      const result = await geminiGenerateJson({
        config: buildConfig(),
        systemPrompt: 'system',
        userText: 'user',
        responseSchema: RESPONSE_SCHEMA,
      })
      expect(result).toBe('{"value":"global"}')
      expect(globalFetch).toHaveBeenCalledTimes(1)
    } finally {
      globalFetch.mockRestore()
    }
  })

  it('GeminiTextError defaults status/code to null and omits cause when unspecified', () => {
    const error = new GeminiTextError('bare')
    expect(error.status).toBeNull()
    expect(error.code).toBeNull()
    expect((error as { cause?: unknown }).cause).toBeUndefined()
  })
})
