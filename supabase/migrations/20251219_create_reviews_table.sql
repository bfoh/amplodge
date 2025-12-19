
-- Create reviews table
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    guest_id UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    is_featured BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Policies
-- 1. Public can read approved reviews
CREATE POLICY "Public can view approved reviews" ON public.reviews
    FOR SELECT
    USING (status = 'approved');

-- 2. Authenticated users (Staff) can do everything
CREATE POLICY "Staff can manage all reviews" ON public.reviews
    FOR ALL
    USING (auth.role() = 'authenticated'); -- Assuming staff use authenticated role

-- 3. Guests can insert via function (handled by service role usually, or anon if logic permits)
-- For now, we'll allow anon insert but only with valid booking_id (logic handled in app layer mostly)
-- But better to use Service Role for submission to be safe.

-- Create index for faster lookups
CREATE INDEX idx_reviews_booking_id ON public.reviews(booking_id);
CREATE INDEX idx_reviews_status ON public.reviews(status);
CREATE INDEX idx_reviews_is_featured ON public.reviews(is_featured);
