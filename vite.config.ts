import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Every edit is already saved to localStorage, so taking a new version
      // on the next load loses nothing and needs no "reload?" prompt.
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'COLORS // PANTOINE',
        short_name: 'Colors',
        description:
          'Generate perceptual tint and shade ramps in OKLCH, with draggable lightness, chroma and hue curves.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The build's own output, fonts included. The icons are precached by
        // `includeAssets` and the manifest, so globbing images would list them twice.
        globPatterns: ['**/*.{js,css,html,woff2}'],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // The 30,000-name dataset is most of the bundle and changes far
            // less often than the app. In a chunk of its own it keeps its hash
            // across releases, so an update does not re-download it, and each
            // file stays well clear of the service worker's 2 MiB precache cap.
            { name: 'color-names', test: /node_modules[\\/]color-name-list/ },
          ],
        },
      },
    },
  },
  test: {
    // Vitest stubs CSS imports as empty by default. The border tests read the
    // stylesheet as text (`styles.css?raw`), which needs it processed.
    css: true,
  },
})
