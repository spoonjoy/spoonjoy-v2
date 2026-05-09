import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

export default [
  // Main project tests (unit/integration)
  'vitest.config.ts',
  // Storybook component tests
  {
    extends: '.storybook/vite.config.ts',
    plugins: [
      storybookTest({
        configDir: new URL('.storybook', import.meta.url).pathname,
      }),
    ],
    test: {
      name: 'storybook',
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
      setupFiles: ['.storybook/vitest.setup.ts'],
    },
  },
];
