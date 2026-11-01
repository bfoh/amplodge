#!/usr/bin/env node
/**
 * Turns the film's source clips (media/film-source/*.mp4) into the
 * scroll-scrubbed frame sequences the home page draws on a canvas, and writes
 * src/site/film/frames.generated.ts with their counts and sizes.
 *
 *   FFMPEG=/path/to/ffmpeg node scripts/build-film-frames.mjs [id ...]
 *   (without FFMPEG it uses `uv run --with imageio-ffmpeg`, or ffmpeg on PATH;
 *   with ids, only those clips are rebuilt and the others keep their entries)
 *
 * Each clip gets two sets of WebP frames in public/film/<id>/:
 *   d-NNN.webp  desktop and tablet: the full frame, at most `maxW` px wide
 *   m-NNN.webp  phones: a 2:3 portrait crop around the clip's focal point,
 *               480×720 (portrait clips are only scaled)
 *
 * Room clips are named after the room's URL slug (src/site/data/rooms.ts), so
 * a room type the owner adds later gets its film by adding a clip here with
 * its slug as the id. Rooms without a clip use their photograph.
 *
 * `start`/`end` trim a clip (seconds) where the generated footage drifts from
 * the photograph; `grade` is an extra ffmpeg filter to match the film's light.
 * The reasons are recorded in docs/redesign/FILM-MANIFEST.md.
 *
 * To replace a clip with real footage: drop the new file in media/film-source/
 * under the same name, adjust `focusX` if the subject moved, and run this again.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
// Warms the overcast forecourt clip toward the late-afternoon light of the exterior shots.
const WARM = 'colorbalance=rs=0.05:bs=-0.07:rm=0.07:gm=0.01:bm=-0.08:rh=0.08:gh=0.02:bh=-0.08,eq=saturation=1.05:contrast=1.03:brightness=0.01'
const CLIPS = [
  // The arrival: an elevated crane down to eye level, the road to the gate, the forecourt, the corridor.
  { id: 'elevated', src: 'media/film-source/elevated.mp4', d: 48, m: 36, focusX: 0.42, q: 52 },
  { id: 'gate', src: 'media/film-source/gate.mp4', d: 36, m: 28, focusX: 0.7, q: 50 },
  { id: 'forecourt', src: 'media/film-source/forecourt.mp4', d: 32, m: 24, focusX: 0.56, grade: WARM, q: 48 },
  { id: 'corridor', src: 'media/film-source/corridor.mp4', d: 40, m: 28, focusX: 0.5 },
  // Rooms, by slug.
  { id: 'standard-room', src: 'media/film-source/standard-room.mp4', d: 40, m: 28, focusX: 0.42 },
  { id: 'executive-suite', src: 'media/film-source/executive-suite.mp4', d: 40, m: 28, focusX: 0.5, end: 4.0 },
  { id: 'deluxe-room', src: 'media/film-source/deluxe-room.mp4', d: 40, m: 28, focusX: 0.42 },
  { id: 'family-room', src: 'media/film-source/family-room.mp4', d: 40, m: 28, focusX: 0.5 },
  { id: 'presidential-suite', src: 'media/film-source/presidential-suite.mp4', d: 36, m: 24, focusX: 0.45, end: 1.83 },
]

function ffmpegBin() {
  if (process.env.FFMPEG) return process.env.FFMPEG
  try {
    return execFileSync('uv', ['run', '-q', '--with', 'imageio-ffmpeg', 'python', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim()
  } catch {
    return 'ffmpeg'
  }
}
const FF = ffmpegBin()

function probe(file) {
  let out = ''
  try {
    execFileSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    out = String(e.stderr)
  }
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(out)
  const size = /Video: .*?, (\d{2,5})x(\d{2,5})/.exec(out)
  if (!dur || !size) throw new Error(`could not read ${file}`)
  return { duration: +dur[1] * 3600 + +dur[2] * 60 + +dur[3], width: +size[1], height: +size[2] }
}

function extract(file, outDir, prefix, count, clip, span, filter) {
  // Evenly spaced frames across the kept span: fps = count / span, then keep exactly `count`.
  const fps = (count / span).toFixed(5)
  const vf = [`fps=${fps}`, clip.grade, filter].filter(Boolean).join(',')
  const trim = [...(clip.start ? ['-ss', String(clip.start)] : []), ...(clip.end ? ['-to', String(clip.end)] : [])]
  const quality = String(prefix === 'd' ? (clip.q ?? 62) : (clip.q ?? 62) - 4)
  execFileSync(FF, ['-v', 'error', '-y', ...trim, '-i', file, '-vf', vf, '-frames:v', String(count), '-an', '-c:v', 'libwebp', '-quality', quality, '-compression_level', '6', join(outDir, `${prefix}-%03d.webp`)])
  const files = readdirSync(outDir).filter((f) => f.startsWith(`${prefix}-`)).sort()
  // A short content hash, appended to frame URLs: frames are cached for a week
  // under fixed names, so a rebuilt clip must not mix with old cached frames.
  const hash = createHash('sha1')
  for (const f of files) hash.update(readFileSync(join(outDir, f)))
  return { count: files.length, bytes: files.reduce((n, f) => n + statSync(join(outDir, f)).size, 0), v: hash.digest('hex').slice(0, 8) }
}

const only = process.argv.slice(2)
const manifestPath = join(root, 'src/site/film/frames.generated.ts')
let manifest = {}
if (only.length) {
  // Keep the entries of clips that aren't being rebuilt.
  const m = /= (\{[\s\S]*\})\s*$/.exec(readFileSync(manifestPath, 'utf8'))
  if (m) manifest = JSON.parse(m[1])
}
const known = new Set(CLIPS.map((c) => c.id))
for (const id of Object.keys(manifest)) if (!known.has(id)) delete manifest[id]

for (const clip of CLIPS) {
  if (only.length && !only.includes(clip.id)) continue
  const file = join(root, clip.src)
  try {
    statSync(file)
  } catch {
    console.warn(`skip ${clip.id}: ${clip.src} not found`)
    continue
  }
  const info = probe(file)
  const span = Math.min(clip.end ?? info.duration, info.duration) - (clip.start ?? 0)
  const outDir = join(root, 'public/film', clip.id)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const portrait = info.height > info.width
  const maxW = clip.maxW ?? 1280

  // Desktop: full frame, at most maxW wide (portrait clips: at most maxW tall).
  const dFilter = portrait ? `scale=-2:'min(${maxW},ih)':flags=lanczos` : `scale='min(${maxW},iw)':-2:flags=lanczos`
  const d = extract(file, outDir, 'd', clip.d, clip, span, dFilter)
  const dw = portrait ? Math.round((Math.min(maxW, info.height) * info.width) / info.height / 2) * 2 : Math.min(maxW, info.width)
  const dh = portrait ? Math.min(maxW, info.height) : Math.round((dw * info.height) / info.width / 2) * 2

  // Phones: 2:3 portrait crop around focusX, 480×720.
  const cropW = Math.min(info.width, Math.round((info.height * 2) / 3))
  const x = Math.max(0, Math.min(info.width - cropW, Math.round(info.width * clip.focusX - cropW / 2)))
  const mFilter = portrait ? 'scale=480:-2:flags=lanczos' : `crop=${cropW}:${info.height}:${x}:0,scale=480:720:flags=lanczos`
  const m = extract(file, outDir, 'm', clip.m, clip, span, mFilter)
  const mh = portrait ? Math.round((480 * info.height) / info.width / 2) * 2 : 720

  manifest[clip.id] = { d: { count: d.count, w: dw, h: dh, v: d.v }, m: { count: m.count, w: 480, h: mh, v: m.v } }
  console.log(
    `${clip.id.padEnd(19)} ${info.width}x${info.height} ${span.toFixed(2)}s  desktop ${d.count} frames ${(d.bytes / 1024).toFixed(0)} KB  phone ${m.count} frames ${(m.bytes / 1024).toFixed(0)} KB`,
  )
}

// Frame folders of clips that are no longer in the film.
for (const dir of readdirSync(join(root, 'public/film'))) {
  if (!known.has(dir) && statSync(join(root, 'public/film', dir)).isDirectory()) {
    rmSync(join(root, 'public/film', dir), { recursive: true, force: true })
    console.log(`removed public/film/${dir}`)
  }
}

const ts = `// Generated by scripts/build-film-frames.mjs. Do not edit by hand.
export interface FrameSet { count: number; w: number; h: number; v?: string }
export const FILM_FRAMES: Record<string, { d: FrameSet; m: FrameSet }> = ${JSON.stringify(manifest, null, 2)}
`
writeFileSync(manifestPath, ts)
console.log('wrote src/site/film/frames.generated.ts')
