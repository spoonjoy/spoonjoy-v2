import type { Meta, StoryObj } from '@storybook/react-vite'
import { ListPager } from '../../app/components/ui/list-pager'
import { RecipeGrid } from '../../app/components/pantry/RecipeGrid'

const recipes = ['Lemon Pasta', 'Spiced Chickpea Bowl', 'Roast Chicken and Root Veg'].map((title, index) => ({
  id: `r-${index + 1}`,
  title,
  chefName: 'ari',
  href: `/recipes/r-${index + 1}`,
}))

const meta: Meta<typeof ListPager> = {
  title: 'Pantry/ListPager',
  component: ListPager,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Previous and next links under a paged list, such as a chef profile recipe grid. Hidden when the list fits on one page.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <RecipeGrid recipes={recipes} totalCount={54} />
        <Story />
      </div>
    ),
  ],
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

export const FirstPage: Story = {
  args: {
    'aria-label': 'ari recipes pagination',
    pages: { page: 1, totalPages: 3, previousHref: null, nextHref: '/users/ari?page=2' },
  },
}

export const MiddlePage: Story = {
  args: {
    'aria-label': 'ari recipes pagination',
    pages: { page: 2, totalPages: 3, previousHref: '/users/ari', nextHref: '/users/ari?page=3' },
  },
}

export const LastPage: Story = {
  args: {
    'aria-label': 'ari recipes pagination',
    pages: { page: 3, totalPages: 3, previousHref: '/users/ari?page=2', nextHref: null },
  },
}
