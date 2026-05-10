import type { StorybookConfig } from '@storybook/react-vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
    '@storybook/addon-onboarding',
    '@storybook/addon-themes',
    '@chromatic-com/storybook',
  ],
  framework: '@storybook/react-vite',
  core: {
    builder: {
      name: '@storybook/builder-vite',
      options: {
        viteConfigPath: path.resolve(__dirname, 'vite.config.ts'),
      },
    },
  },
  viteFinal: async (config) => {
    // Storybook's internal chunks (axe, docs blocks, iframe) exceed default 500KB limit.
    // These are expected and not under our control, so we raise the threshold.
    config.build = config.build || {}
    config.build.chunkSizeWarningLimit = 1500
    return config
  },
}

export default config
