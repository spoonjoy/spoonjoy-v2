import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus, ShoppingCart, Trash2, UtensilsCrossed } from 'lucide-react'
import { Avatar } from '../app/components/ouro/avatar/avatar'
import { Badge } from '../app/components/ouro/badge/badge'
import { Button } from '../app/components/button'
import { Fieldset } from '../app/components/ouro/field/fieldset'
import { TextArea } from '../app/components/ouro/text-field/text-area'
import { TextField } from '../app/components/ouro/text-field/text-field'
import { Heading } from '../app/components/ouro/text/heading'
import { Link } from '../app/components/ouro/link/link'
import { Text } from '../app/components/ouro/text/text'

const meta: Meta = {
  title: 'App/Foundation',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A compact, current snapshot of the shared UI primitives Spoonjoy actually uses in app contexts. This replaces the old exhaustive primitive catalog.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

export const KitchenActions: Story = {
  render: () => (
    <section className="sj-panel max-w-3xl rounded-[var(--sj-radius-surface)] p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Heading level={1} size="xl">Tonight's Kitchen</Heading>
          <Text tone="muted" className="mt-2 max-w-xl">
            The active button set is deliberately small: default, plain, and destructive. If a flow needs more color than
            that, it should earn it in product design first.
          </Text>
        </div>
        <Badge tone="warning" variant="soft">Current primitives</Badge>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/recipes/new">
          <Plus data-slot="icon" aria-hidden="true" />
          New recipe
        </Button>
        <Button href="/shopping-list">
          <ShoppingCart data-slot="icon" aria-hidden="true" />
          Shopping list
        </Button>
        <Button plain>Cancel</Button>
        <Button variant="destructive">
          <Trash2 data-slot="icon" aria-hidden="true" />
          Delete recipe
        </Button>
      </div>
    </section>
  ),
}

export const RecipeFormBasics: Story = {
  render: () => (
    <section className="sj-panel max-w-2xl rounded-[var(--sj-radius-surface)] p-6">
      <Fieldset
        legend="Recipe basics"
        description="Fields are shown the way recipe creation uses them: clear labels, helpful copy, and visible errors."
      >
        <TextField
          label="Recipe title"
          description="Use the name your family would recognize."
          defaultValue="Sunday tomato soup"
        />
        <TextArea label="Why this recipe matters" rows={4} defaultValue="A bright, low-fuss soup for chilly afternoons." />
        <TextField
          label="Missing detail"
          placeholder="e.g., servings"
          error="Add at least one serving note before publishing."
        />
      </Fieldset>
    </section>
  ),
}

export const PantryCardLanguage: Story = {
  render: () => (
    <article className="sj-card max-w-sm overflow-hidden rounded-[var(--sj-radius-surface)]">
      <div className="flex aspect-[4/3] items-center justify-center bg-[var(--sj-flour)] text-[var(--sj-ink-soft)]">
        <UtensilsCrossed className="h-8 w-8" aria-hidden="true" />
      </div>
      <div className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Heading level={2}>Lemon pasta</Heading>
            <Text tone="muted" className="mt-1">A fast, bright weeknight recipe with pantry-friendly ingredients.</Text>
          </div>
          <Avatar name="Ari Mendelow" initials="AM" size="md" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="success" variant="soft">Easy</Badge>
          <Badge variant="soft">20 minutes</Badge>
          <Badge variant="soft">Serves 2</Badge>
        </div>
        <Text tone="muted">
          See the full flow in <Link href="/recipes/lemon-pasta">recipe view</Link>.
        </Text>
      </div>
    </article>
  ),
}
