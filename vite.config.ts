import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { introCriticalCss, introHeadScript, introMarkup } from './src/site/intro/intro-document';

/**
 * Injects the brand intro into index.html: the pre-paint head script,
 * the intro's critical CSS and its markup. Generated from the same logo
 * geometry the React components use (src/site/brand/logo-geometry.ts), so the
 * logo starts drawing on first paint, before the JS bundle has downloaded.
 */
/**
 * On public routes, start downloading the public-site chunk (and, on the home
 * page, the home chunk) and the two hero fonts in parallel with the main
 * bundle, instead of after it has run. File names come from the final bundle.
 */
function ampPublicPreload(): Plugin {
  return {
    name: 'amp-public-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const chunks = Object.values(bundle).filter((c): c is Extract<typeof c, { type: 'chunk' }> => c.type === 'chunk');
        // A dynamic entry's facadeModuleId can be null when it shares the
        // chunk with other modules, so match on the modules it contains.
        const byFacade = (suffix: string) => chunks.find((c) => c.facadeModuleId?.endsWith(suffix) || (c.isDynamicEntry && c.moduleIds.some((m) => m.endsWith(suffix))));
        const collect = (suffix: string) => {
          const js = new Set<string>();
          const css = new Set<string>();
          const visit = (file: string) => {
            const c = chunks.find((x) => x.fileName === file);
            if (!c || js.has(file)) return;
            js.add(file);
            c.viteMetadata?.importedCss.forEach((f) => css.add(f));
            c.imports.forEach(visit);
          };
          const entry = byFacade(suffix);
          if (entry) visit(entry.fileName);
          return { js, css };
        };
        const entries = chunks.filter((c) => c.isEntry);
        const entryFiles = new Set(entries.flatMap((c) => [c.fileName, ...c.imports, ...(c.viteMetadata?.importedCss ?? [])]));
        const site = collect('src/site/layout/PublicSite.tsx');
        const home = collect('src/site/home/HomePage.tsx');
        const fonts = Object.keys(bundle).filter((f) => /(manrope-latin-wght-normal|cormorant-garamond-latin-500-normal)-[\w-]+\.woff2$/.test(f));
        const list = (s: Set<string>) => JSON.stringify([...s].filter((f) => !entryFiles.has(f)).map((f) => '/' + f));
        const script = `(function(){var p=location.pathname;if(/^\\/(staff|guest|invoice|invoice-debug|receipt-preview|task-complete|review)(\\/|$)/.test(p))return;var h=document.head,a=function(href,rel,as,type){var l=document.createElement('link');l.rel=rel;l.href=href;if(as)l.as=as;if(type)l.type=type;if(rel==='modulepreload'||as==='font')l.crossOrigin='';h.appendChild(l)};${list(site.js)}.forEach(function(f){a(f,'modulepreload')});${list(site.css)}.forEach(function(f){a(f,'preload','style')});${JSON.stringify(fonts.map((f) => '/' + f))}.forEach(function(f){a(f,'preload','font','font/woff2')});if(p==='/'||p===''){${list(home.js)}.forEach(function(f){a(f,'modulepreload')});${list(home.css)}.forEach(function(f){a(f,'preload','style')})}})();`;
        // Before the first stylesheet: an inline script after a pending
        // stylesheet would wait for the CSS before it could run.
        const at = html.indexOf('<link rel="stylesheet"');
        return at === -1 ? html.replace('</head>', `<script>${script}</script>\n</head>`) : `${html.slice(0, at)}<script>${script}</script>\n  ${html.slice(at)}`;
      },
    },
  };
}

function ampIntro(): Plugin {
  return {
    name: 'amp-intro',
    transformIndexHtml(html) {
      // The head script goes straight after the viewport meta: after it, so a
      // phone's media queries see the real device width rather than the 980 px
      // default (which picked the wrong poster); before the stylesheet, so it
      // runs without waiting for CSS and starts the poster preload early.
      const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />';
      if (!html.includes(viewport)) throw new Error('amp-intro: viewport meta not found in index.html');
      return {
        html: html
          .replace(viewport, `${viewport}\n  <script>${introHeadScript}</script>`)
          .replace('<body>', `<body>\n${introMarkup()}`),
        tags: [{ tag: 'style', attrs: { id: 'amp-intro-css' }, children: introCriticalCss, injectTo: 'head' }],
      };
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ampIntro(), ampPublicPreload()],
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
        // Strip noisy logging from production bundles (600+ call sites) but
        // keep console.warn/error so Sentry breadcrumbs and real failures
        // stay visible in the field.
        pure_funcs: mode === 'production' ? ['console.log', 'console.info', 'console.debug'] : [],
        drop_debugger: mode === 'production',
      },
    },
    rollupOptions: {
      output: {
        // Function form, so each named chunk holds only that library's own
        // modules. The object form pulled shared helpers (clsx) into `charts`,
        // which made every page, including the public site, download recharts.
        manualChunks(id) {
          // Rollup's shared CommonJS interop helper is used by every CJS
          // package; keep it with the always-loaded vendor chunk.
          if (id.includes('commonjsHelpers')) return 'vendor';
          if (!id.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser|clsx|tailwind-merge)\//.test(id)) return 'vendor';
          if (/\/node_modules\/(recharts|recharts-scale|victory-vendor|d3-[^/]+|internmap|decimal\.js-light|react-smooth|fast-equals)\//.test(id)) return 'charts';
          if (/\/node_modules\/@supabase\//.test(id)) return 'supabase';
          if (/\/node_modules\/date-fns\//.test(id)) return 'dates';
          return undefined;
        },
      },
    },
  },
}));