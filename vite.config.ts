import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'events': 'events',
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: {
      // Proxy API calls to Netlify Functions (expects netlify dev to be running on port 8888)
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/.netlify/functions'),
      },
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: mode === 'development',
    minify: mode === 'production' ? 'terser' : false,
    terserOptions: {
      compress: {
        drop_console: false, // Keep console logs for debugging
        drop_debugger: mode === 'production',
      },
    },
    rollupOptions: {
      output: {
        // Split big vendors into separate long-cacheable chunks so a single
        // app-code change doesn't bust the heavy framework/UI bundles.
        // Especially valuable in Ghana where each MB over the wire = ~1s.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-router-dom')) return 'router'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('@radix-ui')) return 'radix'
          if (id.includes('pouchdb')) return 'pouch'
          if (id.includes('date-fns')) return 'dates'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('@google/generative-ai')) return 'gemini'
          if (id.includes('jspdf') || id.includes('pdf-lib') || id.includes('html2canvas')) return 'pdf'
          if (id.includes('@dnd-kit')) return 'dnd'
          return 'vendor'
        },
      },
    },
  },
}));