import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Dialog, DialogTitle, DialogDescription, DialogBody, DialogActions } from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'

describe('Dialog', () => {
  describe('Dialog component', () => {
    it('renders children when open', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogTitle>Test Dialog</DialogTitle>
        </Dialog>
      )
      await waitFor(() => {
        expect(screen.getByText('Test Dialog')).toBeInTheDocument()
      })
    })

    it('does not render children when closed', () => {
      render(
        <Dialog open={false} onClose={() => {}}>
          <DialogTitle>Hidden Dialog</DialogTitle>
        </Dialog>
      )
      expect(screen.queryByText('Hidden Dialog')).not.toBeInTheDocument()
    })

    it('applies custom className', async () => {
      render(
        <Dialog open={true} onClose={() => {}} className="custom-dialog">
          <DialogTitle>Styled Dialog</DialogTitle>
        </Dialog>
      )
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('opens the panel in place, so its buttons never move under a tap', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogTitle>Steady Dialog</DialogTitle>
        </Dialog>
      )

      await waitFor(() => {
        expect(document.querySelector('[data-slot="dialog-panel"]')).toBeTruthy()
      })
      const classes = document.querySelector('[data-slot="dialog-panel"]')!.className.split(/\s+/)
      // Entering only fades: no closed-state offset or scale that also applies while entering.
      expect(classes.filter((name) => /translate|scale/.test(name) && !name.includes('data-leave:'))).toEqual([])
      expect(classes).toContain('data-closed:opacity-0')
      // Leaving may still slide away; nothing can be tapped by then.
      expect(classes).toContain('data-leave:data-closed:translate-y-8')
      expect(classes).toContain('sm:data-leave:data-closed:scale-95')
    })

    it('keeps the accessible dialog wrapper sized to the viewport', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogTitle>Visible Dialog Wrapper</DialogTitle>
        </Dialog>
      )

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toHaveClass('fixed', 'inset-0', 'z-[60]')
      })
    })

    it('renders with different size variants', async () => {
      const sizes = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] as const
      for (const size of sizes) {
        const { unmount } = render(
          <Dialog open={true} onClose={() => {}} size={size}>
            <DialogTitle>{size} Dialog</DialogTitle>
          </Dialog>
        )
        await waitFor(() => {
          expect(screen.getByText(`${size} Dialog`)).toBeInTheDocument()
        })
        unmount()
      }
    })
  })

  describe('DialogTitle', () => {
    it('renders title text', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogTitle>My Title</DialogTitle>
        </Dialog>
      )
      await waitFor(() => {
        expect(screen.getByText('My Title')).toBeInTheDocument()
      })
    })

    it('applies custom className', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogTitle className="custom-title">Custom Title</DialogTitle>
        </Dialog>
      )
      await waitFor(() => {
        const title = screen.getByText('Custom Title')
        expect(title.className).toContain('custom-title')
      })
    })
  })

  describe('DialogDescription', () => {
    it('renders description text', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogDescription>This is a description</DialogDescription>
        </Dialog>
      )
      await waitFor(() => {
        expect(screen.getByText('This is a description')).toBeInTheDocument()
      })
    })

    it('applies custom className', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogDescription className="custom-desc">Description</DialogDescription>
        </Dialog>
      )
      await waitFor(() => {
        const desc = screen.getByText('Description')
        expect(desc.className).toContain('custom-desc')
      })
    })
  })

  describe('DialogBody', () => {
    it('renders body content', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogBody>Body content here</DialogBody>
        </Dialog>
      )
      await waitFor(() => {
        expect(screen.getByText('Body content here')).toBeInTheDocument()
      })
    })

    it('applies custom className', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogBody className="custom-body">Body</DialogBody>
        </Dialog>
      )
      await waitFor(() => {
        const body = screen.getByText('Body')
        expect(body.className).toContain('custom-body')
      })
    })

    it('applies default mt-6 class', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogBody>Body</DialogBody>
        </Dialog>
      )
      await waitFor(() => {
        const body = screen.getByText('Body')
        expect(body.className).toContain('mt-6')
      })
    })
  })

  describe('DialogActions', () => {
    it('renders action buttons', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogActions>
            <Button>Cancel</Button>
            <Button>Confirm</Button>
          </DialogActions>
        </Dialog>
      )
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
      })
    })

    it('applies custom className', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogActions className="custom-actions" data-testid="dialog-actions">
            <Button>Action</Button>
          </DialogActions>
        </Dialog>
      )
      await waitFor(() => {
        const actions = screen.getByTestId('dialog-actions')
        expect(actions.className).toContain('custom-actions')
      })
    })

    it('applies default flex layout classes', async () => {
      render(
        <Dialog open={true} onClose={() => {}}>
          <DialogActions data-testid="dialog-actions">
            <Button>Action</Button>
          </DialogActions>
        </Dialog>
      )
      await waitFor(() => {
        const actions = screen.getByTestId('dialog-actions')
        expect(actions.className).toContain('mt-8')
        expect(actions.className).toContain('flex')
      })
    })
  })

  describe('Full dialog composition', () => {
    it('renders a complete dialog with all components', async () => {
      const onClose = vi.fn()
      render(
        <Dialog open={true} onClose={onClose}>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>Make changes to your profile here.</DialogDescription>
          <DialogBody>
            <p>Profile form fields would go here.</p>
          </DialogBody>
          <DialogActions>
            <Button plain onClick={onClose}>
              Cancel
            </Button>
            <Button>Save Changes</Button>
          </DialogActions>
        </Dialog>
      )

      await waitFor(() => {
        expect(screen.getByText('Edit Profile')).toBeInTheDocument()
        expect(screen.getByText('Make changes to your profile here.')).toBeInTheDocument()
        expect(screen.getByText('Profile form fields would go here.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument()
      })
    })
  })
})
