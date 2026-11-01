/**
 * Build-time pieces of the brand intro, injected into index.html by the
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
/**
 * The hero poster the head script starts downloading. Must pick exactly the
 * file the hero's <picture> will pick (ArrivalFilm.tsx), or it downloads twice:
 * phones get the portrait crop; wider screens the smallest landscape width that
 * covers the viewport at the device's pixel ratio, as srcset does.
 */
export const HERO_POSTER = {
  portrait: '/images/hero/amp-lodge-arrival-portrait-720.webp',
  base: '/images/hero/amp-lodge-arrival',
  widths: [1280, 1600, 1920],
  mobileQuery: '(max-width: 47.99rem)',
} as const

/**
 * Runs inline in <head> before first paint, on every route (staff included —
 * it only sets attributes). It records:
 *  - html.amp-site-theme on public routes (PublicSite also manages it);
 *  - html[data-motion="full"|"reduce"] from prefers-reduced-motion;
 *  - html[data-lite] for Save-Data or very low-memory / low-core devices;
 *  - html[data-intro="play"] only for a first visit this session, on the home
 *    page, with motion allowed (phones, tablets and desktop alike);
 *  - html[data-home] on the home page;
 * and starts the hero poster download on the home page. It is held as an
 * Image object (not a <link rel=preload>) so the response stays in memory
 * until the hero's <img> asks for it: on slow connections a preload was
 * dropped before React rendered the hero, and the poster downloaded twice.
 * The same Image is then painted by the static poster (introMarkup).
 */
export const introHeadScript = `(function(){var d=document.documentElement,p=location.pathname,home=p==="/"||p==="";try{if(!/^\\/(staff|guest|invoice|invoice-debug|receipt-preview|task-complete|review)(\\/|$)/.test(p))d.classList.add("amp-site-theme");var r=matchMedia("(prefers-reduced-motion: reduce)").matches;d.setAttribute("data-motion",r?"reduce":"full");var n=navigator,c=n.connection||{};if(c.saveData||(n.deviceMemory&&n.deviceMemory<=2)||(n.hardwareConcurrency&&n.hardwareConcurrency<=2))d.setAttribute("data-lite","");var seen=false;try{seen=!!sessionStorage.getItem("${INTRO_SESSION_KEY}")}catch(e){}if(home&&!r&&!seen){d.setAttribute("data-intro","play");var k=function(){d.setAttribute("data-intro-skip","");removeEventListener("keydown",k)};addEventListener("keydown",k)}if(home){d.setAttribute("data-home","");var im=new Image();im.fetchPriority="high";im.decoding="async";var ws=[${HERO_POSTER.widths.join(',')}],need=innerWidth*(devicePixelRatio||1),w=ws[ws.length-1];for(var i=0;i<ws.length;i++){if(ws[i]>=need){w=ws[i];break}}im.src=matchMedia("${HERO_POSTER.mobileQuery}").matches?"${HERO_POSTER.portrait}":"${HERO_POSTER.base}-"+w+".webp";window.__ampPoster=im}}catch(e){}})();`

/**
 * Critical CSS for the intro. Inlined so it applies before the app stylesheet
 * arrives. Every first frame equals the start of its animation, so what paints
 * before any script runs is exactly frame 0.
 *
 * Timeline (seconds from first paint), lengthened on the owner's request
 * (2026-11-01) so the mark stays a few seconds longer:
 * A 0.15–1.25 · M 0.45–1.55 · P 0.75–1.85 · dots 1.05 / 1.3 · bar wipe
 * 1.1–2.3 · glow 1.4 · rule 0.6–2.4 · "Kumasi · Ghana" 1.8 · gold sweep
 * 2.2–3.6 · "Your comfort. Our priority." 2.6 · the mark settles from 96 % to
 * full size over 4.2 s. React opens the curtain at 4.2 s if the page is ready
 * (BrandIntro.tsx), so the whole intro lands at ≈5.2 s. Skip, Escape or any
 * key ends it at once.
 */
