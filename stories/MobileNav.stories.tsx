import type { Meta, StoryObj } from '@storybook/react-vite'
import { MobileNav } from '../app/components/navigation/mobile-nav'
import { RecipesSectionNav } from '../app/components/navigation/recipes-section-nav'
import { DockContextProvider } from '../app/components/navigation/dock-context'

// iPhone SE (320px) is the narrowest target; 13 mini (375px) and 15 (393px) are the common
// widths. Every tab keeps an equal share of the bar at each of them.
const PHONE_VIEWPORTS = {
  iphone5: { name: 'iPhone SE (1st gen) — 320px', styles: { width: '320px', height: '568px' } },
  iphone13mini: { name: 'iPhone 13 mini — 375px', styles: { width: '375px', height: '812px' } },
  iphone15: { name: 'iPhone 15 — 393px', styles: { width: '393px', height: '852px' } },
}

const meta: Meta<typeof MobileNav> = {
  title: 'Navigation/MobileNav',
  component: MobileNav,
  parameters: {
    layout: 'fullscreen',
    viewport: { viewports: PHONE_VIEWPORTS, defaultViewport: 'iphone15' },
    docs: {
      description: {
        component:
          'The phone tab bar. Signed in: Kitchen, Recipes, Cookbooks and Shopping as four equal tabs, each an icon over a short label, with Search in its own circle beside them. Signed out: Home, Recipes and Log in, with Search. It is navigation only and the same on every page; page actions live on the page. The Recipes tab reaches Mine, Saved and Everyone through the switch at the top of each recipe list.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    isAuthenticated: {
      control: 'boolean',
      description: 'Switches between the signed-in and signed-out tabs.',
    },
  },
}

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <DockContextProvider>
      <div className="relative min-h-screen bg-[var(--sj-paper)] p-6 pb-32 text-[var(--sj-ink)]">
        <div className="max-w-sm space-y-3">
          <p className="sj-eyebrow">Phone tab bar</p>
          <h1 className="text-2xl font-semibold">{caption}</h1>
        </div>
        {children}
      </div>
    </DockContextProvider>
  )
}

function tabStory(path: string, caption: string, isAuthenticated = true): Story {
  return {
    args: { isAuthenticated },
    parameters: { router: { initialEntries: [path] } },
    render: (args) => (
      <Frame caption={caption}>
        <MobileNav {...args} />
      </Frame>
    ),
  }
}

export const KitchenTab = tabStory('/', 'Kitchen')
export const RecipesTab = tabStory('/my-recipes', 'Recipes')
export const CookbooksTab = tabStory('/cookbooks', 'Cookbooks')
export const ShoppingTab = tabStory('/shopping-list', 'Shopping')
export const SearchCurrent = tabStory('/search', 'Search')
export const RecipeDetail = tabStory('/recipes/r-1', 'A recipe (under Recipes)')
export const LoggedOutHome = tabStory('/', 'Signed out', false)

export const KitchenTabNarrow: Story = {
  ...tabStory('/', 'Kitchen — 320px'),
  name: 'Kitchen @ 320px',
  parameters: {
    router: { initialEntries: ['/'] },
    viewport: { viewports: PHONE_VIEWPORTS, defaultViewport: 'iphone5' },
  },
}

export const RecipesSwitch: Story = {
  args: { isAuthenticated: true },
  parameters: { router: { initialEntries: ['/saved-recipes'] } },
  render: (args) => (
    <Frame caption="Recipes: Saved">
      <div className="mt-6">
        <RecipesSectionNav />
      </div>
      <MobileNav {...args} />
    </Frame>
  ),
}
