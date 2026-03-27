import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Network, ExternalLink, RefreshCw, Loader2 } from 'lucide-react'
import { channelService } from '@/services/channel-service'
import { ChannelConnection } from '@/types'
import { ChannelConnectDialog } from '@/components/dialogs/ChannelConnectDialog'
import { toast } from 'sonner'

export function ChannelsPage() {
  const [connections, setConnections] = useState<ChannelConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<{ id: string, name: string } | null>(null)

  // Static list of supported channels
  const supportedChannels = [
    { id: 'airbnb', name: 'Airbnb', description: 'Connect your Airbnb listings', logo: '🏠' },
    { id: 'booking', name: 'Booking.com', description: 'Sync with Booking.com', logo: '🏨' },
    { id: 'expedia', name: 'Expedia', description: 'Integrate Expedia bookings', logo: '✈️' },
    { id: 'vrbo', name: 'VRBO', description: 'Connect VRBO properties', logo: '🏡' },
    { id: 'tripadvisor', name: 'TripAdvisor', description: 'Manage TripAdvisor reviews', logo: '🦉' },
    { id: 'hotels', name: 'Hotels.com', description: 'Sync Hotels.com reservations', logo: '🏢' }
  ]

  useEffect(() => {
    loadConnections()
  }, [])

  const loadConnections = async () => {
    try {
      const data = await channelService.getConnections()
      setConnections(data)
    } catch (error) {
      console.error('Failed to load connections:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSyncAll = async () => {
    setSyncing(true)
    try {
      const response = await fetch('/.netlify/functions/sync-channels', { method: 'POST' })
      const result = await response.json()

      if (response.ok) {
        toast.success(`Sync completed!`)
      } else {
        throw new Error(result.error || 'Sync failed')
      }
    } catch (error: any) {
      console.error('Sync failed:', error)
      toast.error(`Sync failed: ${error.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const getConnectionStatus = (channelId: string) => {
    const conn = connections.find(c => c.channelId === channelId)
    return conn?.isActive ? 'active' : 'inactive'
  }

  return (
    <div className="space-y-6 animate-fade-in p-6">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Network className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Channel Manager</h1>
          </div>
          <p className="text-sm text-muted-foreground">Connect and manage booking channels</p>
        </div>
        <Button onClick={handleSyncAll} disabled={syncing} variant="outline" className="gap-2">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync All Channels'}
        </Button>
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
                Synchronize bookings, availability, and rates across all your distribution channels.
                Using iCal synchronization allows for reliable two-way updates with major OTAs.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {supportedChannels.map((channel) => {
          const status = getConnectionStatus(channel.id)
          const connection = connections.find(c => c.channelId === channel.id)

          return (
            <Card key={channel.id} className="hover:shadow-lg transition-shadow border-muted/60">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-4xl select-none">{channel.logo}</div>
                    <div>
                      <CardTitle className="text-lg">{channel.name}</CardTitle>
                      <CardDescription className="text-sm mt-1 line-clamp-1">
                        {channel.description}
                      </CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex flex-col gap-1">
                    {status === 'active' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Connected</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">Not Connected</span>
                    )}
                    {connection && (
                      <span className="text-[10px] text-muted-foreground">
                        Last updated: {new Date(connection.updatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedChannel({ id: channel.id, name: channel.name })}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {status === 'active' ? 'Configure' : 'Connect'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
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

      {/* Configuration Dialog */}
      {selectedChannel && (
        <ChannelConnectDialog
          open={!!selectedChannel}
          onOpenChange={(open) => !open && setSelectedChannel(null)}
          channelId={selectedChannel.id}
          channelName={selectedChannel.name}
          onUpdate={loadConnections}
        />
      )}
    </div>
  )
}
