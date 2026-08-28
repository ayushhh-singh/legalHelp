import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './app/App'
import i18n from './i18n'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

// index.html ships lang="en"; correct it to the detected language before the
// first paint, so assistive tech announces Hindi correctly from the start.
document.documentElement.lang = i18n.language

// Dev-only accessibility reporter. Never bundled into the production build,
// and it makes no network requests.
if (import.meta.env.DEV) {
  void import('./app/axe-dev').then(({ startAxeReporter }) => {
    startAxeReporter()
  })
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
