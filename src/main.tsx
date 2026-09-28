import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Self-hosted rather than fetched from Google Fonts, so the font is part of the
// build and the service worker caches it with everything else.
import '@fontsource-variable/kode-mono'
import './styles.css'

const host = document.getElementById('root')
if (!host) throw new Error('#root missing from index.html')

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
