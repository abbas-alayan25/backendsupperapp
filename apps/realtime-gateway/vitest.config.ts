import swc from 'unplugin-swc';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  ssr: { resolve: { conditions: ['@super-app/source'] } },
  test: {
    name: 'realtime-gateway',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/*.int.spec.ts'],
    environment: 'node',
  },
});
