-- Create channel_connections table
CREATE TABLE IF NOT EXISTS public.channel_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id TEXT NOT NULL, -- 'airbnb', 'booking', 'expedia', etc.
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(channel_id)
);

-- Enable RLS for channel_connections
ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;

-- Create policies for channel_connections (Accessible by authenticated users)
CREATE POLICY "Enable read access for authenticated users" ON public.channel_connections
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable write access for authenticated users" ON public.channel_connections
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.channel_connections
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Create channel_room_mappings table
CREATE TABLE IF NOT EXISTS public.channel_room_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_connection_id UUID REFERENCES public.channel_connections(id) ON DELETE CASCADE,
    local_room_type_id TEXT NOT NULL, -- Assuming room types use text IDs or UUIDs stored as text in other tables
    import_url TEXT, -- iCal URL to import FROM
    export_token TEXT DEFAULT replace(cast(gen_random_uuid() as text), '-', ''), -- Unique token for export URL
    last_synced_at TIMESTAMP WITH TIME ZONE,
    sync_status TEXT DEFAULT 'pending', -- 'success', 'error', 'pending'
    sync_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for channel_room_mappings
ALTER TABLE public.channel_room_mappings ENABLE ROW LEVEL SECURITY;

-- Create policies for channel_room_mappings
CREATE POLICY "Enable read access for authenticated users" ON public.channel_room_mappings
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable write access for authenticated users" ON public.channel_room_mappings
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.channel_room_mappings
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for authenticated users" ON public.channel_room_mappings
    FOR DELETE USING (auth.role() = 'authenticated');

-- Create external_bookings table (to store imported bookings)
CREATE TABLE IF NOT EXISTS public.external_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mapping_id UUID REFERENCES public.channel_room_mappings(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL, -- UID from iCal
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    summary TEXT,
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(mapping_id, external_id)
);

-- Enable RLS for external_bookings
ALTER TABLE public.external_bookings ENABLE ROW LEVEL SECURITY;

-- Create policies for external_bookings
CREATE POLICY "Enable read access for authenticated users" ON public.external_bookings
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable write access for authenticated users" ON public.external_bookings
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.external_bookings
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for authenticated users" ON public.external_bookings
    FOR DELETE USING (auth.role() = 'authenticated');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_channel_room_mappings_connection ON public.channel_room_mappings(channel_connection_id);
CREATE INDEX IF NOT EXISTS idx_external_bookings_mapping ON public.external_bookings(mapping_id);
CREATE INDEX IF NOT EXISTS idx_external_bookings_dates ON public.external_bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_channel_room_mappings_export_token ON public.channel_room_mappings(export_token);
