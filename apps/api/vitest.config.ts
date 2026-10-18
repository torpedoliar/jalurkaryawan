import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false, // serial: all tests share one Postgres database
    globalSetup: ['./test/setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://bms:bms@127.0.0.1:5433/bms_test',
      APP_SECRET: 'test-secret-at-least-32-characters-long!!',
      TZ: 'Asia/Jakarta',
    },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  plugins: [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } })],
});
