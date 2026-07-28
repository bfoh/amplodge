import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App'
import './index.css'

// Sentry browser SDK — guarded on VITE_SENTRY_DSN so dev/preview without
// a DSN remain a no-op. PII suppressed via sendDefaultPii: false +
// beforeSend Authorization redaction.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip Supabase JWT from request headers in any captured event
      const headers = event.request?.headers as Record<string, string> | undefined
      if (headers && 'Authorization' in headers) {
        headers.Authorization = '[REDACTED]'
      }
      return event
    },
  })
}

// PWA removed. Unregister any lingering service workers and drop their caches
// so previously installed clients stop serving the stale cached app shell.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((reg) => reg.unregister()))
    .catch(() => {})
  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => keys.forEach((key) => caches.delete(key)))
      .catch(() => {})
  }
}

ReactDOM.createRoot(document.getElementById('app-root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
) 