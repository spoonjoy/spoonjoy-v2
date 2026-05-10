import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus, ShoppingCart, Trash2, UtensilsCrossed } from 'lucide-react'
import { Avatar } from '../app/components/ui/avatar'
import { Badge } from '../app/components/ui/badge'
import { Button } from '../app/components/ui/button'
import { Field, FieldGroup, Fieldset, Label, Legend, Description, ErrorMessage } from '../app/components/ui/fieldset'
import { Heading, Subheading } from '../app/components/ui/heading'
import { Input } from '../app/components/ui/input'
import { Text, TextLink } from '../app/components/ui/text'
import { Textarea } from '../app/components/ui/textarea'

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
    <section className="max-w-3xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Heading>Tonight's Kitchen</Heading>
          <Text className="mt-2 max-w-xl">
            The active button set is deliberately small: default, plain, and destructive. If a flow needs more color than
            that, it should earn it in product design first.
          </Text>
        </div>
        <Badge color="amber">Current primitives</Badge>
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
    <section className="max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <Fieldset>
        <Legend>Recipe basics</Legend>
        <Text>Fields are shown the way recipe creation uses them: clear labels, helpful copy, and visible errors.</Text>
        <FieldGroup className="mt-6">
          <Field>
            <Label>Recipe title</Label>
            <Description>Use the name your family would recognize.</Description>
            <Input type="text" defaultValue="Sunday tomato soup" />
          </Field>

          <Field>
            <Label>Why this recipe matters</Label>
            <Textarea rows={4} defaultValue="A bright, low-fuss soup for chilly afternoons." />
          </Field>

          <Field>
            <Label>Missing detail</Label>
            <Input type="text" aria-invalid="true" defaultValue="" placeholder="e.g., servings" />
            <ErrorMessage>Add at least one serving note before publishing.</ErrorMessage>
          </Field>
        </FieldGroup>
      </Fieldset>
    </section>
  ),
}

export const PantryCardLanguage: Story = {
  render: () => (
    <article className="max-w-sm overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex aspect-[4/3] items-center justify-center bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
        <UtensilsCrossed className="h-8 w-8" aria-hidden="true" />
      </div>
      <div className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Subheading level={2}>Lemon pasta</Subheading>
            <Text className="mt-1">A fast, bright weeknight recipe with pantry-friendly ingredients.</Text>
          </div>
          <Avatar initials="AM" alt="Ari Mendelow" className="size-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color="green">Easy</Badge>
          <Badge color="zinc">20 minutes</Badge>
          <Badge color="blue">Serves 2</Badge>
        </div>
        <Text>
          See the full flow in <TextLink href="/recipes/lemon-pasta">recipe view</TextLink>.
        </Text>
      </div>
    </article>
  ),
}
