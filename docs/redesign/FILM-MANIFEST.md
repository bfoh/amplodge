# Film: generation manifest

The home page's scroll film has nine clips: four for the arrival and five rooms. Every clip was animated from **real photographs of the lodge**. Three stills were made by editing real photographs, and all three are recorded below. Nothing was generated from a text prompt alone, and no clip shows a place that no photograph shows.

These moves are **made in the page**, not generated footage:
- the dissolves into the road shot and through the gate (the outgoing shot keeps pushing in while the next fades up and settles, with a soft bloom of daylight through the gate);
- the threshold (the camera leans into the glass doors and the corridor opens through them);
- the moves between rooms (each room's card rises over the last, which steps back and dims; the portrait room sits as a print on its card).

No photograph shows how the forecourt connects to the corridor, so no footage of that route was generated.

## The clips in use

| Clip (id) | Chapter | Made with | Source | Used |
| --- | --- | --- | --- | --- |
| `elevated` | 01 Arrival, 02 The façade | Kling `kling-video-v4_0`, first + tail frame | S2 (elevated still) → S1 (eye-level still) | 0–8 s (whole clip) |
| `gate` | 03/04 The approach | Kling `kling-video-v3_0_turbo` | S1 | whole clip |
| `forecourt` | Through the gate, the threshold | Kling `kling-video-v3_0_turbo` | S3 (the forecourt photograph with the Tiwaah Executive wing added) | whole clip, warmed in the build |
| `corridor` | Inside, the rooms | Seedance 2.5 (first phase) | `public/images/property/corridor-1024.jpg` | whole clip |
| `standard-room` | Standard Room | Seedance 2.5 (first phase) | `room-standard-1024.jpg` | whole clip |
| `executive-suite` | Executive Suite | Seedance 2.5 (first phase) | `room-executive-suite-1024.jpg` | first 4.0 s (see QC) |
| `deluxe-room` | Deluxe Room | Kling `kling-video-v3_0_turbo` | `room-deluxe-1024.jpg` | whole clip |
| `family-room` | Family Room | Seedance 2.5 (first phase) | `room-family-576.jpg` (portrait) | whole clip |
| `presidential-suite` | Presidential Suite | Kling `kling-video-v3_0_turbo` | `suite-lounge-1024.jpg` | first 1.83 s (see QC) |

**Retired:** the Seedance clips `arrival` (night push-in) and `approach` (night dolly), and the first Kling forecourt clip (V3, made from `exterior-day-1024.jpg`, which predates the right-hand wing), are no longer used. Their frames were removed or replaced in `public/film/`. Their masters are still in `media/` (V3 as `media/film-source/forecourt-v1-no-wing.mp4`).

**Rooms are matched by URL slug.** A room type whose slug has frames in `public/film/<slug>/` gets its film. Any other room gets its photograph with a camera move made in the page. A room type with no photographs gets the exterior photograph and the note "Photographs of this room are coming soon."

## Kling (this phase)

Account: Kling MCP (`https://kling.ai/mcp`), user id 155934032. The owner approved a plan of about 450 credits. **450 credits were spent** (380 in the first round, 70 for the forecourt wing), with one generation per step and **no re-rolls**.

| Step | Tool / model | Settings | Generation id | Credits | Output |
| --- | --- | --- | --- | --- | --- |
| S1: eye-level retouch | `image_to_image` / `gemini-3-pro-image` | 4:3, 2k, 1 image | `AVLNvGF8wZw6Gc6zMU6ALB_PJ5QVgeY6s7fsxQRi3KroiQ7twPHKM76Dc8H19l3BbH9_RYkk` | 20 | `media/kling-out/s1-exterior-clean.png` (2400×1792) |
| S2: elevated still | `image_to_image` / `gemini-3-pro-image`, inputs S1 + forecourt photo | 4:3, 2k, 1 image | `AXZ8Hkxs5Wv1oEpucwuDUVjLsJCib-CjkXvCHui4nM8mIP5in2rxqSplgsMonPAWg5w3VZYO` | 20 | `media/kling-out/s2-elevated-raw.png` → `s2-elevated.png` (sign fixed, below) |
| V1: crane | `image_to_video` / `kling-video-v4_0`, first S2, tail S1 | 8 s, 1080p | `AU8eDPX7YJuhAylEnCVVczJnc0FT8QZInkHnPWtTU6Y-zpx17UKnMujUQrc3sUUTF7o6IZxm` | 120 | `v-elevated.mp4` → `media/film-source/elevated.mp4` |
| V2: gate | `image_to_video` / `kling-video-v3_0_turbo`, first S1 | 6 s, 1080p | `AVbgp2khLxU00uswik9e9VElIXjGF31mj2wJqjMOsk4gWYsMN9V7GOgNJt1tp4EcGsePNiKF` | 60 | `v-gate.mp4` → `gate.mp4` |
| V3: forecourt *(retired)* | `image_to_video` / `kling-video-v3_0_turbo` | 6 s, 1080p | `AQsC8zMyv57FfPUoZA_OHan2umqktU0D-iDMCuVP-VcHuUJK95hxqsgoWYBVnbJ1mxjK_xIr` | 60 | `v-forecourt.mp4` → `forecourt-v1-no-wing.mp4` |
| Deluxe Room | `image_to_video` / `kling-video-v3_0_turbo` | 5 s, 1080p | `AbOU91P7cg-fP-F3uNO8_Q6Bsefax4uEzfSxXAnVi71dHy4gsr1Vn7UbN2PMhkTVHHQJXvDn` | 50 | `v-deluxe.mp4` → `deluxe-room.mp4` |
| Presidential Suite | `image_to_video` / `kling-video-v3_0_turbo` | 5 s, 1080p | `Abg_rjuSDgX588gGye9nsuU6HZN5fSm8MIj7aIPAaWLoRFtBtq2S2RVaLkUT2Yc8FKAc2jP2` | 50 | `v-presidential.mp4` → `presidential-suite.mp4` |
| S3: forecourt with the wing | `image_to_image` / `gemini-3-pro-image`, inputs forecourt photo + road photo | 3:2, 2k, 1 image | `AZl7P8I3pgL6n-gcpRC0z-wdgNiXlchA1JEdYwUaB2pSw60ycbglIqevWEywLh1H4nnJGJL_` | 20 | `media/kling-out/s3-forecourt-wing.png` (2528×1696) |
| V3b: forecourt | `image_to_video` / `kling-video-v3_0_turbo`, first S3 | 5 s, 1080p | `Ac2e_fbMqyjsmtgFkz_QBYl4ZhXZ7M2is2eV_TaHf_bwrDMyra4pY5VZheY3J17YaHQt4Lcz` | 50 | `v-forecourt-wing.mp4` → `media/film-source/forecourt.mp4` (1756×1176, 5.04 s) |
| **Total** | | | | **450** | |

Trace ids: exterior `01a1971f-4bb6-7a26-a0e2-975df99538c4`, rooms `01a1971f-4bba-73a4-8d87-1c9e7bef07dd`, forecourt wing `01a19b2c-7d10-7c3e-9a4f-2b6e8d1c5f30`.

S3 is also published, graded like the film, as the forecourt chapter's still (`public/images/property/forecourt-wing-{640,1280,1920}.webp`, `-1280.jpg`; `PHOTOS.forecourtWing`). It is shown until the frames arrive, on lite devices and in the reduced-motion sequence. Being an edited image, it is not in the gallery.

The sources uploaded to Kling (`media/kling-source/`):
- `exterior-road.jpg` is the owner's exterior photograph (`exteriorpic.jpeg`), the one also published as `public/images/property/exterior-road-*`.
- The other three are byte-identical to `exterior-day-1024.jpg`, `room-deluxe-1024.jpg` and `suite-lounge-1024.jpg`.

### The elevated opening stays truthful

The brief asks for an elevated opening without inventing roofs or floors. The S2 prompt raises the camera only to **first-floor height**, below the roofline. From there it looks over the wall into the forecourt, which is documented by a real photograph (the second input). The crane (V1) is pinned at both ends: S2 as its first frame and the retouched real photograph S1 as its last. So it lands exactly on the real lodge.

## Seedance (first phase; four clips still in use)

`dreamina-seedance-2-5-260628`, image-to-video with `first_frame`, 720p, 5 s, ratio `adaptive`, no audio, no watermark, one generation per clip.

| Clip | Task id | Output | Tokens |
| --- | --- | --- | --- |
| Corridor | `cgt-20261101171611-2stpa` | 1178×786, 5.04 s | 109,409 |
| Standard | `cgt-20261101171150-0ijit` | 1178×786, 5.04 s | 109,409 |
| Family | `cgt-20261101171613-vygrz` | 720×1280, 5.04 s | 108,900 |
| Executive | `cgt-20261101171614-6o0v1` | 1178×786, 5.04 s | 109,409 |
| *Arrival (retired)* | `cgt-20261101095226-2q9z7` | 1920×1080, 6.04 s | not recorded |
| *Approach (retired)* | `cgt-20261101171610-uvlxs` | 1112×834, 5.04 s | 109,586 |

Cost in the first phase: about $9.00–9.30 in all. This is an estimate at about $10.70 per million tokens, a rate that is **not verified against BytePlus billing**.

## Quality control

Every clip was checked frame by frame against its source photograph. A contact sheet of every frame was reviewed before the clip was accepted.

| Clip | Verdict | Notes |
| --- | --- | --- |
| S1 | Pass | The cement blocks and litter are gone, and the light is late afternoon. The building, windows, lettering, flags, wall, gate and signboard are unchanged. |
| S2 | Pass, after a fix | The model garbled the signboard ("RED & BREAKFAST", "MEETING VEQUE", a wrong number). **The real signboard was composited back from S1** (ffmpeg: `crop=272:246:260:1070,scale=274:249`, overlaid at 256:1202). The camera is below the roofline, and no floors or roofs were added. |
| V1 crane | Pass | Smooth descent; the lettering stays stable and the end matches S1. |
| V2 gate | Pass | Ends with the gate's bars filling the right side. The gate does not open. The flag parallax is consistent. |
| V3 forecourt *(retired)* | Pass | Overcast light, so the build warms it. **The source photograph predates the right wing and the flags**, so the owner asked for S3 and V3b. |
| S3 | Pass, one detail unverified | The wing on the right matches the owner's road photograph: the same irregular stone, the small upper windows, the ground-floor overhang, and it hides the right-hand end of the main building as it should. The main building, lettering, doors and forecourt are unchanged. **Unverified:** the four air-conditioning units on the wing's ground floor. The prompt asked for units on its side wall and no photograph shows that wall, so their number and position are the model's. The flags are not in the frame. |
| V3b forecourt | Pass | A slow dolly toward the glass doors with natural parallax on the wing; no warping, and the lettering stays stable. Warmed in the build like V3. Its audio track is ignored. |
| Deluxe | Pass | Minor: at the far-left edge of the desk the tray's contents are revealed beyond the original frame. |
| Presidential | Pass, trimmed | From about frame 44 a red footstool moves into view beyond the original frame. Red footstools do exist in the suite (see the suite photographs), but this one's position is unverified, so **the clip is cut at 1.83 s**. |
| Corridor, Standard, Family | Pass | See the first-phase notes: no issues found. |
| Executive | Pass, trimmed | In the last second an air-conditioning unit's edge appears outside the original frame. **The clip is cut at 4.0 s.** |

On the page, the film rail says "Film animated from photographs of the lodge." (desktop), and the screen-reader description says the same. The room deck ends with "Room films are animated from photographs of the lodge."

## Where the files are

| What | Path | Committed? |
| --- | --- | --- |
| Masters and stills | `media/kling-out/`, `media/kling-source/`, `media/film-source/*.mp4`, `media/hero-source/` | **No.** Keep `media/` out of git and store it elsewhere. Kling's download links expire after 24 hours. |
| Web frames | `public/film/<clip>/d-NNN.webp` (desktop, ≤ 1280 px wide) and `m-NNN.webp` (phones, 480×720 crop at the clip's focal point) | Yes |
| Hero poster | `public/images/hero/amp-lodge-arrival-{1280,1600,1920}.webp`, `-1920.jpg`, `-portrait-720.webp/.jpg` (V1's first frame, which is S2) | Yes |
| Façade detail | `public/images/hero/amp-lodge-facade-2400.webp` (S1, for the desktop "In detail" chapter) | Yes |
| Frame manifest | `src/site/film/frames.generated.ts` (frame counts, sizes and a content hash `v` per set for cache-busting) | Yes, generated |
| Build script | `scripts/build-film-frames.mjs` (per clip: frame counts, focal point, trims, colour grade, quality) | Yes |

Rebuild every clip, or only the ones named:

```bash
FFMPEG=/path/to/ffmpeg node scripts/build-film-frames.mjs            # all
FFMPEG=/path/to/ffmpeg node scripts/build-film-frames.mjs gate forecourt
```

Without `FFMPEG` it falls back to `uv run --with imageio-ffmpeg`. The script removes the frame folders of clips that are no longer listed.

Frame weight (KB):

| Clip | Desktop frames | Desktop | Phone frames | Phones |
| --- | --- | --- | --- | --- |
| elevated | 48 | 3,754 | 36 | 921 |
| gate | 36 | 2,846 | 28 | 747 |
| forecourt | 32 | 2,498 | 24 | 620 |
| corridor | 40 | 562 | 28 | 206 |
| standard-room | 40 | 1,078 | 28 | 321 |
| executive-suite | 40 | 928 | 28 | 314 |
| deluxe-room | 40 | 1,396 | 28 | 443 |
| family-room | 40 | 1,245 | 28 | 518 |
| presidential-suite | 36 | 1,670 | 24 | 381 |
| **Total** | | **≈ 15.6 MB** | | **≈ 4.4 MB** |

A visitor downloads only the clips near where they are in the film: every 8th frame first, then the gaps. Nothing beyond the poster loads until the intro has finished, the page has loaded and the browser is idle, or the visitor starts scrolling. Visitors with reduced motion, Save-Data, 2G/3G connections or low-power devices download no frames; they get photographs.

## Prompts (verbatim)

### Kling

**S1, eye-level retouch** (input: the owner's exterior photograph):
> Edit this real photograph of AMP Lodge in Kumasi, Ghana, the way a professional architectural photo retoucher would, keeping the photograph otherwise exactly as it is. 1) Remove the stacked grey cement blocks, the loose blocks and the scattered litter in the bottom-left foreground, and continue the grass verge and the red earth road naturally where they were. 2) Relight the scene as soft, warm late-afternoon sunlight with gentle natural shadows and a brighter sky with soft clouds; realistic, not dramatic. Change nothing else: keep the exact shape and proportions of both building sections, the number and position of every window, the stone cladding pattern, the air-conditioning units, both flags and flagpoles, the stone boundary wall, the cream pillars and their wall lamps, the black railings, the black sliding gate, the signboard and all of its lettering exactly as written ('Welcome', 'AMP LODGE', 'ACCOMMODATION AND BED & BREAKFAST MEETING VENUE', '0555009697'), the 'AMP' and 'LODGE' letters on the facade, the 'TIWAAH' and 'EXECUTIVE' letters on the right building, the palm tree, the satellite dish, the overhead power lines and the neighbouring building on the right. Do not add any objects, people, vehicles, plants or features. Same framing, same camera position and perspective. Photorealistic, no stylisation.

**S2, elevated still** (inputs: S1, and the real forecourt photograph):
> Create a photorealistic architectural photograph of exactly the same real building, wall, gate and street as the first image, taken from the same spot on the red earth road and facing the same direction, but with the camera raised about four metres higher, level with the first-floor windows, as if on a camera mast, and tilted gently downward. From this height the camera looks over the stone boundary wall and the black railings into the property, revealing the open gravel forecourt in front of the three-storey main building and the ground-floor colonnade with its stone-clad pillars and glass entrance doors, exactly as they look in the second image, which is a real photograph of that forecourt taken from inside the gate. The camera stays below the roofline, so no roof surface is visible. Keep everything else exactly as in the first image: both building sections with the same shape, proportions, windows, air-conditioning units and stone cladding, the 'AMP' and 'LODGE' letters, the 'TIWAAH' and 'EXECUTIVE' letters, both flags and flagpoles, the cream pillars with their wall lamps, the stone boundary wall, the black railings and the black sliding gate, the signboard and its lettering, the palm tree, the satellite dish, the overhead power lines, the neighbouring building on the right, the grass verge and the red earth road, and the same soft warm late-afternoon light and sky. Do not add any new buildings, floors, balconies, pools, gardens, lawns, plants, cars, people or features that are not in the two images. Photorealistic, natural perspective, no stylisation.

**V1, crane** (first frame S2, tail frame S1):
> Photorealistic architectural film of the real AMP Lodge in Kumasi, Ghana, in warm late-afternoon light. Camera: one continuous, perfectly smooth and stabilized crane shot that descends slowly from first-floor height, looking over the boundary wall into the forecourt, down to eye level on the road in front of the gate, arriving exactly on the last frame. As the camera lowers it tilts up gently, so the forecourt slips behind the wall and the stone façades rise in the frame. Keep everything exactly as in the first and last frames: the two stone-clad buildings and their windows and air-conditioning units, the AMP LODGE and TIWAAH EXECUTIVE lettering, the two flags on their poles, the stone boundary wall with cream pillars and black railings, the sliding gate, the black signboard and its lettering, the satellite dish, the palm tree, the power lines and the soft evening sky. The flags stir gently in a light breeze and the clouds drift slightly. Do not add or remove buildings, floors, roofs, windows, signs, text, people or vehicles. Do not change the shape of the buildings, the wall or the gate. No warping, morphing, flicker, lens flares or exaggerated motion. Calm, premium, cinematic.

**V2, gate** (first frame S1):
> Photorealistic architectural film shot based strictly on this photograph of the real AMP Lodge in Kumasi, Ghana, in warm late-afternoon light. Camera: a slow, perfectly stabilized forward dolly at eye level from the road toward the black sliding gate between the cream pillars on the right, with a gentle drift to the right, travelling only a short distance and ending on a calm, stable frame where the gate and its vertical bars fill the right half of the picture and the stone building is visible behind it. Preserve everything exactly as photographed: the two stone-clad buildings, their windows and air-conditioning units, the AMP LODGE and TIWAAH EXECUTIVE lettering, the flags on their poles, the stone boundary wall, the cream pillars and their wall lights, the black railings, the sliding gate, the black signboard and its lettering, the satellite dish, the palm tree, the power lines, the grass verge and the red earth road. The flags stir gently in a light breeze. Do not add or remove buildings, floors, windows, signs, text, people or vehicles. Do not open the gate. Do not change the shape of the buildings, the wall or the gate. No warping, morphing, flicker, lens flares or exaggerated motion.

**V3, forecourt (retired)** (first frame: the real forecourt photograph):
> Photorealistic architectural film shot based strictly on this real photograph of the forecourt and main building of AMP Lodge, Kumasi, taken from inside the gate. Camera: one slow, perfectly stabilized forward dolly at eye level across the gravel forecourt, straight toward the glass entrance doors in the centre of the ground-floor colonnade, travelling only part of the way and staying well short of the building. Preserve everything exactly as photographed: the three-storey building clad in multicoloured stone, the 'AMP' and 'LODGE' letters on the top edge, every window and its dark frame, the recessed beige panels, the air-conditioning units, the long horizontal window and the vertical louvres on the right, the ground-floor colonnade with its stone-clad pillars, the grey walls, the white doors, the vertical slatted window, the central glass double doors, the red fire extinguisher, the small potted plants, the yellow planter and the white box on the left, the pale gravel, the grass borders, the palm tree on the left, the neighbouring house on the right, the power line and the pale blue sky. Natural daylight with a restrained, slightly warm filmic grade. Do not add or remove buildings, floors, windows, doors, signs, text, plants, vehicles or people. Do not change the shape of the building. No warping, morphing, flicker or lens effects. End on a calm, stable, symmetrical frame of the entrance.

**S3, forecourt with the wing** (inputs: the real forecourt photograph, and the owner's road photograph):
> Edit the first image, a real photograph of the gravel forecourt and main building of AMP Lodge in Kumasi, Ghana, so that it shows the lodge as it stands today. The second image is a recent real photograph of the same property taken from the road outside the gate: it shows that a second, two-storey building clad in the same irregular multicoloured stone now stands to the right of the main building and closer to the road, with small dark square windows on each floor and white air-conditioning units on its long side wall, which faces the forecourt. In the first image, on the right-hand side of the frame, replace the grass verge, the low wall and the neighbouring house with the near end of that building's long side wall, exactly as it looks in the second image: the same stone cladding, the same small dark square windows in two rows and the same white air-conditioning units, in correct perspective, standing on the gravel at the right edge of the frame and receding toward the right end of the main building. Keep everything else exactly as it is in the first image: the three-storey main building with its 'AMP' and 'LODGE' letters, every window and its dark frame, the recessed beige panels, the air-conditioning units, the long horizontal window and the vertical louvres, the ground-floor colonnade with its stone-clad pillars, the grey walls, the central glass entrance doors, the white doors, the red fire extinguisher, the small potted plants, the yellow planter and the white box on the left, the palm tree on the left, the pale gravel, the grass on the left, the power line and the sky. Same camera position, framing, lens and natural daylight as the first image. Do not add any other buildings, floors, signs, text, people, vehicles, flags or plants. Photorealistic architectural photograph, no stylisation.

**V3b, forecourt** (first frame S3):
> Photorealistic architectural film shot based strictly on this photograph of the gravel forecourt of AMP Lodge, Kumasi, Ghana, with the three-storey main building ahead and the two-storey stone-clad wing on the right. Camera: one slow, perfectly stabilized forward dolly at eye level across the gravel forecourt, straight toward the glass entrance doors in the centre of the main building's ground-floor colonnade, travelling only part of the way and staying well short of the building, while the wing on the right slides gently past in natural parallax. Preserve everything exactly as photographed: the main building's multicoloured stone cladding, the 'AMP' and 'LODGE' letters, every window and its dark frame, the recessed beige panels, the air-conditioning units, the colonnade with its stone-clad pillars, the vertical slats, the central glass double doors, the white doors, the red fire extinguisher, the potted plants, the yellow planter and the white box on the left, the palm tree and the grass on the left; on the right, the wing's grey-blue stone wall, its windows, its overhang and its air-conditioning units; the pale gravel and the pale blue sky. Natural daylight with a restrained, slightly warm filmic grade. Do not add or remove buildings, floors, windows, doors, signs, text, plants, vehicles or people. Do not change the shape of either building. No warping, morphing, flicker or lens effects. End on a calm, stable, symmetrical frame of the entrance.

**Deluxe Room:**
> Photorealistic premium cinematic room film based strictly on this photograph of the real Deluxe Room at AMP Lodge, Kumasi. Camera: one extremely slow, perfectly stabilized lateral dolly from right to left with a very gentle push-in toward the bed, as if on a slider; the frame stays inside the room shown in the photograph. Preserve everything exactly as photographed: the soft grey-green walls, the tall pale curtains over the window on the left and the daylight through them, the dark wooden bed and headboard, the navy bedding with its copper geometric pattern and the two matching pillows, the white sheet, the bedside lamp on the left, the dark bedside table on the right, the dark wooden desk in the bottom left corner, the cream armchair with the blue checked blanket, the red patterned rug, the grey marble-look floor tiles, the wall socket and switches, and the shadow of the ceiling fan on the wall, which stays still. Natural daylight, restrained filmic colour grade. Do not enlarge the room, change the bed, or add or remove any furniture, objects, decorations, windows, doors, people or text. No warping, morphing, flicker, floating objects or lens effects. End on a calm, stable frame.

**Presidential Suite:**
> Photorealistic premium cinematic room film based strictly on this photograph of the real Presidential Suite lounge at AMP Lodge, Kumasi. Camera: one very slow, perfectly stabilized forward dolly at seated eye level, moving gently into the room between the red leather recliners toward the television wall, with a slight, smooth arc to the left; the frame stays inside the room shown in the photograph. Preserve everything exactly as photographed: the grey walls, the coffered white ceiling with its recessed lights and the ceiling fan, which stays still, the white curtains on both windows and the window bars on the left, the wall-mounted television and the black low cabinet beneath it, the glass coffee table, the orange and red oval rug, the red leather two-seat recliner on the left, the single red recliner in the foreground and the red three-seat recliner on the right, the two white vases with red stems, the cream standing air-conditioning unit on the right, the framed picture at the left edge, the wall sockets and the polished grey marble floor tiles with their reflections. Soft natural daylight, restrained filmic colour grade. Do not enlarge the room or add or remove any furniture, objects, decorations, windows, doors, people or text. No warping, morphing, flicker, floating objects or lens effects. End on a calm, stable frame.

### Seedance (clips still in use)

**Corridor:**
> Photorealistic architectural interior film shot based strictly on this photograph of the corridor at AMP Lodge. Camera: a very slow, perfectly stabilized forward dolly along the corridor at eye level, travelling only a short distance and staying well short of the far end. Preserve everything exactly as photographed: the yellow walls, the windows and doors along the walls, the red fire extinguisher, the ceiling and its lights, the floor tiles and the far end of the corridor. Keep the warm light of the photograph. Do not add or remove doors, windows, signs, furniture, decorations or people. Do not change the length, width or height of the corridor. No warping, morphing, flicker, floating objects or lens effects. End on a calm, stable frame.

**Standard Room:**
> Photorealistic architectural interior film shot based strictly on this photograph of a real hotel room at AMP Lodge. Camera: an extremely slow, perfectly stabilized push-in with a gentle lateral drift to the left, as if on a dolly; the frame stays within the room shown in the photograph. Preserve everything exactly as photographed: the green walls, the window and white curtain on the left, the dark wooden bed and headboard, the patterned bedcover and pillows, the bedside table and lamp, the cream armchair with its red cushion, the rug, the floor tiles and the wall socket. Keep the soft natural daylight and the warm lamp glow from the photograph. Restrained, natural colour grading. Do not add or remove furniture, objects, decorations, windows, doors or people. Do not change the size, shape or layout of the room. No warping, morphing, flicker, floating objects or lens effects. End on a calm, stable frame.

**Family Room:**
> Photorealistic architectural interior film shot based strictly on this photograph of the Family Room at AMP Lodge. Camera: an extremely slow, perfectly stabilized push-in with a gentle lateral drift, as if on a dolly; the frame stays within the room shown in the photograph. Preserve everything exactly as photographed: the two beds and their dark headboards, the patterned bedcovers and pillows, the window and the teal curtains, the air-conditioning unit, the ceiling fan, which stays still, the walls, the ceiling and the floor. Keep the soft natural daylight of the photograph. Do not add or remove beds, furniture, objects, decorations, windows, doors or people. Do not change the size, shape or layout of the room. No warping, morphing, flicker, floating objects or lens effects. End on a calm, stable frame.

**Executive Suite:**
> Photorealistic architectural interior film shot based strictly on this photograph of the Executive Suite at AMP Lodge. Camera: an extremely slow, perfectly stabilized forward dolly toward the bed combined with a restrained lateral drift to the right; the movement grows calmer toward the end and the frame stays within the room shown in the photograph. Preserve everything exactly as photographed: the warm amber walls, the window and white curtains, the picture above the bed, the dark wooden bed and headboard, the patterned bedcover and pillows, the bedside table and lamp, the cream armchair, the rug, the dark wooden cabinet on the left, the ceiling and the floor tiles. Keep the soft daylight and the warm lamp glow of the photograph. Restrained, natural colour grading. Do not add or remove furniture, objects, decorations, windows, doors or people. Do not change the size, shape or layout of the room. No warping, morphing, flicker, floating objects or lens effects. End on a beautiful, calm, stable frame.

## Replacing the film later

Real footage can replace any clip, for example gimbal or drone footage of the approach, the forecourt, the corridor or a room:
1. Put the new clip in `media/film-source/`.
2. Point its entry in `scripts/build-film-frames.mjs` at the new file, and set trims and the focal point.
3. Rebuild that clip: `node scripts/build-film-frames.mjs <id>`.

Nothing else changes as long as the id stays the same. Room ids are the room's URL slug. A new room type with footage needs only a new entry named after its slug.
