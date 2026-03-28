import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['packages/backend/src/**/*.test.ts'],
    globals: true
  },
  resolve: {
    alias: {
      '@desktop-claw/shared': resolve(__dirname, 'packages/shared/src/index.ts')
    }
  }
})
