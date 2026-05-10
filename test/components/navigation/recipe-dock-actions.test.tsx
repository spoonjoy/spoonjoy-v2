import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import {
  DockContextProvider,
  useDockContext,
  useRecipeDetailActions,
  useRecipeEditActions,
  type DockAction,
} from '~/components/navigation'

let capturedActions: DockAction[] | null = null

function ContextDisplay() {
  const { actions, isContextual } = useDockContext()
  capturedActions = actions
  return (
    <div>
      <div data-testid="is-contextual">{isContextual ? 'yes' : 'no'}</div>
      <div data-testid="action-count">{actions?.length ?? 0}</div>
      <div data-testid="action-ids">{actions?.map(a => a.id).join(',') ?? ''}</div>
      <div data-testid="action-labels">{actions?.map(a => a.label).join(',') ?? ''}</div>
    </div>
  )
}

describe('Recipe Dock Actions', () => {
  beforeEach(() => {
    capturedActions = null
  })

  describe('useRecipeDetailActions', () => {
    function RecipeDetailPage({ recipeId, chefId, chefProfileHref, isOwner, isInShoppingList, onSave, onAddToList, onShare }: {
      recipeId: string
      chefId: string
      chefProfileHref?: string
      isOwner: boolean
      isInShoppingList?: boolean
      onSave?: () => void
      onAddToList?: () => void
      onShare?: () => void
    }) {
      useRecipeDetailActions({ recipeId, chefId, chefProfileHref, isOwner, isInShoppingList, onSave, onAddToList, onShare })
      return <div data-testid="recipe-detail">Recipe Detail</div>
    }

    it('owner layout is Edit/List left and Save/Share right', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} /></DockContextProvider></MemoryRouter>)
      expect(screen.getByTestId('action-count')).toHaveTextContent('4')
      expect(screen.getByTestId('action-ids')).toHaveTextContent('edit,add-to-list,save,share')
      expect(screen.getByTestId('action-labels')).toHaveTextContent('Edit,List,Save,Share')

      const left = capturedActions?.filter(a => a.position === 'left').map(a => a.id)
      const right = capturedActions?.filter(a => a.position === 'right').map(a => a.id)
      expect(left).toEqual(['edit', 'add-to-list'])
      expect(right).toEqual(['save', 'share'])
    })

    it('non-owner layout is View Chef Profile/List left and Save/Share right', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={false} /></DockContextProvider></MemoryRouter>)
      expect(screen.getByTestId('action-count')).toHaveTextContent('4')
      expect(screen.getByTestId('action-ids')).toHaveTextContent('view-chef-profile,add-to-list,save,share')
      expect(screen.getByTestId('action-labels')).toHaveTextContent('View Chef Profile,List,Save,Share')
      expect(capturedActions?.find(a => a.id === 'edit')).toBeUndefined()
      expect(capturedActions?.find(a => a.id === 'view-chef-profile')?.onAction).toBe('/users/chef-1')
    })

    it('uses canonical chef profile href when provided', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" chefProfileHref="/users/chef-rowan" isOwner={false} /></DockContextProvider></MemoryRouter>)
      expect(capturedActions?.find(a => a.id === 'view-chef-profile')?.onAction).toBe('/users/chef-rowan')
    })

    it('uses added state icon styling while keeping action tappable', () => {
      const onAddToList = vi.fn()
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} isInShoppingList={true} onAddToList={onAddToList} /></DockContextProvider></MemoryRouter>)
      const addToList = capturedActions?.find(a => a.id === 'add-to-list')
      expect(addToList?.label).toBe('List')
      expect(addToList?.iconClassName).toContain('fill-white/70')
      expect(addToList?.labelClassName).toContain('text-white/40')
      expect(addToList?.icon).not.toBeUndefined()

      addToList?.onAction?.()
      expect(onAddToList).toHaveBeenCalledOnce()
    })

    it('renders the added-to-list icon badge component', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} isInShoppingList={true} /></DockContextProvider></MemoryRouter>)
      const AddedIcon = capturedActions?.find(a => a.id === 'add-to-list')?.icon

      expect(AddedIcon).toBeDefined()
      const { container } = render(AddedIcon ? <AddedIcon className="test-icon" /> : null)

      expect(container.querySelector('span.relative')).toBeInTheDocument()
      expect(container.querySelectorAll('svg')).toHaveLength(2)
      expect(container.querySelector('svg.test-icon')).toBeInTheDocument()
    })

    it('owner edit action uses direct route and shared handlers execute', async () => {
      const onSave = vi.fn(); const onAddToList = vi.fn(); const onShare = vi.fn()
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} onSave={onSave} onAddToList={onAddToList} onShare={onShare} /></DockContextProvider></MemoryRouter>)

      const edit = capturedActions?.find(a => a.id === 'edit')
      expect(edit?.onAction).toBe('/recipes/123/edit')

      capturedActions?.find(a => a.id === 'save')?.onAction?.()
      capturedActions?.find(a => a.id === 'add-to-list')?.onAction?.()
      capturedActions?.find(a => a.id === 'share')?.onAction?.()

      expect(onSave).toHaveBeenCalled()
      expect(onAddToList).toHaveBeenCalled()
      expect(onShare).toHaveBeenCalled()
    })

    it('uses no-op fallbacks', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={false} /></DockContextProvider></MemoryRouter>)
      expect(() => capturedActions?.find(a => a.id === 'save')?.onAction?.()).not.toThrow()
      expect(() => capturedActions?.find(a => a.id === 'add-to-list')?.onAction?.()).not.toThrow()
      expect(() => capturedActions?.find(a => a.id === 'share')?.onAction?.()).not.toThrow()
    })
  })

  describe('useRecipeEditActions', () => {
    function RecipeEditPage({ recipeId, onSave }: { recipeId: string; onSave?: () => void }) {
      useRecipeEditActions({ recipeId, onSave })
      return <div data-testid="recipe-edit">Recipe Edit</div>
    }

    it('registers Cancel and Save', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeEditPage recipeId="456" /></DockContextProvider></MemoryRouter>)
      expect(screen.getByTestId('action-ids')).toHaveTextContent('cancel,save')
      expect(capturedActions?.find(a => a.id === 'cancel')?.onAction).toBe('/recipes/456')
    })

    it('uses a no-op save fallback when no edit save handler is provided', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeEditPage recipeId="456" /></DockContextProvider></MemoryRouter>)

      expect(() => capturedActions?.find(a => a.id === 'save')?.onAction?.()).not.toThrow()
    })
  })
})
