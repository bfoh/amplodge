-- Add payment_method column to bookings table
ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Not paid';

-- Optional: Add check constraint if strict values are desired, 
-- but given the prompt only asked for dropdown elements, we'll keep it as text for flexibility unless strictness is required.
-- If strictness is needed later:
-- ALTER TABLE public.bookings ADD CONSTRAINT check_payment_method CHECK (payment_method IN ('Not paid', 'Cash', 'Mobile Money', 'Credit/Debit Card'));
