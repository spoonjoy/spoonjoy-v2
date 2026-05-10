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
    <div className="flex items-end gap-6 text-zinc-950 dark:text-white">
      {[16, 24, 32, 48, 64, 96].map((size) => (
        <div key={size} className="text-center">
          <SpoonjoyLogo size={size} />
          <p className="mt-2 text-xs text-zinc-500">{size}px</p>
        </div>
      ))}
    </div>
  ),
}

export const ColorVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-zinc-950">
        <SpoonjoyLogo size={48} variant="current" />
        <p className="mt-2 text-sm text-zinc-600">current</p>
      </div>
      <div className="rounded-2xl bg-zinc-100 p-6 text-center">
        <SpoonjoyLogo size={48} variant="black" />
        <p className="mt-2 text-sm text-zinc-600">black</p>
      </div>
      <div className="rounded-2xl bg-zinc-900 p-6 text-center text-white">
        <SpoonjoyLogo size={48} variant="white" />
        <p className="mt-2 text-sm text-zinc-300">white</p>
      </div>
    </div>
  ),
}

export const MobileDockPlacement: Story = {
  render: () => (
    <div className="rounded-[2rem] bg-zinc-950 p-6 text-white shadow-2xl">
      <div className="grid w-80 grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-full border border-white/10 bg-zinc-900/95 px-5 py-3">
        <div className="flex flex-col items-center text-xs text-zinc-300">
          <Plus className="h-5 w-5" aria-hidden="true" />
          New
        </div>
        <div className="rounded-full bg-white p-3 text-zinc-950 shadow-lg">
          <SpoonjoyLogo size={28} />
        </div>
        <div className="flex flex-col items-center text-xs text-zinc-300">
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          List
        </div>
      </div>
    </div>
  ),
}
