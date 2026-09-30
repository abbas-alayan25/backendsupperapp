import swc from 'unplugin-swc';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  ssr: { resolve: { conditions: ['@super-app/source'] } },
  test: {
    name: 'delivery-service-integration',
    include: ['test/**/*.int.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
