import { defineProject } from 'vitest/config';

export default defineProject({
  ssr: { resolve: { conditions: ['@super-app/source'] } },
  test: {
    name: 'testing-integration',
    include: ['test/**/*.int.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    environment: 'node',
  },
});
