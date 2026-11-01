import { PHOTOS, type Photo } from '../data/photos'
import { FILM_FRAMES, type FrameSet } from './frames.generated'

/**
 * The film's clips (see docs/redesign/FILM-MANIFEST.md for how each was made).
 *
 * The arrival is four clips: an elevated crane down to eye level on the road,
 * the approach to the gate, the forecourt toward the glass doors, and the
 * corridor. The gate opening and the threshold are cuts made in the page, not
 * generated footage: no photograph shows the route from the forecourt to the
 * corridor, so none is invented.
 *
 * Rooms are looked up by their URL slug: a room type with frames in
 * public/film/<slug>/ gets its film, any other room its photograph with a
 * camera move made in the page. Nothing here fixes how many rooms there are.
 */
export type ArrivalClipId = 'elevated' | 'gate' | 'forecourt' | 'corridor'

export interface FilmClip {
  id: string
  /** Shown until (and unless) the frames arrive. */
  still: Photo | null
  /** Focal point kept in view when the stage is narrower than the frame (desktop frames). */
  focusX: number
  focusY: number
}

export const FILM_BASE = '/film'

export const ARRIVAL: Record<ArrivalClipId, FilmClip> = {
  // The poster (HERO_MEDIA) is this clip's first frame.
  elevated: { id: 'elevated', still: null, focusX: 0.5, focusY: 0.5 },
  // Starts on the retouched eye-level photograph, which ends the crane.
  gate: { id: 'gate', still: PHOTOS.exteriorRoad, focusX: 0.6, focusY: 0.55 },
  forecourt: { id: 'forecourt', still: PHOTOS.exteriorDay, focusX: 0.55, focusY: 0.55 },
  corridor: { id: 'corridor', still: PHOTOS.corridor, focusX: 0.5, focusY: 0.5 },
}

/** The detail chapter's still: the eye-level frame at full resolution (desktop only). */
export const FACADE_DETAIL = {
  src: '/images/hero/amp-lodge-facade-2400.webp',
  width: 2400,
  height: 1792,
}

export function frameSet(id: string, phone: boolean): FrameSet | null {
  const entry = FILM_FRAMES[id]
  if (!entry) return null
  return phone ? entry.m : entry.d
}

export function hasFilm(id: string): boolean {
  return !!FILM_FRAMES[id]
}

/**
 * Where each room's camera looks when the stage is narrower than the frame,
 * keyed by room slug. Rooms not listed are framed on the centre.
 */
export const ROOM_FOCUS: Record<string, { x: number; y: number }> = {
  'standard-room': { x: 0.42, y: 0.55 },
  'executive-suite': { x: 0.5, y: 0.6 },
  'deluxe-room': { x: 0.45, y: 0.55 },
  'family-room': { x: 0.5, y: 0.6 },
  'presidential-suite': { x: 0.45, y: 0.6 },
}

export function roomFocus(slug: string) {
  return ROOM_FOCUS[slug] ?? { x: 0.5, y: 0.55 }
}

/**
 * The photograph each room film was animated from (its first frame), shown
 * until the frames arrive and on lite devices. The Presidential Suite's film
 * starts on the landscape photograph of its lounge, not its portrait hero.
 */
const ROOM_STILL: Record<string, Photo> = {
  'standard-room': PHOTOS.roomStandard,
  'executive-suite': PHOTOS.roomExecutive,
  'deluxe-room': PHOTOS.roomDeluxe,
  'family-room': PHOTOS.roomFamily,
  'presidential-suite': PHOTOS.suiteLounge,
}

export function roomStill(slug: string, hero: Photo): Photo {
  return ROOM_STILL[slug] ?? hero
}

/** Scene names for the arrival's progress rail, desktop and compact. */
export const ARRIVAL_SCENES = {
  desktop: ['Arrival', 'The façade', 'In detail', 'The approach', 'Through the gate', 'The threshold', 'Inside', 'The rooms'],
  compact: ['Arrival', 'The façade', 'The approach', 'Through the gate', 'The threshold', 'Inside', 'The rooms'],
} as const
