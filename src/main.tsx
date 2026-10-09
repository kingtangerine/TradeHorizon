import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { installErrorReporting } from './app/errorReport'
import { applyTheme, initialTheme } from './app/theme'
import './styles.css'

applyTheme(initialTheme())
installErrorReporting()

// The service worker delivers price alerts while the app is closed and lets the app be installed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
