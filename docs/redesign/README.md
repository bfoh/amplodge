# AMP Lodge: cinematic public site

The public website (`/`, `/rooms`, `/rooms/:slug`, `/gallery`, `/virtual-tour`, `/contact`, `/booking`, 404) was rebuilt on the existing stack: Vite 7, React 19, React Router 7, Tailwind 3 and Supabase. The staff portal (`/staff/*`), guest portal (`/guest/*`), invoices and review links are untouched.

See [AUDIT.md](AUDIT.md) for the data and asset findings and for the items the owner must confirm, and [FILM-MANIFEST.md](FILM-MANIFEST.md) for how each clip of the arrival film was generated, what it cost and its known flaws.

## Where things are

| Path | What |
| --- | --- |
| `src/site/layout/PublicSite.tsx` | Shell and routes, loaded as its own chunk (staff sessions never download it). Adds `html.amp-site-theme` while mounted. |
| `src/site/styles/site.css` | Fonts (Cormorant Garamond and Manrope, self-hosted), tokens, shadcn token overrides scoped to the site, buttons, header and menu, booking bar, lightbox, motion gating and failsafes, reduced motion |
| `tailwind.config.cjs` | `amp-*` colours, `font-display` / `font-ui`, `ease-editorial` / `ease-mask` / `ease-soft`, `max-w-site`, `px-gutter` |
| `src/site/intro/` | The mobile brand intro: `intro-document.ts` (head script, critical CSS and markup, injected into `index.html` by the `ampIntro` plugin in `vite.config.ts`) and `BrandIntro.tsx` (state machine and hand-off) |
| `src/site/brand/` | Traced logo geometry and `<AmpLogo>` |
| `src/site/motion/` | `Reveal`, `SplitHeading`, `ImageReveal`, `Parallax`, `SmoothScroll` (Lenis on fine pointers only), intro and page-ready signals, scroll lock |
| `src/site/film/` | The arrival film (home chapters 01–08): `ArrivalFilm.tsx` (stage, master timeline, copy, fallbacks), `FrameSequence.ts` (canvas frame player), `film-data.ts` (clips, stills, focal points, the three film rooms), `frames.generated.ts` (frame counts, generated) |
| `src/site/home/` | Chapters 09–14 and `HomePage.tsx` |
| `src/site/pages/` | Rooms, room detail, gallery, contact, virtual tour, 404 |
| `src/site/data/` | `photos.ts` (registry and alt text), `rooms.ts` (live rooms, de-duplication, `isBookableOnline`, booking deep links), `reviews.ts`, `site.ts` (contact facts with sources) |
| `src/site/seo/useDocumentMeta.ts` | Per-route title, description, canonical and Open Graph |
| `index.html` | Default meta, Open Graph and `LodgingBusiness` JSON-LD |
| `public/robots.txt`, `public/sitemap.xml` | Crawling |
| `vite.config.ts` | `ampIntro` (injects the intro into `index.html`), `ampPublicPreload` (preloads public chunks and hero fonts on public routes), function-form `manualChunks` |
| `scripts/build-film-frames.mjs` | Turns the generated clips in `media/` into the WebP frame sequences in `public/film/` |
| `public/film/` | Frame sequences, 13 MB (a visitor downloads only what they scroll to) |
| `netlify.toml` | Cache headers for `/images/*`, `/videos/*` (posters) and `/film/*` |

## The home page, chapter by chapter

| # | Chapter | What happens | Phones | Reduced motion |
| --- | --- | --- | --- | --- |
| 01–08 | The arrival film | One continuous scroll-driven film: arrival, the approach, the threshold, inside, the rooms, then the Standard Room, Family Room and Executive Suite. See below. | own frame crops and transitions | one screen (poster and copy), then a static captioned sequence |
| 09 | Choose your stay | The film's last frame settles into a print and hands over to the room navigator: all five live room types, the film's three first. Desktop: hover or focus a room to change the large preview. | every room stacked with its own photo | same, static |
| 10 | Comfort in the details | sticky text; photos drift (parallax) | 2-up grid | static |
| 11 | Gallery | clip-path mask reveals; every photo opens in the lightbox | same | static |
| 12 | Hospitality | statement; real reviews only when they qualify | same | static |
| 13 | Location | click-to-load map | same | same |
| 14 | Final invitation | dark closing frame (the lodge at night); two lines drift in opposite directions, hairline draws; Book Your Stay and Explore Rooms | reduced drift | static |

## The arrival film

