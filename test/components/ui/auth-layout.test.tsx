import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthLayout } from '~/components/ui/auth-layout'

describe('AuthLayout', () => {
  describe('rendering', () => {
    it('renders children', () => {
      render(
        <AuthLayout>
          <h1>Login Form</h1>
        </AuthLayout>
      )
      expect(screen.getByRole('heading', { name: 'Login Form' })).toBeInTheDocument()
    })

    it('renders multiple children', () => {
      render(
        <AuthLayout>
          <h1>Sign Up</h1>
          <p>Create your account</p>
          <button>Submit</button>
        </AuthLayout>
      )
      expect(screen.getByRole('heading', { name: 'Sign Up' })).toBeInTheDocument()
      expect(screen.getByText('Create your account')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    })

    it('renders complex nested children', () => {
      render(
        <AuthLayout>
          <div>
            <form>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" />
              <button type="submit">Login</button>
            </form>
          </div>
        </AuthLayout>
      )
      expect(screen.getByLabelText('Email')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument()
    })
  })

  describe('marketing copy', () => {
    it('renders the sign-in voice by default', () => {
      render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      expect(screen.getByText('Kitchen sign-in')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Keep the good recipes close.' })).toBeInTheDocument()
      expect(
        screen.getByText(/Sign in to cook, fork, save, and remember/)
      ).toBeInTheDocument()
    })

    it('renders caller-supplied eyebrow, title, and description', () => {
      render(
        <AuthLayout
          eyebrow="Kitchen connection"
          title="Bring your kitchen with you."
          description="Review what each app can access before you let it into your kitchen."
        >
          <p>Content</p>
        </AuthLayout>
      )
      expect(screen.getByText('Kitchen connection')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Bring your kitchen with you.' })).toBeInTheDocument()
      expect(screen.getByText(/Review what each app can access/)).toBeInTheDocument()
      expect(screen.queryByText('Kitchen sign-in')).not.toBeInTheDocument()
    })
  })

  describe('legal links', () => {
    it('always renders Privacy and Terms links beneath the form', () => {
      render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
      expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    })
  })

  describe('semantic structure', () => {
    it('renders a main element as the root', () => {
      render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('contains children within the main element', () => {
      render(
        <AuthLayout>
          <p>Content inside main</p>
        </AuthLayout>
      )
      const main = screen.getByRole('main')
      expect(main).toContainElement(screen.getByText('Content inside main'))
    })
  })

  describe('layout classes', () => {
    it('applies flex layout classes to main element', () => {
      render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      const main = screen.getByRole('main')
      expect(main).toHaveClass('min-h-dvh')
      expect(main).toHaveClass('sj-page')
    })

    it('applies editorial split wrapper styles', () => {
      const { container } = render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      const wrapper = container.querySelector('main > div')
      expect(wrapper).toHaveClass('grid')
      expect(wrapper).toHaveClass('min-h-dvh')
      expect(wrapper).toHaveClass('lg:grid-cols-[minmax(0,0.92fr)_minmax(24rem,0.58fr)]')
    })

    it('applies printed-cookbook intro section styles', () => {
      const { container } = render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      const intro = container.querySelector('main > div > section:first-child')
      expect(intro).toHaveClass('flex')
      expect(intro).toHaveClass('flex-col')
      expect(intro).toHaveClass('justify-between')
      expect(intro).toHaveClass('px-5')
    })

    it('keeps the form constrained for focused auth flows', () => {
      const { container } = render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      const formColumn = container.querySelector('main > div > section:nth-child(2) > div')
      expect(formColumn).toHaveClass('w-full')
      expect(formColumn).toHaveClass('max-w-md')
    })
  })
})
