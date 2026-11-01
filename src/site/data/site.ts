/**
 * Facts about the lodge used across the public site. Each one notes where it
 * comes from; anything marked UNVERIFIED is listed in docs/redesign/AUDIT.md
 * for the owner to confirm before launch.
 */
export const SITE = {
  name: 'AMP Lodge',
  origin: 'https://amplodge.org',
  /** Source: previous ContactPage. */
  address: {
    line1: 'Abuakwa DKC Junction',
    line2: 'Kumasi–Sunyani Road',
    city: 'Kumasi',
    region: 'Ashanti Region',
    country: 'Ghana',
    oneLine: 'Abuakwa DKC Junction, Kumasi–Sunyani Road, Kumasi, Ghana',
  },
  /** Source: previous ContactPage. */
  phone: { display: '+233 55 500 9697', href: 'tel:+233555009697' },
  /** Source: previous ContactPage. */
  email: { general: 'info@amplodge.org', bookings: 'bookings@amplodge.org' },
  /** Source: previous ContactPage ("Hours"). UNVERIFIED: whether these are reception or office hours. */
  hours: [
    { days: 'Monday – Friday', time: '8:00 AM – 8:00 PM' },
    { days: 'Saturday – Sunday', time: '9:00 AM – 6:00 PM' },
  ],
  maps: {
    query: 'AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana',
    get link() {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.query)}`
    },
    get directions() {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(this.query)}`
    },
    get embed() {
      return `https://www.google.com/maps?q=${encodeURIComponent(this.query)}&output=embed`
    },
  },
} as const

export const NAV_LINKS = [
  { to: '/rooms', label: 'Rooms' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/virtual-tour', label: 'Virtual tour' },
  { to: '/contact', label: 'Contact' },
] as const
