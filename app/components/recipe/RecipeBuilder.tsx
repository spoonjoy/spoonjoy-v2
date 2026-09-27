/**
 * RecipeBuilder component.
 *
 * Orchestrates the complete recipe creation/editing experience:
 * - Metadata section (title, description, servings, image)
 * - StepList (steps with ingredients, reordering, dependencies)
 *
 * Features:
 * - Single-page recipe creation experience
 * - Handles both create (new recipe) and edit (existing recipe) modes
 * - No page navigation during creation
 * - Single save action for entire recipe
 * - Progressive disclosure: start simple, expand on demand
 * - Error display with aria-describedby for accessibility
 * - Loading state with spinner
 * - Character limits on inputs
 */

import { useState, useEffect, useId, useRef } from 'react'
import { Button } from '~/components/ui/button'
import { Fieldset, Field, Label, ErrorMessage } from '~/components/ui/fieldset'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { StepList } from './StepList'
import { RecipeImageUpload } from './RecipeImageUpload'
import { Loader2 } from 'lucide-react'
import type { StepData } from './StepEditorCard'
import {
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  SERVINGS_MAX_LENGTH,
} from '~/lib/validation'

export interface RecipeBuilderData {
  id?: string
  title: string
  description: string | null
  servings: string | null
  coverImageUrl: string | null
  imageFile?: File | null
  clearImage?: boolean
  steps: StepData[]
}

export interface RecipeBuilderProps {
  recipe?: RecipeBuilderData
  onSave: (data: RecipeBuilderData) => void
  onCancel?: () => void
  disabled?: boolean
  loading?: boolean
  saveRequestSignal?: number
  errors?: {
    title?: string
    description?: string
    servings?: string
    image?: string
    steps?: string
    general?: string
  }
  showSteps?: boolean
}

