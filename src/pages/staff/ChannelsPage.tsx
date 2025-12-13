import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Network, ExternalLink } from 'lucide-react'

const channels = [
  {
    id: 'airbnb',
    name: 'Airbnb',
    description: 'Connect your Airbnb listings',
    status: 'inactive',
    logo: '🏠'
  },
  {
    id: 'booking',
    name: 'Booking.com',
    description: 'Sync with Booking.com',
    status: 'inactive',
    logo: '🏨'
  },
  {
    id: 'expedia',
    name: 'Expedia',
    description: 'Integrate Expedia bookings',
    status: 'inactive',
    logo: '✈️'
  },
  {
    id: 'vrbo',
    name: 'VRBO',
    description: 'Connect VRBO properties',
    status: 'inactive',
    logo: '🏡'
  },
  {
    id: 'tripadvisor',
    name: 'TripAdvisor',
    description: 'Manage TripAdvisor reviews',
    status: 'inactive',
    logo: '🦉'
  },
  {
    id: 'hotels',
    name: 'Hotels.com',
    description: 'Sync Hotels.com reservations',
    status: 'inactive',
    logo: '🏢'
  }
]

export function ChannelsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-bold">Channel Manager</h2>
        <p className="text-muted-foreground mt-1">
          Connect and manage booking channels
        </p>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Network className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <CardTitle>Channel Integrations</CardTitle>
              <CardDescription className="mt-1">
                Synchronize bookings, availability, and rates across all your distribution channels
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {channels.map((channel) => (
          <Card key={channel.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-4xl">{channel.logo}</div>
                  <div>
                    <CardTitle className="text-lg">{channel.name}</CardTitle>
                    <CardDescription className="text-sm mt-1">
                      {channel.description}
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant={channel.status === 'active' ? 'default' : 'secondary'}>
                  {channel.status === 'active' ? 'Connected' : 'Not Connected'}
                </Badge>
                <Button size="sm" variant="outline">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {channel.status === 'active' ? 'Configure' : 'Connect'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Benefits of Channel Integration</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">•</span>
              <span>Automatic synchronization of bookings and availability</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">•</span>
              <span>Prevent double bookings with real-time updates</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">•</span>
              <span>Manage rates and restrictions from one central platform</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">•</span>
              <span>Increase visibility and reach more potential guests</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
