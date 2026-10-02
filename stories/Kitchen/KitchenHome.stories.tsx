import type { Meta, StoryObj } from '@storybook/react-vite'
import { KitchenHome } from '../../app/components/cookbook/KitchenHome'

// A flat colour block standing in for a cover photo, so the story needs no network.
const photo = (hue: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue} 45% 55%)"/></svg>`,
  )}`

const recipe = (id: string, title: string, hue: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  description: null,
  servings: null,
  coverImageUrl: hue === null ? null : photo(hue),
  coverProvenanceLabel: null,
  ...extra,
})

const meta: Meta<typeof KitchenHome> = {
  title: 'Kitchen/KitchenHome',
  component: KitchenHome,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof meta>

const kitchenUser = { id: 'chef-1', username: 'rowan', photoUrl: null }

/** The newest recipe has no cover; it still sits first in the contents. */
export const Default: Story = {
  args: {
    kitchenUser,
    isOwner: true,
    recipes: [
      recipe('r-1', 'Weeknight Dal', null, { description: 'Red lentils, ginger and a hot tarka.', servings: '4' }),
      recipe('r-2', 'Lemon Pasta', 20, { description: 'Bright pasta with garlic and zest.', servings: '2' }),
      recipe('r-3', 'Brown Butter Cookies', 35, { servings: '24' }),
      recipe('r-4', 'Sunday Roast Chicken', 15, { description: 'Crisp skin, pan gravy.' }),
      recipe('r-5', 'Spiced Chickpea Bowl', 90),
      recipe('r-6', 'Focaccia', 40, { servings: '8' }),
    ],
    cookbooks: [
      { id: 'c-1', title: 'Weeknight Rotation', _count: { recipes: 3 }, recipes: [] },
      { id: 'c-2', title: 'Holiday Table', _count: { recipes: 5 }, recipes: [] },
    ],
  },
}

export const NoRecipes: Story = {
  args: { kitchenUser, isOwner: true, recipes: [], cookbooks: [] },
}
