-- Migration: Create booking_charges table
-- Purpose: Track additional charges incurred by guests during their stay

CREATE TABLE IF NOT EXISTS public.booking_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('food_beverage', 'room_service', 'minibar', 'laundry', 'phone_internet', 'parking', 'other')),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,  -- quantity × unit_price (stored for convenience)
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES public.staff(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_booking_charges_booking_id ON public.booking_charges(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_charges_created_at ON public.booking_charges(created_at);

-- Enable Row Level Security
ALTER TABLE public.booking_charges ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to manage charges
CREATE POLICY "Allow authenticated users to manage booking charges"
ON public.booking_charges
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.booking_charges IS 'Tracks additional charges incurred by guests during their stay (food, services, etc.)';
