/**
 * Every photograph the public site uses. All are the property's own photos
 * (previously hosted on Firebase), re-encoded locally at their native size:
 * the originals are at most 1024 px wide, so nothing is upscaled. See
 * docs/redesign/AUDIT.md: professional photography at ≥2400 px is recommended.
 *
 * Alt text describes what is visible in each photograph and nothing more.
 */
export interface Photo {
  slug: string
  alt: string
  /** Short caption for galleries and lightbox. */
  caption: string
  category: 'Exterior' | 'Rooms' | 'Bathrooms' | 'Interiors' | 'Shared spaces'
  width: number
  height: number
  /** Widths available as WebP. */
  webp: number[]
  /** Width of the JPEG fallback. */
  jpg: number
}

const landscape = (w = 1024, h = 684) => ({ width: w, height: h, webp: [640, w], jpg: w })

export const PHOTOS = {
  /** Supplied by the owner on 2026-11-01 (exteriorpic.jpeg). Light colour correction only. */
  exteriorRoad: {
    slug: 'exterior-road',
    alt: 'AMP Lodge from the road: two stone-clad buildings behind a stone wall with cream pillars, black railings, a sliding gate, flags and the AMP Lodge signboard',
    caption: 'The lodge from the road',
    category: 'Exterior',
    width: 1080,
    height: 810,
    webp: [640, 1080],
    jpg: 1080,
  },
  exteriorDay: {
    slug: 'exterior-day',
    alt: 'The three-storey stone façade of AMP Lodge in daylight, behind a gravel forecourt',
    caption: 'The stone façade by day',
    category: 'Exterior',
    ...landscape(),
  },
  /**
   * The forecourt film's first frame: the daylight façade photograph with the
   * Tiwaah Executive wing on the right, added with Kling from the owner's road
   * photograph (the original predates the wing). Graded like the film. Not in
   * the gallery, being an edited image. See FILM-MANIFEST.md.
   */
  forecourtWing: {
    slug: 'forecourt-wing',
    alt: 'The stone façade of AMP Lodge across the gravel forecourt, with the stone-clad Tiwaah Executive wing on the right',
    caption: 'The forecourt',
    category: 'Exterior',
    width: 1920,
    height: 1288,
    webp: [640, 1280, 1920],
    jpg: 1280,
  },
  exteriorNight: {
    slug: 'exterior-night',
    alt: 'AMP Lodge lit at night, with flags flying in front of the stone building and the gated entrance',
    caption: 'Arriving after dark',
    category: 'Exterior',
    ...landscape(1024, 768),
  },
  roomExecutive: {
    slug: 'room-executive-suite',
    alt: 'A warm amber room with a dark wood double bed, patterned bedding, bedside lamps and an armchair',
    caption: 'Executive Suite',
    category: 'Rooms',
    ...landscape(),
  },
  roomStandard: {
    slug: 'room-standard',
    alt: 'A green-walled room with a wooden double bed, patterned bedding, a bedside lamp and a cream armchair',
    caption: 'Standard Room',
    category: 'Rooms',
    ...landscape(),
  },
  roomDeluxe: {
    slug: 'room-deluxe',
    alt: 'A soft grey room with a double bed dressed in navy geometric bedding',
    caption: 'Deluxe Room',
    category: 'Rooms',
    ...landscape(1024, 768),
  },
  roomFamily: {
    slug: 'room-family',
    alt: 'A bright room with two beds in patterned bedding and teal curtains',
    caption: 'Family Room',
    category: 'Rooms',
    width: 576,
    height: 1024,
    webp: [576],
    jpg: 576,
  },
  roomPresidential: {
    slug: 'room-presidential-suite',
    alt: 'A suite lounge with red leather recliners, a wall-mounted television and marble floors',
    caption: 'Presidential Suite lounge',
    category: 'Rooms',
    width: 560,
    height: 992,
    webp: [560],
    jpg: 560,
  },
  suiteLounge: {
    slug: 'suite-lounge',
    alt: 'A spacious lounge with red leather recliners around a coffee table, a wall-mounted television and grey marble floors',
    caption: 'Suite lounge',
    category: 'Interiors',
    ...landscape(1024, 768),
  },
  diningArea: {
    slug: 'dining-area',
    alt: 'A dark dining table with four upholstered chairs beside a bright window',
    caption: 'Dining table',
    category: 'Interiors',
    ...landscape(1024, 768),
  },
  corridor: {
    slug: 'corridor',
    alt: 'A long golden-yellow corridor with tiled floors leading to the guest rooms',
    caption: 'The corridor to the rooms',
    category: 'Shared spaces',
    ...landscape(),
  },
  corridorMarble: {
    slug: 'corridor-marble',
    alt: 'A narrow corridor with polished marble floors opening onto a lounge',
    caption: 'Marble hallway',
    category: 'Shared spaces',
    width: 576,
    height: 768,
    webp: [576],
    jpg: 576,
  },
  stairwell: {
    slug: 'stairwell',
    alt: 'A pale green stair landing with a black iron balustrade',
    caption: 'The stair landing',
    category: 'Shared spaces',
    ...landscape(),
  },
  bathroomShower: {
    slug: 'bathroom-shower',
    alt: 'A white bathroom with a round mirror, basin, toilet and a walk-in shower',
    caption: 'Walk-in shower',
    category: 'Bathrooms',
    ...landscape(),
  },
  bathroomGlass: {
    slug: 'bathroom-glass-shower',
    alt: 'A marble-tiled bathroom with a frameless glass shower enclosure',
    caption: 'Glass shower',
    category: 'Bathrooms',
    ...landscape(),
  },
  bedroomGreen: {
    slug: 'bedroom-green',
    alt: 'A green room with a wooden double bed, bedside lamp and a framed picture',
    caption: 'Green room',
    category: 'Rooms',
    width: 960,
    height: 768,
    webp: [640, 960],
    jpg: 960,
  },
  bedroomGreenTeal: {
    slug: 'bedroom-green-teal',
    alt: 'A green room with a double bed, teal curtains, a lit bedside lamp and a wall-mounted air conditioner',
    caption: 'Evening light',
    category: 'Rooms',
    ...landscape(),
  },
  bedsideDetail: {
    slug: 'bedside-detail',
    alt: 'A bedside table with a warm lamp beside a dark wood headboard on an amber wall',
    caption: 'Bedside',
    category: 'Interiors',
    ...landscape(),
  },
  deskGreen: {
    slug: 'desk-green-room',
    alt: 'A wooden desk below a wall-mounted television in a green room',
    caption: 'Desk and television',
    category: 'Interiors',
    ...landscape(),
  },
  deskOrange: {
    slug: 'desk-orange-room',
    alt: 'A wooden desk below a wall-mounted television and air conditioner in an amber room',
    caption: 'Desk, television and air conditioning',
    category: 'Interiors',
    ...landscape(),
  },
  eventHall: {
    slug: 'event-hall',
    alt: 'A large open hall with tiled floors, exposed beams and a counter at the far end',
    caption: 'The hall',
    category: 'Shared spaces',
    ...landscape(),
  },
} satisfies Record<string, Photo>

