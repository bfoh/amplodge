import { PageHero } from '../components/PageHero'
import { RoomCard } from '../components/RoomCard'
import { PHOTOS } from '../data/photos'
import { useRooms } from '../data/rooms'
import { SITE } from '../data/site'
import { Reveal } from '../motion/Reveal'
import { useDocumentMeta } from '../seo/useDocumentMeta'

export default function RoomsPage() {
  const { rooms, status } = useRooms()
  useDocumentMeta({
    title: 'Rooms & Suites | AMP Lodge, Kumasi',
    description: 'Every room and suite at AMP Lodge, Abuakwa, Kumasi, with live nightly rates from our booking system. Choose your dates and book directly.',
    path: '/rooms',
  })
  return (
    <>
      <PageHero
        eyebrow="Rooms & suites"
        title="Spaces made for rest."
        intro="Find the room that feels just right. Every rate below comes straight from our booking system."
        photo={PHOTOS.roomStandard}
        focus="50% 60%"
      />

      <section className="bg-amp-ivory py-20 sm:py-28" aria-labelledby="all-rooms">
        <div className="mx-auto max-w-site px-gutter">
          <h2 id="all-rooms" className="sr-only">
            All room types
          </h2>
          {status === 'error' && (
            <p role="status" className="mb-10 border-l-2 border-amp-bronze bg-amp-limestone p-4 text-sm text-amp-ink">
              We couldn't load live rates just now. You can still book online, where rates are shown for your dates, or call us on{' '}
              <a className="amp-link" href={SITE.phone.href}>
                {SITE.phone.display}
              </a>
              .
            </p>
          )}
          <Reveal stagger={0.08}>
            <ul className="grid gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((room) => (
                <li key={room.slug} data-reveal-item>
                  <RoomCard room={room} loading={status === 'loading'} headingLevel="h3" sizes="(min-width: 64rem) 30vw, (min-width: 40rem) 46vw, 100vw" />
                </li>
              ))}
            </ul>
          </Reveal>

          <div className="mt-24 grid gap-8 border-t border-amp-ink/15 pt-12 lg:grid-cols-12">
            <h2 className="amp-display text-[clamp(2rem,4vw,3rem)] text-amp-ink lg:col-span-5">Good to know</h2>
            <ul className="space-y-4 text-amp-ink-muted lg:col-span-7">
              <li>Rates are per room, per night, in Ghana cedis, and are confirmed before you pay.</li>
              <li>
                Every room books the same way: choose your dates online, or call us on{' '}
                <a className="amp-link text-amp-ink" href={SITE.phone.href}>
                  {SITE.phone.display}
                </a>
                .
              </li>
              <li>
                The sign at our gate reads “Accommodation and Bed &amp; Breakfast · Meeting Venue”. Ask us about breakfast or a meeting when you book:
                what is included depends on your booking.
              </li>
              <li>Photographs show rooms of each type; furnishings can differ between rooms.</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  )
}
