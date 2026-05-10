'use client'

import { useMemo } from 'react'
import { Edit, ShoppingCart, Share, X, Save, Bookmark, User, Check } from 'lucide-react'
import { useDockActions, type DockAction } from './dock-context'

export interface UseRecipeDetailActionsOptions {
  recipeId: string
  chefId: string
  chefProfileHref?: string
  isOwner: boolean
  isInShoppingList?: boolean
  onSave?: () => void
  onAddToList?: () => void
  onShare?: () => void
}

function AddedListIcon({ className }: { className?: string }) {
  return (
    <span className="relative">
      <ShoppingCart className={className} />
      <Check className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-black/65 p-[1px] text-white/85" />
    </span>
  )
}

export function useRecipeDetailActions({
  recipeId,
  chefId,
  chefProfileHref,
  isOwner,
  isInShoppingList = false,
  onSave,
  onAddToList,
  onShare,
}: UseRecipeDetailActionsOptions): void {
  const actions = useMemo<DockAction[]>(() => {
    const listAction: DockAction = {
      id: 'add-to-list',
      icon: isInShoppingList ? AddedListIcon : ShoppingCart,
      label: 'List',
      iconClassName: isInShoppingList ? 'fill-white/70 text-white/70' : undefined,
      labelClassName: isInShoppingList ? 'text-white/40 tracking-[0.14em]' : undefined,
      onAction: onAddToList || (() => {}),
      position: 'left',
    }

    const leftActions: DockAction[] = isOwner
      ? [
          {
            id: 'edit',
            icon: Edit,
            label: 'Edit',
            onAction: `/recipes/${recipeId}/edit`,
            position: 'left',
          },
          listAction,
        ]
      : [
          {
            id: 'view-chef-profile',
            icon: User,
            label: 'View Chef Profile',
            onAction: chefProfileHref ?? `/users/${chefId}`,
            position: 'left',
          },
          listAction,
        ]

    return [
      ...leftActions,
      {
        id: 'save',
        icon: Bookmark,
        label: 'Save',
        onAction: onSave || (() => {}),
        position: 'right',
      },
      {
        id: 'share',
        icon: Share,
        label: 'Share',
        onAction: onShare || (() => {}),
        position: 'right',
      },
    ]
  }, [recipeId, chefId, chefProfileHref, isOwner, isInShoppingList, onSave, onAddToList, onShare])

  useDockActions(actions)
}

export interface UseRecipeEditActionsOptions {
  recipeId: string
  onSave?: () => void
}

export function useRecipeEditActions({
  recipeId,
  onSave,
}: UseRecipeEditActionsOptions): void {
  const actions = useMemo<DockAction[]>(() => [
    {
      id: 'cancel',
      icon: X,
      label: 'Cancel',
      onAction: `/recipes/${recipeId}`,
      position: 'left',
    },
    {
      id: 'save',
      icon: Save,
      label: 'Save',
      onAction: onSave || (() => {}),
      position: 'right',
    },
  ], [recipeId, onSave])

  useDockActions(actions)
}
