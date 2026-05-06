-- Migration: Add inventory_id to booking_charges
-- Purpose: Enable real-time inventory tracking for guest charges

ALTER TABLE public.booking_charges
ADD COLUMN IF NOT EXISTS inventory_id UUID REFERENCES public.inventory(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_booking_charges_inventory_id ON public.booking_charges(inventory_id);

-- Add comment
COMMENT ON COLUMN public.booking_charges.inventory_id IS 'Reference to the inventory item if this charge represents a physical product sale';
