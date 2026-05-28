import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArrowLeft, Edit, Share2, ShoppingBag, Trash2 } from 'lucide-react'
import { MobileNav } from '../app/components/navigation/mobile-nav'
import { DockContextProvider, useDockActions, type DockAction } from '../app/components/navigation/dock-context'

// iPhone 5/SE (320px) is the narrowest target; 13 mini (375px) is where the
// dock historically clipped. These let you eyeball every dock variant at the
// widths the responsive audit (e2e/flows/spoondock-responsive.spec.ts) guards.
const NARROW_VIEWPORTS = {
  iphone5: { name: 'iPhone 5/SE — 320px', styles: { width: '320px', height: '568px' } },
  iphone13mini: { name: 'iPhone 13 mini — 375px', styles: { width: '375px', height: '812px' } },
}

const meta: Meta<typeof MobileNav> = {
  title: 'Navigation/MobileNav',
  component: MobileNav,
  parameters: {
    layout: 'fullscreen',
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        component:
          'The current mobile dock: authenticated users get New, centered home logo, and List; logged-out users get Home, centered logo, and Login. Page-level contextual actions may replace the side slots.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    isAuthenticated: {
      control: 'boolean',
      description: 'Switches between the authenticated and logged-out dock IA.',
    },
  },
}

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <DockContextProvider>
      <div className="relative min-h-screen bg-[var(--sj-photo-charcoal)] p-6 pb-32 text-[var(--sj-on-photo)]">
        <div className="max-w-sm space-y-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--sj-on-photo-muted)]">Mobile dock</p>
          <h1 className="text-2xl font-semibold">{caption}</h1>
          <p className="text-sm text-[var(--sj-on-photo-muted)]">Resize to a mobile viewport or use Storybook's viewport toolbar to inspect the fixed bottom dock.</p>
        </div>
        {children}
      </div>
    </DockContextProvider>
  )
}

function ContextualRecipeActions() {
  const actions: DockAction[] = [
    { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes', position: 'left' },
    { id: 'share', icon: Share2, label: 'Share', onAction: () => undefined, position: 'right' },
    { id: 'edit', icon: Edit, label: 'Edit', onAction: '/recipes/r-1/edit', position: 'right' },
  ]
  useDockActions(actions)
  return <MobileNav isAuthenticated />
}

function ContextualEditActions() {
  const actions: DockAction[] = [
    { id: 'back', icon: ArrowLeft, label: 'Back', onAction: '/recipes/r-1', position: 'left' },
    {
      id: 'delete',
      icon: Trash2,
      label: 'Delete',
      ariaLabel: 'Delete recipe',
      iconClassName: 'text-[var(--sj-tomato)]',
      labelClassName: 'text-[var(--sj-tomato)]',
      onAction: () => undefined,
      position: 'right',
    },
  ]
  useDockActions(actions)
  return <MobileNav isAuthenticated />
}

export const AuthenticatedHome: Story = {
  args: { isAuthenticated: true },
  parameters: { router: { initialEntries: ['/'] } },
  render: (args) => (
    <Frame caption="Kitchen home">
      <MobileNav {...args} />
    </Frame>
  ),
}

export const NewRecipeActive: Story = {
  args: { isAuthenticated: true },
  parameters: { router: { initialEntries: ['/recipes/new'] } },
  render: (args) => (
    <Frame caption="New recipe active">
      <MobileNav {...args} />
    </Frame>
  ),
}

export const ShoppingListActive: Story = {
  args: { isAuthenticated: true },
  parameters: { router: { initialEntries: ['/shopping-list'] } },
  render: (args) => (
    <Frame caption="Shopping list active">
      <MobileNav {...args} />
    </Frame>
  ),
}

export const LoggedOutHome: Story = {
  args: { isAuthenticated: false },
  parameters: { router: { initialEntries: ['/'] } },
  render: (args) => (
    <Frame caption="Logged-out home">
      <MobileNav {...args} />
    </Frame>
  ),
}

export const RecipeDetailContext: Story = {
  parameters: { router: { initialEntries: ['/recipes/r-1'] } },
  render: () => (
    <Frame caption="Recipe detail actions">
      <ContextualRecipeActions />
    </Frame>
  ),
}

export const RecipeEditContext: Story = {
  parameters: { router: { initialEntries: ['/recipes/r-1/edit'] } },
  render: () => (
    <Frame caption="Recipe edit actions">
      <ContextualEditActions />
    </Frame>
  ),
}

/** Worst case for width: place + primary + three tools (recipe detail, owner). */
function ContextualRecipeActionsFull() {
  const actions: DockAction[] = [
    { id: 'back', icon: ArrowLeft, label: 'Back', sublabel: 'recipes', onAction: '/recipes', position: 'left' },
    { id: 'list', icon: ShoppingBag, label: 'List', onAction: () => undefined, position: 'right' },
    { id: 'share', icon: Share2, label: 'Share', onAction: () => undefined, position: 'right' },
    { id: 'edit', icon: Edit, label: 'Edit', onAction: '/recipes/r-1/edit', position: 'right' },
  ]
  useDockActions(actions)
  return <MobileNav isAuthenticated />
}

export const RecipeDetailNarrow: Story = {
  name: 'Recipe detail @ iPhone 5 (worst case)',
  parameters: {
    router: { initialEntries: ['/recipes/r-1'] },
    viewport: { viewports: NARROW_VIEWPORTS, defaultViewport: 'iphone5' },
  },
  render: () => (
    <Frame caption="Recipe detail — 320px">
      <ContextualRecipeActionsFull />
    </Frame>
  ),
}

export const KitchenHomeNarrow: Story = {
  name: 'Kitchen home @ iPhone 5',
  args: { isAuthenticated: true },
  parameters: {
    router: { initialEntries: ['/'] },
    viewport: { viewports: NARROW_VIEWPORTS, defaultViewport: 'iphone5' },
  },
  render: (args) => (
    <Frame caption="Kitchen home — 320px">
      <MobileNav {...args} />
    </Frame>
  ),
}
