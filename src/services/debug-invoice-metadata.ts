
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://kfjncxphokthkuwypiea.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtmam5jeHBob2t0aGt1d3lwaWVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MTY0NjAsImV4cCI6MjA4MTI5MjQ2MH0.zZwisLZ9FgN3VJydzDx6t5oRSqEmfBlJUpskEIfCobU'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function inspectLatestBooking() {
    try {
        console.log('Connecting to Supabase...')
        // Fetch latest booking
        const { data: bookings, error } = await supabase
            .from('bookings')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5)

        if (error) {
            console.error('Supabase Error:', error)
            return
        }

        if (!bookings || bookings.length === 0) {
            console.log('No bookings found.')
            return
        }

        bookings.forEach((booking, index) => {
            console.log(`\n--- Booking #${index + 1} ---`)
            console.log('ID:', booking.id)
            console.log('Room ID:', booking.room_id)
            console.log('Total Price:', booking.total_price)
            console.log('Guest ID:', booking.guest_id)
            console.log('Created At:', booking.created_at)
            console.log('Special Requests (len):', booking.special_requests ? booking.special_requests.length : 0)

            // Attempt parse
            if (booking.special_requests) {
                const match = booking.special_requests.match(/<!-- GROUP_DATA:(.*?) -->/)
                if (match) {
                    console.log('✅ GROUP_DATA found!')
                    try {
                        const data = JSON.parse(match[1])
                        console.log('Additional Charges:', JSON.stringify(data.additionalCharges))
                        console.log('Discount:', JSON.stringify(data.discount))
                        console.log('Is Primary:', data.isPrimaryBooking)
                    } catch (e) {
                        console.error('Failed to parse JSON:', e)
                    }
                } else {
                    console.log('❌ No GROUP_DATA tag found')
                }
            } else {
                console.log('❌ special_requests is null/empty')
            }
        })

    } catch (error) {
        console.error('Unexpected error:', error)
    }
}

inspectLatestBooking()
