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
    function RecipeDetailPage({ recipeId, chefId, chefProfileHref, isOwner, isInShoppingList, onSave, onAddToList, onShare, onCook }: {
      recipeId: string
      chefId: string
      chefProfileHref?: string
      isOwner: boolean
      isInShoppingList?: boolean
      onSave?: () => void
      onAddToList?: () => void
      onShare?: () => void
      onCook?: () => void
    }) {
      useRecipeDetailActions({ recipeId, chefId, chefProfileHref, isOwner, isInShoppingList, onSave, onAddToList, onShare, onCook })
      return <div data-testid="recipe-detail">Recipe Detail</div>
    }

    it('owner layout is Back/Cook with List/Edit tools', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} /></DockContextProvider></MemoryRouter>)
      expect(screen.getByTestId('action-count')).toHaveTextContent('4')
      expect(screen.getByTestId('action-ids')).toHaveTextContent('recipe-back,cook,add-to-list,edit')
      expect(screen.getByTestId('action-labels')).toHaveTextContent('Back,Cook,List,Edit')

      const left = capturedActions?.filter(a => a.position === 'left').map(a => a.id)
      const right = capturedActions?.filter(a => a.position === 'right').map(a => a.id)
      expect(left).toEqual(['recipe-back'])
      expect(right).toEqual(['cook', 'add-to-list', 'edit'])
    })

    it('non-owner layout is Back/Cook with List/Save tools', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={false} /></DockContextProvider></MemoryRouter>)
      expect(screen.getByTestId('action-count')).toHaveTextContent('4')
      expect(screen.getByTestId('action-ids')).toHaveTextContent('recipe-back,cook,add-to-list,save')
      expect(screen.getByTestId('action-labels')).toHaveTextContent('Back,Cook,List,Save')
      expect(capturedActions?.find(a => a.id === 'edit')).toBeUndefined()
      expect(capturedActions?.find(a => a.id === 'recipe-back')?.onAction).toBe('/recipes')
    })

    it('keeps chef profile navigation out of the dock when a canonical href is provided', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" chefProfileHref="/users/chef-rowan" isOwner={false} /></DockContextProvider></MemoryRouter>)
      expect(capturedActions?.find(a => a.id === 'view-chef-profile')).toBeUndefined()
      expect(capturedActions?.find(a => a.id === 'recipe-back')?.onAction).toBe('/recipes')
    })

    it('uses added state icon styling while keeping action tappable', () => {
      const onAddToList = vi.fn()
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} isInShoppingList={true} onAddToList={onAddToList} /></DockContextProvider></MemoryRouter>)
      const addToList = capturedActions?.find(a => a.id === 'add-to-list')
      expect(addToList?.label).toBe('List')
      expect(addToList?.ariaLabel).toBe('Ingredients already in shopping list')
      expect(addToList?.icon).not.toBeUndefined()

      addToList?.onAction?.()
      expect(onAddToList).toHaveBeenCalledOnce()
    })

    it('labels the shopping-list action by intent before ingredients are added', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} isInShoppingList={false} /></DockContextProvider></MemoryRouter>)
      expect(capturedActions?.find(a => a.id === 'add-to-list')?.ariaLabel).toBe('Add ingredients to shopping list')
    })

    it('uses the real cook-mode handler when one is provided', () => {
      const onCook = vi.fn()
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} onCook={onCook} /></DockContextProvider></MemoryRouter>)

      capturedActions?.find(a => a.id === 'cook')?.onAction?.()

      expect(onCook).toHaveBeenCalledOnce()
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

    it('owner edit action uses direct route and available handlers execute', async () => {
      const onSave = vi.fn(); const onAddToList = vi.fn(); const onShare = vi.fn()
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={true} onSave={onSave} onAddToList={onAddToList} onShare={onShare} /></DockContextProvider></MemoryRouter>)

      const edit = capturedActions?.find(a => a.id === 'edit')
      expect(edit?.onAction).toBe('/recipes/123/edit')

      capturedActions?.find(a => a.id === 'add-to-list')?.onAction?.()

      expect(onSave).not.toHaveBeenCalled()
      expect(onAddToList).toHaveBeenCalled()
      expect(onShare).not.toHaveBeenCalled()
    })

    it('uses no-op fallbacks', () => {
      render(<MemoryRouter><DockContextProvider><ContextDisplay /><RecipeDetailPage recipeId="123" chefId="chef-1" isOwner={false} /></DockContextProvider></MemoryRouter>)
      expect(() => capturedActions?.find(a => a.id === 'save')?.onAction?.()).not.toThrow()
      expect(() => capturedActions?.find(a => a.id === 'add-to-list')?.onAction?.()).not.toThrow()
      expect(() => capturedActions?.find(a => a.id === 'cook')?.onAction?.()).not.toThrow()
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
