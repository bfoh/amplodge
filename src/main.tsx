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

// Register our offline-capable Service Worker
// (replaces the old "cleanup legacy SWs" logic)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[SW] ✅ Service Worker registered. Scope:', registration.scope)

        // Check for updates periodically
        setInterval(() => {
          registration.update()
        }, 60 * 60 * 1000) // Every hour
      })
      .catch((error) => {
        console.warn('[SW] ⚠️ Service Worker registration failed:', error)
      })
  })
}

// BUILD VERSION CHECK
console.log('🚀 BUILD TIMESTAMP: ' + new Date().toISOString())
console.log('📧 Email Service Endpoint: /.netlify/functions/send-email')
console.log('📴 Offline Mode: ENABLED')

ReactDOM.createRoot(document.getElementById('app-root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
) 