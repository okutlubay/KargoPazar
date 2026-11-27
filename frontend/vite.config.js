import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
        // Standalone legal pages (src/legal): dist/gizlilik/index.html, dist/kvkk/index.html, ...
        gizlilik: resolve(__dirname, 'gizlilik/index.html'),
        kvkk: resolve(__dirname, 'kvkk/index.html'),
        kullanimSartlari: resolve(__dirname, 'kullanim-sartlari/index.html'),
        cerezPolitikasi: resolve(__dirname, 'cerez-politikasi/index.html'),
      },
    },
  },
})
