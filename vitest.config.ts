import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/lib/render.ts'],
    },
    testTimeout: 10000,
  },
  resolve: {
    // strip .js extensions so Vitest resolves TS files
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
