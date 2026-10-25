import type { Preview } from '@storybook/react-vite'
import { withThemeByClassName } from '@storybook/addon-themes'
import { createMemoryRouter, RouterProvider } from 'react-router'
import '../app/styles/tailwind.css'

type RouterParameters = {
  initialEntries?: string[]
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // Violations fail a story's test. CI checks every story, in both themes and with the
      // checks axe could not decide, in e2e/storybook/accessibility.spec.ts.
      test: 'error',
    },

    backgrounds: {
      disable: true,
    },
  },

  decorators: [
    (Story, context) => {
      const routerParameters = context.parameters.router as RouterParameters | undefined
      const router = createMemoryRouter(
        [
          {
            path: '*',
            element: <Story />,
          },
        ],
        {
          initialEntries: routerParameters?.initialEntries ?? ['/'],
        }
      )

      return <RouterProvider router={router} />
    },
    withThemeByClassName({
      themes: {
        light: '',
        dark: 'dark',
      },
      defaultTheme: 'light',
    }),
  ],
}

export default preview
