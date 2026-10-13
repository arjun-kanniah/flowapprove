import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // Database tests share one database, so test files run one at a time
    fileParallelism: false,
  },
})
