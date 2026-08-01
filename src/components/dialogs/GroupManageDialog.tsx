import { useState, useMemo, useEffect } from 'react'
import { db, auth } from '@/lib/db'
import { bookingEngine } from '@/services/booking-engine'
import { formatCurrencySync, getCurrencySymbol, cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/use-currency'
import { toast } from 'sonner'
import { differenceInDays } from 'date-fns'
import { safeFormatDate, safeParseISO, safeToISODate } from '@/lib/safe-date'
import { sendGroupMemberAddedNotification, sendGroupMemberUpdatedNotification } from '@/services/notifications'
import { activityLogService } from '@/services/activity-log-service'
import { createGroupInvoiceData, downloadGroupInvoicePDF } from '@/services/invoice-service'
import { getRoomAvailability } from '@/lib/availability'
import {
    getGroupMembers,
    getGroupMeta,
    addGroupMember,
    removeGroupMember,
    cancelGroup as cancelGroupService,
    updateGroupMeta,
} from '@/lib/booking-groups'
import type { BookingGroup, AdditionalCharge } from '@/types'
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
import {
    Loader2, Plus, Trash2, Users, AlertTriangle, Crown, Pencil, PlusCircle, Minus,
    LogIn, LogOut, Ban, FileDown, Tag, Wrench, Lock,
} from 'lucide-react'
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
import { CheckInDialog } from '@/components/dialogs/CheckInDialog'

interface GroupManageDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    groupId: string
    groupReference: string
    onUpdate: () => void
}

interface GroupMember {
    id: string
    roomId: string
    guestId: string
    guestName: string
    guestEmail?: string
    guestPhone?: string
    roomNumber: string
    roomType: string
    checkIn: string
    checkOut: string
    totalPrice: number
    amountPaid: number
    paymentStatus: 'full' | 'part' | 'pending'
    status: string
    isPrimary: boolean
    specialRequests: string
}

/** Parse a booking row into a GroupMember, preferring the GUEST_SNAPSHOT taken
 *  at booking time over the live (possibly since-renamed) guest record. */
function toGroupMember(b: any, guestMap: Map<string, any>, propertyMap: Map<string, any>, roomTypeMap: Map<string, any>): GroupMember {
    const specialReq = b.special_requests || b.specialRequests || ''
    const guest = guestMap.get(b.guestId)
    const property = propertyMap.get(b.roomId)
    const roomType = property ? roomTypeMap.get(property.propertyTypeId) : null

    let isPrimary = false
    const groupMatch = specialReq.match(/<!-- GROUP_DATA:(.*?) -->/)
    if (groupMatch) {
        try { isPrimary = JSON.parse(groupMatch[1]).isPrimaryBooking === true } catch { /* ignore */ }
    }

    let guestName = 'Guest'
    let guestEmail: string | undefined
    let guestPhone: string | undefined
    const snapshotMatch = specialReq.match(/<!-- GUEST_SNAPSHOT:(.*?) -->/)
    if (snapshotMatch) {
        try {
            const snap = JSON.parse(snapshotMatch[1])
            if (snap.name) guestName = snap.name
            if (snap.email) guestEmail = snap.email
            if (snap.phone) guestPhone = snap.phone
        } catch { /* ignore */ }
    }
    if (guestName === 'Guest' && guest?.name) guestName = guest.name
    if (!guestEmail && guest?.email) guestEmail = guest.email
    if (!guestPhone && guest?.phone) guestPhone = guest.phone

    let amountPaid = Number(b.amountPaid || 0)
    let paymentStatus: 'full' | 'part' | 'pending' = (b.paymentStatus || 'pending')
    const paymentDataMatch = specialReq.match(/<!-- PAYMENT_DATA:(.*?) -->/)
    if (paymentDataMatch) {
        try {
            const pd = JSON.parse(paymentDataMatch[1])
            if (pd.amountPaid) amountPaid = Number(pd.amountPaid)
            if (pd.paymentStatus) paymentStatus = pd.paymentStatus
        } catch { /* ignore */ }
    }

    return {
        id: b.id,
        roomId: b.roomId,
        guestId: b.guestId,
        guestName,
        guestEmail,
        guestPhone,
        roomNumber: property?.roomNumber || 'N/A',
        roomType: roomType?.name || 'Standard Room',
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        totalPrice: b.totalPrice || 0,
        amountPaid,
        paymentStatus,
        status: b.status,
        isPrimary,
        specialRequests: specialReq,
    }
}

