-- Add phone column to staff table
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS phone text;

-- Add comment
COMMENT ON COLUMN public.staff.phone IS 'Contact phone number for the staff member';
