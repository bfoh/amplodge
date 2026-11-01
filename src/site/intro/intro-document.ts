/**
 * Build-time pieces of the mobile brand intro, injected into index.html by the
 * `ampIntro` Vite plugin (vite.config.ts). Framework-free on purpose: the Vite
 * config imports this file, so it must not import React or use the `@/` alias.
 *
 * Why the intro lives in index.html rather than in React: the logo can start
 * drawing on the very first paint, while the JavaScript bundle is still
 * downloading on a slow mobile connection. React (BrandIntro.tsx) only takes
 * over for the hand-off: opening the curtain once the real page exists and
 * flying the mark into the header. Nothing here fakes progress.
 */
import { LODGE_PLATE, LOGO_COLORS, LOGO_PATHS, LOGO_STROKE_MASK_WIDTH, LOGO_STROKES, LOGO_VIEWBOX } from '../brand/logo-geometry'

/** sessionStorage key: the intro has played in this tab session. */
export const INTRO_SESSION_KEY = 'amp:intro'
/** Below this width the intro plays (phones and portrait tablets). Matches Tailwind `lg`. */
export const INTRO_MAX_WIDTH = '(max-width: 63.98rem)'
export const HERO_POSTER = {
  mobile: '/videos/hero/amp-lodge-hero-poster-960.webp',
  desktop: '/videos/hero/amp-lodge-hero-poster-1920.webp',
  mobileQuery: '(max-width: 47.99rem)',
} as const

/**
 * Runs inline in <head> before first paint, on every route (staff included —
 * it only sets attributes). It records:
 *  - html.amp-site-theme on public routes (PublicSite also manages it);
 *  - html[data-motion="full"|"reduce"] from prefers-reduced-motion;
 *  - html[data-lite] for Save-Data or very low-memory / low-core devices;
 *  - html[data-intro="play"] only for a first visit this session, on the home
 *    page, on a small screen, with motion allowed;
 * and starts the hero poster download on the home page. It is held as an
 * Image object (not a <link rel=preload>) so the response stays in memory
 * until the hero's <img> asks for it: on slow connections a preload was
 * dropped before React rendered the hero, and the poster downloaded twice.
 */
export const introHeadScript = `(function(){var d=document.documentElement,p=location.pathname,home=p==="/"||p==="";try{if(!/^\\/(staff|guest|invoice|invoice-debug|receipt-preview|task-complete|review)(\\/|$)/.test(p))d.classList.add("amp-site-theme");var r=matchMedia("(prefers-reduced-motion: reduce)").matches;d.setAttribute("data-motion",r?"reduce":"full");var n=navigator,c=n.connection||{};if(c.saveData||(n.deviceMemory&&n.deviceMemory<=2)||(n.hardwareConcurrency&&n.hardwareConcurrency<=2))d.setAttribute("data-lite","");var seen=false;try{seen=!!sessionStorage.getItem("${INTRO_SESSION_KEY}")}catch(e){}if(home&&!r&&!seen&&matchMedia("${INTRO_MAX_WIDTH}").matches){d.setAttribute("data-intro","play");var k=function(){d.setAttribute("data-intro-skip","");removeEventListener("keydown",k)};addEventListener("keydown",k)}if(home){var im=new Image();im.fetchPriority="high";im.decoding="async";im.src=matchMedia("${HERO_POSTER.mobileQuery}").matches?"${HERO_POSTER.mobile}":"${HERO_POSTER.desktop}";window.__ampPoster=im}}catch(e){}})();`

/**
 * Critical CSS for the intro. Inlined so it applies before the app stylesheet
 * arrives. Every first frame equals the start of its animation, so what paints
 * before any script runs is exactly frame 0.
 *
 * Timeline (seconds from first paint): A 0.10–0.80 · M 0.28–0.98 · P 0.46–1.16
 * · dots 0.62 / 0.78 · bar wipe 0.62–1.37 · gold sweep 1.05–2.05 · glow 0.85.
 * React opens the curtain once these finish and the page is mounted
 * (≈1.3–1.5 s on a capable phone), so the whole intro lands at ≈2.1–2.3 s.
 */
