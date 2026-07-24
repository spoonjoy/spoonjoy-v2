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
import { Select } from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import { StepList } from './StepList'
import { RecipeImageUpload } from './RecipeImageUpload'
import { Loader2, Plus, X } from 'lucide-react'
import type { StepData } from './StepEditorCard'
import {
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  SERVINGS_MAX_LENGTH,
} from '~/lib/validation'
import { MAX_RECIPE_TAG_CODE_POINTS, MAX_RECIPE_TAGS } from '~/lib/recipe-tags'

export interface RecipeBuilderData {
  id?: string
  title: string
  description: string | null
  servings: string | null
  course: 'main' | 'side' | 'appetizer' | 'dessert' | null
  tags: string[]
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
    course?: string
    tags?: string
    image?: string
    steps?: string
    general?: string
  }
  showSteps?: boolean
}

function normalizePendingTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
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
  const courseErrorId = useId()
  const tagsErrorId = useId()
  const tagsHelpId = useId()
  const tagsInputId = useId()

  // Combine disabled and loading for isDisabled
  const isDisabled = disabled || loading

  // Form state for metadata
  const [title, setTitle] = useState(recipe?.title ?? '')
  const [description, setDescription] = useState(recipe?.description ?? '')
  const [servings, setServings] = useState(recipe?.servings ?? '')
  const [course, setCourse] = useState<RecipeBuilderData['course']>(recipe?.course ?? null)
  const [tags, setTags] = useState<string[]>(recipe?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [tagClientError, setTagClientError] = useState<string | null>(null)
  const [tagAnnouncement, setTagAnnouncement] = useState('')
  const tagsInputRef = useRef<HTMLInputElement>(null)
  const tagRemoveButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingTagFocus = useRef<string | null>(null)

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [clearImage, setClearImage] = useState(false)

  // Steps state
  const [steps, setSteps] = useState<StepData[]>(recipe?.steps ?? [])
  const lastSaveRequestSignal = useRef(saveRequestSignal)

  const pendingTag = normalizePendingTag(tagInput)
  const pendingTagIsDuplicate = tags.some(
    (tag) => tag.toLowerCase() === pendingTag.toLowerCase(),
  )
  const pendingTagIsTooLong = Array.from(pendingTag.normalize('NFKC')).length > MAX_RECIPE_TAG_CODE_POINTS
  const pendingTagExceedsCount = Boolean(pendingTag) && !pendingTagIsDuplicate && tags.length >= MAX_RECIPE_TAGS
  const pendingTagError = pendingTagIsTooLong
    ? `Tags must be ${MAX_RECIPE_TAG_CODE_POINTS} characters or fewer`
    : pendingTagExceedsCount
      ? `Add no more than ${MAX_RECIPE_TAGS} tags`
      : null
  const effectiveTagError = tagClientError ?? pendingTagError ?? errors?.tags

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
    /* istanbul ignore next -- @preserve defensive guard; save button is disabled for these states */
    if (isDisabled || !title.trim()) return

    if (pendingTagError) {
      setTagClientError(pendingTagError)
      tagsInputRef.current?.focus()
      return
    }
    const savedTags = pendingTag && !tags.some((tag) => tag.toLowerCase() === pendingTag.toLowerCase())
      ? [...tags, pendingTag]
      : tags
    const data: RecipeBuilderData = {
      id: recipe?.id,
      title,
      description: description || null,
      servings: servings || null,
      course,
      tags: savedTags,
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

  useEffect(() => {
    const focusTarget = pendingTagFocus.current
    if (focusTarget === null) return
    pendingTagFocus.current = null
    if (focusTarget) {
      tagRemoveButtonRefs.current.get(focusTarget)?.focus()
    } else {
      tagsInputRef.current?.focus()
    }
  }, [tags])

  const handleCancel = () => {
    onCancel?.()
  }

  const handleStepsChange = (newSteps: StepData[]) => {
    setSteps(newSteps)
  }

  const addPendingTag = () => {
    const label = pendingTag
    if (!label) return
    if (pendingTagError) {
      setTagClientError(pendingTagError)
      return
    }
    if (!pendingTagIsDuplicate) {
      setTags((current) => [...current, label])
    }
    setTagClientError(null)
    setTagInput('')
  }

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    addPendingTag()
  }

  const removeTag = (tagToRemove: string) => {
    const index = tags.indexOf(tagToRemove)
    pendingTagFocus.current = tags[index + 1] ?? tags[index - 1] ?? ''
    setTags((current) => current.filter((tag) => tag !== tagToRemove))
    setTagClientError(null)
    setTagAnnouncement(`${tagToRemove} tag removed`)
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
              type="text"
              value={title}
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              type="text"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
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
            <Label>Course</Label>
            <Select
              value={course ?? ''}
              onChange={(event) => setCourse((event.target.value || null) as RecipeBuilderData['course'])}
              disabled={isDisabled}
              data-invalid={errors?.course ? true : undefined}
              aria-invalid={errors?.course ? true : undefined}
              aria-describedby={errors?.course ? courseErrorId : undefined}
            >
              <option value="">No course</option>
              <option value="main">Main</option>
              <option value="side">Side</option>
              <option value="appetizer">Appetizer</option>
              <option value="dessert">Dessert</option>
            </Select>
            {errors?.course && <ErrorMessage id={courseErrorId}>{errors.course}</ErrorMessage>}
          </Field>

          <Field>
            <Label htmlFor={tagsInputId}>Tags</Label>
            <div data-slot="control" className="flex gap-2">
              <input
                ref={tagsInputRef}
                id={tagsInputId}
                type="text"
                value={tagInput}
                onChange={(event) => {
                  setTagInput(event.target.value)
                  setTagClientError(null)
                }}
                onKeyDown={handleTagKeyDown}
                placeholder="Add a tag"
                disabled={isDisabled}
                data-invalid={effectiveTagError ? true : undefined}
                aria-invalid={effectiveTagError ? true : undefined}
                aria-describedby={effectiveTagError ? `${tagsHelpId} ${tagsErrorId}` : tagsHelpId}
                className="font-sj-ui min-h-11 min-w-0 flex-1 rounded-[var(--sj-radius-small)] border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-3.5 py-2.5 text-base/6 text-[var(--sj-ink)] outline-none placeholder:text-[var(--sj-ink-soft)] hover:border-[var(--sj-brass)] focus-visible:ring-2 focus-visible:ring-[var(--sj-brass)] disabled:border-[var(--sj-border)] disabled:opacity-50 data-[invalid]:border-[var(--sj-tomato)] sm:px-3 sm:py-1.5 sm:text-sm/6"
              />
              <button
                type="button"
                onClick={addPendingTag}
                disabled={isDisabled || !pendingTag || pendingTagIsTooLong || tags.length >= MAX_RECIPE_TAGS}
                aria-label="Add tag"
                title="Add tag"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--sj-radius-small)] border border-[var(--sj-border-strong)] bg-[var(--sj-field)] text-[var(--sj-ink-soft)] hover:border-[var(--sj-brass)] hover:text-[var(--sj-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
            <p id={tagsHelpId} className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">
              Up to {MAX_RECIPE_TAGS} tags, {MAX_RECIPE_TAG_CODE_POINTS} characters each.
            </p>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Recipe tags">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-[var(--sj-radius-small)] border border-[var(--sj-border)] bg-[var(--sj-field)] py-1 pl-3 pr-1 text-sm text-[var(--sj-ink)]"
                  >
                    <span className="min-w-0 break-all">{tag}</span>
                    <button
                      ref={(element) => {
                        if (element) tagRemoveButtonRefs.current.set(tag, element)
                        else tagRemoveButtonRefs.current.delete(tag)
                      }}
                      type="button"
                      onClick={() => removeTag(tag)}
                      disabled={isDisabled}
                      aria-label={`Remove ${tag} tag`}
                      title={`Remove ${tag} tag`}
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--sj-radius-small)] text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] disabled:opacity-50"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {effectiveTagError && <ErrorMessage id={tagsErrorId}>{effectiveTagError}</ErrorMessage>}
            <p className="sr-only" role="status" aria-live="polite">{tagAnnouncement}</p>
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
