# AMP Lodge redesign: audit

| Phase | Date | Branch | Status |
| --- | --- | --- | --- |
| A: cinematic public site | 2026-11-01 | `feat/cinematic-redesign` | merged to `main` (7bf0ad1) |
| B: the cinematic journey (elevated opening, every room as film, film-to-booking) | 2026-11-01 | `feat/cinematic-journey` | pushed for review, **not merged** |

This records what the redesign found in the site, code and data, what it could verify, and what the owner still needs to confirm or supply. Anything listed as **unverified** is either kept off the site or shown with the wording described.

## 1. Live data (Supabase, read-only checks)

### Room inventory

| Room type | Rate / night | Max guests | Rooms (by number) |
| --- | --- | --- | --- |
| Standard Room | GH₵350 | 2 | 101–107 (7) |
| Executive Suite | GH₵450 | 2 | 109 |
| Deluxe Room | GH₵550 | 2 | 110 |
| Family Room | GH₵700 | 4 | 108, 111 |
| Presidential Suite | GH₵1,200 | 5 | "110+109", "3000" |

13 rooms in all. These rates match www.amplodge.org on 2026-11-01. The 100/200/250 prices in the brief are stale.

| Finding | Detail | What the site does |
| --- | --- | --- |
| Duplicate room types | `room_types` has **70 rows** for 5 names. Only one row per name has rooms linked. | Grouped by name. The row with the most linked rooms wins, and types with no rooms are dropped (`dedupeRoomTypes` in `src/site/data/rooms.ts`). The booking flow uses the same rule. **Recommend deleting the 65 orphan rows** in the staff tools. |
| Room categories are dynamic | Nothing in the site fixes the number or names of categories. | Every type with at least one room appears in the room film, the comparison, `/rooms`, `/rooms/:slug` and `/booking`, in price order. A new type gets the lodge's photograph and "Photographs of this room are coming soon." until photographs are added to `KNOWN` in `rooms.ts`. A type with frames in `public/film/<slug>/` gets its film automatically. |
| **Executive Suite is now bookable online** | It was enquiry-only from commit `99d5d77` (2025-12-13). **The owner decided on 2026-11-01 to make it bookable.** | `isBookableOnline()` is now true for every type. The enquiry branches on the room card, room page and `/rooms` are removed. |
| **Double-booking risk: the "110+109" unit** | The Presidential Suite's unit "110+109" appears to be the Deluxe Room (110) and the Executive Suite (109) let together. Every overlap check works **per room record**: the client engine (`src/services/booking-engine.ts`, around line 345), `netlify/functions/create-booking.js`, `netlify/functions/rooms-availability.js` and the database constraint `bookings_no_room_overlap` (`supabase/migrations/20260719000000_prevent_room_overlap.sql`). So "110+109" can be booked for the same nights as 110 or 109. The risk already existed for 110. Making the Executive Suite bookable extends it to 109. | **Not changed** (booking logic was out of scope, and the owner accepted the risk). **Recommended fix:** record which physical rooms a combined unit occupies (for example a `component_room_ids` column), and make all four checks treat a booking of the unit as a booking of each component, and a booking of a component as a booking of the unit. Until then, staff should check 109 and 110 by hand before confirming "110+109". |
| **Room "3000"** | A Presidential Suite room numbered "3000". It does not follow the 1xx numbering. | Counted as a real room, because the booking system offers it. **Confirm** whether it exists. If it is a test row, delete it, or the suite will show availability the lodge doesn't have. |
| Descriptions | Empty for all types except Presidential: "Our most luxurious accommodation with exclusive amenities and premium services". | Shown when present, since it is the owner's own content. **Confirm** the Presidential wording. |
| Amenities and bed configuration | Empty for every type. No bed sizes or counts are recorded. | No amenity lists and no bed claims. Each room shows a one-line note of what its photographs show ("Pictured: …"), and that furnishings differ between rooms. **Supply** beds and amenities per type. |
| Room images in DB | None (`image_url` empty). | Uses the photo the previous site paired with each type (§3). |
| Reviews | 3 approved reviews, all 5★: two with **empty comments**, one reading "Hhhh". These look like test entries. | Only approved reviews with a written comment of 30 characters or more are shown, so **none appear today**. Nothing is invented. |
| Booking while rates load | The room links carry the booking system's type id, which arrives with the rates (usually well under a second). | A visitor who taps "Book This Room" before the rates have loaded lands on `/booking` without the room preselected, and picks it there. |

## 2. Contact and location facts

