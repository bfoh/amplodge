import { bookingEngine } from './booking-engine'
import { v4 as uuidv4 } from 'uuid'
import { blink } from '@/blink/client'

export const testGroupBooking = async () => {
    console.log('🧪 Starting Group Booking Test...')

    try {
        // 1. Fetch real room types and rooms to ensure validity
        const db = (blink.db as any)
        const roomTypes = await db.roomTypes.list()
        const rooms = await db.rooms.list()

        if (rooms.length < 2) {
            console.warn('⚠️ Not enough rooms to test multi-room booking effectively.')
            return
        }

        const room1 = rooms[0]
        const room2 = rooms[1]

        console.log(`📋 Found rooms: ${room1.roomNumber}, ${room2.roomNumber}`)

        // 2. Mock Cart Data
        const checkIn = new Date()
        checkIn.setDate(checkIn.getDate() + 10) // 10 days from now
        const checkOut = new Date(checkIn)
        checkOut.setDate(checkOut.getDate() + 2) // 2 night stay

        const bookingData1 = {
            guest: { fullName: 'Test Grouper 1', email: 'group1@test.com', phone: '1234567890', address: '123 Test St' },
            roomType: 'Test Room Type', // Should match valid type logic ideally, but engine allows strings
            roomNumber: room1.roomNumber,
            dates: { checkIn: checkIn.toISOString(), checkOut: checkOut.toISOString() },
            numGuests: 1,
            amount: 100,
            status: 'confirmed' as const,
            source: 'online' as const,
            payment: { method: 'cash' as const, status: 'pending' as const, amount: 100, reference: 'TEST-REF-1', paidAt: new Date().toISOString() },
            payment_method: 'cash'
        }

        const bookingData2 = {
            guest: { fullName: 'Test Grouper 2', email: 'group2@test.com', phone: '1234567890', address: '123 Test St' },
            roomType: 'Test Room Type',
            roomNumber: room2.roomNumber,
            dates: { checkIn: checkIn.toISOString(), checkOut: checkOut.toISOString() },
            numGuests: 2,
            amount: 200,
            status: 'confirmed' as const,
            source: 'online' as const,
            payment: { method: 'cash' as const, status: 'pending' as const, amount: 200, reference: 'TEST-REF-2', paidAt: new Date().toISOString() },
            payment_method: 'cash'
        }

        const billingContact = {
            fullName: 'Billing Boss',
            email: 'boss@test.com',
            phone: '555-5555',
            address: 'Corporate HQ'
        }

        // 3. Execute
        console.log('🚀 Executing bookingEngine.createGroupBooking...')
        const results = await bookingEngine.createGroupBooking([bookingData1, bookingData2], billingContact)

        // 4. Verify
        console.log('✅ Group Booking Created!', results)

        if (results.length !== 2) throw new Error('Expected 2 bookings to be returned')
        if (results[0].groupId !== results[1].groupId) throw new Error('GroupId mismatch between bookings')
        if (!results[0].groupReference) throw new Error('GroupReference missing')

        console.log(`🎉 Success! Group Reference: ${results[0].groupReference} | Group ID: ${results[0].groupId}`)

        return results

    } catch (error) {
        console.error('❌ Group Booking Test Failed:', error)
    }
}
