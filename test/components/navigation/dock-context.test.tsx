import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import {
  configFromActions,
  DockContextProvider,
  useDockContext,
  useDockActions,
  useDockConfig,
  type DockAction,
} from '~/components/navigation/dock-context'
import { ArrowLeft, Edit, Share, ShoppingCart } from 'lucide-react'

// Sample contextual actions for testing
const sampleActions: DockAction[] = [
  { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
  { id: 'edit', icon: Edit, label: 'Edit', onAction: vi.fn(), position: 'left' },
  { id: 'add-to-list', icon: ShoppingCart, label: 'Add to List', onAction: vi.fn(), position: 'right' },
  { id: 'share', icon: Share, label: 'Share', onAction: vi.fn(), position: 'right' },
]

describe('DockContext', () => {
  describe('DockContextProvider', () => {
    it('renders children', () => {
      render(
        <DockContextProvider>
          <div data-testid="child">Child content</div>
        </DockContextProvider>
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('provides context to children', () => {
      function TestComponent() {
        const context = useDockContext()
        return <div data-testid="context-check">{context ? 'has context' : 'no context'}</div>
      }

      render(
        <DockContextProvider>
          <TestComponent />
        </DockContextProvider>
      )

      expect(screen.getByTestId('context-check')).toHaveTextContent('has context')
    })
  })

  describe('useDockContext', () => {
    it('returns default values when not in provider', () => {
      const { result } = renderHook(() => useDockContext())

      expect(result.current.actions).toBeNull()
      expect(result.current.isContextual).toBe(false)
      expect(typeof result.current.setActions).toBe('function')
    })

    it('default setActions is a no-op function (function coverage)', () => {
      // This test covers the default setActions: () => {} function in defaultValue
      const { result } = renderHook(() => useDockContext())

      // The default setActions should be callable but do nothing
      expect(() => {
        result.current.setActions(sampleActions)
      }).not.toThrow()

      // Since we're not in a provider, actions should still be null
      expect(result.current.actions).toBeNull()
    })

    it('returns context value when in provider', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DockContextProvider>{children}</DockContextProvider>
      )

      const { result } = renderHook(() => useDockContext(), { wrapper })

      expect(result.current.actions).toBeNull()
      expect(result.current.isContextual).toBe(false)
      expect(typeof result.current.setActions).toBe('function')
    })

    it('setActions updates the actions', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DockContextProvider>{children}</DockContextProvider>
      )

      const { result } = renderHook(() => useDockContext(), { wrapper })

      act(() => {
        result.current.setActions(sampleActions)
      })

      expect(result.current.actions).toEqual(sampleActions)
      expect(result.current.isContextual).toBe(true)
    })

    it('setActions(null) clears contextual mode', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DockContextProvider>{children}</DockContextProvider>
      )

      const { result } = renderHook(() => useDockContext(), { wrapper })

      // Set actions first
      act(() => {
        result.current.setActions(sampleActions)
      })
      expect(result.current.isContextual).toBe(true)

      // Clear actions
      act(() => {
        result.current.setActions(null)
      })
      expect(result.current.actions).toBeNull()
      expect(result.current.isContextual).toBe(false)
    })
  })

  describe('useDockActions', () => {
    it('converts legacy side actions into a dock config with fallback slots', () => {
      const onlyLeftActions: DockAction[] = [
        { id: 'cancel', icon: ArrowLeft, label: 'Cancel', onAction: '/recipes', position: 'left' },
        { id: 'save', icon: Edit, label: 'Save', onAction: vi.fn(), position: 'left' },
      ]
      const singleLeftAction: DockAction[] = [
        { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
      ]
      const onlyRightActions: DockAction[] = [
        { id: 'edit', icon: Edit, label: 'Edit', onAction: vi.fn(), position: 'right' },
        { id: 'share', icon: Share, label: 'Share', onAction: vi.fn(), position: 'right' },
      ]

      expect(configFromActions(null)).toBeNull()
      expect(configFromActions([])).toBeNull()
      expect(configFromActions(onlyLeftActions)).toMatchObject({
        left: { id: 'cancel', sublabel: 'back' },
        primary: { id: 'save' },
        tools: [],
        variant: 'context',
      })
      expect(configFromActions(singleLeftAction)).toMatchObject({
        left: { id: 'back', sublabel: 'back' },
        primary: { id: 'back' },
        tools: [],
        variant: 'context',
      })
      expect(configFromActions(onlyRightActions)).toMatchObject({
        left: { id: 'edit', sublabel: 'back' },
        primary: { id: 'edit' },
        tools: [{ id: 'share' }],
        variant: 'context',
      })
    })

    it('registers explicit dock config and mirrors it into legacy actions', () => {
      function TestPage({ mode }: { mode: 'task' | 'plain' | 'clear' }) {
        const config = mode === 'clear'
          ? null
          : {
              variant: mode === 'task' ? 'task' as const : undefined,
              left: { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes' },
              primary: { id: 'save', icon: Edit, label: 'Save', onAction: vi.fn() },
              tools: mode === 'task' ? [{ id: 'share', icon: Share, label: 'Share', onAction: vi.fn() }] : [],
            }
        useDockConfig(config)
        return <div>Configured Page</div>
      }

      function TestApp({ mode }: { mode: 'task' | 'plain' | 'clear' }) {
        const context = useDockContext()
        return (
          <>
            <div data-testid="config-variant">{context.config?.variant ?? 'none'}</div>
            <div data-testid="legacy-action-count">{context.actions?.length ?? 0}</div>
            <TestPage mode={mode} />
          </>
        )
      }

      const { rerender } = render(
        <DockContextProvider>
          <TestApp mode="task" />
        </DockContextProvider>
      )

      expect(screen.getByTestId('config-variant')).toHaveTextContent('task')
      expect(screen.getByTestId('legacy-action-count')).toHaveTextContent('3')

      rerender(
        <DockContextProvider>
          <TestApp mode="plain" />
        </DockContextProvider>
      )
      expect(screen.getByTestId('config-variant')).toHaveTextContent('none')
      expect(screen.getByTestId('legacy-action-count')).toHaveTextContent('2')

      rerender(
        <DockContextProvider>
          <TestApp mode="clear" />
        </DockContextProvider>
      )
      expect(screen.getByTestId('config-variant')).toHaveTextContent('none')
      expect(screen.getByTestId('legacy-action-count')).toHaveTextContent('0')
    })

    it('registers actions when component mounts', () => {
      function TestPage() {
        useDockActions(sampleActions)
        return <div data-testid="page">Test Page</div>
      }

      function TestApp() {
        const context = useDockContext()
        return (
          <>
            <div data-testid="is-contextual">{context.isContextual ? 'yes' : 'no'}</div>
            <TestPage />
          </>
        )
      }

      render(
        <DockContextProvider>
          <TestApp />
        </DockContextProvider>
      )

      expect(screen.getByTestId('is-contextual')).toHaveTextContent('yes')
    })

    it('clears actions when component unmounts', () => {
      function TestPage() {
        useDockActions(sampleActions)
        return <div>Test Page</div>
      }

      function TestApp({ showPage }: { showPage: boolean }) {
        const context = useDockContext()
        return (
          <>
            <div data-testid="is-contextual">{context.isContextual ? 'yes' : 'no'}</div>
            {showPage && <TestPage />}
          </>
        )
      }

      const { rerender } = render(
        <DockContextProvider>
          <TestApp showPage={true} />
        </DockContextProvider>
      )

      expect(screen.getByTestId('is-contextual')).toHaveTextContent('yes')

      // Unmount the page
      rerender(
        <DockContextProvider>
          <TestApp showPage={false} />
        </DockContextProvider>
      )

      expect(screen.getByTestId('is-contextual')).toHaveTextContent('no')
    })

    it('updates actions when actions prop changes', () => {
      const newActions: DockAction[] = [
        { id: 'cancel', icon: ArrowLeft, label: 'Cancel', onAction: vi.fn(), position: 'left' },
        { id: 'save', icon: Edit, label: 'Save', onAction: vi.fn(), position: 'right' },
      ]

      function TestPage({ actions }: { actions: DockAction[] }) {
        useDockActions(actions)
        return <div>Test Page</div>
      }

      function TestApp({ actions }: { actions: DockAction[] }) {
        const context = useDockContext()
        return (
          <>
            <div data-testid="action-count">{context.actions?.length ?? 0}</div>
            <TestPage actions={actions} />
          </>
        )
      }

      const { rerender } = render(
        <DockContextProvider>
          <TestApp actions={sampleActions} />
        </DockContextProvider>
      )

      expect(screen.getByTestId('action-count')).toHaveTextContent('4')

      // Change actions
      rerender(
        <DockContextProvider>
          <TestApp actions={newActions} />
        </DockContextProvider>
      )

      expect(screen.getByTestId('action-count')).toHaveTextContent('2')
    })

    it('accepts null actions to keep the dock in default mode', () => {
      function TestPage() {
        useDockActions(null)
        return <div>Default Dock Page</div>
      }

      function TestApp() {
        const context = useDockContext()
        return (
          <>
            <div data-testid="action-count">{context.actions?.length ?? 0}</div>
            <div data-testid="is-contextual">{context.isContextual ? 'yes' : 'no'}</div>
            <TestPage />
          </>
        )
      }

      render(
        <DockContextProvider>
          <TestApp />
        </DockContextProvider>
      )

      expect(screen.getByTestId('action-count')).toHaveTextContent('0')
      expect(screen.getByTestId('is-contextual')).toHaveTextContent('no')
    })
  })

  describe('DockAction type', () => {
    it('supports function onAction', () => {
      const mockFn = vi.fn()
      const action: DockAction = {
        id: 'test',
        icon: Edit,
        label: 'Test',
        onAction: mockFn,
        position: 'left',
      }

      expect(typeof action.onAction).toBe('function')
      if (typeof action.onAction === 'function') {
        action.onAction()
        expect(mockFn).toHaveBeenCalled()
      }
    })

    it('supports string (href) onAction', () => {
      const action: DockAction = {
        id: 'test',
        icon: Edit,
        label: 'Test',
        onAction: '/some/route',
        position: 'right',
      }

      expect(typeof action.onAction).toBe('string')
      expect(action.onAction).toBe('/some/route')
    })
  })

  describe('Root layout integration', () => {
    it('DockContextProvider provides default context value (no actions)', () => {
      function ContextChecker() {
        const context = useDockContext()
        return (
          <div>
            <span data-testid="actions">{context.actions === null ? 'null' : 'has-actions'}</span>
            <span data-testid="contextual">{context.isContextual ? 'true' : 'false'}</span>
          </div>
        )
      }

      render(
        <DockContextProvider>
          <ContextChecker />
        </DockContextProvider>
      )

      expect(screen.getByTestId('actions')).toHaveTextContent('null')
      expect(screen.getByTestId('contextual')).toHaveTextContent('false')
    })

    it('context is accessible from deeply nested child components', () => {
      function DeepChild() {
        const context = useDockContext()
        return <div data-testid="deep-child">{context.isContextual ? 'contextual' : 'default'}</div>
      }

      function MiddleLevel({ children }: { children: React.ReactNode }) {
        return <div className="middle">{children}</div>
      }

      function Layout({ children }: { children: React.ReactNode }) {
        return <div className="layout">{children}</div>
      }

      render(
        <DockContextProvider>
          <Layout>
            <MiddleLevel>
              <MiddleLevel>
                <DeepChild />
              </MiddleLevel>
            </MiddleLevel>
          </Layout>
        </DockContextProvider>
      )

      expect(screen.getByTestId('deep-child')).toHaveTextContent('default')
    })

    it('setActions updates context state across the tree', () => {
      function ActionSetter() {
        const { setActions } = useDockContext()
        return (
          <button
            data-testid="set-actions-btn"
            onClick={() => setActions(sampleActions)}
          >
            Set Actions
          </button>
        )
      }

      function ActionDisplay() {
        const { actions, isContextual } = useDockContext()
        return (
          <div>
            <span data-testid="action-count">{actions?.length ?? 0}</span>
            <span data-testid="is-contextual">{isContextual ? 'yes' : 'no'}</span>
          </div>
        )
      }

      render(
        <DockContextProvider>
          <ActionSetter />
          <ActionDisplay />
        </DockContextProvider>
      )

      // Initial state
      expect(screen.getByTestId('action-count')).toHaveTextContent('0')
      expect(screen.getByTestId('is-contextual')).toHaveTextContent('no')

      // Update actions
      act(() => {
        screen.getByTestId('set-actions-btn').click()
      })

      // State should be updated
      expect(screen.getByTestId('action-count')).toHaveTextContent('4')
      expect(screen.getByTestId('is-contextual')).toHaveTextContent('yes')
    })

    it('multiple consumers receive same state', () => {
      function Consumer({ id }: { id: string }) {
        const { actions, isContextual } = useDockContext()
        return (
          <div data-testid={`consumer-${id}`}>
            <span data-testid={`${id}-count`}>{actions?.length ?? 0}</span>
            <span data-testid={`${id}-contextual`}>{isContextual ? 'yes' : 'no'}</span>
          </div>
        )
      }

      function ActionUpdater() {
        const { setActions } = useDockContext()
        return (
          <button
            data-testid="update-btn"
            onClick={() => setActions(sampleActions)}
          >
            Update
          </button>
        )
      }

      render(
        <DockContextProvider>
          <Consumer id="a" />
          <Consumer id="b" />
          <Consumer id="c" />
          <ActionUpdater />
        </DockContextProvider>
      )

      // All consumers start with default state
      expect(screen.getByTestId('a-count')).toHaveTextContent('0')
      expect(screen.getByTestId('b-count')).toHaveTextContent('0')
      expect(screen.getByTestId('c-count')).toHaveTextContent('0')

      // Update actions
      act(() => {
        screen.getByTestId('update-btn').click()
      })

      // All consumers receive the same updated state
      expect(screen.getByTestId('a-count')).toHaveTextContent('4')
      expect(screen.getByTestId('b-count')).toHaveTextContent('4')
      expect(screen.getByTestId('c-count')).toHaveTextContent('4')
      expect(screen.getByTestId('a-contextual')).toHaveTextContent('yes')
      expect(screen.getByTestId('b-contextual')).toHaveTextContent('yes')
      expect(screen.getByTestId('c-contextual')).toHaveTextContent('yes')
    })

    it('provider does not interfere with existing navigation rendering', () => {
      // Simulates the root layout structure with navigation components
      function MockMobileNav() {
        return (
          <nav data-testid="mobile-nav" aria-label="Mobile navigation">
            <a href="/">Home</a>
            <a href="/recipes">Recipes</a>
            <a href="/cookbooks">Cookbooks</a>
          </nav>
        )
      }

      function MockContent() {
        return (
          <main data-testid="content">
            <h1>Page Content</h1>
          </main>
        )
      }

      render(
        <DockContextProvider>
          <div className="layout">
            <MockContent />
            <MockMobileNav />
          </div>
        </DockContextProvider>
      )

      // Navigation renders correctly
      expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
      expect(screen.getByRole('link', { name: 'Recipes' })).toHaveAttribute('href', '/recipes')
      expect(screen.getByRole('link', { name: 'Cookbooks' })).toHaveAttribute('href', '/cookbooks')

      // Content renders correctly
      expect(screen.getByTestId('content')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Page Content' })).toBeInTheDocument()
    })
  })
})