| Fact | Source | Status |
| --- | --- | --- |
| Abuakwa DKC Junction, Kumasi–Sunyani Road, Kumasi, Ghana | previous ContactPage and footer | used |
| +233 55 500 9697 | previous ContactPage; also on the signboard ("0555009697") | used |
| info@amplodge.org, bookings@amplodge.org | previous ContactPage | used |
| **Signboard:** "Welcome · AMP LODGE · ACCOMMODATION AND BED & BREAKFAST · MEETING VENUE · 0555009697" | the owner's exterior photograph (`exteriorpic.jpeg`, 2026-11-01) | **Used, as approved by the owner** ("Both"): the Find Us lede and `/rooms` quote the sign, the home page's meta description says "accommodation, bed & breakfast and a meeting venue". `/rooms` adds "Ask us about breakfast or a meeting when you book: what is included depends on your booking." No rate claims to include breakfast. |
| Hours: Mon–Fri 8 AM–8 PM, Sat–Sun 9 AM–6 PM | previous ContactPage ("Hours") | **Unverified.** Reception, office or phone hours? |
| "north-west of the city centre" | geography of Abuakwa | **Confirm** wording. |
| Check-in and check-out times, cancellation policy | not found anywhere | **Missing.** Not shown. Please supply. |
| Google Business Profile URL | not found | **Missing.** The site links to a Google Maps search. |

## 3. Assets

### Photographs

All photographs are at most **1080 px wide** (most 1024 px), re-encoded in `public/images/property/` as `{slug}-640.webp`, `{slug}-1024.webp` and `.jpg`, at native width when smaller. Nothing is upscaled. On large, high-DPI screens they look soft. **Recommend a professional shoot** at ≥ 2400 px: the façade, the gate and forecourt, reception if there is one, the corridor, each room type, the bathrooms.

New in Phase B: **`exterior-road`**, the owner's photograph of the lodge from the road (`exteriorpic.jpeg`, 1080×810, light colour correction only). It is the gallery's first photograph, the still behind the approach chapter, and the stand-in for a room type with no photographs.

Pairings kept from the previous site:

| Room type | Photo used | Film starts on |
| --- | --- | --- |
| Standard | green room | the same photograph |
| Executive Suite | amber room | the same photograph |
| Deluxe | grey room | the same photograph |
| Family | two-bed room (portrait) | the same photograph |
| Presidential | suite (portrait hero) | the suite lounge (landscape) |

Note: **`exterior-day` predates the right-hand (Tiwaah Executive) wing and the flags.** The forecourt chapter is therefore animated from an edit of it, S3, with the wing added from the owner's road photograph (below and in FILM-MANIFEST.md). `exterior-day` itself still shows the old view in the gallery. A new forecourt photograph would replace both.

### Logo

The only logo is a raster (`public/amp.png`). `src/site/brand/logo-geometry.ts` is a **traced stand-in** (potrace) for the inline SVG logo and the intro's pen-drawn reveal. **Supply the master SVG** and replace the paths, keeping the layer split `a`, `m`, `p`, `dots`, `bar`.

### The film (AI-animated from photographs)

Nine clips: four for the arrival and five rooms. Every clip, still, prompt, generation id, credit cost and QC verdict is in [FILM-MANIFEST.md](FILM-MANIFEST.md).

- **Kling (Phase B):** three stills and six clips (five in use), **450 credits**, the ~450 the owner approved: 380 in the first round, then 70 for the forecourt with the wing. One generation per step, no re-rolls.
- **Seedance (Phase A):** four clips still in use (corridor, Standard, Executive, Family), about $9.00–9.30 in all, not verified against BytePlus billing. The Phase A arrival and approach clips are retired.
- Masters are in `media/`, which is git-ignored. **Store `media/` somewhere safe:** Kling's download links expire after 24 hours.

**Three images are edits of real photographs, not photographs:**
- **S1**, the eye-level view used to end the crane and start the approach: the owner's photograph with the cement blocks and litter removed, relit to late afternoon.
- **S2**, the elevated opening (and the hero poster): the same view with the camera raised to first-floor height, looking over the wall into the forecourt, which a real photograph documents. It stays below the roofline, so no roof or floor is invented. The model garbled the signboard, so **the real signboard was composited back in**.
- **S3**, the forecourt chapter's first frame and still: the daylight forecourt photograph with the Tiwaah Executive wing added on the right, from the owner's road photograph. The wing's stone, upper windows and overhang match that photograph. **Unverified:** the four air-conditioning units on the wing's ground floor, which no photograph shows. Worth checking on site, or replacing with a real photograph.

**What the film does not show, because no photograph exists:**
- **The route from the forecourt to the corridor**, and any reception or lobby. The threshold is an **editorial cut**: the camera leans into the glass doors and the corridor opens through them.
- **How the corridor leads to each room.** Each room arrives as a card rising over the last.
- **Bathrooms, dining or any facility.**

