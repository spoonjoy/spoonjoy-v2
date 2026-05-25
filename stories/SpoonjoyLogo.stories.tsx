import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus, ShoppingCart } from 'lucide-react'
import { SpoonjoyLogo } from '../app/components/ui/spoonjoy-logo'

const meta: Meta<typeof SpoonjoyLogo> = {
  title: 'Brand/SpoonjoyLogo',
  component: SpoonjoyLogo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'The current Spoonjoy mark as used in the app shell and mobile dock.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: { control: { type: 'range', min: 16, max: 128, step: 8 } },
    variant: { control: 'select', options: ['current', 'black', 'white'] },
  },
}

export default meta
type Story = StoryObj<typeof SpoonjoyLogo>

export const Default: Story = {
  args: {
    size: 48,
  },
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-6 text-[var(--sj-ink)]">
      {[16, 24, 32, 48, 64, 96].map((size) => (
        <div key={size} className="text-center">
          <SpoonjoyLogo size={size} />
          <p className="mt-2 text-xs text-[var(--sj-ink-soft)]">{size}px</p>
        </div>
      ))}
    </div>
  ),
}

export const ColorVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <div className="rounded-[var(--sj-radius-surface)] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] p-6 text-center text-[var(--sj-ink)]">
        <SpoonjoyLogo size={48} variant="current" />
        <p className="mt-2 text-sm text-[var(--sj-ink-soft)]">current</p>
      </div>
      <div className="rounded-[var(--sj-radius-surface)] bg-[var(--sj-flour)] p-6 text-center">
        <SpoonjoyLogo size={48} variant="black" />
        <p className="mt-2 text-sm text-[var(--sj-ink-soft)]">black</p>
      </div>
      <div className="rounded-[var(--sj-radius-surface)] bg-[var(--sj-photo-charcoal)] p-6 text-center text-[var(--sj-on-photo)]">
        <SpoonjoyLogo size={48} variant="white" />
        <p className="mt-2 text-sm text-[var(--sj-on-photo-muted)]">white</p>
      </div>
    </div>
  ),
}

export const MobileDockPlacement: Story = {
  render: () => (
    <div className="rounded-[var(--sj-radius-surface)] bg-[var(--sj-photo-charcoal)] p-6 text-[var(--sj-on-photo)] shadow-[var(--sj-shadow)]">
      <div className="grid w-80 grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-full border border-[var(--sj-photo-line)] bg-[color-mix(in_srgb,var(--sj-photo-charcoal)_92%,transparent)] px-5 py-3">
        <div className="flex flex-col items-center text-xs text-[var(--sj-on-photo-muted)]">
          <Plus className="h-5 w-5" aria-hidden="true" />
          New
        </div>
        <div className="rounded-full bg-[var(--sj-on-photo)] p-3 text-[var(--sj-photo-charcoal)] shadow-[var(--sj-shadow-soft)]">
          <SpoonjoyLogo size={28} />
        </div>
        <div className="flex flex-col items-center text-xs text-[var(--sj-on-photo-muted)]">
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          List
        </div>
      </div>
    </div>
  ),
}