**How it works:**
- **One master timeline.** A GSAP timeline is scrubbed (`scrub: 0.6`) by a single ScrollTrigger on a tall track (880svh on desktop, 680svh below 64 rem) holding a `position: sticky` stage.
- **Native scrolling.** No pinning by JavaScript and no snapping. Scrolling back plays the film backwards. Lenis smooths it on fine pointers only.
- **Clips are WebP frame sequences drawn to a canvas** (`FrameSequence.ts`), not video, so scrubbing is exact in both directions on every browser.
  - The canvas covers the stage, cropped around each clip's focal point. Its backing store is capped at 1.5× device pixel ratio.
  - Frames load coarse to fine (every 8th, 4th, 2nd, then every frame). The player draws the nearest loaded frame, so scrubbing never waits on the network.
  - Desktop uses `d-` frames (48 per clip, ≤ 1280 px wide). Phones use `m-` frames (32 per clip, a 480×720 crop at the focal point).
- **Loading order.** Nothing loads until the intro has finished, the page has loaded and the hero has settled (about 1.2 s, then idle time), or until the visitor first scrolls, touches, clicks or presses a key. Then the arrival and approach clips load, and every scene change loads the current clip and the next two.
- **Transitions are made in the page**, not generated: an exposure dip, a door-shaped aperture, a wipe with a gold door edge, a framed print. Photographs show each space but not how they connect, so the film cuts rather than inventing a path.

| Scene | Timeline | Picture | Copy |
| --- | --- | --- | --- |
| 01 Arrival | 0–0.95 | the dusk clip scrubs; the camera leans in; the hero copy fades on the first scroll | "Arrive. Unwind. Feel at Home.", Book Your Stay, Explore Rooms |
| 02 The approach | 0.95–2.0 | exposure dips; the night clip; a push toward the gate | "02 The approach", the address |
| 03 The threshold | 2.0–2.65 | the camera presses into the gate while a narrow, door-shaped aperture between the pillars opens onto the corridor; light shifts from cool to warm | — |
| 04 Inside | 2.65–3.65 | the corridor dolly | "The AMP Lodge experience / Comfort begins the moment you arrive." |
| 05 The rooms | 3.65–4.55 | the corridor dims; a door-like wipe with a gold edge opens on the Standard Room | "Three Ways to Feel at Home. / Discover your perfect space." |
| 06 Standard Room | 4.55–5.95 | Standard clip | name, tagline, guests, live rate, Book This Room, View details |
| 07 Family Room | 5.95–7.3 | desktop: the Standard Room contracts into a portrait print and the Family Room appears in it. Phones: the Family Room wipes in from the right | as above |
| 08 Executive Suite | 7.3–8.55 | expands out of the print (desktop) or from the centre to full bleed | as above, with "Enquire about this suite" (enquiry only) |
| 09 hand-off | 8.55–9.25 | the last frame settles into an editorial frame | "Choose your stay", lowest live rate |

Timeline values are in the timeline's own units (9.25 in all), spread over the track.

A progress rail shows the scene number and name, a "Skip to rooms & rates" button, and the label "Film animated from photographs of the lodge." (desktop).

**Fallbacks:**
- **Reduced motion:** the track collapses to one screen with the poster, headline and buttons. A static, captioned sequence follows: the approach photo, the corridor, then the three rooms with live rates and actions. No frames are downloaded.
- **Lite devices** (Save-Data, 2G/3G, or `html[data-lite]`): the same scroll sequence runs over the photographs (the poster for the arrival) with the same camera moves. No frames are downloaded.
- **Before frames arrive:** each layer shows its photograph, and the clip's first frame matches it. The canvas fades in only once it has drawn.

**Accessibility:**
- The h1 and the rooms h2 fade with `opacity` only, so the heading outline (h1 → h2 → h3) stays whole at every point of the film.
- Other captions use `visibility`, so controls that are off screen are out of the tab order. The hero buttons leave the tab order once they have faded and return when scrolled back.
- A screen-reader paragraph describes the film. The rail's skip button jumps straight to the room selection.

**Editing the film:**
- Beat timings live in the master timeline in `ArrivalFilm.tsx`. `SCENE_AT` there must match the scene starts.
- To replace a clip, see the end of [FILM-MANIFEST.md](FILM-MANIFEST.md).

## The intro

- **When it plays:** only on `/`, below 64 rem, with motion allowed, and once per tab session (`sessionStorage['amp:intro']`). An inline head script decides this before first paint.
- **Drawing starts before the JS loads:** the logo draws from the first paint, before the JavaScript bundle arrives. A, M and P are pen strokes revealed through SVG masks. The dots pop in, the LODGE bar wipes across, and a gold sweep and a glow follow.
- **No fake progress:** the hold lasts only until the real hero poster has loaded, and is capped at 2.5 s.
- **Exit:** the curtain parts while the mark flies into the header logo's exact position (FLIP), and the hero copy rises.
- **Skip:** the visible "Skip intro" button, Escape, or any key.
- **Fallbacks:**
  - `html[data-lite]` (Save-Data, or ≤ 2 GB memory or ≤ 2 cores) gets shortened timings.
  - Reduced motion never shows the intro.
  - If JavaScript fails, a CSS failsafe hides the intro at 9 s.
