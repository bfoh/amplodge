import { PHOTOS, type Photo } from '../data/photos'
import { FILM_FRAMES } from './frames.generated'

/**
 * The arrival film: six clips, each animated by Seedance from one real
 * photograph of the lodge (see docs/redesign/FILM-MANIFEST.md), and the
 * still each one falls back to. The threshold and the move into the rooms are
 * editorial cuts made in the page, not generated footage: no photograph shows
 * how the outside connects to the inside, so none is invented.
 */
export type ClipId = 'arrival' | 'approach' | 'corridor' | 'standard' | 'family' | 'executive'

export interface FilmClip {
  id: ClipId
  /** Shown until (and unless) the frames arrive; the clip's first frame matches it. */
  still: Photo | null
  /** Focal point kept in view when the stage is narrower than the frame. */
  focusX: number
  focusY: number
}

export const FILM_BASE = '/film'

export const CLIPS: Record<ClipId, FilmClip> = {
  arrival: { id: 'arrival', still: null, focusX: 0.3, focusY: 0.5 },
  approach: { id: 'approach', still: PHOTOS.exteriorNight, focusX: 0.45, focusY: 0.55 },
  corridor: { id: 'corridor', still: PHOTOS.corridor, focusX: 0.5, focusY: 0.5 },
  standard: { id: 'standard', still: PHOTOS.roomStandard, focusX: 0.42, focusY: 0.55 },
  family: { id: 'family', still: PHOTOS.roomFamily, focusX: 0.5, focusY: 0.6 },
  executive: { id: 'executive', still: PHOTOS.roomExecutive, focusX: 0.5, focusY: 0.6 },
}

export function frameSet(id: ClipId, phone: boolean) {
  const entry = FILM_FRAMES[id]
  if (!entry) return null
  return phone ? entry.m : entry.d
}

/** The three rooms the film visits, in order; copy from the brief. */
export const FILM_ROOMS = [
  { slug: 'standard-room', clip: 'standard' as const, tagline: 'Comfort in its simplest form.' },
  { slug: 'family-room', clip: 'family' as const, tagline: 'More room for moments together.' },
  { slug: 'executive-suite', clip: 'executive' as const, tagline: 'Settle into something special.' },
]

/** Scene names for the progress rail and the reduced-motion sequence. */
export const SCENES = [
  'Arrival',
  'The approach',
  'The threshold',
  'Inside',
  'The rooms',
  'Standard Room',
  'Family Room',
  'Executive Suite',
] as const
