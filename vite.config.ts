import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Vitest stubs CSS imports as empty by default. The border tests read the
    // stylesheet as text (`styles.css?raw`), which needs it processed.
    css: true,
  },
})