- **Measured:** emulated iPhone 13, local production build, no throttling: the curtain starts to part at **1.40 s** and the intro is fully handed over at **2.45–2.47 s** (15 of 15 runs). Taking screenshots during the exit stretches it, because GSAP's lag smoothing absorbs the stalled frames; that is a test artifact.

## Booking flow changes (`src/pages/BookingPage.tsx`)

The flow's logic is unchanged. What changed:

- **Room types are de-duplicated** with the same rule as the site. Previously the list showed ~65 duplicate rows, most with 0 availability.
- **Deep links:** `?roomType=<id>&checkIn=yyyy-MM-dd&checkOut=yyyy-MM-dd&guests=n`. Past dates are ignored, and check-out must be after check-in.
- **Presentation:** restyled shell and progress steps. Steps are now an accessible ordered list with `aria-current`, the guests input has a label, the date buttons have names, and heading order is fixed.

## Verification

The commands:

```bash
npx tsc --noEmit        # 0 errors
npm run build           # passes
```

The checks are Playwright scripts kept in a scratch folder, not in this repo. They ran against the production build served by a small local server that behaves like Netlify for this purpose:
- it sends the cache headers from `netlify.toml`;
- it serves brotli;
- it falls back to the SPA;
- it forwards **GET** requests for `/.netlify/functions/supabase-proxy` to Supabase and refuses everything else.

The browser tests also blocked every non-GET request to Supabase. **No form, booking or review was submitted.**

What was checked (all passing on the final build):

- **Intro on an emulated iPhone 13:**
  - plays on the first visit
  - hands over with `data-intro-done`, the node removed and scroll unlocked
  - every `[data-intro]` element ends visible
  - a reload in the same session skips it
  - the Skip button ends it
  - it never plays on desktop
- **The film at 1440×900 and on an emulated iPhone 13:**
  - 14 points from 0 to 9.25 were captured and reviewed by eye.
  - Frames load progressively; no sideways overflow; no errors.
  - Scrubbing forward and back: the hero copy and buttons return and are clickable at the top, and the h1 stays in the accessibility tree throughout.
- **Fallbacks:**
  - Reduced motion at 390 and 1440: the track is one screen tall, no film captions are shown, the static sequence is shown, and no frames are requested.
  - Lite device: no frames are requested; the stills show.
- **Reduced motion across the site at 390 and 1440:** no intro, nothing hidden, no Lenis.
- **Sideways overflow** at 320, 360, 375, 390, 430, 768, 1024 and 1440 across all nine public routes: none.
- **axe** (WCAG 2.0/2.1/2.2 A and AA plus best practice): **0 violations**, excluding the pre-existing voice widget, in two runs:
  - all nine routes at 390 and 1440 on load;
  - every film scene (7 scroll positions × desktop and phone), and `/rooms` after scrolling.
  - axe also leaves two checks for manual review:
    - colour contrast over photographs, which the gradients are there for;
    - the menu button's `aria-controls`, whose menu is only rendered once opened.
- **Menu and lightbox:** open, focus moves in, scroll locks, Escape closes, and focus returns to the opener.
- **Console:** no errors or GSAP warnings.
- **Staff, guest and review entry screens** (`/staff`, `/staff/login`, `/guest`, `/review?token=…`): they render in their original styling (Inter), get no site theme, and the intro markup stays `display: none`. Not signed in.

Not tested:
- real devices (only emulation)
- Safari/WebKit and Firefox; the frame player uses only `<canvas>` 2D and `<img>.decode()`, but iOS Safari has not been run
- screen readers (VoiceOver, TalkBack)
- the full booking submission (deliberately not exercised against production)
- signed-in staff and guest pages (no credentials were used)
- field INP and LCP (only lab measurements, below)

## Performance

Lab method:
- Lighthouse's mobile profile, "slow 4G": 150 ms RTT, 1.6 Mbps down, 4× CPU slowdown, Moto G4 emulation.
- Cold cache, two runs per row.
- LCP is read before any scrolling.

| Scenario | FCP | LCP | CLS |
| --- | --- | --- | --- |
| Phone, home, first visit (intro plays) | 1.2 s (the intro) | 4.0–4.4 s (hero sentence) | 0.004 |
| Phone, home, no intro | 2.8 s | 3.5–3.6 s (hero sentence) | 0.004 |
| Phone, `/rooms` | 2.5 s | 3.1–3.2 s (photo) | 0.001 |
| Desktop 1440 (40 ms RTT, 10 Mbps, no CPU slowdown) | 0.7 s | 1.0–1.1 s (headline) | 0 |

