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

import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Button } from '~/components/button'
import { Form } from '~/components/ouro/form/form'
import { ImageField, type ImageFieldRejection } from '~/components/ouro/image-field/image-field'
import { TextArea } from '~/components/ouro/text-field/text-area'
import { TextField } from '~/components/ouro/text-field/text-field'
import { useFormErrors } from '~/hooks/use-form-errors'
import { StepList } from './StepList'
import { Loader2 } from 'lucide-react'
import type { StepData } from './StepEditorCard'
import {
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  SERVINGS_MAX_LENGTH,
} from '~/lib/validation'
import {
  FOOD_IMAGE_ACCEPT,
  FOOD_IMAGE_TYPE_MESSAGE,
  IMAGE_MAX_FILE_SIZE,
  RECIPE_IMAGE_SIZE_MESSAGE,
} from '~/lib/recipe-image'
import { claim } from "~/lib/ouro/claims";

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
  /** The actual response accepted by this builder's own save form; absent for SSR display. */
  answer?: object
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

function recipeImageRejection(reason: ImageFieldRejection, file: File): string {
  if (reason === 'size') return RECIPE_IMAGE_SIZE_MESSAGE
  if (reason === 'unreadable') return `${file.name} could not be opened as a photo.`
  return file.type === 'image/gif' ? FOOD_IMAGE_TYPE_MESSAGE : `Invalid image type. ${FOOD_IMAGE_TYPE_MESSAGE}`
}

// The fields of the recipe details form. The image and steps errors show beside their own controls.
const DETAIL_FIELDS = ['title', 'description', 'servings'] as const

// The details are saved by the Save button below, through the page's own form, so Enter in a
// field submits nothing, as before.
const ignoreSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()

export function RecipeBuilder({
  recipe,
  onSave,
  onCancel,
  disabled = false,
  loading = false,
  saveRequestSignal = 0,
  errors,
  answer,
  showSteps = true,
}: RecipeBuilderProps) {
  const detailErrors = useFormErrors(errors, DETAIL_FIELDS, answer)

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

  // Image state: the photo just chosen (HX ImageField shows it), and whether the saved one was removed
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [clearImage, setClearImage] = useState(false)

  // Steps state
  const [steps, setSteps] = useState<StepData[]>(recipe?.steps ?? [])
  const lastSaveRequestSignal = useRef(saveRequestSignal)

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

  // Removing a photo just chosen goes back to the saved one (onFileChange(null)); removing the
  // saved one clears it on save.
  const handleImageChange = (file: File | null) => {
    setImageFile(file)
  }

  const handleImageRemove = () => {
    setClearImage(true)
  }

  const savedImageUrl = clearImage ? null : recipe?.coverImageUrl || null

  const isSaveDisabled = isDisabled || !title.trim()

  return (
    <div className="space-y-8">
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
        {/* The save's messages land on the fields by name; "general" shows at the top. */}
        <Form errors={detailErrors} onSubmit={ignoreSubmit}>
          <TextField
            ref={titleRef}
            label="Title"
            name="title"
            defaultValue={recipe?.title ?? ''}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Chocolate Chip Cookies"
            maxLength={TITLE_MAX_LENGTH}
            required
            disabled={isDisabled}
          />
          <TextArea
            ref={descriptionRef}
            label="Description"
            name="description"
            defaultValue={recipe?.description ?? ''}
            placeholder="Recipe description"
            rows={3}
            maxLength={DESCRIPTION_MAX_LENGTH}
            disabled={isDisabled}
          />
          <TextField
            ref={servingsRef}
            label="Servings"
            name="servings"
            defaultValue={recipe?.servings ?? ''}
            placeholder="e.g., 4 servings"
            maxLength={SERVINGS_MAX_LENGTH}
            disabled={isDisabled}
          />
          <ImageField
            label="Recipe image"
            description={claim("JPG, PNG, or WebP. 5 MB max.", { source: { file: "app/lib/recipe-image.ts" }, verify: [{ fileLine: "app/lib/recipe-image.ts", pattern: "IMAGE_MAX_FILE_SIZE = 5 \\* 1024 \\* 1024" }] })}
            src={savedImageUrl}
            alt={recipe?.title ? `Photo of ${recipe.title}` : 'Recipe photo'}
            accept={FOOD_IMAGE_ACCEPT}
            maxSize={IMAGE_MAX_FILE_SIZE}
            aspect={16 / 9}
            rejectMessage={recipeImageRejection}
            chooseLabel="Upload image"
            changeLabel="Change image"
            removeLabel="Remove image"
            onFileChange={handleImageChange}
            onRemove={savedImageUrl ? handleImageRemove : undefined}
            disabled={isDisabled}
            error={errors?.image}
          />
          {loading ? (
            <p role="status" className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
              {imageFile ? 'Uploading image...' : 'Saving recipe...'}
            </p>
          ) : null}
        </Form>
      </fieldset>

      {showSteps && (
        <section aria-label="Recipe steps" className="space-y-4 border-t border-[var(--sj-border)] pt-6">
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
            onChange={setSteps}
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
          {recipe ? 'Save recipe' : 'Create recipe'}
        </Button>
      </div>
    </div>
  )
}
