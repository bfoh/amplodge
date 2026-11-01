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
  exteriorDay: {
    slug: 'exterior-day',
    alt: 'The three-storey stone façade of AMP Lodge in daylight, behind a gravel forecourt',
    caption: 'The stone façade by day',
    category: 'Exterior',
    ...landscape(),
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

export const HERO_MEDIA = {
  poster960: '/videos/hero/amp-lodge-hero-poster-960',
  poster1920: '/videos/hero/amp-lodge-hero-poster-1920',
  width: 1920,
  height: 1080,
  alt: 'AMP Lodge at dusk: the stone façade lit by warm wall lights, flags flying behind the iron fence, and the AMP LODGE sign',
} as const