export type PhotoKey = keyof typeof PHOTOS

export const photoBase = '/images/property'

export function photoSrcSet(p: Photo): string {
  return p.webp.map((w) => `${photoBase}/${p.slug}-${w}.webp ${w}w`).join(', ')
}

export function photoJpg(p: Photo): string {
  return `${photoBase}/${p.slug}-${p.jpg}.jpg`
}

/** Gallery order: arrival, rooms, details, bathrooms, shared spaces. */
export const GALLERY: Photo[] = [
  PHOTOS.exteriorRoad,
  PHOTOS.exteriorDay,
  PHOTOS.exteriorNight,
  PHOTOS.roomExecutive,
  PHOTOS.roomStandard,
  PHOTOS.roomDeluxe,
  PHOTOS.roomFamily,
  PHOTOS.bedroomGreenTeal,
  PHOTOS.bedroomGreen,
  PHOTOS.suiteLounge,
  PHOTOS.roomPresidential,
  PHOTOS.bedsideDetail,
  PHOTOS.deskOrange,
  PHOTOS.deskGreen,
  PHOTOS.diningArea,
  PHOTOS.bathroomGlass,
  PHOTOS.bathroomShower,
  PHOTOS.corridor,
  PHOTOS.corridorMarble,
  PHOTOS.stairwell,
  PHOTOS.eventHall,
]

/**
 * The film's first frame: the lodge from first-floor height above the road,
 * looking over the wall into the forecourt. Made from the owner's photograph
 * (exteriorpic.jpeg) with Kling: cleaned up, then raised to that height; the
 * signboard is the real one, composited back in. See FILM-MANIFEST.md.
 * Landscape for tablets and desktop; a 2:3 crop for phones that matches the
 * phone frames exactly.
 */
export const HERO_MEDIA = {
  base: '/images/hero/amp-lodge-arrival',
  widths: [1280, 1600, 1920],
  width: 1920,
  height: 1434,
  portrait: '/images/hero/amp-lodge-arrival-portrait-720',
  portraitWidth: 720,
  portraitHeight: 1080,
  alt: 'AMP Lodge in late-afternoon light, seen from above the road: two stone-clad buildings, flags in the forecourt, and the stone wall with cream pillars, black railings, the sliding gate and the AMP Lodge signboard',
} as const
