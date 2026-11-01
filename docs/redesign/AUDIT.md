# AMP Lodge redesign: audit (Phase A)

Date: 2026-11-01 · Branch: `feat/cinematic-redesign`

This records what the redesign found in the existing site, code and data, what it could verify, and what the owner still needs to confirm or supply. Anything listed here as **unverified** is either kept off the site or shown with the wording described.

## 1. Live data (Supabase, read-only checks)

| Finding | Detail | What the site does |
| --- | --- | --- |
| Duplicate room types | `room_types` has **70 rows** for 5 names (Standard ×19, Executive ×17, Deluxe ×13, Presidential ×11, Family ×10). Only one row per name has rooms linked. | Grouped by name. The row with the most linked rooms wins, and types with no rooms are dropped (`dedupeRoomTypes` in `src/site/data/rooms.ts`). The booking flow uses the same rule. **Recommend deleting the 65 orphan rows** in the staff tools. |
| Rooms | 13 rooms: Standard 7, Family 2, Presidential 2, Deluxe 1, Executive 1. The previous site said "24 rooms", which is **unverified**. | No room count is claimed anywhere. |
| Prices | Standard GH₵350, Executive Suite GH₵450, Deluxe GH₵550, Family GH₵700, Presidential Suite GH₵1,200. These match www.amplodge.org on 2026-11-01. The 100/200/250 prices in the brief are stale. | Rates are read live from `room_types.base_price`; nothing is hard-coded. While loading, a placeholder shows; on error, a notice appears and no rate is shown. |
| Max guests | 2, 2, 2, 4, 5 (`max_occupancy`) | Shown live. |
| Descriptions | Empty for all types except Presidential: "Our most luxurious accommodation with exclusive amenities and premium services". | When a description exists it is shown, since it is the owner's own content. Otherwise the line is "A private room for up to N guests." **Confirm** the Presidential wording ("exclusive amenities", "premium services"). |
| Amenities | Empty for every type. | No per-room amenity lists. Chapter 05 shows only what the photographs show and says furnishings differ by room. |
| Room images in DB | None (`image_url` empty). | Uses the photo the previous site already paired with each type (see §3). |
| Executive Suite | Excluded from online booking in code since commit `99d5d77` (2025-12-13). | Kept. The site shows "Book by enquiry" with message and call options. The rule is shared by `isBookableOnline()`. **Confirm** this is still intended. |
| Reviews | 3 approved reviews, all 5★: two with **empty comments**, one reading "Hhhh". These look like test entries. | Only approved reviews with a written comment of 30 characters or more are shown, so **no testimonials appear today**. Nothing is invented. A Google Maps link stands in. |

## 2. Contact and location facts

| Fact | Source | Status |
| --- | --- | --- |
| Abuakwa DKC Junction, Kumasi–Sunyani Road, Kumasi, Ghana | previous ContactPage and footer | used |
| +233 55 500 9697 | previous ContactPage | used |
| info@amplodge.org, bookings@amplodge.org | previous ContactPage | used. The previous HomePage had a placeholder `hello@amplodge.example`, which has been removed. |
| Hours: Mon–Fri 8 AM–8 PM, Sat–Sun 9 AM–6 PM | previous ContactPage ("Hours") | **Unverified.** Are these reception, office or phone hours? Labelled only "Hours". |
| "north-west of the city centre" | geography of Abuakwa | **Confirm** wording. |
| "minutes from the heart of Kumasi" (previous site) | previous HomePage | **Not used.** The new copy says "a short drive away"; **confirm**. |
| Check-in and check-out times, cancellation policy | not found anywhere | **Missing.** Not shown. Please supply. |
| Google Business Profile URL | not found | **Missing.** The site links to a Google Maps search for the address. Supply the profile's review link to replace it. |

## 3. Assets

### Photographs

The originals were 12 Firebase-hosted images plus 3 in `public/static/images/rooms`, at most **1024 px wide**. All are re-encoded locally in `public/images/property/` as `{slug}-640.webp`, `{slug}-1024.webp` and `{slug}-1024.jpg`, or at native width when smaller. Nothing is upscaled. On large, high-DPI screens the photos look soft. **Recommend a professional shoot** delivered at ≥ 2400 px: façade at dusk, each room type, bathrooms, any dining or bar area.

Pairings kept from the previous site:

| Room type | Photo used |
| --- | --- |
| Standard | green room |
| Executive Suite | amber room |
| Deluxe | grey room |
| Family | two-bed room |
| Presidential | suite lounge |

Bug fixed: the previous HomePage showed the **event hall** as the Family Room. The hall now appears only as "The hall" in the gallery and tour.

Excluded: one CCTV still that the old virtual-tour slider showed.

### Logo

The only logo is a raster (`public/amp.png`). `src/site/brand/logo-geometry.ts` is a **traced stand-in** (potrace) used for the inline SVG logo and the intro's pen-drawn reveal. Coverage is verified at 0 % uncovered pixels. **Supply the master SVG** and replace the paths, keeping the same layer split: `a`, `m`, `p`, `dots`, `bar`. The logo has no crown, so the intro doesn't invent one.

