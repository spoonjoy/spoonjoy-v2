import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

const DEBOUNCE_DELAY_MS = 1000

interface UseIngredientParserProps {
  recipeId: string
  stepId: string
}

interface ActionData {
  parsedIngredients?: ParsedIngredient[]
  errors?: {
    parse?: string
  }
}

export function getIngredientParserAction(recipeId: string, stepId: string) {
  if (recipeId === 'new-recipe') {
    return '/recipes/new'
  }

  return `/recipes/${recipeId}/steps/${stepId}/edit`
}

export function useIngredientParser({ recipeId, stepId }: UseIngredientParserProps) {
  const [text, setTextInternal] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [localParsedIngredients, setLocalParsedIngredients] = useState<ParsedIngredient[] | null>(
    null
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetcher = useFetcher<ActionData>()

  // Derived loading state from fetcher
  const isLoading = fetcher.state === 'submitting' || fetcher.state === 'loading'

  // Sync fetcher data to local state when it arrives
  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.errors?.parse) {
        setLocalError(fetcher.data.errors.parse)
        setLocalParsedIngredients(null)
      } else if (fetcher.data.parsedIngredients) {
        setLocalParsedIngredients(fetcher.data.parsedIngredients)
        setLocalError(null)
      }
    }
  }, [fetcher.data])

  const submitParse = useCallback(
    (ingredientText: string) => {
      const formData = new FormData()
      formData.set('intent', 'parseIngredients')
      formData.set('ingredientText', ingredientText)

      fetcher.submit(formData, {
        method: 'post',
        action: getIngredientParserAction(recipeId, stepId),
      })
    },
    [fetcher, recipeId, stepId]
  )

  const setText = useCallback(
    (newText: string) => {
      setTextInternal(newText)

      // Clear pending debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }

      // Don't parse empty or whitespace-only text
      if (!newText.trim()) {
        return
      }

      // Set up new debounce
      debounceRef.current = setTimeout(() => {
        submitParse(newText)
      }, DEBOUNCE_DELAY_MS)
    },
    [submitParse]
  )

  const parse = useCallback(() => {
    // Cancel pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    // Don't parse empty or whitespace-only text
    if (!text.trim()) {
      return
    }

    submitParse(text)
  }, [text, submitParse])

  const clear = useCallback(() => {
    setTextInternal('')
    setLocalError(null)
    setLocalParsedIngredients(null)

    // Cancel pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  return {
    text,
    setText,
    parse,
    clear,
    isLoading,
    error: localError,
    parsedIngredients: localParsedIngredients,
  }
}
