# AMP Lodge: cinematic public site

The public website (`/`, `/rooms`, `/rooms/:slug`, `/gallery`, `/virtual-tour`, `/contact`, `/booking`, 404) runs on the existing stack: Vite 7, React 19, React Router 7, Tailwind 3, GSAP (ScrollTrigger, SplitText) and Supabase. The staff portal (`/staff/*`), guest portal (`/guest/*`), invoices and review links are untouched.

Two phases:
- **Phase A** (merged, 7bf0ad1) rebuilt the public site and introduced the scroll film.
- **Phase B** (`feat/cinematic-journey`) is the cinematic journey: an elevated opening, the approach and gate, the threshold, every room category as film, and a film that ends in the booking interface.

See also:
- [AUDIT.md](AUDIT.md): the data and asset findings, the room inventory, and the items the owner must confirm.
- [FILM-MANIFEST.md](FILM-MANIFEST.md): how each clip and still was generated, what it cost, the QC verdicts and trims, and how to replace a clip.

## Where things are

| Path | What |
| --- | --- |
| `src/site/layout/PublicSite.tsx` | Shell and routes, loaded as its own chunk (staff sessions never download it). Adds `html.amp-site-theme` while mounted. |
| `src/site/styles/site.css` | Fonts (Cormorant Garamond and Manrope, self-hosted), tokens, buttons, header (transparent over film, a dark bar over dark text sections), menu, booking bar, lightbox, motion gating and failsafes, reduced motion |
| `tailwind.config.cjs` | `amp-*` colours (the brief's palette, burgundy `#653A3B`), `font-display` / `font-ui`, eases, `max-w-site`, `px-gutter` |
| `src/site/intro/` | The brand intro: `intro-document.ts` (head script, critical CSS, markup and the static hero poster, injected into `index.html` by the `ampIntro` plugin) and `BrandIntro.tsx` (state machine and hand-off) |
| `src/site/brand/` | Traced logo geometry and `<AmpLogo>` |
| `src/site/motion/` | `Reveal`, `SplitHeading`, `ImageReveal`, `Parallax`, `SmoothScroll` (Lenis on fine pointers only), intro and page-ready signals, scroll lock, `scrollToTarget` / `scrollToY` |
| `src/site/film/` | `ArrivalFilm.tsx` (the arrival), `RoomJourney.tsx` (every room), `FrameSequence.ts` (canvas frame player), `film-data.ts` (clips, stills, focal points, scene names), `anchors.ts` (shared ids), `frames.generated.ts` (frame counts, sizes and cache-busting hashes, generated) |
| `src/site/home/` | `HomePage.tsx` and chapters 09–14 |
| `src/site/components/BookingPanel.tsx` | Room, dates and guests, handed to `/booking` with the room preselected. Used by the home page and every room page. |
| `src/site/data/rooms.ts` | Live room categories (de-duplicated, price order), photographs and taglines for known types, a placeholder for unknown ones, `bookingHref` deep links |
| `src/site/data/room-choice.ts` | The room the visitor is looking at, shared by the film, the comparison and the booking panel |
| `src/site/data/photos.ts` | Photo registry and alt text; `HERO_MEDIA` (the film's first frame) |
| `src/site/pages/` | Rooms, room detail, gallery, contact, virtual tour, 404 |
| `vite.config.ts` | `ampIntro`, `ampPublicPreload` (public chunks and hero fonts on public routes), function-form `manualChunks` |
| `scripts/build-film-frames.mjs` | Turns the masters in `media/` into WebP frame sequences in `public/film/` |
| `public/film/` | Frame sequences, 21 MB on disk; a visitor downloads only the clips they reach |
| `public/images/hero/` | The film's first frame (poster) in four widths plus a phone crop, and the full-resolution façade still |
| `netlify.toml` | Cache headers for `/images/*`, `/videos/*` and `/film/*` |

## The home page, chapter by chapter

| # | Chapter | Desktop (≥ 64 rem, motion allowed) | Phones and tablets | Reduced motion |
| --- | --- | --- | --- | --- |
| 00 | Intro | the logo draws itself, holds, and the curtain opens onto the hero | same | none |
| 01–07 | The arrival film | one scroll-driven film: elevated opening, façade, detail, approach, through the gate, threshold, inside, the accommodation introduction | the same story on its own shorter timeline, with portrait frames and no detail chapter | captioned photographs |
| 08 | The rooms | a sticky film stage: every room category arrives through its own mask, with a room index (any room directly, previous / next, skip to booking) | a sticky room selector and one cinematic card per room; native scrolling | the same cards, with photographs |
| 09 | Choose your stay | the last room settles into an editorial frame and hands over to a side-by-side comparison and the booking panel, opened on the room last seen | stacked | static |
| 10 | Comfort in the details | sticky text; photos drift | 2-up grid | static |
| 11 | Gallery | clip-path reveals; lightbox | same | static |
| 12 | Hospitality | statement; real reviews only when they qualify | same | static |
| 13 | Location | click-to-load map; the sign to look for | same | same |
| 14 | Final invitation | the film comes full circle: its opening frame, dimmed; Book Your Stay and Explore Rooms | reduced drift | static |

## The arrival film (`ArrivalFilm.tsx`)

**How it works:**
- **One master timeline** per screen class (`gsap.matchMedia`), scrubbed (`scrub: 0.6`) by a single ScrollTrigger on a tall track (920svh on desktop, 600svh below 64 rem) holding a `position: sticky` stage. Nothing is pinned by JavaScript and nothing snaps. Scrolling back plays the film backwards.
- **Clips are WebP frame sequences drawn to a canvas** (`FrameSequence.ts`), so scrubbing is exact in both directions on every browser. Frames load coarse to fine (every 8th, 4th, 2nd, then all), and the player draws the nearest loaded frame. Desktop uses `d-` frames (≤ 1280 px wide), phones `m-` frames (480×720 crops at each clip's focal point).
- **Loading order.** Nothing beyond the poster loads until the intro has finished, the page has loaded and the browser is idle (plus 1.2 s), or the visitor first scrolls, touches, clicks or presses a key. Then the crane and the approach load, and every scene change loads the current clip and the next two. Measured on a throttled phone: the first frame request starts at 6.7 s, after LCP (5.6 s on that run).
- **Transitions are made in the page**, not generated: a wipe led by a gold hairline, the gate's bars sliding away, the camera leaning into the glass doors while the corridor opens through them, a light shift from cool to warm. No photograph shows how the forecourt connects to the corridor, so the film cuts rather than inventing a route.

Desktop beats (timeline units, 8.75 in all; phones run the same beats without the detail chapter, 7.75 in all):

| Scene | Beats | Picture | Copy |
| --- | --- | --- | --- |
| 01 Arrival | 0–1.3 | the poster (the film's first frame) gives way to the crane: from first-floor height, looking over the wall into the forecourt, down to eye level on the road | "Your comfort. Our priority." / "Arrive. Unwind. / Feel at Home.", the hero sentence, Book Your Stay, Explore Rooms. The copy recedes on the first scroll. |
| 02 The façade | 1.15–1.95 | eye level, the stone-clad lodge | "A stone-clad lodge on the Kumasi–Sunyani Road." |
| 03 In detail (desktop) | 1.95–2.95 | the full-resolution still: the camera travels across the stone and lettering, then down the pillars and ironwork | "Stone walls, cream pillars and black ironwork." |
| 04 The approach | 2.95–4.3 | the road shot wipes in from the right behind a gold hairline; a dolly toward the gate | "Abuakwa DKC Junction. The gate is just ahead." |
| 05 Through the gate | 4.3–5.8 | the gate slides open to the right on the forecourt; a dolly toward the glass doors | "Across the forecourt to the glass doors." |
| 06 The threshold | 5.8–6.4 | the camera leans into the doors; the corridor opens through them and the light warms | — |
| 07 Inside | 6.4–7.65 | the corridor dolly | "THE AMP LODGE EXPERIENCE" / "Comfort Begins Here." |
| 07 The rooms | 7.65–8.75 | the corridor dims | "Find Your Place to Unwind." / "Explore our rooms and discover the comfort that feels right for you.", then a link to every room |

A progress rail shows the scene number and name, a "Skip to the rooms" button, and "Film animated from photographs of the lodge." (desktop).

**Fallbacks:**
- **Reduced motion:** the track collapses to one screen with the poster and the hero copy. A captioned sequence follows: the lodge from the road, the forecourt, the corridor, then the accommodation introduction. No frames are downloaded.
- **Lite devices** (Save-Data, 2G/3G, or ≤ 2 GB memory or ≤ 2 cores, marked `html[data-lite]`): the same timeline runs over the photographs, with the same camera moves. No frames are downloaded.
- **Before frames arrive, or if they fail:** each layer shows its photograph, and the clip's first frame matches it. A canvas fades in only once it has drawn.

**Accessibility:**
- The h1 and the h2s fade with `opacity` only, so the heading outline stays whole at every point of the film. Other captions use `visibility`, so off-screen controls leave the tab order. The hero buttons leave it once they have faded and return when scrolled back.
- A screen-reader paragraph describes the film.

## The rooms (`RoomJourney.tsx`)

**Every live room category, however many there are.** The list comes from the booking system (`useRooms`), de-duplicated and in price order. A room type with frames in `public/film/<slug>/` gets its film. Any other room gets its photograph with a slow camera move made in the page. A room with no photographs gets the lodge's and says so.

**Desktop (≥ 64 rem, motion allowed):**
- A sticky stage on a track of `(0.3 + rooms × 1.5 + 1.0) × 80 + 100` svh (804svh for five rooms).
- Each room arrives through a different mask in turn: a door (with a gold edge), an iris, a rise, a split, a frame. Portrait films (the Family Room) open as a framed print. The room it replaces steps back the way the new one arrives.
- Each room's film scrubs with the scroll. Beside it: the room's number of the total, name, tagline, guests, live rate, **Book This Room** and **View Room Details**.
- **The room index** (right): the current room highlighted, any room directly, previous / next, and "Skip to booking". A jump lands after that room's entrance has settled.
- **The hand-off:** the last room contracts into an editorial frame, and "Every room, side by side." with a "Compare and book" button takes the visitor to chapter 09.

**Phones and tablets:** no pinned scene and no horizontal scrolling. A sticky room selector (under the header while it shows) and one 4:5 card per room. Each card's frame opens and its film plays as the card crosses the screen. The selector follows the card in the middle of the screen.

**Reduced motion:** the same cards, with photographs and no movement.

## Booking: one workflow

Every booking action leads to the same flow (`src/pages/BookingPage.tsx`) with the room preselected when one was chosen:
- the hero's **Book Your Stay** and the header (no room: every category is offered);
- **Book This Room** in the room film, the room cards, the comparison, `/rooms` and the room pages (that room);
- **the booking panel** (`BookingPanel.tsx`) in chapter 09 and on every room page: room (where there is a choice), check-in, check-out and guests (capped at the room's maximum). Chapter 09's panel opens on the room the visitor last looked at in the film, or last picked in the list.

Deep links: `/booking?roomType=<room_types.id>&checkIn=yyyy-MM-dd&checkOut=yyyy-MM-dd&guests=n`. Past dates are ignored, and check-out must be after check-in.

**The Executive Suite is now bookable online** (the owner's decision, 2026-11-01). Note the double-booking risk with the Presidential Suite's "110+109" unit, recorded in AUDIT.md with a recommended fix.

Room pages (`/rooms/:slug`) exist for every live category, including one added later. While data loads, a known type renders at once, and an unknown slug waits rather than showing "not found" too early.

## The intro

- **When it plays:** on `/`, on **every screen size** (phones only in Phase A), with motion allowed, once per tab session (`sessionStorage['amp:intro']`). An inline head script decides this before first paint.
- **Before the JS loads:** A, M and P draw as pen strokes through SVG masks. The dots pop in, the LODGE bar wipes across, a gold sweep and glow follow, then the caption "Kumasi · Ghana" and the motto "Your comfort. Our priority.".
- **Length: lengthened at the owner's request** (2026-11-01), "a few seconds longer before the site loads". The drawing and hold now run to 4.2 s (1.9 s on lite devices), and the hold waits for the hero poster, capped at 6.5 s. Measured in Chrome: the hand-over completes about **5.5 s** after navigation on desktop and about **5.3 s** at phone width. The brief asked for 1.5–2.3 s; this is a deliberate departure.
- **Exit:** the curtain parts while the mark flies into the header logo's position, and the hero copy rises.
- **The hero underneath:** the head script requests the poster at high priority and `index.html` paints it straight away (`#amp-poster`). React's own copy takes over once decoded, so there is no flash.
- **Skip:** the "Skip intro" button, Escape, or any key.
- **Fallbacks:** lite devices get shortened timings; reduced motion never shows the intro; if JavaScript fails, a CSS failsafe hides it at 11 s.

## Verification (Phase B)

Commands, on the final tree:

```bash
npx tsc --noEmit        # 0 errors
./tests/run.sh          # all 17 suites pass (in-memory database, no network)
npm run build           # passes
```

**Local runs talk to the production Supabase project.** Every browser test blocked non-GET requests, and **no booking, contact form or review was submitted**. Booking pages were opened but not submitted.

Checked in Chrome (desktop window, and a 390×844 same-origin frame for phone width) and with Playwright (iPhone 13 emulation, 1440×900):
- **Intro:** plays on desktop and on phone width, with the timings above; hands over cleanly. A repeat visit in the same session skips it. Every hero element ends fully visible.
- **The arrival film:** every chapter scrubbed forward and back at fixed scroll points on desktop and phone. Fixes made from this: a stronger shade behind the hero copy, the missing "Through the gate" caption, and the phone's crane-to-road cut turned into a wipe.
- **The rooms:** the index's jumps, previous/next and skip to booking. Fixes: a shade behind the index, the highlight switching with each entrance, and jumps landing after the entrance settles. Phone cards and the selector follow the scroll. The header became a dark bar over dark text sections, and the selector sits under it.
- **Hand-off and booking:** "Compare and book" lands on chapter 09. Choosing a room switches the photograph and the panel. **Book This Room carries the room into `/booking`** (Executive Suite preselected). The panel was compacted so its button stays on screen on a 778-px-tall laptop.
- **Room pages:** load for each category, and an unknown room shows "not found" once data has loaded.
- **Reduced motion** at 390 and 1440: no intro, no Lenis, the static sequence and cards show, nothing is hidden, no sideways overflow.
- **Sideways overflow** at 320 and 390 px on `/`, `/rooms` and a room page: none.
- **axe 4.14** (WCAG 2.0, 2.1 and 2.2 A and AA), voice widget included: **0 violations** across 34 checks. These were nine routes at 1440 and on an iPhone 13, and the home page at 8 scroll positions through the film and rooms on each. Fixes from the first run: names for the voice widget's buttons and input, accessible names that now contain the visible label ("Book This Room: Deluxe Room"), the date buttons on `/booking`, and the star ratings.
- **Console:** no errors or GSAP warnings in the dev build. Under `vite preview` the Supabase proxy isn't served, so the rate requests fail there; that is expected locally.

Not tested:
- real devices (only emulation), Safari/WebKit and Firefox. The frame player uses only `<canvas>` 2D and `<img>.decode()`, and `:has()` is used for one cosmetic rule.
- screen readers (VoiceOver, TalkBack)
- a full booking submission (deliberately not exercised against production)
- signed-in staff and guest pages
- field INP and LCP

## Performance

**Lab method (Phase B):**
- Playwright with Chrome DevTools throttling: 150 ms RTT, 1.6 Mbps down, 4× CPU slowdown, iPhone 13 emulation; desktop at 1440×900 unthrottled.
- Production build under `vite preview`, cold cache, two runs.
- This is a different harness from Phase A's Lighthouse runs, so **the two tables are not directly comparable**.

| Scenario | LCP | CLS |
| --- | --- | --- |
| Desktop, first visit (intro plays) | 4.94–4.96 s (hero sentence, once the curtain opens) | 0 |
| Desktop, no intro | 0.78–0.87 s (headline) | 0 |
| Phone, first visit (intro plays) | 5.7–6.5 s | 0 |
| Phone, no intro | 4.4–4.6 s (hero sentence) | 0 |

**Against the brief's targets:**
- **CLS ≤ 0.1** is met.
- **LCP ≤ 2.5 s** is met on desktop when the intro doesn't play. It is **missed on a first visit**, because the lengthened intro holds the hero copy for about 5 s (by design, at the owner's request). It is also **missed on a throttled phone**.
- **INP ≤ 200 ms** was not re-measured in Phase B (Phase A's figures are below).

**Why phones miss LCP:** the app renders on the client. On the throttled phone the poster paints at about 2.4 s from `index.html`, but React only mounts at about 4.7 s, after downloading and running the app shell (about 180 KB of which predates the redesign, including staff code imported eagerly by `src/App.tsx`). The hero copy then reveals.

**Film weight:**
- Watching the whole film downloads about **4.5 MB** of frames on a phone and about **15.7 MB** on desktop (FILM-MANIFEST.md has it per clip). Each clip arrives only as the visitor nears it.
- Lite devices, Save-Data, slow connections and reduced motion download none.
- `/film/*` is cached for 7 days with stale-while-revalidate, and every frame URL carries a content hash (`?v=`), so a rebuilt clip is never served stale.

**Recommended next steps, by impact:**
1. **Prerender the home hero into static HTML** at build time (headline, sentence and CTAs over the poster `index.html` already paints). This is the change that would bring phone LCP under 2.5 s. It needs care so the hero's reveal doesn't replay over visible content.
2. **Slim the app shell:** lazy-load `AppLayout`, `StaffLoginPage`, `ReceiptPrintDialog` and `activity-log-service` in `src/App.tsx`. Do this together with a signed-in staff regression pass.
3. **Consider the intro's length again** once real-visitor data exists. Each second it holds is a second of LCP on a first visit.
4. **Measure in the field** (web-vitals RUM or CrUX) on real phones and Ghanaian networks.

### Phase A figures (Lighthouse mobile profile, for reference)

| Scenario | FCP | LCP | CLS |
| --- | --- | --- | --- |
| Phone, home, first visit (intro plays) | 1.2 s | 4.0–4.4 s | 0.004 |
| Phone, home, no intro | 2.8 s | 3.5–3.6 s | 0.004 |
| Phone, `/rooms` | 2.5 s | 3.1–3.2 s | 0.001 |
| Desktop 1440 | 0.7 s | 1.0–1.1 s | 0 |

Interaction latency (lab, Moto G4 emulation, 4× CPU): opening the menu 152–184 ms; the film's skip button 16 ms on phone and 112 ms on desktop; tabbing through the room selector ≤ 32 ms.

Phase A's other performance work still stands:
- recharts' helpers moved out of the public critical path (`manualChunks`);
- public chunks and hero fonts preloaded (`ampPublicPreload`);
- no staff fonts on the public site;
- dialogs that lock scrolling before `showModal()`;
- 7-day caching for images.

Note for local testing: Playwright switches off the HTTP cache whenever request routing is on, so assets appear to download twice. On Netlify they download once.
