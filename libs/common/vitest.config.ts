import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'common',
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.int.spec.ts'],
    environment: 'node',
  },
});
