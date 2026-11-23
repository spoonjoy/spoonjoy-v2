import { useState } from 'react'
import { useFetcher } from 'react-router'
import { Card } from '~/components/ouro/card/card'
import { Button } from '~/components/ouro/button/button'
import { Text } from '~/components/ouro/text/text'
import { RecipeVisibilityField } from '~/components/recipe/RecipeVisibilityField'
import type { RecipeVisibility } from '~/domains/kitchen'

export interface RecipeVisibilityDefaultSectionProps {
  /** The cook's default for new recipes. */
  value: RecipeVisibility
}

/** Account settings: who can see the cook's new recipes, unless they choose otherwise on the recipe. */
export function RecipeVisibilityDefaultSection({ value }: RecipeVisibilityDefaultSectionProps) {
  const fetcher = useFetcher<{ success: boolean; intent?: string; message?: string }>()
  const [visibility, setVisibility] = useState<RecipeVisibility>(value)
  const saving = fetcher.state !== 'idle'
  const answer = fetcher.state === 'idle' && fetcher.data?.intent === 'setRecipeVisibilityDefault' ? fetcher.data : undefined

  return (
    <Card as="section" headingLevel={2} stackBelow="sm" className="my-4" data-testid="recipe-visibility-section" title="New recipes">
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="setRecipeVisibilityDefault" />
        <RecipeVisibilityField
          legend="Who can see your new recipes"
          value={visibility}
          onChange={setVisibility}
          disabled={saving}
        />
        <Text tone="muted">You can still change it on each recipe.</Text>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          {answer ? (
            <Text role="status">{answer.success ? 'Saved.' : answer.message}</Text>
          ) : null}
        </div>
      </fetcher.Form>
    </Card>
  )
}