### The arrival film (AI-animated)

The home page's film is six clips generated with BytePlus Seedance (Dreamina Seedance 2.5). Each is animated from **one real photograph**:
- the exterior at dusk
- the exterior at night
- the corridor
- the Standard, Family and Executive rooms

Every clip, its prompt, task ID, cost and QC notes are in [FILM-MANIFEST.md](FILM-MANIFEST.md). Total generation cost was about $9.00–9.30, not verified against BytePlus billing. The masters are in `media/`, which is not for committing.

**What the film does not show, because no photograph exists:**
- **The entrance, reception and lobby.** No photograph shows the inside of the gate, the door or a reception area. The threshold is therefore an **editorial cut**: an aperture from the night gate into the corridor, not a walk through a door.
- **How the corridor leads to each room.** Rooms appear through wipes and a framed print, not by walking in.
- **Bathrooms, dining or any facility.**

**Known flaws in the generated clips:**
- Arrival: invented, blurry lettering behind the green flag. An inpainting smudge in the sky for the first ~2 s, also visible in the poster. The "A" of the AMP sign crops out during the push.
- Approach: the flags flap across the "AMP" lettering.
- Executive Suite: an air-conditioning unit's edge appears top left in the last second, outside the original frame. **Owner to confirm** that a unit is there in the real room; otherwise trim the clip's last second.

The site labels the film "Film animated from photographs of the lodge." (desktop), and the screen-reader description says so. Reduced-motion visitors, Save-Data, slow connections and low-power devices get the photographs only.

**Replace with real gimbal or drone footage when available.** The frame pipeline (`scripts/build-film-frames.mjs`) takes any clip.

The removed hero video (`public/videos/hero/*.mp4` and `.webm`) was the arrival clip's earlier encode. Its posters are still used.

### Open Graph image

`public/images/og/amp-lodge-og.jpg`, 1200×630, made from the exterior photo.

## 4. Claims removed or kept off the site

| Claim on the previous site | Status |
| --- | --- |
| Fine Dining, on-site restaurant serving local and continental dishes | **unverified**: not shown (a dining-table photo exists; whether a restaurant operates is unknown) |
| Café & Bar | **unverified**: not shown (the event-hall photo has a counter; purpose unknown) |
| Fitness Center | **unverified**: removed |
| Free WiFi, Free Parking | **unverified**: not shown. **Confirm** and they can be added to the room pages. |
| Breakfast | never claimed; not shown |
| "Relaxing lounge and garden area" | **unverified**: not shown |
| Air conditioning, wall-mounted TV, desk, en-suite shower | **visible in photographs** of some rooms. Shown only as photo captions, with "furnishings differ from room to room". |

## 5. Copy written for the redesign (owner to approve)

Brief-supplied lines are used verbatim:
- "Arrive. Unwind. Feel at Home." and the hero sentence
- "Your comfort. Our priority."
- "The AMP Lodge experience" / "Comfort begins the moment you arrive."
- "The rooms" / "Three Ways to Feel at Home." / "Discover your perfect space."
- the room taglines: "Comfort in its simplest form.", "More room for moments together.", "Settle into something special."
- "Book Your Stay", "Explore Rooms", "Book This Room"
- "Find the room that feels just right."
- "Spaces Made for Rest." (the rooms page)
- "Hospitality You Can Feel."
- "Your Stay Begins Here."

New supporting copy to review:

| Where | New copy |
| --- | --- |
| Film, scene 02 | "The approach", then the address from `site.ts` and "on the Kumasi–Sunyani Road." |
| Film, hand-off | "Choose your stay / Five rooms. One warm welcome. / From GH₵350 a night, booked directly with us." The count and the rate come from the live room list. |
| Film rail | the scene names, "Skip to rooms & rates", "Film animated from photographs of the lodge." |
| Executive Suite action | "Enquire about this suite" (the suite stays enquiry-only, as decided) |
| Choose your stay | "Every room is booked directly with us. Rates and guest numbers come live from our booking system." The two rooms the film doesn't show use their description from the booking system. |
| Hospitality paragraph | "Good hospitality is mostly small things done well … That is the standard we hold ourselves to." |
| Virtual tour captions | one per photograph |

## 6. Blocked or out of scope

- **Availability on the public pages.** It is not shown, to avoid stale or misleading scarcity. The booking flow (existing logic) computes availability for the chosen dates.
- **Reviews.** Nothing qualifies (see §1).
- **Payments.** The booking flow is unchanged apart from presentation, de-duplication and deep-link parameters.
- **Analytics and consent.** None added. Google Maps loads only on request (click-to-load).

## 7. Security note

During setup a BytePlus API key was saved into the **tracked** file `.env.local.example`, which now shows as modified in `git status`. Remove that line, or revert the file, before committing, and consider rotating the key. The key is not used by the website.
