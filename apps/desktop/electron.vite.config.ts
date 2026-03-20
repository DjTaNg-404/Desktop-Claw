import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@desktop-claw/backend', '@desktop-claw/shared'] })],
    resolve: {
      alias: {
        '@desktop-claw/backend': resolve(__dirname, '../../packages/backend/src/index.ts'),
        '@desktop-claw/shared': resolve(__dirname, '../../packages/shared/src/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
