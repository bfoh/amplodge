# Arrival film: generation manifest

The home page's scroll film is made of six clips. Each was animated by BytePlus Seedance from **one real photograph of the lodge**. Nothing was generated from a text prompt alone, and no clip shows a place that has no photograph.

The threshold (outside to inside) and the moves between rooms are **cuts made in the page** (clip-path wipes, an aperture, a framed print), not generated footage. No photograph shows how the gate connects to the corridor, so none was invented.

## Model and settings

| | |
| --- | --- |
| Model | `dreamina-seedance-2-5-260628` (Dreamina Seedance 2.5), image-to-video with `first_frame` |
| Tool | `byteplus-seedance` MCP server (`~/mcp-servers/byteplus-seedance-mcp`) |
| Arrival clip | 1080p, 6 s, ratio `adaptive`, no audio, no watermark |
| Five film clips | 720p, 5 s, ratio `adaptive`, no audio, no watermark, 24 fps |
| Variations | one generation per clip; **no re-rolls** |

## Clips

| Clip | Scene(s) | Source photograph | Task ID | Output | Tokens | Approx. cost |
| --- | --- | --- | --- | --- | --- | --- |
| Arrival | 01 Arrival | `media/hero-source/first-frame-cleaned.png` (the owner's exterior photo, cleaned) | `cgt-20261101095226-2q9z7` | 1920×1080, 6.04 s | not recorded | $3.10–3.40 |
| Approach | 02 The approach, 03 Threshold | `public/images/property/exterior-night-1024.jpg` | `cgt-20261101171610-uvlxs` | 1112×834, 5.04 s | 109,586 | ≈ $1.17 |
| Corridor | 03 Threshold, 04 Inside, 05 The rooms | `public/images/property/corridor-1024.jpg` | `cgt-20261101171611-2stpa` | 1178×786, 5.04 s | 109,409 | ≈ $1.17 |
| Standard | 06 Standard Room | `public/images/property/room-standard-1024.jpg` | `cgt-20261101171150-0ijit` | 1178×786, 5.04 s | 109,409 | ≈ $1.17 |
| Family | 07 Family Room | `public/images/property/room-family-576.jpg` (portrait) | `cgt-20261101171613-vygrz` | 720×1280, 5.04 s | 108,900 | ≈ $1.17 |
| Executive | 08 Executive Suite, 09 hand-off | `public/images/property/room-executive-suite-1024.jpg` | `cgt-20261101171614-6o0v1` | 1178×786, 5.04 s | 109,409 | ≈ $1.17 |

**Cost:**
- The five film clips used **546,713 tokens, about $5.85**.
- The arrival clip, generated in the earlier phase, cost about $3.10–3.40.
- **Total: about $9.00–9.30.**
- Costs are estimates at about $10.70 per million tokens. That rate comes from a third-party price list and is **not verified against BytePlus billing**. Check the BytePlus console for the exact charge.

**Approval:**
- The arrival clip was approved by the owner before submission, in the first phase.
- The five film clips were approved together before submission, with a cap of $12 (about $5.85 spent).
- Nothing else was generated.

## Where the files are

| What | Path | Committed? |
| --- | --- | --- |
| Generated masters | `media/hero-source/amp-lodge-hero-master-hevc10.mp4`, `media/film-source/*.mp4` | **No.** Keep `media/` out of git and store it elsewhere. |
| Web frames | `public/film/<clip>/d-NNN.webp` (desktop, 48 frames, ≤ 1280 px wide, q62) and `m-NNN.webp` (phones, 32 frames, 480×720 crop at the clip's focal point, q58) | Yes (13 MB in all) |
| Frame manifest | `src/site/film/frames.generated.ts` | Yes, generated |
| Build script | `scripts/build-film-frames.mjs` | Yes |

The script rebuilds the frames from the masters:

```bash
FFMPEG=/path/to/ffmpeg node scripts/build-film-frames.mjs
```

Without `FFMPEG` it falls back to `uv run --with imageio-ffmpeg`.

Frame weight in KB:

| Clip | Desktop | Phones |
| --- | --- | --- |
| Arrival | 3,073 | 690 |
| Approach | 2,175 | 675 |
| Corridor | 676 | 236 |
| Standard | 1,294 | 367 |
| Family | 1,495 | 591 |
| Executive | 1,118 | 361 |
| **Total** | **≈ 9.8 MB** | **≈ 2.9 MB** |

A visitor downloads only the clips near where they are in the film: every 8th frame first, then the gaps. Visitors with reduced motion, Save-Data, 2G/3G connections or low-power devices download none.

## Quality control

Every clip was checked frame by frame against its source photograph. All were accepted, with these notes.

| Clip | QC notes |
| --- | --- |
| Arrival | Invented, blurry lettering behind the green flag. An inpainting smudge in the sky for the first ~2 s. The "A" of the AMP sign crops out during the push. |
| Approach | Small camera move, as asked. The flags flap across the "AMP" lettering. The person beside the vehicle is in the original photograph. |
| Corridor | Short dolly. The far end of the corridor stays as photographed. No issues found. |
| Standard | The glass on the bedside table is in the original photograph. No issues found. |
| Family | Portrait. The ceiling fan stays still, as asked. No issues found. |
| Executive | In the last second an air-conditioning unit's edge appears top left, outside the original frame. Its position in the real room is **unverified**. Air conditioning does appear in another photograph of the amber room. |

On the page, each film is labelled "Film animated from photographs of the lodge." (desktop). The screen-reader description says the same.

## Prompts (verbatim)

Every prompt asks the model to keep the photographed space exactly as it is. Each lists what is in the photograph and forbids adding or removing anything.

**Arrival:**
> Slow, steady cinematic dolly push-in toward the lodge's main stone façade between the two flagpoles; smooth, level, gentle forward motion only. Warm wall sconces and garden uplights glow softly on the stone under a soft dusk sky. Flags stir gently in a light breeze, shrubs move subtly. Realistic architectural depth and natural parallax through the iron fence. Restrained filmic colour grade, natural contrast, fine grain. The building, façade, windows, doors, fence, pillars, lamps and the AMP LODGE sign stay exactly as in the first frame, with no added floors, structures or features and no changes to text. No people, no vehicles, no lens flares, no exaggerated effects.

**Approach:**
> Photorealistic architectural film shot based strictly on this night photograph of the real AMP Lodge. Camera: a very slow, perfectly stabilized forward dolly at eye level toward the lit boundary wall and gate in front of the building, travelling only a short distance. Preserve everything exactly as photographed: the stone-faced building and its lit windows, the AMP LODGE lettering on the façade, the flags on their poles, the stone boundary wall, its pillars and metal railings, the signboard and its lettering, the parked white vehicle, the wall lights and their glow, the lawn and the night sky. Keep the existing lights exactly where they are; the flags may move gently in a light breeze. Do not add or remove buildings, floors, windows, doors, signs, text, vehicles, people or lights. Do not change the shape of the building or the wall. No warping, morphing, flicker, extra lens flares or exaggerated motion. End on a calm, stable frame of the wall, gate and building.

**Corridor:**
> Photorealistic architectural interior film shot based strictly on this photograph of the corridor at AMP Lodge. Camera: a very slow, perfectly stabilized forward dolly along the corridor at eye level, travelling only a short distance and staying well short of the far end. Preserve everything exactly as photographed: the yellow walls, the windows and doors along the walls, the red fire extinguisher, the ceiling and its lights, the floor tiles and the far end of the corridor. Keep the warm light of the photograph. Do not add or remove doors, windows, signs, furniture, decorations or people. Do not change the length, width or height of the corridor. No warping, morphing, flicker, floating objects or lens effects. End on a calm, stable frame.

**Standard Room:**
> Photorealistic architectural interior film shot based strictly on this photograph of a real hotel room at AMP Lodge. Camera: an extremely slow, perfectly stabilized push-in with a gentle lateral drift to the left, as if on a dolly; the frame stays within the room shown in the photograph. Preserve everything exactly as photographed: the green walls, the window and white curtain on the left, the dark wooden bed and headboard, the patterned bedcover and pillows, the bedside table and lamp, the cream armchair with its red cushion, the rug, the floor tiles and the wall socket. Keep the soft natural daylight and the warm lamp glow from the photograph. Restrained, natural colour grading. Do not add or remove furniture, objects, decorations, windows, doors or people. Do not change the size, shape or layout of the room. No warping, morphing, flicker, floating objects or lens effects. End on a calm, stable frame.

**Family Room:**
> Photorealistic architectural interior film shot based strictly on this photograph of the Family Room at AMP Lodge. Camera: an extremely slow, perfectly stabilized push-in with a gentle lateral drift, as if on a dolly; the frame stays within the room shown in the photograph. Preserve everything exactly as photographed: the two beds and their dark headboards, the patterned bedcovers and pillows, the window and the teal curtains, the air-conditioning unit, the ceiling fan, which stays still, the walls, the ceiling and the floor. Keep the soft natural daylight of the photograph. Do not add or remove beds, furniture, objects, decorations, windows, doors or people. Do not change the size, shape or layout of the room. No warping, morphing, flicker, floating objects or lens effects. End on a calm, stable frame.

**Executive Suite:**
> Photorealistic architectural interior film shot based strictly on this photograph of the Executive Suite at AMP Lodge. Camera: an extremely slow, perfectly stabilized forward dolly toward the bed combined with a restrained lateral drift to the right; the movement grows calmer toward the end and the frame stays within the room shown in the photograph. Preserve everything exactly as photographed: the warm amber walls, the window and white curtains, the picture above the bed, the dark wooden bed and headboard, the patterned bedcover and pillows, the bedside table and lamp, the cream armchair, the rug, the dark wooden cabinet on the left, the ceiling and the floor tiles. Keep the soft daylight and the warm lamp glow of the photograph. Restrained, natural colour grading. Do not add or remove furniture, objects, decorations, windows, doors or people. Do not change the size, shape or layout of the room. No warping, morphing, flicker, floating objects or lens effects. End on a beautiful, calm, stable frame.

## Replacing the film later

Real footage, such as gimbal or drone footage of the approach, the corridor and each room, can replace any clip:
1. Put the new clip in `media/film-source/`.
2. Point its entry in `scripts/build-film-frames.mjs` at the new file.
3. Rebuild the frames with the command above.

Nothing else changes as long as the clip id stays the same.
