import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Preview } from '@storybook/react-vite'
import { withThemeByClassName } from '@storybook/addon-themes'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { OuroProvider } from '../app/lib/ouro/ouro-provider'
import '../app/styles/tailwind.css'

type RouterParameters = {
  initialEntries?: string[]
}

/**
 * The story as a page shows it: in <main>, with Ouro UI's popups at the end of that <main>, as
 * app/root.tsx places them. A story that renders its own <main> (a page layout) is left alone.
 * The accessibility check turns it on (the `page` global), so content outside every landmark,
 * such as a popup rendered at the end of <body>, fails there.
 */
function StoryPage({ children }: { children: ReactNode }) {
  const main = useRef<HTMLElement>(null)
  const popups = useRef<HTMLDivElement>(null)
  const [ownMain, setOwnMain] = useState(false)
  useLayoutEffect(() => {
    if (main.current?.querySelector('main, [role="main"]')) setOwnMain(true)
  }, [])
  if (ownMain) return <>{children}</>
  return (
    <OuroProvider portalContainer={popups}>
      <main ref={main}>
        {children}
        <div ref={popups} />
      </main>
    </OuroProvider>
  )
}

const preview: Preview = {
  initialGlobals: {
    page: false,
  },

  parameters: {
    controls: {
      matchers: {
        // Not a bare `color`: Ouro UI components declare `color` as a typed hint that is not a
        // prop (an object type), and a colour control on it makes Storybook warn.
        color: /^(background|.+Color)$/,
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
    (Story, context) => (context.globals.page ? <StoryPage><Story /></StoryPage> : <Story />),
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
