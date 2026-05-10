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
      expect(main).toHaveClass('flex')
      expect(main).toHaveClass('min-h-dvh')
      expect(main).toHaveClass('flex-col')
      expect(main).toHaveClass('p-3')
    })

    it('applies centered content wrapper styles', () => {
      const { container } = render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      const wrapper = container.querySelector('main > div')
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('grow')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-center')
      expect(wrapper).toHaveClass('p-4')
    })

    it('applies branded panel styles to the auth card', () => {
      const { container } = render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      const authCard = container.querySelector('main > div > section')
      expect(authCard).toHaveClass('sj-panel')
      expect(authCard).toHaveClass('rounded-[2rem]')
      expect(authCard).toHaveClass('p-6')
      expect(authCard).toHaveClass('sm:p-8')
      expect(authCard).toHaveClass('overflow-hidden')
    })

    it('keeps the card constrained for focused auth flows', () => {
      const { container } = render(
        <AuthLayout>
          <p>Content</p>
        </AuthLayout>
      )
      const authCard = container.querySelector('main > div > section')
      expect(authCard).toHaveClass('w-full')
      expect(authCard).toHaveClass('max-w-md')
    })
  })
})
