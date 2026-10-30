import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Separate from vite.config.js so tests don't load vite-plugin-cesium (build/serve only).
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.js'],
    setupFiles: ['src/lib/testing/setup.js'],
  },
})