The film did not change the phone figures from the previous build. On desktop, starting the frames together with the hero had cost about 150 ms of LCP (median 1.59 s against 1.43 s with frames blocked). The frames now wait until the hero has settled or the visitor scrolls, and desktop LCP is back to 1.0–1.1 s.

**Interaction latency** (lab, scripted, Moto G4 emulation with 4× CPU slowdown; these are single interactions, not field INP):

| Interaction | Latency |
| --- | --- |
| Opening the menu on the home page | 176–184 ms (272–288 ms before the fix below) |
| Opening the menu on `/rooms` | 152 ms |
| The film's "Skip to rooms & rates" button | 16 ms on phone, 112 ms on desktop |
| Tabbing through the room selector | ≤ 32 ms |

During a fast scrub, the longest main-thread task was 72 ms on the phone profile. On desktop with the same 4× slowdown it reached 173 ms; a real desktop CPU is much faster.

**Against the brief's targets:**
- CLS ≤ 0.1 is met everywhere.
- INP ≤ 200 ms: every interaction measured stays under 200 ms in the lab, on a throttled phone profile. That is not field INP.
- LCP ≤ 2.5 s is met on desktop but **missed on a throttled phone**.

**Why phones miss LCP:** the app is rendered on the client. Apart from the intro, nothing can paint until about 240 KB of brotli JavaScript has downloaded (about 2.3 s on slow 4G) and run (about 0.9 s at 4× CPU).
- About 180 KB of that predates the redesign: the app shell, which eagerly imports the staff layout, staff login and receipt dialog; React and vendor code; and the Supabase client.
- The public site's own chunk is 60 KB.

On a first visit the intro also holds the hero copy until the curtain parts, which is by design.

**What the film phase changed:**
- **The hero video is gone.** `public/videos/hero/*.mp4` and `.webm` were removed and the posters kept. The arrival is now the first clip of the frame-sequence film.
- **Frames never compete with LCP.** They wait for the hero to settle, or for the first scroll.
- **Opening a dialog costs half as much.** The menu and the lightbox now lock scrolling *before* `showModal()`, so both changes share one style recalculation instead of two (about 95 ms saved at 4× CPU on the home page).
- **`/film/*` is cached for 7 days** with stale-while-revalidate (`netlify.toml`).
- **Download weight:** watching the whole film downloads about 2.9 MB of frames on a phone and about 9.8 MB on desktop. Each clip arrives only as the visitor nears it.

**What the earlier phase changed:**
- **Charts library off the public critical path:** `clsx`, `tailwind-merge` and a CommonJS helper had been bundled into the `charts` chunk, so every page preloaded about 103 KB of recharts. The function-form `manualChunks` in `vite.config.ts` pins them to `vendor`.
- **Public chunks preloaded:** the `ampPublicPreload` plugin preloads the public site's chunks, its CSS and the two hero fonts on public routes. They now download alongside the app shell instead of after it.
- **No staff fonts on the public site:** the theme class is set by the head script before first paint, so the staff fonts (Inter, Playfair) are no longer downloaded there.
- **Poster:** the head script requests it at high priority, and phones get the 960 px version.
- **Caching:** `netlify.toml` gives `/images/*` and `/videos/*` a 7-day cache with stale-while-revalidate.
- **Intro timer fix:** fixed a race that sometimes held the intro to its 2.5 s cap. `setTimeout` truncates fractional delays, so the draw-end check could run a fraction of a millisecond early and give up.

**Recommended next steps, by impact:**
1. **Prerender the home hero, and the inner-page heroes, into static HTML** at build time. The headline, sentence, poster and CTAs would then paint from HTML, at about the time the intro paints now (about 1.2 s on the same profile), and React takes over from there. This is the change that would bring phone LCP under 2.5 s. It needs care so the hero's reveal doesn't replay over content that is already visible.
2. **Slim the app shell.** Lazy-load `AppLayout`, `StaffLoginPage`, `ReceiptPrintDialog` and `activity-log-service` in `src/App.tsx`, so public visitors don't download staff code. Do this together with a signed-in staff regression pass.
3. **Measure in the field** (web-vitals RUM or CrUX) on real phones and Ghanaian networks. Lab slow-4G is a pessimistic stand-in and no substitute.

Note for local testing: Playwright switches off the HTTP cache whenever request routing is on. With routing on, images such as the poster appear to download twice; on Netlify they download once.
