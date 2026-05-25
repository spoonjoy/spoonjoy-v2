import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { DockContextProvider, useDockContext, useRecipeDetailActions, useRecipeEditActions, type DockAction } from '~/components/navigation'

let capturedActions: DockAction[] | null = null
function ContextDisplay() {
  const { actions, isContextual } = useDockContext()
  capturedActions = actions
  return <><div data-testid="is-contextual">{isContextual ? 'yes' : 'no'}</div><div data-testid="action-ids">{actions?.map(a => a.id).join(',') ?? ''}</div></>
}

describe('Recipe Page Dock Integration', () => {
  beforeEach(() => {
    capturedActions = null
  })

  it('detail actions for owner: back/cook/list/edit', async () => {
    const onAddToList = vi.fn()
    const onSave = vi.fn()
    const onShare = vi.fn()
    const onCook = vi.fn()

    function P() { useRecipeDetailActions({ recipeId: 'recipe-1', chefId: 'chef-1', isOwner: true, onSave, onAddToList, onShare, onCook }); return null }
    render(<MemoryRouter><DockContextProvider><ContextDisplay /><P /></DockContextProvider></MemoryRouter>)

    expect(screen.getByTestId('action-ids')).toHaveTextContent('recipe-back,cook,add-to-list,edit')

    expect(capturedActions?.find(a => a.id === 'edit')?.onAction).toBe('/recipes/recipe-1/edit')

    const addToListAction = capturedActions?.find(a => a.id === 'add-to-list')?.onAction
    const cookAction = capturedActions?.find(a => a.id === 'cook')?.onAction

    if (typeof addToListAction === 'function') addToListAction()
    if (typeof cookAction === 'function') cookAction()

    expect(onSave).not.toHaveBeenCalled()
    expect(onAddToList).toHaveBeenCalled()
    expect(onShare).not.toHaveBeenCalled()
    expect(onCook).toHaveBeenCalled()
  })

  it('detail actions for non-owner: back/cook/list/save', () => {
    function P() { useRecipeDetailActions({ recipeId: 'recipe-1', chefId: 'chef-1', isOwner: false }); return null }
    render(<MemoryRouter><DockContextProvider><ContextDisplay /><P /></DockContextProvider></MemoryRouter>)

    expect(screen.getByTestId('action-ids')).toHaveTextContent('recipe-back,cook,add-to-list,save')
    expect(capturedActions?.find(a => a.id === 'edit')).toBeUndefined()
    expect(capturedActions?.find(a => a.id === 'recipe-back')?.onAction).toBe('/recipes')
  })

  it('does not thrash dock context when callbacks are recreated across rerenders', () => {
    function P({ tick }: { tick: number }) {
      useRecipeDetailActions({
        recipeId: 'recipe-1',
        chefId: 'chef-1',
        isOwner: true,
        onSave: () => {
          void tick
        },
      })
      return null
    }

    const { rerender } = render(
      <MemoryRouter>
        <DockContextProvider>
          <ContextDisplay />
          <P tick={0} />
        </DockContextProvider>
      </MemoryRouter>
    )

    rerender(
      <MemoryRouter>
        <DockContextProvider>
          <ContextDisplay />
          <P tick={1} />
        </DockContextProvider>
      </MemoryRouter>
    )

    expect(screen.getByTestId('is-contextual')).toHaveTextContent('yes')
    expect(screen.getByTestId('action-ids')).toHaveTextContent('recipe-back,cook,add-to-list,edit')
  })

  it('detail actions use no-op fallbacks', () => {
    function P() { useRecipeDetailActions({ recipeId: 'recipe-1', chefId: 'chef-1', isOwner: false }); return null }
    render(<MemoryRouter><DockContextProvider><ContextDisplay /><P /></DockContextProvider></MemoryRouter>)

    expect(() => {
      const action = capturedActions?.find(a => a.id === 'save')?.onAction
      if (typeof action === 'function') action()
    }).not.toThrow()
    expect(() => {
      const action = capturedActions?.find(a => a.id === 'add-to-list')?.onAction
      if (typeof action === 'function') action()
    }).not.toThrow()
    expect(() => {
      const action = capturedActions?.find(a => a.id === 'cook')?.onAction
      if (typeof action === 'function') action()
    }).not.toThrow()
  })

  it('edit page actions: cancel/save', () => {
    function P() { useRecipeEditActions({ recipeId: 'recipe-1' }); return null }
    render(<MemoryRouter><DockContextProvider><ContextDisplay /><P /></DockContextProvider></MemoryRouter>)
    expect(screen.getByTestId('action-ids')).toHaveTextContent('cancel,save')
  })
})