export const introCriticalCss = `
#amp-intro{display:none}
html[data-intro="play"]:not([data-intro-done]){overflow:hidden}
html[data-intro="play"]:not([data-intro-done]) #amp-intro{display:block;position:fixed;inset:0;z-index:2147483000;color:${LOGO_COLORS.ivory};animation:ai-failsafe .6s ease 9s forwards}
html[data-intro="play"][data-motion-ready] #amp-intro{animation:none}
html[data-intro-skip]:not([data-motion-ready]) #amp-intro{display:none!important}
.amp-intro__curtain{position:absolute;top:0;bottom:0;width:50.5%;background:#121312;will-change:transform}
.amp-intro__curtain--l{left:0}.amp-intro__curtain--r{right:0}
.amp-intro__atmos{position:absolute;inset:0;pointer-events:none;background:radial-gradient(70% 55% at 50% 46%,rgba(93,47,49,.42) 0%,rgba(18,19,18,0) 72%)}
.amp-intro__glow{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(36% 24% at 50% 46%,rgba(188,147,84,.30) 0%,rgba(188,147,84,0) 70%);animation:ai-fade 1.1s cubic-bezier(.22,1,.36,1) .85s forwards}
.amp-intro__stage{--w:min(64vw,15.5rem);position:absolute;left:50%;top:46%;width:var(--w);height:calc(var(--w) * ${(247 / 902).toFixed(5)});margin-left:calc(var(--w) / -2);margin-top:calc(var(--w) * ${(-247 / 902 / 2).toFixed(5)});transform-origin:0 0;will-change:transform}
.amp-intro__layer{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.amp-intro__layer--bar{clip-path:inset(0 100% 0 0);animation:ai-wipe .75s cubic-bezier(.65,0,.35,1) .62s forwards}
.ai-stroke{fill:none;stroke:#fff;stroke-width:${LOGO_STROKE_MASK_WIDTH};stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1 2;stroke-dashoffset:1.05;animation:ai-draw .7s cubic-bezier(.65,0,.35,1) forwards}
.ai-stroke--a{animation-delay:.1s}.ai-stroke--m{animation-delay:.28s}.ai-stroke--p{animation-delay:.46s}
.ai-dot{transform-box:fill-box;transform-origin:50% 50%;transform:scale(0);animation:ai-pop .55s cubic-bezier(.22,1,.36,1) forwards}
.ai-dot--a{animation-delay:.62s}.ai-dot--m{animation-delay:.78s}
.ai-sweep{transform:translateX(0);animation:ai-sweep 1s cubic-bezier(.4,0,.2,1) 1.05s forwards}
.amp-intro__rule{position:absolute;left:50%;top:calc(100% + 1.6rem);width:6.5rem;height:1px;margin-left:-3.25rem;background:#BC9354;transform:scaleX(0);animation:ai-rule 1.2s cubic-bezier(.65,0,.35,1) .3s forwards}
.amp-intro__caption{position:absolute;left:50%;top:calc(100% + 2.6rem);transform:translateX(-50%);white-space:nowrap;font:600 .625rem/1 system-ui,-apple-system,sans-serif;letter-spacing:.32em;text-transform:uppercase;color:rgba(245,240,232,.62);opacity:0;animation:ai-fade .9s cubic-bezier(.22,1,.36,1) 1s forwards}
.amp-intro__skip{position:absolute;left:50%;bottom:max(1.25rem,calc(env(safe-area-inset-bottom) + .75rem));transform:translateX(-50%);min-height:44px;padding:.85rem 1.25rem;border:0;background:none;color:rgba(245,240,232,.74);font:600 .6875rem/1 system-ui,-apple-system,sans-serif;letter-spacing:.24em;text-transform:uppercase;cursor:pointer;opacity:0;animation:ai-fade .6s ease .45s forwards;-webkit-tap-highlight-color:transparent}
.amp-intro__skip:focus-visible{outline:1px solid #BC9354;outline-offset:2px}
html[data-lite] .ai-stroke{animation-duration:.4s;animation-delay:0s}
html[data-lite] .ai-dot,html[data-lite] .amp-intro__layer--bar{animation-delay:.25s;animation-duration:.4s}
html[data-lite] .ai-sweep,html[data-lite] .amp-intro__glow{display:none}
@keyframes ai-draw{to{stroke-dashoffset:0}}
@keyframes ai-pop{to{transform:scale(1)}}
@keyframes ai-wipe{to{clip-path:inset(0 0 0 0)}}
@keyframes ai-sweep{to{transform:translateX(1500px)}}
@keyframes ai-rule{to{transform:scaleX(1)}}
@keyframes ai-fade{to{opacity:1}}
@keyframes ai-failsafe{to{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion: reduce){#amp-intro{display:none!important}}
`.trim()

