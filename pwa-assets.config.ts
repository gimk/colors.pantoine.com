import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

/**
 * The app icons, drawn from the favicon.
 *
 * Run by hand (`npm run icons`) whenever favicon.svg changes; the PNGs are
 * committed, so a deploy does not need an image toolchain.
 */
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/favicon.svg'],
})
