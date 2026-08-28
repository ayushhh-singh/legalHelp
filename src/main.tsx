import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './app/App'
import i18n, { i18nReady } from './i18n'
import './styles/fonts.css'
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

// The active language's strings are their own chunk now (ADR-031), so the
// first render waits for it. Without this await the shell paints one frame of
// bare translation keys — i18next returns the key when a namespace has not
// loaded, and `useSuspense: false` means nothing holds the tree back. The
// chunk is same-origin, precached and already in flight by the time this line
// runs, so the wait is a microtask on a warm load.
void i18nReady.finally(() => {
  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
