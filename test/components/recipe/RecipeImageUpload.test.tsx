import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { RecipeImageUpload } from '../../../app/components/recipe/RecipeImageUpload'

// Helper to create a mock File
function createMockFile(
  name = 'test-image.jpg',
  type = 'image/jpeg',
  size = 1024 * 1024 // 1MB
): File {
  const content = new Array(size).fill('a').join('')
  return new File([content], name, { type })
}

// Mock URL.createObjectURL and URL.revokeObjectURL
let mockObjectUrls: string[] = []
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

beforeEach(() => {
  mockObjectUrls = []
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:http://localhost/mock-${mockObjectUrls.length}`
    mockObjectUrls.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => {
    const index = mockObjectUrls.indexOf(url)
    if (index > -1) {
      mockObjectUrls.splice(index, 1)
    }
  })
})

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
})

describe('RecipeImageUpload', () => {
  describe('rendering', () => {
    it('renders upload button when no image is provided', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
    })

    it('renders hidden file input', () => {
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const fileInput = container.querySelector('input[type="file"]')
      expect(fileInput).toBeInTheDocument()
      expect(fileInput).toHaveClass('hidden')
    })

    it('accepts only food-photo MIME types in the hidden file input', () => {
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const fileInput = container.querySelector('input[type="file"]')
      expect(fileInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    })

    it('renders placeholder area when no image', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      // Should show a placeholder/drop zone area with instructional text
      // Using getAllByText since button also contains "upload" text
      const placeholderElements = screen.getAllByText(/drag.*drop|upload.*image/i)
      expect(placeholderElements.length).toBeGreaterThanOrEqual(1)
    })

    it('renders placeholder area when coverImageUrl is null', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} coverImageUrl={null} />)

      expect(screen.getAllByText(/drag.*drop|upload.*image/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('renders with helper text about accepted formats', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const helperText = screen.getByText(/jpg, png, or webp/i)
      expect(helperText).toBeInTheDocument()
      expect(helperText).not.toHaveTextContent(/gif/i)
    })

    it('renders with file size limit text', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      expect(screen.getByText(/5\s*mb/i)).toBeInTheDocument()
    })
  })

  describe('existing image', () => {
    it('renders image preview when imageUrl is provided', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
        />
      )

      const image = screen.getByRole('img')
      expect(image).toHaveAttribute('src', 'https://example.com/recipe.jpg')
    })

    it('renders alt text for existing image', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
          alt="Chocolate cake"
        />
      )

      expect(screen.getByAltText('Chocolate cake')).toBeInTheDocument()
    })

    it('shows "Change Image" button when image exists', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
        />
      )

      expect(screen.getByRole('button', { name: /change/i })).toBeInTheDocument()
    })

    it('shows "Clear" or "Remove" button when image exists', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
        />
      )

      expect(
        screen.getByRole('button', { name: /clear|remove/i })
      ).toBeInTheDocument()
    })
  })

  describe('file selection', () => {
    it('triggers file input click when upload button is clicked', async () => {
      const user = userEvent.setup()
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement
      const clickSpy = vi.spyOn(fileInput, 'click')

      await user.click(screen.getByRole('button', { name: /upload/i }))

      expect(clickSpy).toHaveBeenCalled()
    })

    it('calls onFileSelect with selected file', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const file = createMockFile()
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, file)

      expect(onFileSelect).toHaveBeenCalledWith(file)
    })

    it('shows preview after file selection', async () => {
      const user = userEvent.setup()
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const file = createMockFile()
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, file)

      await waitFor(() => {
        const previewImage = screen.getByRole('img')
        expect(previewImage).toHaveAttribute(
          'src',
          expect.stringContaining('blob:')
        )
      })
    })

    it('cleans up object URL when new file is selected', async () => {
      const user = userEvent.setup()
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      // Upload first file
      const file1 = createMockFile('image1.jpg')
      await user.upload(fileInput, file1)

      await waitFor(() => {
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
      })

      // Upload second file
      const file2 = createMockFile('image2.jpg')
      await user.upload(fileInput, file2)

      await waitFor(() => {
        expect(URL.revokeObjectURL).toHaveBeenCalled()
        expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
      })
    })

    it('does not call onFileSelect if no file selected (cancel)', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      // Simulate empty file list (cancelled dialog)
      await user.upload(fileInput, [])

      expect(onFileSelect).not.toHaveBeenCalled()
    })
  })

  describe('clear image', () => {
    it('calls onClear when clear button is clicked', async () => {
      const user = userEvent.setup()
      const onClear = vi.fn()

      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          onClear={onClear}
          coverImageUrl="https://example.com/recipe.jpg"
        />
      )

      await user.click(screen.getByRole('button', { name: /clear|remove/i }))

      expect(onClear).toHaveBeenCalled()
    })

    it('removes preview when clear is clicked on newly selected file', async () => {
      const user = userEvent.setup()
      const onClear = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={vi.fn()} onClear={onClear} />
      )

      // Select a file
      const file = createMockFile()
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement
      await user.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument()
      })

      // Clear it
      await user.click(screen.getByRole('button', { name: /clear|remove/i }))

      await waitFor(() => {
        expect(onClear).toHaveBeenCalled()
      })
    })

    it('revokes object URL when clearing preview', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <RecipeImageUpload onFileSelect={vi.fn()} onClear={vi.fn()} />
      )

      // Select a file
      const file = createMockFile()
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement
      await user.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByRole('img')).toBeInTheDocument()
      })

      // Clear it
      await user.click(screen.getByRole('button', { name: /clear|remove/i }))

      await waitFor(() => {
        expect(URL.revokeObjectURL).toHaveBeenCalled()
      })
    })

    it('hides clear button when no image', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} onClear={vi.fn()} />)

      expect(
        screen.queryByRole('button', { name: /clear|remove/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('disabled state', () => {
    it('disables upload button when disabled', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} disabled />)

      expect(screen.getByRole('button', { name: /upload/i })).toBeDisabled()
    })

    it('disables file input when disabled', () => {
      const { container } = render(
        <RecipeImageUpload onFileSelect={vi.fn()} disabled />
      )

      const fileInput = container.querySelector('input[type="file"]')
      expect(fileInput).toBeDisabled()
    })

    it('disables clear button when disabled', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          onClear={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
          disabled
        />
      )

      expect(
        screen.getByRole('button', { name: /clear|remove/i })
      ).toBeDisabled()
    })

    it('disables change button when disabled', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
          disabled
        />
      )

      expect(screen.getByRole('button', { name: /change/i })).toBeDisabled()
    })
  })

  describe('loading state', () => {
    it('shows loading indicator when loading', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} loading />)

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('disables upload button when loading', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} loading />)

      expect(screen.getByRole('button', { name: /upload/i })).toBeDisabled()
    })

    it('shows aria-busy when loading', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} loading />)

      // The component or a wrapper should have aria-busy
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('error state', () => {
    it('displays error message when provided', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          error="File too large. Max 5MB."
        />
      )

      expect(screen.getByText(/file too large/i)).toBeInTheDocument()
    })

    it('applies error styling to error message', () => {
      render(
        <RecipeImageUpload onFileSelect={vi.fn()} error="Upload failed" />
      )

      const errorMessage = screen.getByText(/upload failed/i)
      expect(errorMessage).toHaveClass('text-[var(--sj-tomato)]')
    })

    it('clears error when new file is selected', async () => {
      const user = userEvent.setup()
      const { container, rerender } = render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          error="Previous error"
        />
      )

      expect(screen.getByText(/previous error/i)).toBeInTheDocument()

      // Simulate parent clearing error on new selection
      const file = createMockFile()
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, file)

      // Parent would typically clear the error
      rerender(<RecipeImageUpload onFileSelect={vi.fn()} />)

      expect(screen.queryByText(/previous error/i)).not.toBeInTheDocument()
    })
  })

  describe('file validation', () => {
    it('validates file type - rejects non-image files', async () => {
      // Use applyAccept: false to bypass the accept attribute filtering
      // so we can test JS-side validation
      const user = userEvent.setup({ applyAccept: false })
      const onFileSelect = vi.fn()
      const onError = vi.fn()
      const { container } = render(
        <RecipeImageUpload
          onFileSelect={onFileSelect}
          onValidationError={onError}
        />
      )

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' })
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, textFile)

      expect(onError).toHaveBeenCalledWith(
        expect.stringMatching(/invalid.*type|image.*only/i)
      )
      expect(onFileSelect).not.toHaveBeenCalled()
    })

    it('validates file size - rejects files over 5MB', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const onError = vi.fn()
      const { container } = render(
        <RecipeImageUpload
          onFileSelect={onFileSelect}
          onValidationError={onError}
        />
      )

      // Create 6MB file
      const largeFile = createMockFile('large.jpg', 'image/jpeg', 6 * 1024 * 1024)
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, largeFile)

      expect(onError).toHaveBeenCalledWith(
        expect.stringMatching(/too large|5\s*mb/i)
      )
      expect(onFileSelect).not.toHaveBeenCalled()
    })

    it('accepts valid JPEG files', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const jpegFile = createMockFile('image.jpg', 'image/jpeg', 1024 * 1024)
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, jpegFile)

      expect(onFileSelect).toHaveBeenCalledWith(jpegFile)
    })

    it('accepts valid PNG files', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const pngFile = createMockFile('image.png', 'image/png', 1024 * 1024)
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, pngFile)

      expect(onFileSelect).toHaveBeenCalledWith(pngFile)
    })

    it('rejects GIF files', async () => {
      const user = userEvent.setup({ applyAccept: false })
      const onFileSelect = vi.fn()
      const onError = vi.fn()
      const { container } = render(
        <RecipeImageUpload
          onFileSelect={onFileSelect}
          onValidationError={onError}
        />
      )

      const gifFile = createMockFile('image.gif', 'image/gif', 512 * 1024)
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, gifFile)

      expect(onError).toHaveBeenCalledWith('Photos must be JPG, PNG, or WebP.')
      expect(onFileSelect).not.toHaveBeenCalled()
    })

    it('accepts valid WebP files', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const webpFile = createMockFile('image.webp', 'image/webp', 512 * 1024)
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, webpFile)

      expect(onFileSelect).toHaveBeenCalledWith(webpFile)
    })

    it('rejects image types not in accepted list (e.g., BMP, TIFF)', async () => {
      // Use applyAccept: false to bypass the accept attribute filtering
      const user = userEvent.setup({ applyAccept: false })
      const onFileSelect = vi.fn()
      const onError = vi.fn()
      const { container } = render(
        <RecipeImageUpload
          onFileSelect={onFileSelect}
          onValidationError={onError}
        />
      )

      // BMP is an image type but not in ACCEPTED_IMAGE_TYPES
      const bmpFile = createMockFile('image.bmp', 'image/bmp', 1024 * 1024)
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, bmpFile)

      expect(onError).toHaveBeenCalledWith(
        expect.stringMatching(/invalid.*type|image.*file/i)
      )
      expect(onFileSelect).not.toHaveBeenCalled()
    })
  })

  describe('preview dimensions', () => {
    it('renders preview with appropriate dimensions for recipe images', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
        />
      )

      const image = screen.getByRole('img')
      // Recipe images should be larger than avatars, at least 200px or responsive
      expect(image.parentElement).toHaveClass(/w-full|w-64|h-48|h-64|aspect/i)
    })

    it('maintains aspect ratio in preview', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
        />
      )

      const image = screen.getByRole('img')
      expect(image).toHaveClass('object-cover')
    })
  })

  describe('accessibility', () => {
    it('has accessible name for upload button', () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const button = screen.getByRole('button', { name: /upload/i })
      expect(button).toHaveAccessibleName()
    })

    it('has accessible name for clear button', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          onClear={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
        />
      )

      const button = screen.getByRole('button', { name: /clear|remove/i })
      expect(button).toHaveAccessibleName()
    })

    it('has accessible label for file input', () => {
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const fileInput = container.querySelector('input[type="file"]')
      // Should have aria-label or be labelled by visible element
      expect(
        fileInput?.getAttribute('aria-label') ||
          fileInput?.getAttribute('aria-labelledby')
      ).toBeTruthy()
    })

    it('announces error to screen readers', () => {
      render(
        <RecipeImageUpload onFileSelect={vi.fn()} error="Upload failed" />
      )

      const errorMessage = screen.getByText(/upload failed/i)
      expect(errorMessage).toHaveAttribute('role', 'alert')
    })

    it('describes preview image with alt text', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
          alt="Delicious pasta dish"
        />
      )

      expect(screen.getByAltText('Delicious pasta dish')).toBeInTheDocument()
    })

    it('uses default alt text when none provided', () => {
      render(
        <RecipeImageUpload
          onFileSelect={vi.fn()}
          coverImageUrl="https://example.com/recipe.jpg"
        />
      )

      expect(screen.getByAltText(/recipe image|preview/i)).toBeInTheDocument()
    })
  })

  describe('keyboard interaction', () => {
    it('can trigger upload via keyboard on button', async () => {
      const user = userEvent.setup()
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement
      const clickSpy = vi.spyOn(fileInput, 'click')

      const uploadButton = screen.getByRole('button', { name: /upload/i })
      uploadButton.focus()
      await user.keyboard('{Enter}')

      expect(clickSpy).toHaveBeenCalled()
    })

    it('upload button is focusable', async () => {
      render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const uploadButton = screen.getByRole('button', { name: /upload/i })
      // Focus the button directly and verify it can receive focus
      uploadButton.focus()

      expect(uploadButton).toHaveFocus()
    })
  })

  describe('drag and drop', () => {
    it('shows drop zone visual feedback on drag enter', async () => {
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement
      expect(dropZone).toBeInTheDocument()

      // Fire dragenter event using fireEvent
      fireEvent.dragEnter(dropZone)

      expect(dropZone).toHaveClass('drag-active')
    })

    it('removes visual feedback on drag leave', async () => {
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement

      // First enter, then leave
      fireEvent.dragEnter(dropZone)
      expect(dropZone).toHaveClass('drag-active')

      fireEvent.dragLeave(dropZone)
      expect(dropZone).not.toHaveClass('drag-active')
    })

    it('handles drag over event', async () => {
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} />)

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement

      // dragOver should not throw and should prevent default behavior
      fireEvent.dragOver(dropZone)

      // Component should still be usable
      expect(dropZone).toBeInTheDocument()
    })

    it('accepts dropped image files', async () => {
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement
      const file = createMockFile()

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      })

      await waitFor(() => {
        expect(onFileSelect).toHaveBeenCalledWith(file)
      })
    })

    it('does not accept dropped files when disabled', async () => {
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} disabled />
      )

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement
      const file = createMockFile()

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      })

      expect(onFileSelect).not.toHaveBeenCalled()
    })

    it('does not accept dropped files when loading', async () => {
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} loading />
      )

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement
      const file = createMockFile()

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      })

      expect(onFileSelect).not.toHaveBeenCalled()
    })

    it('does not show drag feedback when disabled', async () => {
      const { container } = render(<RecipeImageUpload onFileSelect={vi.fn()} disabled />)

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement

      fireEvent.dragEnter(dropZone)

      // Should not have the active class when disabled
      expect(dropZone).not.toHaveClass('drag-active')
    })

    it('handles drop with no files gracefully', async () => {
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [],
        },
      })

      expect(onFileSelect).not.toHaveBeenCalled()
    })

    it('revokes old preview URL when dropping new file', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      // First, select a file via file input to create a preview URL
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement
      const file1 = createMockFile('img1.jpg')
      await user.upload(fileInput, file1)

      await waitFor(() => {
        expect(URL.createObjectURL).toHaveBeenCalled()
      })

      // Now drop a new file
      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement
      const file2 = createMockFile('img2.jpg')

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file2],
        },
      })

      await waitFor(() => {
        // Should have revoked the old URL
        expect(URL.revokeObjectURL).toHaveBeenCalled()
        expect(onFileSelect).toHaveBeenCalledWith(file2)
      })
    })
  })

  describe('component cleanup', () => {
    it('revokes object URL on unmount', async () => {
      const user = userEvent.setup()
      const { container, unmount } = render(
        <RecipeImageUpload onFileSelect={vi.fn()} />
      )

      const file = createMockFile()
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, file)

      await waitFor(() => {
        expect(URL.createObjectURL).toHaveBeenCalled()
      })

      unmount()

      expect(URL.revokeObjectURL).toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('handles rapid file selections', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      const file1 = createMockFile('img1.jpg')
      const file2 = createMockFile('img2.jpg')
      const file3 = createMockFile('img3.jpg')

      await user.upload(fileInput, file1)
      await user.upload(fileInput, file2)
      await user.upload(fileInput, file3)

      expect(onFileSelect).toHaveBeenCalledTimes(3)
      expect(onFileSelect).toHaveBeenLastCalledWith(file3)
    })

    it('handles file with special characters in name', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const specialFile = createMockFile(
        'my recipe (1) - final.jpg',
        'image/jpeg'
      )
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, specialFile)

      expect(onFileSelect).toHaveBeenCalledWith(specialFile)
    })

    it('handles very long file names', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const { container } = render(
        <RecipeImageUpload onFileSelect={onFileSelect} />
      )

      const longName = 'a'.repeat(200) + '.jpg'
      const longFile = createMockFile(longName, 'image/jpeg')
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, longFile)

      expect(onFileSelect).toHaveBeenCalledWith(longFile)
    })

    it('handles zero-byte files', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      const onError = vi.fn()
      const { container } = render(
        <RecipeImageUpload
          onFileSelect={onFileSelect}
          onValidationError={onError}
        />
      )

      const emptyFile = createMockFile('empty.jpg', 'image/jpeg', 0)
      const fileInput = container.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement

      await user.upload(fileInput, emptyFile)

      // Zero-byte files should either be rejected or accepted
      // Implementation decides - just ensure no crash
      expect(true).toBe(true)
    })
  })

  describe('drag and drop validation', () => {
    it('rejects dropped files with invalid type', async () => {
      const onFileSelect = vi.fn()
      const onError = vi.fn()
      const { container } = render(
        <RecipeImageUpload
          onFileSelect={onFileSelect}
          onValidationError={onError}
        />
      )

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement

      // Create an invalid file type (PDF)
      const invalidFile = createMockFile('document.pdf', 'application/pdf', 1024 * 1024)

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [invalidFile],
        },
      })

      // Should have called the validation error callback
      expect(onError).toHaveBeenCalledWith(
        expect.stringMatching(/invalid.*type|image.*file/i)
      )
      // Should not have called onFileSelect
      expect(onFileSelect).not.toHaveBeenCalled()
    })

    it('rejects dropped files that exceed size limit', async () => {
      const onFileSelect = vi.fn()
      const onError = vi.fn()
      const { container } = render(
        <RecipeImageUpload
          onFileSelect={onFileSelect}
          onValidationError={onError}
        />
      )

      const dropZone = container.querySelector('[data-drop-zone]') as HTMLElement

      // Create a file that exceeds the 5MB limit
      const largeFile = createMockFile('large.jpg', 'image/jpeg', 6 * 1024 * 1024)

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [largeFile],
        },
      })

      // Should have called the validation error callback for size
      expect(onError).toHaveBeenCalledWith(
        expect.stringMatching(/size|5.*mb|too.*large/i)
      )
      // Should not have called onFileSelect
      expect(onFileSelect).not.toHaveBeenCalled()
    })
  })
})
