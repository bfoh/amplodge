import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
})

// Export types for database tables
export type Tables = {
    users: {
        id: string
        email: string
        first_login: number
        created_at: string
        updated_at: string
    }
    staff: {
        id: string
        user_id: string
        name: string
        email: string
        role: string
        created_at: string
    }
    room_types: {
        id: string
        name: string
        description: string | null
        base_price: number
        max_occupancy: number
        amenities: any[]
        created_at: string
        updated_at: string
    }
    rooms: {
        id: string
        room_number: string
        room_type_id: string | null
        status: string
        price: number | null
        image_urls: any[]
        created_at: string
    }
    guests: {
        id: string
        name: string
        email: string | null
        phone: string | null
        address: string | null
        created_at: string
    }
    bookings: {
        id: string
        user_id: string | null
        guest_id: string
        room_id: string
        check_in: string
        check_out: string
        actual_check_in: string | null
        actual_check_out: string | null
        status: string
        total_price: number | null
        num_guests: number
        special_requests: string | null
        created_at: string
        updated_at: string
    }
    invoices: {
        id: string
        guest_id: string
        booking_id: string
        invoice_number: string
        total_amount: number
        status: string
        items: any[]
        created_at: string
        updated_at: string
    }
    activity_logs: {
        id: string
        action: string
        entity_type: string
        entity_id: string
        details: Record<string, any> | null
        user_id: string | null
        metadata: Record<string, any> | null
        created_at: string
    }
    contact_messages: {
        id: string
        name: string
        email: string
        phone: string | null
        subject: string | null
        message: string
        status: string
        created_at: string
    }
    properties: {
        id: string
        name: string
        room_number: string | null
        address: string | null
        property_type_id: string | null
        bedrooms: number | null
        bathrooms: number | null
        max_guests: number | null
        base_price: number | null
        description: string | null
        status: string
        created_at: string
        updated_at: string
    }
    hotel_settings: {
        id: string
        name: string
        address: string | null
        phone: string | null
        email: string | null
        website: string | null
        logo_url: string | null
        tax_rate: number
        currency: string
        created_at: string
        updated_at: string
    }
}