export const introCriticalCss = `
#amp-poster{display:none}
html[data-home] #amp-poster{display:block;position:absolute;top:0;left:0;z-index:1;width:100%;height:100vh;height:100svh;min-height:34rem;overflow:hidden;pointer-events:none;background:#121312}
#amp-poster img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.02)}
#amp-poster:after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 70% 75% at 8% 80%,rgba(10,10,9,.66) 0%,rgba(10,10,9,.34) 50%,rgba(10,10,9,0) 80%),linear-gradient(to top,rgba(10,10,9,.9) 0%,rgba(10,10,9,.58) 40%,rgba(10,10,9,.06) 72%),linear-gradient(to bottom,rgba(10,10,9,.5),rgba(10,10,9,0) 22%)}
@media (min-width:48rem){#amp-poster:after{background:radial-gradient(ellipse 60% 80% at 10% 78%,rgba(10,10,9,.62) 0%,rgba(10,10,9,.3) 52%,rgba(10,10,9,0) 82%),linear-gradient(to top,rgba(10,10,9,.86) 0%,rgba(10,10,9,.42) 36%,rgba(10,10,9,.04) 66%),linear-gradient(to bottom,rgba(10,10,9,.5),rgba(10,10,9,0) 22%)}}
#amp-intro{display:none}
html[data-intro="play"]:not([data-intro-done]){overflow:hidden}
html[data-intro="play"]:not([data-intro-done]) #amp-intro{display:block;position:fixed;inset:0;z-index:2147483000;color:${LOGO_COLORS.ivory};animation:ai-failsafe .6s ease 11s forwards}
html[data-intro="play"][data-motion-ready] #amp-intro{animation:none}
html[data-intro-skip]:not([data-motion-ready]) #amp-intro{display:none!important}
.amp-intro__curtain{position:absolute;top:0;bottom:0;width:50.5%;background:#121312;will-change:transform}
.amp-intro__curtain--l{left:0}.amp-intro__curtain--r{right:0}
.amp-intro__atmos{position:absolute;inset:0;pointer-events:none;background:radial-gradient(70% 55% at 50% 46%,rgba(93,47,49,.42) 0%,rgba(18,19,18,0) 72%)}
.amp-intro__glow{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(36% 24% at 50% 46%,rgba(188,147,84,.30) 0%,rgba(188,147,84,0) 70%);animation:ai-fade 1.6s cubic-bezier(.22,1,.36,1) 1.4s forwards}
.amp-intro__stage{--w:min(64vw,15.5rem);position:absolute;left:50%;top:46%;width:var(--w);height:calc(var(--w) * ${(247 / 902).toFixed(5)});margin-left:calc(var(--w) / -2);margin-top:calc(var(--w) * ${(-247 / 902 / 2).toFixed(5)});transform-origin:0 0;will-change:transform}
.amp-intro__layer{position:absolute;inset:0;width:100%;height:100%;overflow:visible;transform:scale(.96);transform-origin:50% 50%;animation:ai-settle 4.2s cubic-bezier(.22,1,.36,1) forwards}
.amp-intro__layer--bar{clip-path:inset(0 100% 0 0);animation:ai-settle 4.2s cubic-bezier(.22,1,.36,1) forwards,ai-wipe 1.2s cubic-bezier(.65,0,.35,1) 1.1s forwards}
.ai-stroke{fill:none;stroke:#fff;stroke-width:${LOGO_STROKE_MASK_WIDTH};stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1 2;stroke-dashoffset:1.05;animation:ai-draw 1.1s cubic-bezier(.65,0,.35,1) forwards}
.ai-stroke--a{animation-delay:.15s}.ai-stroke--m{animation-delay:.45s}.ai-stroke--p{animation-delay:.75s}
.ai-dot{transform-box:fill-box;transform-origin:50% 50%;transform:scale(0);animation:ai-pop .7s cubic-bezier(.22,1,.36,1) forwards}
.ai-dot--a{animation-delay:1.05s}.ai-dot--m{animation-delay:1.3s}
.ai-sweep{transform:translateX(0);animation:ai-sweep 1.4s cubic-bezier(.4,0,.2,1) 2.2s forwards}
.amp-intro__rule{position:absolute;left:50%;top:calc(100% + 1.6rem);width:6.5rem;height:1px;margin-left:-3.25rem;background:#BC9354;transform:scaleX(0);animation:ai-rule 1.8s cubic-bezier(.65,0,.35,1) .6s forwards}
.amp-intro__caption{position:absolute;left:50%;top:calc(100% + 2.6rem);transform:translateX(-50%);white-space:nowrap;font:600 .625rem/1 system-ui,-apple-system,sans-serif;letter-spacing:.32em;text-transform:uppercase;color:rgba(245,240,232,.62);opacity:0;animation:ai-fade 1.2s cubic-bezier(.22,1,.36,1) 1.8s forwards}
.amp-intro__motto{position:absolute;left:50%;top:calc(100% + 4.1rem);transform:translateX(-50%);white-space:nowrap;font:italic 400 1.0625rem/1.2 Georgia,'Times New Roman',serif;letter-spacing:.01em;color:rgba(212,180,124,.92);opacity:0;animation:ai-fade 1.4s cubic-bezier(.22,1,.36,1) 2.6s forwards}
@media (min-width:64rem){.amp-intro__stage{--w:min(30vw,25rem)}.amp-intro__rule{top:calc(100% + 2.2rem);width:8rem;margin-left:-4rem}.amp-intro__caption{top:calc(100% + 3.4rem);font-size:.6875rem}.amp-intro__motto{top:calc(100% + 5.2rem);font-size:1.3125rem}}
.amp-intro__skip{position:absolute;left:50%;bottom:max(1.25rem,calc(env(safe-area-inset-bottom) + .75rem));transform:translateX(-50%);min-height:44px;padding:.85rem 1.25rem;border:0;background:none;color:rgba(245,240,232,.74);font:600 .6875rem/1 system-ui,-apple-system,sans-serif;letter-spacing:.24em;text-transform:uppercase;cursor:pointer;opacity:0;animation:ai-fade .6s ease .6s forwards;-webkit-tap-highlight-color:transparent}
.amp-intro__skip:focus-visible{outline:1px solid #BC9354;outline-offset:2px}
html[data-lite] .ai-stroke{animation-duration:.6s;animation-delay:0s}
html[data-lite] .ai-dot{animation-delay:.4s;animation-duration:.5s}
html[data-lite] .amp-intro__layer{animation:none;transform:none}
html[data-lite] .amp-intro__layer--bar{animation:ai-wipe .6s cubic-bezier(.65,0,.35,1) .4s forwards}
html[data-lite] .amp-intro__caption{animation-delay:.8s}html[data-lite] .amp-intro__motto{animation-delay:1.1s}
html[data-lite] .ai-sweep,html[data-lite] .amp-intro__glow{display:none}
@keyframes ai-draw{to{stroke-dashoffset:0}}
@keyframes ai-pop{to{transform:scale(1)}}
@keyframes ai-wipe{to{clip-path:inset(0 0 0 0)}}
@keyframes ai-sweep{to{transform:translateX(1500px)}}
@keyframes ai-rule{to{transform:scaleX(1)}}
@keyframes ai-fade{to{opacity:1}}
@keyframes ai-settle{to{transform:scale(1)}}
@keyframes ai-failsafe{to{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion: reduce){#amp-intro{display:none!important}}
`.trim()

