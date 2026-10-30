import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import cesium from 'vite-plugin-cesium'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (e.g. GitHub Pages /laz-viewer/).
  // An absolute sub-path base would make vite-plugin-cesium copy assets to dist/<base>/cesium.
  base: './',
  plugins: [vue(), tailwindcss(), cesium()],
  server: {
    proxy: {
      // Ground extraction backend (see ../backend)
      '/api': process.env.VITE_API_TARGET || 'http://localhost:8000',
    },
  },
})