**Known flaws, all minor, and trims:**
- Deluxe: at the far-left edge of the desk, the tray's contents extend beyond the original frame.
- Presidential: an unverified red footstool moves in from about frame 44, so the clip is **cut at 1.83 s**.
- Executive: an air-conditioning unit's edge appears outside the original frame in the last second, so the clip is **cut at 4.0 s** (this resolves Phase A's open question).

Disclosure on the page: the film rail says "Film animated from photographs of the lodge." (desktop), the screen-reader description says the same, and the phone room cards end with "Room films are animated from photographs of the lodge." Reduced-motion visitors, Save-Data, slow connections and low-power devices get photographs only.

**Replace with real gimbal or drone footage when available.** `scripts/build-film-frames.mjs` takes any clip; see the end of FILM-MANIFEST.md.

### Open Graph image

`public/images/og/amp-lodge-og.jpg`, 1200×630, from the exterior photo. Not changed in Phase B.

## 4. Claims removed or kept off the site

| Claim on the previous site | Status |
| --- | --- |
| Fine Dining, on-site restaurant | **unverified**: not shown |
| Café & Bar | **unverified**: not shown |
| Fitness Center | **unverified**: removed |
| Free WiFi, Free Parking | **unverified**: not shown. **Confirm** and they can be added. |
| Breakfast | **Only as the sign says it** (§2): the sign is quoted, and guests are told to ask what their booking includes. No rate is said to include breakfast. |
| Meeting venue | **Only as the sign says it.** The event-hall photograph appears in the gallery as "The hall". No capacity or equipment is claimed. |
| "Relaxing lounge and garden area" | **unverified**: not shown |
| Air conditioning, wall-mounted TV, desk, en-suite shower | **visible in photographs** of some rooms; shown only in "Pictured: …" notes and captions |
| A count of rooms or room categories | Never stated. The brief's "Three Ways to Feel at Home." was replaced by "Find Your Place to Unwind." |

## 5. Copy (owner to approve)

Used verbatim from the brief:
- "Arrive. Unwind. / Feel at Home.", "Your comfort. Our priority." and "Your welcoming retreat in Kumasi, where thoughtful comfort meets genuine hospitality."
- "THE AMP LODGE EXPERIENCE" / "Comfort Begins Here."
- "Find Your Place to Unwind." / "Explore our rooms and discover the comfort that feels right for you."
- "Book Your Stay", "Explore Rooms", "Book This Room", "View Room Details"
- "Your Stay Begins Here."
- Earlier-phase lines still in use: "Find the room that feels just right.", "Spaces Made for Rest.", "Hospitality You Can Feel."

New supporting copy to review:

| Where | New copy |
| --- | --- |
| Intro | "Your comfort. Our priority." under the logo (the brief's line) |
| Film, 02 | "The façade" / "A stone-clad lodge on the Kumasi–Sunyani Road." |
| Film, 03 (desktop) | "In detail" / "Stone walls, cream pillars and black ironwork." |
| Film, approach | "The approach" / "Abuakwa DKC Junction. The gate is just ahead." |
| Film, gate | "Through the gate" / "Across the forecourt to the glass doors." |
| Film rail | the scene names, "Skip to the rooms" |
| Room taglines, new | Deluxe "A quieter kind of comfort.", Presidential "Room to gather, and room to rest." (Standard, Family and Executive keep the brief's lines) |
| Room film hand-off | "Choose your stay" / "Every room, side by side." / "Compare rates and guest numbers, then choose your dates." / "Compare and book" |
| Room index | "Skip to booking", "Previous room", "Next room" |
| Booking panel | "Check availability", "Next you'll see availability for your dates. Nothing is booked until you confirm." |
| Find Us | "Look for the stone wall, the cream pillars and our sign: “Accommodation and Bed & Breakfast · Meeting Venue”." |
| A room type with no photographs | "Photographs of this room are coming soon. Pictured: the lodge." |

## 6. Blocked or out of scope

- **The "110+109" composite-unit guard** (§1). Documented with a recommended fix; booking logic not changed.
- **Availability on the public pages.** Not shown, to avoid stale or misleading scarcity. The booking flow computes it for the chosen dates.
- **Reviews.** Nothing qualifies (§1).
- **Payments.** The booking flow is unchanged apart from presentation, de-duplication, deep links and the Executive Suite.
- **Analytics and consent.** None added. Google Maps loads only on request.
- **Field performance data.** Only lab measurements exist (README, Performance).

## 7. Security note

**Resolved.** During Phase A setup a BytePlus API key was written into the tracked `.env.local.example`. The committed file carries only an empty placeholder (`BYTEPLUS_MODELARK_API_KEY=`), and no commit contains the key. The key lives only in `~/mcp-servers/byteplus-seedance-mcp/.env`, outside this repository. The website doesn't use it.
