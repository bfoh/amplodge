import { useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { db } from '@/lib/db'
import { activityLogService } from '@/services/activity-log-service'
import { MapEmbed } from '../components/MapEmbed'
import { PageHero } from '../components/PageHero'
import { PHOTOS } from '../data/photos'
import { findKnownRoom } from '../data/rooms'
import { SITE } from '../data/site'
import { Reveal } from '../motion/Reveal'
import { useDocumentMeta } from '../seo/useDocumentMeta'

/**
 * Contact. The submission logic is unchanged from the previous ContactPage:
 * a contact_messages row (status "unread") plus an activity-log entry, which
 * is what the staff portal reads.
 */
export default function ContactPage() {
  const [params] = useSearchParams()
  const room = findKnownRoom(params.get('room') ?? undefined)
  const id = useId()
  const [formData, setFormData] = useState(() => ({
    name: '',
    email: '',
    message: room ? `I'd like to enquire about the ${room.name}.\n\nDates: \nGuests: ` : '',
  }))
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  useDocumentMeta({
    title: 'Contact | AMP Lodge, Kumasi',
    description: `Call ${SITE.phone.display}, email ${SITE.email.general} or send AMP Lodge a message. Abuakwa DKC Junction, Kumasi–Sunyani Road, Kumasi.`,
    path: '/contact',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const messageId = `msg-${Date.now()}`
      await db.contactMessages.create({
        id: messageId,
        name: formData.name,
        email: formData.email,
        message: formData.message,
        status: 'unread',
      })
      try {
        await activityLogService.log({
          action: 'created',
          entityType: 'contact_message',
          entityId: messageId,
          details: { name: formData.name, email: formData.email, message: formData.message, status: 'unread' },
          userId: 'guest',
          metadata: {
            source: 'contact_form',
            ipAddress: 'unknown',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          },
        })
      } catch (logError) {
        console.error('Failed to log contact message creation:', logError)
      }
      toast.success("Message sent. We'll get back to you soon.")
      setFormData({ name: '', email: '', message: '' })
      setSent(true)
    } catch (error) {
      console.error('Failed to send message:', error)
      toast.error('Your message could not be sent. Please try again, or call us.')
    } finally {
      setLoading(false)
    }
  }

  const field = 'mt-2 w-full border border-amp-ink/30 bg-amp-ivory px-4 text-base text-amp-ink placeholder:text-amp-ink-muted/70'

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="We'd love to hear from you."
        intro="Questions about a room, a booking or how to find us: call, email or send a message and our team will reply."
        photo={PHOTOS.exteriorDay}
        focus="50% 45%"
      />

      <section className="bg-amp-ivory py-20 sm:py-28" aria-label="Contact details and form">
        <div className="mx-auto grid max-w-site gap-16 px-gutter lg:grid-cols-12 lg:gap-12">
          <Reveal stagger={0.08} className="space-y-10 lg:col-span-4">
            <div data-reveal-item>
              <h2 className="amp-eyebrow text-amp-bronze">Call</h2>
              <a href={SITE.phone.href} className="amp-display mt-3 inline-block text-[2rem] text-amp-ink">
                {SITE.phone.display}
              </a>
            </div>
            <div data-reveal-item>
              <h2 className="amp-eyebrow text-amp-bronze">Email</h2>
              <ul className="mt-3 space-y-1 text-amp-ink">
                <li>
                  General:{' '}
                  <a className="amp-link break-all" href={`mailto:${SITE.email.general}`}>
                    {SITE.email.general}
                  </a>
                </li>
                <li>
                  Reservations:{' '}
                  <a className="amp-link break-all" href={`mailto:${SITE.email.bookings}`}>
                    {SITE.email.bookings}
                  </a>
                </li>
              </ul>
            </div>
            <div data-reveal-item>
              <h2 className="amp-eyebrow text-amp-bronze">Address</h2>
              <address className="mt-3 not-italic leading-relaxed text-amp-ink">
                AMP Lodge
                <br />
                {SITE.address.line1}
                <br />
                {SITE.address.line2}
                <br />
                {SITE.address.city}, {SITE.address.country}
              </address>
              <a href={SITE.maps.directions} target="_blank" rel="noopener noreferrer" className="amp-link mt-3 inline-block text-sm text-amp-bronze">
                Get directions<span className="sr-only"> (opens Google Maps in a new tab)</span>
              </a>
            </div>
            <div data-reveal-item>
              <h2 className="amp-eyebrow text-amp-bronze">Hours</h2>
              <ul className="mt-3 space-y-1 text-amp-ink">
                {SITE.hours.map((h) => (
                  <li key={h.days}>
                    {h.days}: {h.time}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <div className="lg:col-span-8">
            <h2 className="amp-display text-[clamp(2.2rem,5vw,3.5rem)] text-amp-ink">Send us a message</h2>
            <p className="mt-3 text-amp-ink-muted">All fields are required. We reply by email.</p>
            {sent && (
              <p role="status" className="mt-6 border-l-2 border-amp-bronze bg-amp-limestone p-4 text-sm text-amp-ink">
                Thank you, your message has been sent. We'll reply to you by email.
              </p>
            )}
            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-name`} className="amp-eyebrow block text-amp-ink-muted">
                    Name
                  </label>
                  <input
                    id={`${id}-name`}
                    required
                    autoComplete="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={`${field} h-12`}
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-email`} className="amp-eyebrow block text-amp-ink-muted">
                    Email
                  </label>
                  <input
                    id={`${id}-email`}
                    type="email"
                    required
                    autoComplete="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={`${field} h-12`}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`${id}-message`} className="amp-eyebrow block text-amp-ink-muted">
                  Message
                </label>
                <textarea
                  id={`${id}-message`}
                  required
                  rows={7}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className={`${field} py-3`}
                />
              </div>
              <button type="submit" className="amp-btn w-full sm:w-auto" disabled={loading}>
                {loading ? 'Sending…' : 'Send message'}
              </button>
            </form>

            <MapEmbed className="mt-16 aspect-[16/10] w-full" />
          </div>
        </div>
      </section>
    </>
  )
}