function splitSubpaths(d: string): string[] {
  return d.split(/(?=M)/).map((s) => s.trim()).filter(Boolean)
}

/** Markup injected just after <body>. Decorative parts are aria-hidden; the Skip control is real. */
export function introMarkup(): string {
  const [dotA, dotM] = splitSubpaths(LOGO_PATHS.dots)
  const maskRegion = 'maskUnits="userSpaceOnUse" x="100" y="120" width="960" height="300"'
  const letter = (k: 'a' | 'm' | 'p') =>
    `<mask id="ai-mask-${k}" ${maskRegion}><path class="ai-stroke ai-stroke--${k}" pathLength="1" d="${LOGO_STROKES[k]}"/></mask>` +
    `<path d="${LOGO_PATHS[k]}" fill-rule="evenodd" mask="url(#ai-mask-${k})"/>`
  return `<div id="amp-intro">
<div class="amp-intro__curtain amp-intro__curtain--l" aria-hidden="true"></div>
<div class="amp-intro__curtain amp-intro__curtain--r" aria-hidden="true"></div>
<div class="amp-intro__atmos" aria-hidden="true"></div>
<div class="amp-intro__glow" aria-hidden="true"></div>
<div class="amp-intro__stage" aria-hidden="true">
<svg class="amp-intro__layer amp-intro__layer--bar" viewBox="${LOGO_VIEWBOX}" focusable="false">
<defs><clipPath id="ai-bar-clip"><path d="${LOGO_PATHS.bar}" clip-rule="evenodd"/></clipPath>
<linearGradient id="ai-sweep-grad" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff6dc" stop-opacity="0"/><stop offset=".5" stop-color="#fff6dc" stop-opacity=".78"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></linearGradient></defs>
<rect x="${LODGE_PLATE.x}" y="${LODGE_PLATE.y}" width="${LODGE_PLATE.width}" height="${LODGE_PLATE.height}" rx="${LODGE_PLATE.rx}" fill="${LOGO_COLORS.burgundy}"/>
<path d="${LOGO_PATHS.bar}" fill="${LOGO_COLORS.barGold}" fill-rule="evenodd"/>
<g clip-path="url(#ai-bar-clip)"><rect class="ai-sweep" x="-260" y="300" width="200" height="100" fill="url(#ai-sweep-grad)" transform-origin="0 0"/></g>
</svg>
<svg class="amp-intro__layer amp-intro__layer--letters" viewBox="${LOGO_VIEWBOX}" fill="currentColor" focusable="false">
${letter('a')}${letter('m')}${letter('p')}
<path class="ai-dot ai-dot--a" d="${dotA}"/><path class="ai-dot ai-dot--m" d="${dotM}"/>
</svg>
<span class="amp-intro__rule"></span>
<span class="amp-intro__caption">Kumasi &middot; Ghana</span>
</div>
<button type="button" class="amp-intro__skip" onclick="document.documentElement.setAttribute('data-intro-skip','')">Skip intro</button>
</div>`
}
