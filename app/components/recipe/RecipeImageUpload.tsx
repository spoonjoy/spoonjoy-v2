import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  FOOD_IMAGE_ACCEPT,
  FOOD_IMAGE_TYPE_MESSAGE,
  IMAGE_MAX_FILE_SIZE,
  RECIPE_IMAGE_SIZE_MESSAGE,
  FOOD_IMAGE_TYPES,
} from '~/lib/recipe-image'

interface RecipeImageUploadProps {
  onFileSelect: (file: File) => void
  onClear?: () => void
  onValidationError?: (message: string) => void
  coverImageUrl?: string | null
  alt?: string
  disabled?: boolean
  loading?: boolean
  error?: string
}

export function RecipeImageUpload({
  onFileSelect,
  onClear,
  onValidationError,
  coverImageUrl,
  alt,
  disabled = false,
  loading = false,
  error,
}: RecipeImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Cleanup object URL on unmount or when preview changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const validateFile = (file: File): boolean => {
    if (!file.type.startsWith('image/')) {
      onValidationError?.(`Invalid image type. ${FOOD_IMAGE_TYPE_MESSAGE}`)
      return false
    }

    if (!(FOOD_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      onValidationError?.(
        file.type === 'image/gif'
          ? FOOD_IMAGE_TYPE_MESSAGE
          : `Invalid image type. ${FOOD_IMAGE_TYPE_MESSAGE}`
      )
      return false
    }

    if (file.size > IMAGE_MAX_FILE_SIZE) {
      onValidationError?.(RECIPE_IMAGE_SIZE_MESSAGE)
      return false
    }

    return true
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    /* istanbul ignore next -- @preserve native file input onChange only fires with a selected file */
    if (!file) return

    if (!validateFile(file)) {
      // Reset input so the same file can be selected again
      event.target.value = ''
      return
    }

    // Revoke old preview URL if exists
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }

    // Create new preview URL
    const newPreviewUrl = URL.createObjectURL(file)
    setPreviewUrl(newPreviewUrl)

    onFileSelect(file)

    // Reset input to allow selecting the same file again
    event.target.value = ''
  }

  const handleClear = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    onClear?.()
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled && !loading) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (disabled || loading) return

    const file = e.dataTransfer.files?.[0]
    if (!file) return

    if (!validateFile(file)) return

    // Revoke old preview URL if exists
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }

    // Create new preview URL
    const newPreviewUrl = URL.createObjectURL(file)
    setPreviewUrl(newPreviewUrl)

    onFileSelect(file)
  }

  const displayUrl = previewUrl || coverImageUrl
  const hasImage = Boolean(displayUrl)
  const isDisabled = disabled || loading

  return (
    <div className="space-y-2">
      <div
        data-drop-zone
        className={clsx(
          'relative w-full aspect-video overflow-hidden rounded-[var(--sj-radius-surface)] border-2 border-dashed transition-colors',
          isDragging
            ? 'drag-active border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_14%,var(--sj-panel-solid))]'
            : 'border-[var(--sj-border-strong)] bg-[color-mix(in_srgb,var(--sj-flour)_46%,transparent)]',
          isDisabled && 'opacity-50 cursor-not-allowed'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {hasImage ? (
          <img
            src={displayUrl!}
            alt={alt || 'Recipe image preview'}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-[var(--sj-ink-soft)]">
            <div className="rounded-[var(--sj-radius-surface)] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] p-4 shadow-[var(--sj-shadow-soft)]">
              <ImageIcon className="size-10" />
            </div>
            <p className="font-sj-ui text-sm font-semibold uppercase tracking-[0.12em]">Drag, drop, or upload a recipe photo</p>
          </div>
        )}

        {loading && (
          <div
            role="status"
            aria-busy="true"
            className="absolute inset-0 flex items-center justify-center rounded-[var(--sj-radius-surface)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_78%,transparent)]"
          >
            <Loader2 className="size-8 animate-spin text-[var(--sj-brass)]" />
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={FOOD_IMAGE_ACCEPT}
        className="hidden"
        disabled={isDisabled}
        aria-label="Upload recipe image"
        onChange={handleFileChange}
      />

      <div className="flex gap-2">
        {hasImage ? (
          <>
            <Button
              type="button"
              plain
              onClick={handleUploadClick}
              disabled={isDisabled}
            >
              <Upload data-slot="icon" aria-hidden="true" />
              Change Image
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleClear}
              disabled={isDisabled}
            >
              <X data-slot="icon" aria-hidden="true" />
              Remove
            </Button>
          </>
        ) : (
          <Button
            type="button"
            plain
            onClick={handleUploadClick}
            disabled={isDisabled}
          >
            <Upload data-slot="icon" aria-hidden="true" />
            Upload Image
          </Button>
        )}
      </div>

      <p className="text-sm text-[var(--sj-ink-soft)]">
        JPG, PNG, or WebP. Max 5MB.
      </p>

      {error && (
        <p role="alert" className="text-sm text-[var(--sj-tomato)]">
          {error}
        </p>
      )}
    </div>
  )
}
