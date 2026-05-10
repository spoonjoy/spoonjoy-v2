import { useState, useRef, useEffect } from 'react'
import { Bookmark, Plus } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownMenu,
  DropdownDivider,
  DropdownHeader,
} from '../ui/dropdown'

export interface Cookbook {
  id: string
  title: string
}

export interface SaveToCookbookDropdownProps {
  /** User's cookbooks to display */
  cookbooks: Cookbook[]
  /** Cookbooks that already contain this recipe */
  savedInCookbookIds?: Set<string>
  /** Callback when a cookbook is selected */
  onSave: (cookbookId: string) => void
  /** Callback when "Create new cookbook" is selected (legacy navigation) */
  onCreateNew?: () => void
  /** Callback to create a new cookbook and save the recipe to it (inline flow) */
  onCreateAndSave?: (title: string) => void
  /** Whether the dropdown is disabled */
  disabled?: boolean
}

/**
 * A dropdown button for saving a recipe to a cookbook.
 *
 * Features:
 * - Lists user's existing cookbooks
 * - Shows which cookbooks already contain this recipe
 * - Inline create new cookbook flow (when onCreateAndSave provided)
 * - Accessible dropdown menu
 */
export function SaveToCookbookDropdown({
  cookbooks,
  savedInCookbookIds = new Set(),
  onSave,
  onCreateNew,
  onCreateAndSave,
  disabled = false,
}: SaveToCookbookDropdownProps) {
  const cookbooksList = cookbooks ?? []
  const hasCookbooks = cookbooksList.length > 0
  const [isCreating, setIsCreating] = useState(false)
  const [newCookbookTitle, setNewCookbookTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when entering create mode
  useEffect(() => {
    if (isCreating) {
      inputRef.current?.focus()
    }
  }, [isCreating])

  const handleCreateClick = () => {
    if (onCreateAndSave) {
      setIsCreating(true)
    } else {
      onCreateNew?.()
    }
  }

  const handleCreateSubmit = () => {
    const trimmed = newCookbookTitle.trim()
    if (trimmed && onCreateAndSave) {
      onCreateAndSave(trimmed)
      setNewCookbookTitle('')
      setIsCreating(false)
    }
  }

  const handleCreateCancel = () => {
    setNewCookbookTitle('')
    setIsCreating(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      handleCreateSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleCreateCancel()
    }
  }

  // When in create mode, show the inline form instead of the dropdown
  if (isCreating) {
    return (
      <div className="relative" data-testid="inline-create-cookbook">
        <Button
          plain
          disabled
          className="flex items-center gap-1.5"
          aria-label="Save to cookbook"
        >
          <Bookmark className="w-4 h-4" aria-hidden="true" />
          Save
        </Button>
        <div className="sj-panel absolute right-0 top-full z-50 mt-1 w-64 rounded-[1.5rem] p-3">
          <label htmlFor="new-cookbook-input" className="font-sj-ui mb-1 block text-sm font-medium text-[var(--sj-ink-soft)]">
            New cookbook name
          </label>
          <input
            id="new-cookbook-input"
            ref={inputRef}
            type="text"
            value={newCookbookTitle}
            onChange={(e) => setNewCookbookTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Cookbook name"
            aria-label="New cookbook name"
            className="font-sj-ui w-full rounded-full border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-3 py-1.5 text-sm text-[var(--sj-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--sj-brass)]"
          />
          <div className="flex gap-2 mt-2">
            <Button
              className="text-xs px-2 py-1"
              onClick={handleCreateSubmit}
              disabled={!newCookbookTitle.trim()}
            >
              Create
            </Button>
            <Button
              plain
              className="text-xs px-2 py-1"
              onClick={handleCreateCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Dropdown>
      <DropdownButton
        plain
        disabled={disabled}
        className="flex items-center gap-1.5"
        aria-label="Save to cookbook"
      >
        <Bookmark className="w-4 h-4" aria-hidden="true" />
        Save
      </DropdownButton>
      <DropdownMenu anchor="bottom end">
        {hasCookbooks ? (
          <>
            <DropdownHeader className="text-sm font-medium text-[var(--sj-ink-soft)]">
              Save to cookbook
            </DropdownHeader>
            {cookbooksList.map(cookbook => {
              const isSaved = savedInCookbookIds.has(cookbook.id)
              return (
                <DropdownItem
                  key={cookbook.id}
                  onClick={() => !isSaved && onSave(cookbook.id)}
                  disabled={isSaved}
                >
                  <span className={isSaved ? 'text-[var(--sj-ink-soft)] opacity-60' : ''}>
                    {cookbook.title}
                    {isSaved && ' ✓'}
                  </span>
                </DropdownItem>
              )
            })}
            {(onCreateNew || onCreateAndSave) && (
              <>
                <DropdownDivider />
                <DropdownItem onClick={handleCreateClick}>
                  <Plus data-slot="icon" />
                  Create new cookbook
                </DropdownItem>
              </>
            )}
          </>
        ) : (
          <>
            <DropdownHeader className="text-sm text-[var(--sj-ink-soft)]">
              No cookbooks yet
            </DropdownHeader>
            {(onCreateNew || onCreateAndSave) && (
              <DropdownItem onClick={handleCreateClick}>
                <Plus data-slot="icon" />
                Create your first cookbook
              </DropdownItem>
            )}
          </>
        )}
      </DropdownMenu>
    </Dropdown>
  )
}
