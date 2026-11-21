import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      // Tests must never be influenced by artifacts a developer has built
      // locally. A real Target catalog index at data/target-index/target.sqlite
      // would otherwise make Target "available" and change what these assert.
      // Tests that need an index point TARGET_INDEX_PATH at their own temp DB.
      TARGET_INDEX_PATH: '/nonexistent/emporika-test-target.sqlite',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});
