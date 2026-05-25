import { useMemo } from "react";
import { ArrowLeft, Bookmark, Check, Edit, Save, Search, ShoppingBag, X } from "lucide-react";
import { useDockConfig, type DockConfig } from "./dock-context";

export interface UseRecipeDetailActionsOptions {
  recipeId: string;
  chefId: string;
  chefProfileHref?: string;
  isOwner: boolean;
  isInShoppingList?: boolean;
  onSave?: () => void;
  onAddToList?: () => void;
  onShare?: () => void;
  onCook?: () => void;
}

function AddedListIcon({ className }: { className?: string }) {
  return (
    <span className="relative">
      <ShoppingBag className={className} />
      <Check className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-[var(--sj-on-photo)] p-[1px] text-[var(--sj-charcoal)]" />
    </span>
  );
}

export function useRecipeDetailActions({
  recipeId,
  isOwner,
  isInShoppingList = false,
  onSave,
  onAddToList,
  onShare,
  onCook,
}: UseRecipeDetailActionsOptions): void {
  const config = useMemo<DockConfig>(() => {
    const listAction = {
      id: "add-to-list",
      icon: isInShoppingList ? AddedListIcon : ShoppingBag,
      label: "List",
      ariaLabel: isInShoppingList ? "Ingredients already in shopping list" : "Add ingredients to shopping list",
      onAction: onAddToList || (() => {}),
    };

    const saveAction = {
      id: "save",
      icon: Bookmark,
      label: "Save",
      onAction: onSave || (() => {}),
    };

    const editAction = {
      id: "edit",
      icon: Edit,
      label: "Edit",
      onAction: `/recipes/${recipeId}/edit`,
    };

    return {
      variant: "context",
      left: {
        id: "recipe-back",
        icon: ArrowLeft,
        label: "Back",
        sublabel: "recipes",
        onAction: "/recipes",
      },
      primary: {
        id: "cook",
        icon: Check,
        label: "Cook",
        onAction: onCook || (() => {}),
      },
      tools: isOwner ? [listAction, editAction] : [listAction, saveAction],
    };
  }, [recipeId, isOwner, isInShoppingList, onSave, onAddToList, onShare, onCook]);

  useDockConfig(config);
}

export interface UseRecipeEditActionsOptions {
  recipeId: string;
  onSave?: () => void;
}

export function useRecipeEditActions({
  recipeId,
  onSave,
}: UseRecipeEditActionsOptions): void {
  const config = useMemo<DockConfig>(() => ({
    variant: "task",
    left: {
      id: "cancel",
      icon: X,
      label: "Cancel",
      sublabel: "recipe",
      onAction: `/recipes/${recipeId}`,
    },
    primary: {
      id: "save",
      icon: Save,
      label: "Save",
      onAction: onSave || (() => {}),
    },
    tools: [
      {
        id: "search",
        icon: Search,
        label: "Search",
        onAction: "/search",
      },
    ],
  }), [recipeId, onSave]);

  useDockConfig(config);
}