export function RecipeBuilder({
  recipe,
  onSave,
  onCancel,
  disabled = false,
  loading = false,
  saveRequestSignal = 0,
  errors,
  showSteps = true,
}: RecipeBuilderProps) {
  // Generate unique IDs for aria-describedby
  const titleErrorId = useId()
  const descriptionErrorId = useId()
  const servingsErrorId = useId()

  // Combine disabled and loading for isDisabled
  const isDisabled = disabled || loading

  // The title, description and servings fields are uncontrolled, and saving
  // reads them from the DOM. They are server-rendered, and a controlled `value`
  // would wipe anything typed before hydration: the first re-render after it (a
  // focus change in the Headless UI field) makes React write its state back to
  // the field. `title` only mirrors the field to dim Create while it is empty;
  // the mount effect picks up a title typed before hydration.
  const titleRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const servingsRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(recipe?.title ?? '')

  useEffect(() => {
    setTitle(titleRef.current!.value)
  }, [])

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [clearImage, setClearImage] = useState(false)

  // Steps state
  const [steps, setSteps] = useState<StepData[]>(recipe?.steps ?? [])
  const lastSaveRequestSignal = useRef(saveRequestSignal)

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  // Derive recipe ID (for edit mode or generate temp ID for create mode)
  const recipeId = recipe?.id ?? 'new-recipe'

  const handleSave = () => {
    // Prevent save if disabled, loading, or no title
    // Note: Button is only disabled when isDisabled=true, not when title is empty
    // When title is empty, button is visually dimmed but still clickable
    const title = titleRef.current!.value
    const description = descriptionRef.current!.value
    const servings = servingsRef.current!.value

    /* istanbul ignore next -- @preserve defensive guard; save button is disabled for these states */
    if (isDisabled || !title.trim()) return

    const data: RecipeBuilderData = {
      id: recipe?.id,
      title,
      description: description || null,
      servings: servings || null,
      coverImageUrl: recipe?.coverImageUrl ?? '',
      imageFile,
      clearImage: clearImage || undefined,
      steps,
    }
    onSave(data)
  }

  useEffect(() => {
    if (saveRequestSignal === lastSaveRequestSignal.current) return
    lastSaveRequestSignal.current = saveRequestSignal
    handleSave()
  }, [saveRequestSignal])

  const handleCancel = () => {
    onCancel?.()
  }

  const handleStepsChange = (newSteps: StepData[]) => {
    setSteps(newSteps)
  }

  const handleImageSelect = (file: File) => {
    setImageFile(file)
    setClearImage(false)
    // Create preview URL for display
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }

  const handleImageClear = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    setImageFile(null)
    setClearImage(true)
  }

  // Determine which image URL to display
  const getDisplayImageUrl = () => {
    if (previewUrl) return previewUrl
    if (clearImage) return ''
    return recipe?.coverImageUrl || ''
  }

  const displayImageUrl = getDisplayImageUrl()

  const isSaveDisabled = isDisabled || !title.trim()
  const imageUploadStatus = imageFile ? 'Uploading image...' : 'Saving recipe...'

  return (
    <div className="space-y-8">
      {/* General error alert */}
      {errors?.general && (
        <div
          role="alert"
          className="border-y border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_10%,var(--sj-panel-solid))] py-4 text-sm text-[var(--sj-tomato)]"
        >
          {errors.general}
        </div>
      )}

      {/* Recipe details section */}
      <fieldset
        aria-label="Recipe details"
        className="sj-form-section space-y-6"
        disabled={isDisabled}
      >
        <div>
          <p className="sj-eyebrow">Recipe card</p>
          <h2 className="font-sj-display mt-3 text-3xl/9 font-semibold tracking-normal text-[var(--sj-ink)]">
            Give the dish a home.
          </h2>
          <p className="mt-2 max-w-2xl text-sm/6 text-[var(--sj-ink-soft)]">
            Capture the name, story, serving cue, and photo someone will need when they cook this later.
          </p>
        </div>
        <Fieldset>
          <Field>
            <Label>Title</Label>
            <Input
              ref={titleRef}
              type="text"
              defaultValue={recipe?.title ?? ''}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Chocolate Chip Cookies"
              maxLength={TITLE_MAX_LENGTH}
              required
              disabled={isDisabled}
              data-invalid={errors?.title ? true : undefined}
              aria-invalid={errors?.title ? true : undefined}
              aria-describedby={errors?.title ? titleErrorId : undefined}
            />
            {errors?.title && <ErrorMessage id={titleErrorId}>{errors.title}</ErrorMessage>}
          </Field>

          <Field>
            <Label>Description</Label>
            <Textarea
              ref={descriptionRef}
              defaultValue={recipe?.description ?? ''}
              placeholder="Recipe description"
              rows={3}
              maxLength={DESCRIPTION_MAX_LENGTH}
              disabled={isDisabled}
              data-invalid={errors?.description ? true : undefined}
              aria-invalid={errors?.description ? true : undefined}
              aria-describedby={errors?.description ? descriptionErrorId : undefined}
            />
            {errors?.description && <ErrorMessage id={descriptionErrorId}>{errors.description}</ErrorMessage>}
          </Field>

          <Field>
            <Label>Servings</Label>
            <Input
              ref={servingsRef}
              type="text"
              defaultValue={recipe?.servings ?? ''}
              placeholder="e.g., 4 servings"
              maxLength={SERVINGS_MAX_LENGTH}
              disabled={isDisabled}
              data-invalid={errors?.servings ? true : undefined}
              aria-invalid={errors?.servings ? true : undefined}
              aria-describedby={errors?.servings ? servingsErrorId : undefined}
            />
            {errors?.servings && <ErrorMessage id={servingsErrorId}>{errors.servings}</ErrorMessage>}
          </Field>

          <Field>
            <Label>Recipe Image</Label>
            <RecipeImageUpload
              coverImageUrl={displayImageUrl}
              onFileSelect={handleImageSelect}
              onClear={handleImageClear}
              disabled={isDisabled}
              loading={loading}
              loadingLabel={imageUploadStatus}
              error={errors?.image}
            />
          </Field>
        </Fieldset>
      </fieldset>

      {showSteps && (
        <section aria-label="Recipe Steps" className="space-y-4 border-t border-[var(--sj-border)] pt-6">
          <div>
            <p className="sj-eyebrow">Method</p>
            <h2 className="font-sj-display mt-3 text-3xl/9 font-semibold tracking-normal text-[var(--sj-ink)]">
              Build the cooking path.
            </h2>
          </div>
          {errors?.steps && (
            <div
              role="alert"
              className="border-y border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_10%,var(--sj-panel-solid))] py-4 text-sm text-[var(--sj-tomato)]"
            >
              {errors.steps}
            </div>
          )}

          <StepList
            steps={steps}
            recipeId={recipeId}
            onChange={handleStepsChange}
            disabled={isDisabled}
          />
        </section>
      )}

      {/* Action buttons */}
      <div className="flex flex-col-reverse gap-3 border-t border-[var(--sj-border)] pt-5 sm:flex-row sm:justify-end">
        <Button
          type="button"

          onClick={handleCancel}
          disabled={isDisabled}
          plain
        >
          Cancel
        </Button>
        <Button
          type="button"

          onClick={handleSave}
          disabled={isDisabled}
          aria-disabled={isSaveDisabled || undefined}
          aria-busy={loading ? 'true' : undefined}
          className={isSaveDisabled && !isDisabled ? 'opacity-50' : undefined}
        >
          {loading && <Loader2 className="size-4 animate-spin" data-slot="icon" />}
          {recipe ? 'Save Recipe' : 'Create Recipe'}
        </Button>
      </div>
    </div>
  )
}
