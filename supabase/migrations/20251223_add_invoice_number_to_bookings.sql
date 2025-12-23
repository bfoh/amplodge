-- Add invoice_number column to bookings table
ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS invoice_number TEXT;

-- Add index for looking up bookings by invoice number
CREATE INDEX IF NOT EXISTS idx_bookings_invoice_number ON public.bookings(invoice_number);

-- Comment
COMMENT ON COLUMN public.bookings.invoice_number IS 'Unique invoice number associated with this booking, generated at checkout';
