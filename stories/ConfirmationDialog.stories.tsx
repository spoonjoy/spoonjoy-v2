import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { BookX, Eraser, LogOut, Trash2 } from 'lucide-react'
import { ConfirmationDialog } from '../app/components/confirmation-dialog'
import { Button } from '../app/components/ui/button'

const meta: Meta<typeof ConfirmationDialog> = {
  title: 'Components/ConfirmationDialog',
  component: ConfirmationDialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The current confirmation pattern for destructive or consequential Spoonjoy actions. These examples mirror real app copy and the current Button API.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

type DialogDemoProps = Omit<React.ComponentProps<typeof ConfirmationDialog>, 'open' | 'onClose' | 'onConfirm'> & {
  triggerLabel: string
  triggerIcon?: typeof Trash2
}

function DialogDemo({ triggerLabel, triggerIcon: Icon, destructive, ...dialogProps }: DialogDemoProps) {
  const [open, setOpen] = useState(false)
  const [lastAction, setLastAction] = useState('No action yet')

  return (
    <div className="sj-panel flex min-w-80 flex-col items-center gap-4 rounded-[var(--sj-radius-surface)] p-6">
      <Button variant={destructive ? 'destructive' : 'default'} onClick={() => setOpen(true)}>
        {Icon ? <Icon data-slot="icon" aria-hidden="true" /> : null}
        {triggerLabel}
      </Button>
      <ConfirmationDialog
        {...dialogProps}
        destructive={destructive}
        open={open}
        onClose={() => {
          setOpen(false)
          setLastAction('Cancelled')
        }}
        onConfirm={() => {
          setOpen(false)
          setLastAction('Confirmed')
        }}
      />
      <p className="text-sm text-[var(--sj-ink-soft)]">Last action: {lastAction}</p>
    </div>
  )
}

export const ClearShoppingList: Story = {
  render: () => (
    <DialogDemo
      triggerLabel="Clear all"
      triggerIcon={Eraser}
      title="Start fresh?"
      description="All items will be cleared from your shopping list. Your cart will be squeaky clean!"
      confirmLabel="Clear it all"
      cancelLabel="Keep my stuff"
      destructive
    />
  ),
}

export const RemoveIngredient: Story = {
  render: () => (
    <DialogDemo
      triggerLabel="Remove ingredient"
      triggerIcon={Trash2}
      title="Remove this ingredient?"
      description="This ingredient will be removed from the step."
      confirmLabel="Remove it"
      cancelLabel="Keep it"
      destructive
    />
  ),
}

export const DeleteCookbook: Story = {
  render: () => (
    <DialogDemo
      triggerLabel="Delete cookbook"
      triggerIcon={BookX}
      title="Banish this cookbook?"
      description="This will permanently delete the cookbook and remove all recipe associations. The recipes themselves will not be deleted."
      confirmLabel="Delete it"
      cancelLabel="Keep it"
      destructive
    />
  ),
}

export const SignOut: Story = {
  render: () => (
    <DialogDemo
      triggerLabel="Sign out"
      triggerIcon={LogOut}
      title="Sign out of Spoonjoy?"
      description="You can always come back when the next kitchen idea strikes."
      confirmLabel="Sign out"
      cancelLabel="Stay here"
    />
  ),
}
