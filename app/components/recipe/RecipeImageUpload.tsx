import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

interface RecipeImageUploadProps {
  onFileSelect: (file: File) => void
  onClear?: () => void
  onValidationError?: (message: string) => void
  coverImageUrl?: string
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
      onValidationError?.('Invalid file type. Please select an image file.')
      return false
    }

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      onValidationError?.('Invalid file type. Please select an image file.')
      return false
    }

    if (file.size > MAX_FILE_SIZE) {
      onValidationError?.('File too large. Maximum size is 5MB.')
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
          'relative w-full aspect-video overflow-hidden rounded-[1.5rem] border-2 border-dashed transition-colors',
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
            <div className="rounded-full border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] p-4 shadow-[var(--sj-shadow-soft)]">
              <ImageIcon className="size-10" />
            </div>
            <p className="font-sj-ui text-sm font-semibold uppercase tracking-[0.12em]">Drag, drop, or upload a recipe photo</p>
          </div>
        )}

        {loading && (
          <div
            role="status"
            aria-busy="true"
            className="absolute inset-0 flex items-center justify-center rounded-[1.5rem] bg-[color-mix(in_srgb,var(--sj-panel-solid)_78%,transparent)]"
          >
            <Loader2 className="size-8 animate-spin text-[var(--sj-brass)]" />
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={isDisabled}
        aria-label="Upload recipe image"
        onChange={handleFileChange}
      />

      <div className="flex gap-2">
        {hasImage ? (
          <>
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={isDisabled}
              className={clsx(
                'font-sj-ui inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors',
                'border-[var(--sj-border-strong)] text-[var(--sj-ink)] hover:bg-[var(--sj-flour)]',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <Upload className="size-4" />
              Change Image
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={isDisabled}
              className={clsx(
                'font-sj-ui inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors',
                'border-[var(--sj-tomato)] text-[var(--sj-tomato)] hover:bg-[color-mix(in_srgb,var(--sj-tomato)_10%,transparent)]',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <X className="size-4" />
              Remove
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={isDisabled}
            className={clsx(
              'font-sj-ui inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors',
              'border-[var(--sj-border-strong)] text-[var(--sj-ink)] hover:bg-[var(--sj-flour)]',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <Upload className="size-4" />
            Upload Image
          </button>
        )}
      </div>

      <p className="text-sm text-[var(--sj-ink-soft)]">
        JPG, PNG, GIF, or WebP. Max 5MB.
      </p>

      {error && (
        <p role="alert" className="text-sm text-[var(--sj-tomato)]">
          {error}
        </p>
      )}
    </div>
  )
}