export function GroupManageDialog({
    open,
    onOpenChange,
    groupId,
    groupReference,
    onUpdate
}: GroupManageDialogProps) {
    const { currency } = useCurrency()
    const [currentUser, setCurrentUser] = useState<any>(null)
    useEffect(() => {
        const unsub = auth.onAuthStateChanged((state: any) => setCurrentUser(state.user))
        return unsub
    }, [])

    // Core state
    const [loading, setLoading] = useState(true)
    const [members, setMembers] = useState<GroupMember[]>([])
    const [groupMeta, setGroupMeta] = useState<BookingGroup | null>(null)
    const [roomTypes, setRoomTypes] = useState<any[]>([])
    const [guests, setGuests] = useState<any[]>([])
    const [properties, setProperties] = useState<any[]>([])
    const [allBookings, setAllBookings] = useState<any[]>([])

    const reload = async () => {
        setLoading(true)
        try {
            const [rawMembers, meta, guestsData, roomTypesData, propertiesData, everyBooking] = await Promise.all([
                getGroupMembers(groupId),
                getGroupMeta(groupId),
                db.guests.list({ limit: 500 }),
                db.roomTypes.list({ limit: 100 }),
                db.properties.list({ limit: 500 }),
                bookingEngine.getAllBookings(),
            ])

            setGuests(guestsData)
            setRoomTypes(roomTypesData)
            setProperties(propertiesData)
            setAllBookings(everyBooking)
            setGroupMeta(meta)

            const guestMap = new Map(guestsData.map((g: any) => [g.id, g]))
            const propertyMap = new Map(propertiesData.map((p: any) => [p.id, p]))
            const roomTypeMap = new Map(roomTypesData.map((rt: any) => [rt.id, rt]))
            setMembers(rawMembers.map((b: any) => toGroupMember(b, guestMap, propertyMap, roomTypeMap)))
        } catch (error) {
            console.error('Failed to load group data:', error)
            toast.error('Failed to load group members')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!open || !groupId) return
        reload()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, groupId])

    const groupDates = useMemo(() => {
        if (members.length === 0) return null
        const ci = members[0].checkIn
        const co = members[0].checkOut
        if (!ci || !co) return null
        return { checkIn: ci, checkOut: co }
    }, [members])

    const nights = useMemo(() => {
        if (!groupDates) return 0
        const ci = safeParseISO(groupDates.checkIn)
        const co = safeParseISO(groupDates.checkOut)
        if (!ci || !co) return 0
        return differenceInDays(co, ci)
    }, [groupDates])

    const checkedInCount = members.filter(m => m.status === 'checked-in').length
    const checkedOutCount = members.filter(m => m.status === 'checked-out').length
    const totalAmount = useMemo(() => members.reduce((sum, m) => sum + m.totalPrice, 0), [members])

    // ------------------------------------------------------------------
    // Add Member
    // ------------------------------------------------------------------
    const [showAddForm, setShowAddForm] = useState(false)
    const [selectedRoomId, setSelectedRoomId] = useState('')
    const [newGuestName, setNewGuestName] = useState('')
    const [newGuestEmail, setNewGuestEmail] = useState('')
    const [newGuestPhone, setNewGuestPhone] = useState('')
    const [newCheckIn, setNewCheckIn] = useState('')
    const [newCheckOut, setNewCheckOut] = useState('')
    const [addingMember, setAddingMember] = useState(false)
    const [newPaymentType, setNewPaymentType] = useState<'full' | 'part' | 'pending'>('pending')
    const [newPaymentSplits, setNewPaymentSplits] = useState<Array<{ method: string; amount: number }>>(
        [{ method: 'cash', amount: 0 }]
    )

    useEffect(() => {
        if (groupDates && !newCheckIn && !newCheckOut) {
            setNewCheckIn(safeToISODate(groupDates.checkIn))
            setNewCheckOut(safeToISODate(groupDates.checkOut))
        }
    }, [groupDates]) // eslint-disable-line react-hooks/exhaustive-deps

    const newMemberNights = useMemo(() => {
        if (!newCheckIn || !newCheckOut) return 0
        const ci = safeParseISO(newCheckIn)
        const co = safeParseISO(newCheckOut)
        if (!ci || !co) return 0
        return differenceInDays(co, ci)
    }, [newCheckIn, newCheckOut])

    // Real per-room availability for the add-member dates — same engine as
    // the Onsite Booking picker. Excludes rooms already in this group and
    // checks every OTHER booking in the system, not just this group's rows
    // (the previous version only excluded rooms already in the group and
    // never checked for genuine conflicts with outside bookings).
    const addRoomAvailability = useMemo(() => {
        const memberRoomIds = new Set(members.map(m => m.roomId))
        const candidateProperties = properties.filter((p: any) => !memberRoomIds.has(p.id))
        return getRoomAvailability(candidateProperties, allBookings, {
            checkIn: newCheckIn || undefined,
            checkOut: newCheckOut || undefined,
        })
    }, [properties, allBookings, members, newCheckIn, newCheckOut])

    const getRoomPricePerNight = (property: any) => {
        const roomType = roomTypes.find((rt: any) => rt.id === property.propertyTypeId || rt.name === property.name)
        return roomType?.basePrice || property.basePrice || 100
    }

    const getSelectedRoomPrice = () => {
        const property = properties.find((p: any) => p.id === selectedRoomId)
        if (!property) return 0
        return getRoomPricePerNight(property) * Math.max(1, newMemberNights)
    }

    const handleAddMember = async () => {
        if (!selectedRoomId || !newGuestName.trim()) {
            toast.error('Please select a room and enter guest name')
            return
        }
        if (!newCheckIn || !newCheckOut || newMemberNights < 1) {
            toast.error('Check-out date must be after check-in date')
            return
        }

        setAddingMember(true)
        try {
            const property = properties.find((p: any) => p.id === selectedRoomId)
            if (!property) throw new Error('Room not found')
            const roomType = roomTypes.find((rt: any) => rt.id === property.propertyTypeId)

            const roomAmount = getRoomPricePerNight(property) * newMemberNights
            const splitsPaidTotal = newPaymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
            const validSplits = newPaymentSplits.filter(s => s.amount > 0)
            const primaryMethod: any = newPaymentType === 'pending'
                ? 'not_paid'
                : validSplits.length > 0
                    ? validSplits.reduce((a, b) => b.amount > a.amount ? b : a, validSplits[0]).method
                    : 'cash'
            const paymentSplitsData = newPaymentType !== 'pending' && validSplits.length > 1
                ? validSplits.map(s => ({ method: s.method, amount: s.amount }))
                : undefined
            const amountPaid = newPaymentType === 'full' ? roomAmount : newPaymentType === 'part' ? splitsPaidTotal : 0

            const staffName = currentUser?.user_metadata?.full_name || currentUser?.email || 'Staff'
            const staffId = currentUser?.id || ''

            const { buildBookingPaymentEvent, appendPaymentEvent } = await import('@/lib/payment-events')
            const paymentEvent = buildBookingPaymentEvent({
                paymentType: newPaymentType,
                amount: amountPaid,
                staffId,
                staffName,
                method: primaryMethod,
                splits: paymentSplitsData,
            })
            const specialRequests = paymentEvent ? appendPaymentEvent('', paymentEvent) : ''

            const bookingData = {
                guest: {
                    fullName: newGuestName.trim(),
                    email: newGuestEmail.trim() || `guest-${Date.now()}@guest.local`,
                    phone: newGuestPhone.trim() || '',
                    address: ''
                },
                roomType: roomType?.name || 'Standard Room',
                roomNumber: property.roomNumber,
                dates: { checkIn: newCheckIn, checkOut: newCheckOut },
                numGuests: 1,
                amount: roomAmount,
                status: 'confirmed' as const,
                source: 'reception' as const,
                payment: {
                    method: primaryMethod,
                    status: (newPaymentType === 'full' ? 'completed' : 'pending') as 'pending' | 'completed',
                    amount: amountPaid,
                    reference: `PAY-${Date.now()}`,
                    paidAt: newPaymentType !== 'pending' ? new Date().toISOString() : undefined
                },
                paymentMethod: primaryMethod,
                paymentSplits: paymentSplitsData,
                amountPaid,
                paymentStatus: newPaymentType,
                specialRequests,
                notes: ''
            }

            await addGroupMember(groupId, bookingData as any)
            toast.success(`Added ${newGuestName} to group`)

            const primaryMember = members.find(m => m.isPrimary)
            const billingContact = primaryMember ? {
                name: primaryMember.guestName,
                email: primaryMember.guestEmail || '',
                phone: null
            } : null

            sendGroupMemberAddedNotification(
                {
                    name: newGuestName.trim(),
                    email: newGuestEmail.trim() || `guest-${Date.now()}@guest.local`,
                    phone: newGuestPhone.trim() || null
                },
                billingContact,
                { roomNumber: property.roomNumber, roomType: roomType?.name },
                { checkIn: newCheckIn, checkOut: newCheckOut },
                groupReference || groupId
            ).catch(err => console.error('Failed to send notifications:', err))

            setSelectedRoomId('')
            setNewGuestName('')
            setNewGuestEmail('')
            setNewGuestPhone('')
            setNewPaymentType('pending')
            setNewPaymentSplits([{ method: 'cash', amount: 0 }])
            if (groupDates) {
                setNewCheckIn(safeToISODate(groupDates.checkIn))
                setNewCheckOut(safeToISODate(groupDates.checkOut))
            }
            setShowAddForm(false)
            onUpdate()
            await reload()
        } catch (error: any) {
            console.error('Failed to add member:', error)
            toast.error(error.message || 'Failed to add member to group')
        } finally {
            setAddingMember(false)
        }
    }

    // ------------------------------------------------------------------
    // Remove member / Cancel whole group
    // ------------------------------------------------------------------
    const [removeConfirm, setRemoveConfirm] = useState<GroupMember | null>(null)
    const [removing, setRemoving] = useState(false)
    const [cancelConfirm, setCancelConfirm] = useState(false)
    const [cancelling, setCancelling] = useState(false)

    const handleRemoveMember = async () => {
        if (!removeConfirm) return
        setRemoving(true)
        try {
            const result = await removeGroupMember(removeConfirm.id)
            if (result.groupClosed) {
                toast.success(`Removed ${removeConfirm.guestName} — that was the last room, so the group is now closed`)
                setRemoveConfirm(null)
                onUpdate()
                onOpenChange(false)
                return
            }
            toast.success(`Removed ${removeConfirm.guestName} from group`)
            setRemoveConfirm(null)
            onUpdate()
            await reload()
        } catch (error: any) {
            console.error('Failed to remove member:', error)
            toast.error(error.message || 'Failed to remove member from group')
        } finally {
            setRemoving(false)
        }
    }

    const handleCancelGroup = async () => {
        setCancelling(true)
        try {
            await cancelGroupService(groupId)
            toast.success('Group booking cancelled')
            setCancelConfirm(false)
            onUpdate()
            onOpenChange(false)
        } catch (error: any) {
            console.error('Failed to cancel group:', error)
            toast.error(error.message || 'Failed to cancel group')
        } finally {
            setCancelling(false)
        }
    }

    // ------------------------------------------------------------------
    // Check-in / Check-out per room
    // ------------------------------------------------------------------
    const [checkInMember, setCheckInMember] = useState<GroupMember | null>(null)
    const [checkingOutId, setCheckingOutId] = useState<string | null>(null)

    const handleCheckOut = async (member: GroupMember) => {
        setCheckingOutId(member.id)
        try {
            const staffName = currentUser?.user_metadata?.full_name || currentUser?.email || 'Staff'
            await db.bookings.update(member.id, {
                status: 'checked-out',
                actualCheckOut: new Date().toISOString(),
                checkOutBy: currentUser?.id || '',
                checkOutByName: staffName,
            })
            const property = properties.find((p: any) => p.id === member.roomId)
            if (property) {
                await db.properties.update(property.id, { status: 'cleaning' }).catch(() => {})
                activityLogService.log({
                    action: 'updated',
                    entityType: 'property',
                    entityId: property.id,
                    details: { roomNumber: property.roomNumber, previousStatus: 'occupied', newStatus: 'cleaning', reason: 'group_check_out' },
                    userId: currentUser?.id || 'system'
                }).catch(() => {})
            }
            toast.success(`Checked out ${member.guestName} (Room ${member.roomNumber})`)
            onUpdate()
            await reload()
        } catch (error: any) {
            console.error('Failed to check out member:', error)
            toast.error(error.message || 'Failed to check out')
        } finally {
            setCheckingOutId(null)
        }
    }

    // ------------------------------------------------------------------
    // Group invoice
    // ------------------------------------------------------------------
    const [downloadingInvoice, setDownloadingInvoice] = useState(false)

    const handleDownloadInvoice = async () => {
        setDownloadingInvoice(true)
        try {
            const guestMap = new Map(guests.map((g: any) => [g.id, g]))
            const propertyMap = new Map(properties.map((p: any) => [p.id, p]))
            const roomTypeMap = new Map(roomTypes.map((rt: any) => [rt.id, rt]))

            const fullBookingDetails = members.map((m) => {
                const property = propertyMap.get(m.roomId)
                return {
                    id: m.id,
                    guestId: m.guestId,
                    guest: { name: m.guestName, email: m.guestEmail, phone: m.guestPhone },
                    checkIn: m.checkIn,
                    checkOut: m.checkOut,
                    totalPrice: m.totalPrice,
                    special_requests: m.specialRequests,
                    room: {
                        roomNumber: m.roomNumber,
                        roomType: roomTypeMap.get(property?.propertyTypeId)?.name || m.roomType,
                    },
                }
            })

            const billingContact = groupMeta?.billingContact || {
                fullName: members.find(m => m.isPrimary)?.guestName || '',
                email: members.find(m => m.isPrimary)?.guestEmail || '',
                phone: members.find(m => m.isPrimary)?.guestPhone || '',
                address: '',
            }

            const groupInvoiceData = await createGroupInvoiceData(fullBookingDetails as any, billingContact as any)
            await downloadGroupInvoicePDF(groupInvoiceData)
            toast.success('Group invoice downloaded')
        } catch (error: any) {
            console.error('Group invoice failed', error)
            toast.error('Failed to generate group invoice')
        } finally {
            setDownloadingInvoice(false)
        }
    }

    // ------------------------------------------------------------------
    // Billing contact / charges / discount editor
    // ------------------------------------------------------------------
    const [showBillingEditor, setShowBillingEditor] = useState(false)
    const [editBillingName, setEditBillingName] = useState('')
    const [editBillingEmail, setEditBillingEmail] = useState('')
    const [editBillingPhone, setEditBillingPhone] = useState('')
    const [editBillingAddress, setEditBillingAddress] = useState('')
    const [editCharges, setEditCharges] = useState<AdditionalCharge[]>([])
    const [editDiscountType, setEditDiscountType] = useState<'fixed' | 'percentage'>('fixed')
    const [editDiscountValue, setEditDiscountValue] = useState(0)
    const [savingMeta, setSavingMeta] = useState(false)

    const openBillingEditor = () => {
        const bc = groupMeta?.billingContact
        setEditBillingName(bc?.fullName || members.find(m => m.isPrimary)?.guestName || '')
        setEditBillingEmail(bc?.email || members.find(m => m.isPrimary)?.guestEmail || '')
        setEditBillingPhone(bc?.phone || '')
        setEditBillingAddress(bc?.address || '')
        setEditCharges(groupMeta?.additionalCharges || [])
        setEditDiscountType(groupMeta?.discount?.type || 'fixed')
        setEditDiscountValue(groupMeta?.discount?.value || 0)
        setShowBillingEditor(true)
    }

    const handleSaveMeta = async () => {
        setSavingMeta(true)
        try {
            const chargesTotal = editCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0)
            const discountAmount = editDiscountType === 'percentage'
                ? (totalAmount + chargesTotal) * (editDiscountValue / 100)
                : editDiscountValue

            await updateGroupMeta(groupId, {
                billingContact: {
                    fullName: editBillingName.trim(),
                    email: editBillingEmail.trim(),
                    phone: editBillingPhone.trim(),
                    address: editBillingAddress.trim(),
                },
                additionalCharges: editCharges.filter(c => c.description.trim() && c.amount > 0),
                discount: editDiscountValue > 0
                    ? { type: editDiscountType, value: editDiscountValue, amount: discountAmount }
                    : undefined,
            })
            toast.success('Billing details updated')
            setShowBillingEditor(false)
            await reload()
        } catch (error: any) {
            console.error('Failed to update billing details:', error)
            toast.error(error.message || 'Failed to update billing details')
        } finally {
            setSavingMeta(false)
        }
    }

    // ------------------------------------------------------------------
    // Edit member (name / email / dates) — booking-scoped only, never
    // touches the shared guests table (previously this retroactively
    // renamed the guest across every other booking they had).
    // ------------------------------------------------------------------
    const [editMember, setEditMember] = useState<GroupMember | null>(null)
    const [editGuestName, setEditGuestName] = useState('')
    const [editGuestEmail, setEditGuestEmail] = useState('')
    const [editCheckIn, setEditCheckIn] = useState('')
    const [editCheckOut, setEditCheckOut] = useState('')
    const [saving, setSaving] = useState(false)

    const handleSaveMember = async () => {
        if (!editMember || !editGuestName.trim()) {
            toast.error('Guest name is required')
            return
        }
        setSaving(true)
        try {
            const bookingUpdates: any = {}
            if (editCheckIn && editCheckIn !== safeToISODate(editMember.checkIn)) bookingUpdates.checkIn = editCheckIn
            if (editCheckOut && editCheckOut !== safeToISODate(editMember.checkOut)) bookingUpdates.checkOut = editCheckOut

            if (Object.keys(bookingUpdates).length > 0) {
                const property = properties.find((p: any) => p.id === editMember.roomId)
                const roomType = property ? roomTypes.find((rt: any) => rt.id === property.propertyTypeId) : null
                const pricePerNight = roomType?.basePrice || property?.basePrice || 0
                const checkInDate = safeParseISO(bookingUpdates.checkIn || editMember.checkIn)
                const checkOutDate = safeParseISO(bookingUpdates.checkOut || editMember.checkOut)
                const nightsForEdit = (checkInDate && checkOutDate) ? differenceInDays(checkOutDate, checkInDate) : 0
                bookingUpdates.totalPrice = pricePerNight * nightsForEdit
            }

            // Update the booking's own GUEST_SNAPSHOT rather than the shared
            // guests table — this booking's display name/email changes, but
            // no other booking sharing the same guestId is affected.
            const cleanSpecialReq = editMember.specialRequests.replace(/<!-- GUEST_SNAPSHOT:.*? -->/g, '').trim()
            const newSnapshot = { name: editGuestName.trim(), email: editGuestEmail.trim() || editMember.guestEmail || '', phone: editMember.guestPhone || '' }
            bookingUpdates.specialRequests = `${cleanSpecialReq}\n\n<!-- GUEST_SNAPSHOT:${JSON.stringify(newSnapshot)} -->`

            await db.bookings.update(editMember.id, bookingUpdates)

            setMembers(prev => prev.map(m =>
                m.id === editMember.id
                    ? {
                        ...m,
                        guestName: editGuestName.trim(),
                        guestEmail: editGuestEmail.trim() || m.guestEmail,
                        checkIn: bookingUpdates.checkIn || m.checkIn,
                        checkOut: bookingUpdates.checkOut || m.checkOut,
                        totalPrice: bookingUpdates.totalPrice ?? m.totalPrice
                    }
                    : m
            ))

            toast.success('Member updated successfully')

            const changes: { field: string; oldValue: string; newValue: string }[] = []
            if (editGuestName.trim() !== editMember.guestName) {
                changes.push({ field: 'Name', oldValue: editMember.guestName, newValue: editGuestName.trim() })
            }
            if (editGuestEmail.trim() && editGuestEmail.trim() !== (editMember.guestEmail || '')) {
                changes.push({ field: 'Email', oldValue: editMember.guestEmail || 'Not set', newValue: editGuestEmail.trim() })
            }
            if (bookingUpdates.checkIn) {
                changes.push({ field: 'Check-in', oldValue: safeFormatDate(editMember.checkIn, 'MMM d, yyyy'), newValue: safeFormatDate(bookingUpdates.checkIn, 'MMM d, yyyy') })
            }
            if (bookingUpdates.checkOut) {
                changes.push({ field: 'Check-out', oldValue: safeFormatDate(editMember.checkOut, 'MMM d, yyyy'), newValue: safeFormatDate(bookingUpdates.checkOut, 'MMM d, yyyy') })
            }
            if (changes.length > 0) {
                sendGroupMemberUpdatedNotification(
                    { name: editGuestName.trim(), email: editGuestEmail.trim() || editMember.guestEmail || '', phone: null },
                    { roomNumber: editMember.roomNumber },
                    changes,
                    groupReference || groupId
                ).catch(err => console.error('Failed to send update notification:', err))
            }

            setEditMember(null)
            onUpdate()
        } catch (error: any) {
            console.error('Failed to update member:', error)
            toast.error(error.message || 'Failed to update member')
        } finally {
            setSaving(false)
        }
    }

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
                                    • {safeFormatDate(groupDates.checkIn, 'MMM d')} - {safeFormatDate(groupDates.checkOut, 'MMM d, yyyy')}
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
                            {/* Status summary + group-level actions */}
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-secondary/10 p-3">
                                <div className="flex items-center gap-3 text-sm">
                                    <span className="font-medium">{checkedInCount} of {members.length} checked in</span>
                                    {checkedOutCount > 0 && <span className="text-muted-foreground">• {checkedOutCount} checked out</span>}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button size="sm" variant="outline" onClick={openBillingEditor}>
                                        <Tag className="w-4 h-4 mr-1.5" /> Billing & Charges
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={handleDownloadInvoice} disabled={downloadingInvoice}>
                                        {downloadingInvoice ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileDown className="w-4 h-4 mr-1.5" />}
                                        Group Invoice
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-destructive hover:bg-destructive/10 border-destructive/30"
                                        onClick={() => setCancelConfirm(true)}
                                        disabled={checkedInCount > 0}
                                        title={checkedInCount > 0 ? 'Check out all rooms before cancelling the group' : undefined}
                                    >
                                        <Ban className="w-4 h-4 mr-1.5" /> Cancel Entire Group
                                    </Button>
                                </div>
                            </div>

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
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Check-in Date *</Label>
                                                    <Input
                                                        type="date"
                                                        min={new Date().toLocaleDateString('en-CA')}
                                                        value={newCheckIn}
                                                        onChange={(e) => setNewCheckIn(e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Check-out Date *</Label>
                                                    <Input
                                                        type="date"
                                                        value={newCheckOut}
                                                        onChange={(e) => setNewCheckOut(e.target.value)}
                                                        min={newCheckIn}
                                                    />
                                                </div>
                                            </div>

                                            {/* Per-room availability grid — same engine as Onsite Booking */}
                                            <div className="space-y-2">
                                                <Label>Room *</Label>
                                                {!newCheckIn || !newCheckOut ? (
                                                    <p className="text-xs text-muted-foreground italic">Pick dates above to see room availability.</p>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 border rounded-md bg-background">
                                                        {addRoomAvailability.length === 0 && (
                                                            <p className="text-xs text-muted-foreground">No other rooms in inventory.</p>
                                                        )}
                                                        {addRoomAvailability.map(({ property, status }) => {
                                                            const selected = selectedRoomId === property.id
                                                            const clickable = status === 'available'
                                                            return (
                                                                <button
                                                                    key={property.id}
                                                                    type="button"
                                                                    disabled={!clickable}
                                                                    onClick={() => setSelectedRoomId(property.id)}
                                                                    className={cn(
                                                                        'flex items-center gap-1 rounded-md border-2 px-2 py-1 text-xs font-medium transition-all',
                                                                        selected && 'border-primary bg-primary text-white',
                                                                        !selected && clickable && 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-500 cursor-pointer',
                                                                        !selected && status === 'booked' && 'border-red-100 bg-red-50/60 text-red-400 cursor-not-allowed',
                                                                        !selected && status === 'maintenance' && 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                    )}
                                                                >
                                                                    {status === 'maintenance' && <Wrench className="w-3 h-3" />}
                                                                    {status === 'booked' && <Lock className="w-3 h-3" />}
                                                                    Room {property.roomNumber}
                                                                    {clickable && ` · ${formatCurrencySync(getRoomPricePerNight(property), currency)}/night`}
                                                                </button>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                                                <div className="space-y-2">
                                                    <Label>Phone (optional)</Label>
                                                    <Input
                                                        type="tel"
                                                        placeholder="+233 XX XXX XXXX"
                                                        value={newGuestPhone}
                                                        onChange={(e) => setNewGuestPhone(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            {selectedRoomId && newMemberNights > 0 && (
                                                <div className="text-sm text-muted-foreground">
                                                    Room total: <span className="font-medium text-foreground">{formatCurrencySync(getSelectedRoomPrice(), currency)}</span>
                                                    {' '}({newMemberNights} night{newMemberNights !== 1 ? 's' : ''})
                                                </div>
                                            )}

                                            {/* Payment Section */}
                                            <div className="border rounded-lg p-3 space-y-3 bg-background">
                                                <Label className="text-sm font-medium">Payment Status</Label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {(
                                                        [
                                                            { key: 'full', label: 'Full', sub: 'Paid in full', color: 'text-green-700 bg-green-50 border-green-300' },
                                                            { key: 'part', label: 'Part', sub: 'Partial amount', color: 'text-amber-700 bg-amber-50 border-amber-300' },
                                                            { key: 'pending', label: 'Later', sub: 'No payment yet', color: 'text-gray-600 bg-gray-50 border-gray-200' },
                                                        ] as const
                                                    ).map(opt => (
                                                        <button
                                                            key={opt.key}
                                                            type="button"
                                                            onClick={() => {
                                                                setNewPaymentType(opt.key)
                                                                if (opt.key === 'full') {
                                                                    setNewPaymentSplits([{ method: 'cash', amount: getSelectedRoomPrice() }])
                                                                } else if (opt.key === 'pending') {
                                                                    setNewPaymentSplits([{ method: 'cash', amount: 0 }])
                                                                }
                                                            }}
                                                            className={cn(
                                                                'rounded-lg border-2 p-2 text-center transition-all',
                                                                newPaymentType === opt.key
                                                                    ? `${opt.color} border-current font-semibold`
                                                                    : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted'
                                                            )}
                                                        >
                                                            <div className="text-xs font-medium">{opt.label}</div>
                                                            <div className="text-[10px] opacity-70 hidden sm:block">{opt.sub}</div>
                                                        </button>
                                                    ))}
                                                </div>

                                                {newPaymentType !== 'pending' && (
                                                    <div className="space-y-2">
                                                        {newPaymentSplits.map((split, idx) => (
                                                            <div key={idx} className="flex items-center gap-2">
                                                                <Select
                                                                    value={split.method}
                                                                    onValueChange={(val) => {
                                                                        const updated = [...newPaymentSplits]
                                                                        updated[idx] = { ...updated[idx], method: val }
                                                                        setNewPaymentSplits(updated)
                                                                    }}
                                                                >
                                                                    <SelectTrigger className="w-36 shrink-0">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="cash">💵 Cash</SelectItem>
                                                                        <SelectItem value="mobile_money">📱 Mobile Money</SelectItem>
                                                                        <SelectItem value="card">💳 Card</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <div className="relative flex-1">
                                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                                                        {getCurrencySymbol(currency)}
                                                                    </span>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        className="pl-8"
                                                                        value={split.amount || ''}
                                                                        onChange={(e) => {
                                                                            const updated = [...newPaymentSplits]
                                                                            updated[idx] = { ...updated[idx], amount: Number(e.target.value) || 0 }
                                                                            setNewPaymentSplits(updated)
                                                                        }}
                                                                        placeholder="Amount"
                                                                    />
                                                                </div>
                                                                {newPaymentSplits.length > 1 && (
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-9 w-9 shrink-0 text-destructive"
                                                                        onClick={() => setNewPaymentSplits(newPaymentSplits.filter((_, i) => i !== idx))}
                                                                    >
                                                                        <Minus className="w-4 h-4" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        ))}
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            className="text-xs h-7"
                                                            onClick={() => setNewPaymentSplits([...newPaymentSplits, { method: 'cash', amount: 0 }])}
                                                        >
                                                            <PlusCircle className="w-3 h-3 mr-1" />
                                                            Add another payment method
                                                        </Button>
                                                        {(() => {
                                                            const paid = newPaymentSplits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
                                                            const total = getSelectedRoomPrice()
                                                            const balance = total - paid
                                                            return (
                                                                <div className="flex justify-between text-sm pt-1 border-t">
                                                                    <span className="text-muted-foreground">
                                                                        {newPaymentType === 'full' ? 'Amount Paid:' : 'Partial Payment:'}
                                                                    </span>
                                                                    <div className="text-right">
                                                                        <span className="font-medium text-green-700">{formatCurrencySync(paid, currency)}</span>
                                                                        {newPaymentType === 'part' && balance > 0 && (
                                                                            <div className="text-xs text-amber-600">Balance: {formatCurrencySync(balance, currency)}</div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })()}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={handleAddMember}
                                                    disabled={addingMember || !selectedRoomId || !newGuestName.trim() || !newCheckIn || !newCheckOut || newMemberNights < 1}
                                                >
                                                    {addingMember && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                                                    Add to Group
                                                </Button>
                                                <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
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
                                                <TableHead className="w-[160px]"></TableHead>
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
                                                            {safeFormatDate(member.checkIn, 'MMM d')} - {safeFormatDate(member.checkOut, 'MMM d')}
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
                                                        <div className="flex items-center gap-1 justify-end">
                                                            {member.status === 'confirmed' && (
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                                                    onClick={() => setCheckInMember(member)}
                                                                    title="Check in"
                                                                >
                                                                    <LogIn className="w-4 h-4" />
                                                                </Button>
                                                            )}
                                                            {member.status === 'checked-in' && (
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 text-primary hover:bg-primary/10"
                                                                    onClick={() => handleCheckOut(member)}
                                                                    disabled={checkingOutId === member.id}
                                                                    title="Check out"
                                                                >
                                                                    {checkingOutId === member.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                                                                </Button>
                                                            )}
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                                onClick={() => {
                                                                    setEditMember(member)
                                                                    setEditGuestName(member.guestName)
                                                                    setEditGuestEmail(member.guestEmail || '')
                                                                    setEditCheckIn(safeToISODate(member.checkIn))
                                                                    setEditCheckOut(safeToISODate(member.checkOut))
                                                                }}
                                                                title="Edit member"
                                                            >
                                                                <Pencil className="w-4 h-4" />
                                                            </Button>
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
                                                        </div>
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

            {/* Check-in — reuses the standard CheckInDialog/useCheckIn flow */}
            {checkInMember && (
                <CheckInDialog
                    open={!!checkInMember}
                    onOpenChange={(o) => !o && setCheckInMember(null)}
                    booking={{
                        id: checkInMember.id,
                        checkIn: checkInMember.checkIn,
                        checkOut: checkInMember.checkOut,
                        totalPrice: checkInMember.totalPrice,
                        amountPaid: checkInMember.amountPaid,
                        paymentStatus: checkInMember.paymentStatus,
                        status: checkInMember.status,
                    }}
                    room={{ id: checkInMember.roomId, roomNumber: checkInMember.roomNumber }}
                    guest={{
                        id: checkInMember.guestId,
                        name: checkInMember.guestName,
                        email: checkInMember.guestEmail || '',
                        phone: checkInMember.guestPhone || '',
                    }}
                    user={currentUser}
                    onSuccess={async () => {
                        setCheckInMember(null)
                        onUpdate()
                        await reload()
                    }}
                />
            )}

            {/* Remove Member Confirmation */}
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
                                    {members.length === 1 && (
                                        <span className="block mt-2 text-amber-600">
                                            This is the last room in the group — removing it will close the entire group.
                                        </span>
                                    )}
                                    <span className="block mt-2">
                                        This action cannot be undone.
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

            {/* Cancel Entire Group Confirmation */}
            <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Ban className="w-5 h-5 text-destructive" />
                            Cancel Entire Group?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This cancels all {members.length} room{members.length !== 1 ? 's' : ''} in <strong>{groupReference}</strong>. Bookings are marked cancelled, not deleted, and this cannot be undone from here.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={cancelling}>Keep Group</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={handleCancelGroup}
                            disabled={cancelling}
                        >
                            {cancelling && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                            Cancel Group
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Billing & Charges Editor */}
            <Dialog open={showBillingEditor} onOpenChange={setShowBillingEditor}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><Tag className="w-5 h-5" /> Billing & Charges</DialogTitle>
                        <DialogDescription>Shared billing contact, extra charges, and discount for this group.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Billing Name</Label>
                                <Input value={editBillingName} onChange={(e) => setEditBillingName(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Billing Email</Label>
                                <Input value={editBillingEmail} onChange={(e) => setEditBillingEmail(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Phone</Label>
                                <Input value={editBillingPhone} onChange={(e) => setEditBillingPhone(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Address</Label>
                                <Input value={editBillingAddress} onChange={(e) => setEditBillingAddress(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Additional Charges</Label>
                            {editCharges.map((charge, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <Input
                                        value={charge.description}
                                        onChange={(e) => setEditCharges(prev => prev.map((c, i) => i === idx ? { ...c, description: e.target.value } : c))}
                                        placeholder="Description"
                                        className="flex-grow h-9"
                                    />
                                    <Input
                                        type="number"
                                        value={charge.amount}
                                        onChange={(e) => setEditCharges(prev => prev.map((c, i) => i === idx ? { ...c, amount: parseFloat(e.target.value) || 0 } : c))}
                                        placeholder="Amount"
                                        className="w-24 h-9"
                                    />
                                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setEditCharges(prev => prev.filter((_, i) => i !== idx))}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </div>
                            ))}
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full border-dashed"
                                onClick={() => setEditCharges(prev => [...prev, { description: '', amount: 0 }])}
                            >
                                <Plus className="h-4 w-4 mr-2" /> Add Charge
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <Label>Discount</Label>
                            <div className="flex gap-2">
                                <Select value={editDiscountType} onValueChange={(v: any) => setEditDiscountType(v)}>
                                    <SelectTrigger className="w-[140px] h-9">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="fixed">Fixed Amount</SelectItem>
                                        <SelectItem value="percentage">Percentage (%)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Input
                                    type="number"
                                    value={editDiscountValue}
                                    onChange={(e) => setEditDiscountValue(parseFloat(e.target.value) || 0)}
                                    min="0"
                                    className="h-9"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowBillingEditor(false)} disabled={savingMeta}>Cancel</Button>
                        <Button onClick={handleSaveMeta} disabled={savingMeta}>
                            {savingMeta && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Member Dialog */}
            <Dialog open={!!editMember} onOpenChange={(open) => !open && setEditMember(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="w-5 h-5" />
                            Edit Member
                        </DialogTitle>
                        <DialogDescription>
                            Update guest information for Room {editMember?.roomNumber}. This only changes this booking, not the guest's other reservations.
                        </DialogDescription>
                    </DialogHeader>
                    {editMember && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Guest Name *</Label>
                                <Input
                                    placeholder="Enter guest name"
                                    value={editGuestName}
                                    onChange={(e) => setEditGuestName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    type="email"
                                    placeholder="guest@example.com"
                                    value={editGuestEmail}
                                    onChange={(e) => setEditGuestEmail(e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Check-in Date</Label>
                                    <Input
                                        type="date"
                                        value={editCheckIn}
                                        onChange={(e) => setEditCheckIn(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Check-out Date</Label>
                                    <Input
                                        type="date"
                                        value={editCheckOut}
                                        onChange={(e) => setEditCheckOut(e.target.value)}
                                        min={editCheckIn}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditMember(null)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveMember} disabled={saving || !editGuestName.trim()}>
                            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
