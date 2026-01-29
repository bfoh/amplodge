import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { CheckCircle2, Clock, MapPin, User, AlertCircle, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface ServiceRequest {
    id: string
    booking_id: string
    type: string
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    details: string
    created_at: string
    updated_at: string
    bookings?: {
        guest?: {
            name: string
            email: string
        }
        room?: {
            room_number: string
        }
    }
}

export function ServiceRequestsPage() {
    const [requests, setRequests] = useState<ServiceRequest[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)

    const fetchRequests = async () => {
        try {
            setRefreshing(true)

            const { data, error } = await supabase
                .from('service_requests')
                .select(`
          *,
          bookings (
             id,
             guest:guests (
               name,
               email
             ),
             room:rooms (
               room_number
             )
          )
        `)
                .order('created_at', { ascending: false })

            if (error) throw error

            console.log('Fetched requests:', data)
            setRequests(data as any[])

        } catch (error) {
            console.error('Error fetching requests:', error)
            toast.error('Failed to load service requests')
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    useEffect(() => {
        fetchRequests()

        // Optional: Set up realtime subscription here
        const channel = supabase
            .channel('service_requests_channel')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'service_requests' },
                (payload) => {
                    console.log('Realtime update:', payload)
                    fetchRequests()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [])

    const updateStatus = async (id: string, newStatus: string) => {
        try {
            // Optimistic update
            setRequests(prev => prev.map(r =>
                r.id === id ? { ...r, status: newStatus as any } : r
            ))

            const { error } = await supabase
                .from('service_requests')
                .update({ status: newStatus })
                .eq('id', id)

            if (error) throw error

            toast.success(`Request marked as ${newStatus}`)
        } catch (error) {
            console.error('Error updating status:', error)
            toast.error('Failed to update status')
            fetchRequests() // Revert on error
        }
    }

    const deleteRequest = async (id: string) => {
        try {
            // Optimistic update
            setRequests(prev => prev.filter(r => r.id !== id))

            const { error } = await supabase
                .from('service_requests')
                .delete()
                .eq('id', id)

            if (error) throw error

            toast.success('Request deleted')
        } catch (error) {
            console.error('Error deleting request:', error)
            toast.error('Failed to delete request')
            fetchRequests() // Revert on error
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'pending': return 'bg-orange-100 text-orange-800 border-orange-200'
            case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-200'
            case 'completed': return 'bg-green-100 text-green-800 border-green-200'
            case 'cancelled': return 'bg-gray-100 text-gray-800 border-gray-200'
            default: return 'bg-gray-100 text-gray-800'
        }
    }

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'housekeeping': return '🧹'
            case 'food': return '🍽️'
            case 'transport': return '🚕'
            case 'problem': return '⚠️'
            case 'amenity': return '🧴'
            default: return '🛎️'
        }
    }

    const filteredRequests = (statusGroup: 'active' | 'completed') => {
        return requests.filter(r => {
            if (statusGroup === 'active') return ['pending', 'in_progress'].includes(r.status)
            return ['completed', 'cancelled'].includes(r.status)
        })
    }

    return (
        <div className="space-y-6 animate-fade-in p-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Service Requests</h2>
                    <p className="text-muted-foreground mt-1">Manage guest requests and housekeeping tasks</p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchRequests} disabled={refreshing}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            <Tabs defaultValue="active" className="w-full">
                <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                    <TabsTrigger value="active">Active ({filteredRequests('active').length})</TabsTrigger>
                    <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="active" className="mt-6 space-y-4">
                    {loading ? (
                        <div className="flex justify-center py-12 text-muted-foreground">Loading...</div>
                    ) : filteredRequests('active').length === 0 ? (
                        <Card className="bg-muted/50 border-dashed">
                            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                                <CheckCircle2 className="w-12 h-12 text-muted-foreground/50 mb-4" />
                                <h3 className="text-lg font-semibold">No active requests</h3>
                                <p className="text-muted-foreground">All caught up! Good job.</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {filteredRequests('active').map(request => (
                                <RequestCard key={request.id} request={request} onUpdateStatus={updateStatus} />
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="history" className="mt-6">
                    <div className="space-y-4">
                        {filteredRequests('completed').map(request => (
                            <RequestCard key={request.id} request={request} onUpdateStatus={updateStatus} onDelete={deleteRequest} showDelete />
                        ))}
                        {filteredRequests('completed').length === 0 && (
                            <div className="text-center py-12 text-muted-foreground">No history yet</div>
                        )}
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}

function RequestCard({ request, onUpdateStatus, onDelete, showDelete }: { request: ServiceRequest, onUpdateStatus: (id: string, s: string) => void, onDelete?: (id: string) => void, showDelete?: boolean }) {
    // Extract room number: via room relation
    const roomNumber = request.bookings?.room?.room_number || '?'
    const guestName = request.bookings?.guest?.name || 'Guest'

    return (
        <Card className="overflow-hidden hover:shadow-md transition-all">
            <CardHeader className="pb-3 bg-neutral-50/50 border-b">
                <div className="flex justify-between items-start mb-1">
                    <Badge variant="outline" className={`${request.status === 'pending' ? 'bg-orange-50 text-orange-700 border-orange-200 animate-pulse' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                        {request.status === 'pending' ? 'New Request' : 'In Progress'}
                    </Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(request.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
                <CardTitle className="text-lg flex items-center gap-2">
                    <span className="text-2xl">{request.type === 'housekeeping' ? '🧹' : request.type === 'food' ? '🍽️' : request.type === 'transport' ? '🚕' : '🛎️'}</span>
                    <span className="capitalize">{request.type.replace('_', ' ')}</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
                <div className="space-y-2">
                    <p className="text-sm font-medium leading-none text-muted-foreground">Details</p>
                    <p className="text-base">{request.details || "No details provided"}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="w-4 h-4" />
                        <span className="text-foreground font-medium">Room {roomNumber}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <User className="w-4 h-4" />
                        <span className="truncate">{guestName}</span>
                    </div>
                </div>

                <div className="flex gap-2 pt-2">
                    {request.status === 'pending' && (
                        <Button className="w-full" size="sm" onClick={() => onUpdateStatus(request.id, 'in_progress')}>
                            Start
                        </Button>
                    )}
                    {request.status === 'in_progress' && (
                        <Button className="w-full bg-green-600 hover:bg-green-700" size="sm" onClick={() => onUpdateStatus(request.id, 'completed')}>
                            Mark Complete
                        </Button>
                    )}
                    {request.status !== 'completed' && request.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" onClick={() => onUpdateStatus(request.id, 'cancelled')}>
                            Cancel
                        </Button>
                    )}
                    {showDelete && onDelete && ['completed', 'cancelled'].includes(request.status) && (
                        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => onDelete(request.id)}>
                            <Trash2 className="w-4 h-4 mr-1" />
                            Delete
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
