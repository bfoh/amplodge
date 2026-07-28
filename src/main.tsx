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
  // When a *replacement* SW takes control, reload once so the page runs the
  // fixed code. We only reload when a controller already existed at load time —
  // on a first-ever install `controllerchange` also fires (via clients.claim())
  // and we must NOT reload then, nor loop.
  const hadControllerAtLoad = !!navigator.serviceWorker.controller
  let reloadedForUpdate = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad || reloadedForUpdate) return
    reloadedForUpdate = true
    window.location.reload()
  })

  // Ask a waiting worker to activate immediately so fixes reach the device now
  // instead of lingering until every tab is closed.
  const promote = (registration: ServiceWorkerRegistration) => {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[SW] ✅ Service Worker registered. Scope:', registration.scope)

        // A newer SW is already waiting from a previous visit — promote it now.
        promote(registration)

        // Promote future updates as soon as they finish installing.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              promote(registration)
            }
          })
        })

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