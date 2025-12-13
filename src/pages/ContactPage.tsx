import { useState } from 'react'
import { blink } from '@/blink/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MapPin, Phone, Mail, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { activityLogService } from '@/services/activity-log-service'

export function ContactPage() {
  const db = (blink.db as any)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  })
  const [loading, setLoading] = useState(false)

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
        status: 'unread'
      })

      // Log the contact message creation
      try {
        await activityLogService.log({
          action: 'created',
          entityType: 'contact_message',
          entityId: messageId,
          details: {
            name: formData.name,
            email: formData.email,
            message: formData.message,
            status: 'unread'
          },
          userId: 'guest', // Guest user
          metadata: {
            source: 'contact_form',
            ipAddress: 'unknown',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
          }
        })
      } catch (logError) {
        console.error('Failed to log contact message creation:', logError)
        // Don't fail the main operation if logging fails
      }

      toast.success('Message sent successfully! We\'ll get back to you soon.')
      setFormData({ name: '', email: '', message: '' })
    } catch (error) {
      console.error('Failed to send message:', error)
      toast.error('Failed to send message. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen pt-20">
      {/* Header */}
      <section className="bg-gradient-to-br from-primary/10 via-secondary to-accent/10 py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-foreground mb-6 tracking-tight">Contact Us</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            We'd love to hear from you. Get in touch with our team.
          </p>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-b from-background to-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-3 gap-10">
            {/* Contact Info */}
            <div className="space-y-6">
              <Card className="border-primary/10 shadow-md hover:shadow-lg transition-all bg-white">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center text-lg font-serif">
                    <MapPin className="w-6 h-6 mr-3 text-primary" />
                    Address
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">
                    AMP LODGE, Abuakwa DKC junction, Kumasi-Sunyani Rd, Kumasi, Ghana
                  </p>
                </CardContent>
              </Card>

              <Card className="border-primary/10 shadow-md hover:shadow-lg transition-all bg-white">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center text-lg font-serif">
                    <Phone className="w-6 h-6 mr-3 text-primary" />
                    Phone
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground font-medium">
                    +233 55 500 9697
                  </p>
                </CardContent>
              </Card>

              <Card className="border-primary/10 shadow-md hover:shadow-lg transition-all bg-white">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center text-lg font-serif">
                    <Mail className="w-6 h-6 mr-3 text-primary" />
                    Email
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">
                    General: info@amplodge.org<br />
                    Reservations: bookings@amplodge.org
                  </p>
                </CardContent>
              </Card>

              <Card className="border-primary/10 shadow-md hover:shadow-lg transition-all bg-white">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center text-lg font-serif">
                    <Clock className="w-6 h-6 mr-3 text-primary" />
                    Hours
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">
                    Monday - Friday: 8:00 AM - 8:00 PM<br />
                    Saturday - Sunday: 9:00 AM - 6:00 PM
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              <Card className="border-primary/10 shadow-lg bg-white">
                <CardHeader className="pb-6">
                  <CardTitle className="text-3xl font-serif mb-3">Send us a Message</CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    Fill out the form below and we'll get back to you as soon as possible
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-7">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium mb-2">
                        Name *
                      </label>
                      <Input
                        id="name"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Your name"
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="block text-sm font-medium mb-2">
                        Email *
                      </label>
                      <Input
                        id="email"
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="your.email@example.com"
                      />
                    </div>

                    <div>
                      <label htmlFor="message" className="block text-sm font-medium mb-2">
                        Message *
                      </label>
                      <Textarea
                        id="message"
                        required
                        rows={8}
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        placeholder="How can we help you?"
                      />
                    </div>

                    <Button type="submit" size="lg" className="w-full py-6 text-base font-semibold bg-gradient-to-r from-primary via-primary to-accent hover:from-primary/95 hover:to-accent/95 transition-all duration-300 shadow-md hover:shadow-lg" disabled={loading}>
                      {loading ? 'Sending...' : 'Send Message'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Map */}
              <div className="mt-8 rounded-2xl overflow-hidden h-80 bg-secondary shadow-lg border border-primary/10">
                <iframe
                  src="https://www.google.com/maps?q=AMP%20LODGE%2C%20Abuakwa%20DKC%20junction%2C%20Kumasi-Sunyani%20Rd%2C%20Kumasi%2C%20Ghana&output=embed"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="AMP Lodge Location"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
