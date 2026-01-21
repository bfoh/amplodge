import { useState, useMemo, useEffect } from 'react'
import { blink } from '@/blink/client'
import { bookingEngine } from '@/services/booking-engine'
import { formatCurrencySync } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { toast } from 'sonner'
import { format, parseISO, differenceInDays } from 'date-fns'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Plus, Trash2, Users, AlertTriangle, Crown } from 'lucide-react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface GroupManageDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    groupId: string
    groupReference: string
    onUpdate: () => void
}

interface GroupMember {
    id: string
    guestName: string
    guestEmail?: string
    roomNumber: string
    roomType: string
    checkIn: string
    checkOut: string
    totalPrice: number
    status: string
    isPrimary: boolean
}

export function GroupManageDialog({
    open,
    onOpenChange,
    groupId,
    groupReference,
    onUpdate
}: GroupManageDialogProps) {
    const { currency } = useCurrency()
    const db = blink.db as any

    // State
    const [loading, setLoading] = useState(true)
    const [members, setMembers] = useState<GroupMember[]>([])
    const [rooms, setRooms] = useState<any[]>([])
    const [roomTypes, setRoomTypes] = useState<any[]>([])
    const [guests, setGuests] = useState<any[]>([])
    const [properties, setProperties] = useState<any[]>([])

    // Add member form
    const [showAddForm, setShowAddForm] = useState(false)
    const [selectedRoomId, setSelectedRoomId] = useState('')
    const [newGuestName, setNewGuestName] = useState('')
    const [newGuestEmail, setNewGuestEmail] = useState('')
    const [addingMember, setAddingMember] = useState(false)

    // Remove confirmation
    const [removeConfirm, setRemoveConfirm] = useState<GroupMember | null>(null)
    const [removing, setRemoving] = useState(false)

    // Load group data
    useEffect(() => {
        if (!open || !groupId) return

        const loadData = async () => {
            setLoading(true)
            try {
                const [bookings, roomsData, guestsData, roomTypesData, propertiesData] = await Promise.all([
                    db.bookings.list({ limit: 500 }),
                    db.rooms.list({ limit: 500 }),
                    db.guests.list({ limit: 500 }),
                    db.roomTypes.list({ limit: 100 }),
                    db.properties.list({ limit: 500 })
                ])

                setRooms(roomsData)
                setGuests(guestsData)
                setRoomTypes(roomTypesData)
                setProperties(propertiesData)

                // Create lookup maps
                const guestMap = new Map(guestsData.map((g: any) => [g.id, g]))
                const roomMap = new Map(roomsData.map((r: any) => [r.id, r]))
                const roomTypeMap = new Map(roomTypesData.map((rt: any) => [rt.id, rt]))

                // Filter bookings for this group
                const groupBookings = bookings.filter((b: any) => {
                    const specialReq = b.special_requests || b.specialRequests || ''
                    const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
                    if (match) {
                        try {
                            const data = JSON.parse(match[1])
                            return data.groupId === groupId
                        } catch { return false }
                    }
                    return false
                })

                // Map to members
                const membersList: GroupMember[] = groupBookings.map((b: any) => {
                    const guest = guestMap.get(b.guestId)
                    const room = roomMap.get(b.roomId)
                    const roomType = room ? roomTypeMap.get(room.roomTypeId) : null

                    let isPrimary = false
                    const specialReq = b.special_requests || b.specialRequests || ''
                    const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
                    if (match) {
                        try {
                            const data = JSON.parse(match[1])
                            isPrimary = data.isPrimaryBooking === true
                        } catch { }
                    }

                    return {
                        id: b.id,
                        guestName: guest?.name || 'Guest',
                        guestEmail: guest?.email,
                        roomNumber: room?.roomNumber || 'N/A',
                        roomType: roomType?.name || 'Standard Room',
                        checkIn: b.checkIn,
                        checkOut: b.checkOut,
                        totalPrice: b.totalPrice || 0,
                        status: b.status,
                        isPrimary
                    }
                })

                setMembers(membersList)
            } catch (error) {
                console.error('Failed to load group data:', error)
                toast.error('Failed to load group members')
            } finally {
                setLoading(false)
            }
        }

        loadData()
    }, [open, groupId])

    // Get group date range from first member
    const groupDates = useMemo(() => {
        if (members.length === 0) return null
        return {
            checkIn: members[0].checkIn,
            checkOut: members[0].checkOut
        }
    }, [members])

    // Calculate nights
    const nights = useMemo(() => {
        if (!groupDates) return 0
        return differenceInDays(parseISO(groupDates.checkOut), parseISO(groupDates.checkIn))
    }, [groupDates])

    // Available rooms (not already in group and available for dates)
    const availableRooms = useMemo(() => {
        if (!groupDates) return []

        const usedRoomIds = new Set(members.map(m => {
            const room = rooms.find(r => r.roomNumber === m.roomNumber)
            return room?.id
        }))

        return properties.filter((p: any) => {
            // Must be active and not already in group
            if (p.status !== 'active') return false
            const room = rooms.find(r => r.roomNumber === p.roomNumber)
            if (room && usedRoomIds.has(room.id)) return false
            return true
        })
    }, [properties, rooms, members, groupDates])

    // Get room price
    const getSelectedRoomPrice = () => {
        const property = properties.find(p => p.id === selectedRoomId)
        if (!property) return 0
        return (property.basePrice || 0) * nights
    }

    // Handle add member
    const handleAddMember = async () => {
        if (!selectedRoomId || !newGuestName.trim()) {
            toast.error('Please select a room and enter guest name')
            return
        }

        if (!groupDates) {
            toast.error('Could not determine group dates')
            return
        }

        setAddingMember(true)
        try {
            const property = properties.find(p => p.id === selectedRoomId)
            if (!property) throw new Error('Room not found')

            const roomType = roomTypes.find(rt => rt.id === property.propertyTypeId)

            const bookingData = {
                guest: {
                    fullName: newGuestName.trim(),
                    email: newGuestEmail.trim() || `guest-${Date.now()}@guest.local`,
                    phone: '',
                    address: ''
                },
                roomType: roomType?.name || 'Standard Room',
                roomNumber: property.roomNumber,
                dates: {
                    checkIn: groupDates.checkIn,
                    checkOut: groupDates.checkOut
                },
                numGuests: 1,
                amount: property.basePrice * nights,
                status: 'confirmed' as const,
                source: 'reception' as const,
                notes: ''
            }

            await bookingEngine.addToGroup(groupId, bookingData)

            toast.success(`Added ${newGuestName} to group`)

            // Reset form
            setSelectedRoomId('')
            setNewGuestName('')
            setNewGuestEmail('')
            setShowAddForm(false)

            // Refresh data
            onUpdate()

            // Reload members
            const [bookings] = await Promise.all([db.bookings.list({ limit: 500 })])
            const guestMap = new Map(guests.map((g: any) => [g.id, g]))
            const roomMap = new Map(rooms.map((r: any) => [r.id, r]))
            const roomTypeMap = new Map(roomTypes.map((rt: any) => [rt.id, rt]))

            const groupBookings = bookings.filter((b: any) => {
                const specialReq = b.special_requests || b.specialRequests || ''
                const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
                if (match) {
                    try {
                        const data = JSON.parse(match[1])
                        return data.groupId === groupId
                    } catch { return false }
                }
                return false
            })

            const membersList: GroupMember[] = groupBookings.map((b: any) => {
                const guest = guestMap.get(b.guestId)
                const room = roomMap.get(b.roomId)
                const roomType = room ? roomTypeMap.get(room.roomTypeId) : null

                let isPrimary = false
                const specialReq = b.special_requests || b.specialRequests || ''
                const match = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
                if (match) {
                    try {
                        const data = JSON.parse(match[1])
                        isPrimary = data.isPrimaryBooking === true
                    } catch { }
                }

                return {
                    id: b.id,
                    guestName: guest?.name || 'Guest',
                    guestEmail: guest?.email,
                    roomNumber: room?.roomNumber || 'N/A',
                    roomType: roomType?.name || 'Standard Room',
                    checkIn: b.checkIn,
                    checkOut: b.checkOut,
                    totalPrice: b.totalPrice || 0,
                    status: b.status,
                    isPrimary
                }
            })

            setMembers(membersList)
        } catch (error: any) {
            console.error('Failed to add member:', error)
            toast.error(error.message || 'Failed to add member to group')
        } finally {
            setAddingMember(false)
        }
    }

    // Handle remove member
    const handleRemoveMember = async () => {
        if (!removeConfirm) return

        setRemoving(true)
        try {
            await bookingEngine.removeFromGroup(removeConfirm.id)

            toast.success(`Removed ${removeConfirm.guestName} from group`)
            setRemoveConfirm(null)

            // Update local state
            setMembers(prev => prev.filter(m => m.id !== removeConfirm.id))
            onUpdate()
        } catch (error: any) {
            console.error('Failed to remove member:', error)
            toast.error(error.message || 'Failed to remove member from group')
        } finally {
            setRemoving(false)
        }
    }

    // Calculate totals
    const totalAmount = useMemo(() => {
        return members.reduce((sum, m) => sum + m.totalPrice, 0)
    }, [members])

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Users className="w-5 h-5" />
                            Manage Group Booking
                        </DialogTitle>
                        <DialogDescription>
                            {groupReference} • {members.length} room{members.length !== 1 ? 's' : ''}
                            {groupDates && (
                                <span className="ml-2">
                                    • {format(parseISO(groupDates.checkIn), 'MMM d')} - {format(parseISO(groupDates.checkOut), 'MMM d, yyyy')}
                                    ({nights} night{nights !== 1 ? 's' : ''})
                                </span>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Members Table */}
                            <Card>
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base">Group Members</CardTitle>
                                        <Button
                                            size="sm"
                                            onClick={() => setShowAddForm(!showAddForm)}
                                            variant={showAddForm ? 'outline' : 'default'}
                                        >
                                            <Plus className="w-4 h-4 mr-1" />
                                            Add Member
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {/* Add Member Form */}
                                    {showAddForm && (
                                        <div className="mb-4 p-4 border rounded-lg bg-muted/30 space-y-4">
                                            <h4 className="font-medium text-sm">Add New Member</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Room</Label>
                                                    <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select room..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {availableRooms.length === 0 ? (
                                                                <SelectItem value="" disabled>No rooms available</SelectItem>
                                                            ) : (
                                                                availableRooms.map((p: any) => (
                                                                    <SelectItem key={p.id} value={p.id}>
                                                                        Room {p.roomNumber} - {p.name || 'Standard'} ({formatCurrencySync(p.basePrice * nights, currency)})
                                                                    </SelectItem>
                                                                ))
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Guest Name *</Label>
                                                    <Input
                                                        placeholder="Enter guest name"
                                                        value={newGuestName}
                                                        onChange={(e) => setNewGuestName(e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Email (optional)</Label>
                                                    <Input
                                                        type="email"
                                                        placeholder="guest@example.com"
                                                        value={newGuestEmail}
                                                        onChange={(e) => setNewGuestEmail(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            {selectedRoomId && (
                                                <div className="text-sm text-muted-foreground">
                                                    Price: <span className="font-medium text-foreground">{formatCurrencySync(getSelectedRoomPrice(), currency)}</span>
                                                    {' '}for {nights} night{nights !== 1 ? 's' : ''}
                                                </div>
                                            )}
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={handleAddMember}
                                                    disabled={addingMember || !selectedRoomId || !newGuestName.trim()}
                                                >
                                                    {addingMember && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                                                    Add to Group
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setShowAddForm(false)}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Members List */}
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Guest</TableHead>
                                                <TableHead>Room</TableHead>
                                                <TableHead>Dates</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Amount</TableHead>
                                                <TableHead className="w-[80px]"></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {members.map((member) => (
                                                <TableRow key={member.id}>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium">{member.guestName}</span>
                                                            {member.isPrimary && (
                                                                <Badge variant="outline" className="text-xs gap-1">
                                                                    <Crown className="w-3 h-3" />
                                                                    Primary
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        {member.guestEmail && (
                                                            <div className="text-xs text-muted-foreground">{member.guestEmail}</div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-medium">Room {member.roomNumber}</div>
                                                        <div className="text-xs text-muted-foreground">{member.roomType}</div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="text-sm">
                                                            {format(parseISO(member.checkIn), 'MMM d')} - {format(parseISO(member.checkOut), 'MMM d')}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant={member.status === 'checked-in' ? 'default' : 'secondary'}>
                                                            {member.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium">
                                                        {formatCurrencySync(member.totalPrice, currency)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                            onClick={() => setRemoveConfirm(member)}
                                                            disabled={member.status === 'checked-in'}
                                                            title={member.status === 'checked-in' ? 'Cannot remove checked-in guest' : 'Remove from group'}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>

                                    {/* Total */}
                                    <div className="flex justify-end pt-4 border-t mt-4">
                                        <div className="text-right">
                                            <div className="text-sm text-muted-foreground">Group Total</div>
                                            <div className="text-2xl font-bold">{formatCurrencySync(totalAmount, currency)}</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Remove Confirmation Dialog */}
            <AlertDialog open={!!removeConfirm} onOpenChange={() => setRemoveConfirm(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-destructive" />
                            Remove from Group?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {removeConfirm && (
                                <>
                                    Are you sure you want to remove <strong>{removeConfirm.guestName}</strong> (Room {removeConfirm.roomNumber}) from this group?
                                    {removeConfirm.isPrimary && (
                                        <span className="block mt-2 text-amber-600">
                                            This is the primary booking. Group metadata will be transferred to another member.
                                        </span>
                                    )}
                                    <span className="block mt-2">
                                        This action will delete the booking and cannot be undone.
                                    </span>
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={handleRemoveMember}
                            disabled={removing}
                        >
                            {removing && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
