
-- Migration: Persist reviews by adding guest_name and relaxing FK constraints

-- 1. Add guest_name column
ALTER TABLE public.reviews
ADD COLUMN IF NOT EXISTS guest_name TEXT;

-- 2. Backfill guest_name from guests table
UPDATE public.reviews r
SET guest_name = g.name
FROM public.guests g
WHERE r.guest_id = g.id
AND r.guest_name IS NULL;

-- 3. Alter columns to be nullable
ALTER TABLE public.reviews
ALTER COLUMN booking_id DROP NOT NULL,
ALTER COLUMN guest_id DROP NOT NULL;

-- 4. Drop existing foreign key constraints (names might vary, so we try standard naming or IF EXISTS)
-- Drop booking_id FK
ALTER TABLE public.reviews
DROP CONSTRAINT IF EXISTS reviews_booking_id_fkey;

-- Drop guest_id FK
ALTER TABLE public.reviews
DROP CONSTRAINT IF EXISTS reviews_guest_id_fkey;

-- 5. Add new constraints with ON DELETE SET NULL
ALTER TABLE public.reviews
ADD CONSTRAINT reviews_booking_id_fkey
FOREIGN KEY (booking_id)
REFERENCES public.bookings(id)
ON DELETE SET NULL;

ALTER TABLE public.reviews
ADD CONSTRAINT reviews_guest_id_fkey
FOREIGN KEY (guest_id)
REFERENCES public.guests(id)
ON DELETE SET NULL;
