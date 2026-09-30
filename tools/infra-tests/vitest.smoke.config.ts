import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'services-smoke',
    include: ['src/**/*.smoke.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
