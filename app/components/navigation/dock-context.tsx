import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
  type ElementType,
} from 'react'

/**
 * DockContext - Context provider for contextual dock navigation
 * 
 * Allows pages to register custom actions that replace the default
 * navigation items in the dock. When a page unmounts, the dock
 * automatically returns to default navigation.
 * 
 * ## Usage
 * 
 * ```tsx
 * // In root layout
 * <DockContextProvider>
 *   <App />
 * </DockContextProvider>
 * 
 * // In a page component
 * function RecipeDetailPage() {
 *   useDockActions([
 *     { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
 *     { id: 'edit', icon: Edit, label: 'Edit', onAction: handleEdit, position: 'right' },
 *   ])
 *   return <div>...</div>
 * }
 * ```
 */

/** Action definition for contextual dock items */
export interface DockAction {
  /** Unique identifier for the action */
  id: string
  /** Lucide icon component */
  icon: ElementType
  /** Label text */
  label: string
  /** Optional icon class overrides */
  iconClassName?: string
  /** Optional label class overrides */
  labelClassName?: string
  /** Action handler or route href */
  onAction: (() => void) | string
  /** Position in dock (left of center or right of center) */
  position: 'left' | 'right'
}

/** Context value type */
export interface DockContextValue {
  /** Current contextual actions (null = use default nav) */
  actions: DockAction[] | null
  /** Register contextual actions */
  setActions: (actions: DockAction[] | null) => void
  /** Whether the dock is in contextual mode */
  isContextual: boolean
}

/** Default context value */
const defaultValue: DockContextValue = {
  actions: null,
  setActions: () => {},
  isContextual: false,
}

/** The React context */
export const DockContext = createContext<DockContextValue>(defaultValue)

/** Provider props */
export interface DockContextProviderProps {
  children: ReactNode
}

/**
 * Provider component that manages contextual dock state
 */
export function DockContextProvider({ children }: DockContextProviderProps) {
  const [actions, setActionsState] = useState<DockAction[] | null>(null)

  const setActions = useCallback((newActions: DockAction[] | null) => {
    setActionsState(newActions)
  }, [])

  const isContextual = actions !== null

  const value = useMemo<DockContextValue>(
    () => ({
      actions,
      setActions,
      isContextual,
    }),
    [actions, setActions, isContextual]
  )

  return (
    <DockContext.Provider value={value}>
      {children}
    </DockContext.Provider>
  )
}

/**
 * Hook to access dock context
 * @returns The dock context value
 */
export function useDockContext(): DockContextValue {
  const context = useContext(DockContext)
  return context
}

/**
 * Hook to register contextual actions (for pages)
 * 
 * Automatically registers actions on mount and clears them on unmount.
 * Updates actions if the actions prop changes.
 * 
 * Uses a stable string key (derived from action ids) to prevent infinite
 * re-render loops when action callbacks change reference but content is the same.
 * 
 * @param actions - Array of dock actions to register, or null to use default
 */
export function useDockActions(actions: DockAction[] | null): void {
  const { setActions } = useDockContext()

  // Only update registered actions when their identity key actually changes.
  // This avoids effect churn and potential update loops from unstable callback refs.
  const actionsKey = actions ? actions.map((action) => action.id).join(',') : ''

  useEffect(() => {
    setActions(actions)
  }, [actionsKey, setActions])

  // Clear actions only when the registering component unmounts.
  useEffect(() => {
    return () => {
      setActions(null)
    }
  }, [setActions])
}