function splitSubpaths(d: string): string[] {
  return d.split(/(?=M)/).map((s) => s.trim()).filter(Boolean)
}

/**
 * The hero photograph, painted from index.html on the home page: the poster the
 * head script is already downloading, shown full-screen with the hero's shading
 * until React's hero has the same picture decoded (ArrivalFilm.tsx removes it).
 * It sits under the intro's curtain, so the curtain opens onto the real
 * photograph, and on a repeat visit it shows before the JavaScript has arrived.
 */
const posterMarkup = `<div id="amp-poster" aria-hidden="true"></div>
<script>(function(){var im=window.__ampPoster,el=document.getElementById("amp-poster");if(im&&el){im.alt="";el.appendChild(im)}})();</script>`

/** Markup injected just after <body>. Decorative parts are aria-hidden; the Skip control is real. */
export function introMarkup(): string {
  const [dotA, dotM] = splitSubpaths(LOGO_PATHS.dots)
  const maskRegion = 'maskUnits="userSpaceOnUse" x="100" y="120" width="960" height="300"'
  const letter = (k: 'a' | 'm' | 'p') =>
    `<mask id="ai-mask-${k}" ${maskRegion}><path class="ai-stroke ai-stroke--${k}" pathLength="1" d="${LOGO_STROKES[k]}"/></mask>` +
    `<path d="${LOGO_PATHS[k]}" fill-rule="evenodd" mask="url(#ai-mask-${k})"/>`
  return `${posterMarkup}
<div id="amp-intro">
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
<span class="amp-intro__motto">Your comfort. Our priority.</span>
</div>
<button type="button" class="amp-intro__skip" onclick="document.documentElement.setAttribute('data-intro-skip','')">Skip intro</button>
</div>`
}
