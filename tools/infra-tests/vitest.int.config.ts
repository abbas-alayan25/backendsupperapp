import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'infra-integration',
    include: ['src/**/*.int.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 900_000,
  },
});
