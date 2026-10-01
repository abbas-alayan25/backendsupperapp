import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'dev-seed-integration',
    include: ['test/**/*.int.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
