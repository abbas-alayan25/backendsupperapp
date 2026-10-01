import swc from 'unplugin-swc';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  ssr: { resolve: { conditions: ['@super-app/source'] } },
  test: {
    name: 'tenant-service-integration',
    include: ['test/**/*.int.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
