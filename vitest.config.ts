import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests mutate process.env.HOME; run files sequentially to keep them isolated.
    fileParallelism: false,
  },
});
