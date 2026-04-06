import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

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