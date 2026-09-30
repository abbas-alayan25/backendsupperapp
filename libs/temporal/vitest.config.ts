import { defineProject } from 'vitest/config';

export default defineProject({
  ssr: { resolve: { conditions: ['@super-app/source'] } },
  test: {
    name: 'temporal',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/*.int.spec.ts'],
    environment: 'node',
  },
});
