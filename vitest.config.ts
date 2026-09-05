import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  // Component specs render through react-native-web, which is already a
  // dependency of this Expo app, so React Native primitives resolve in jsdom.
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
  test: {
    exclude: [...configDefaults.exclude, '.claude/**', '**/*.integration.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      // Include untested source files so coverage cannot be made to look high
      // by simply omitting difficult modules from the report.
      all: true,
      include: ['packages/api/src/**/*.ts', 'lib/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.integration.spec.ts', '**/test/**', '**/*.d.ts'],
      thresholds: {
        statements: 45,
        branches: 35,
        functions: 40,
        lines: 45,
      },
    } as any,
  },
});
