import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    environment: 'node',
    reporters: 'default'
  }
})
