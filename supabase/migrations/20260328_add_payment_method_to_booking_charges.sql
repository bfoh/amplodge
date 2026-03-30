-- Migration: Add payment_method column to booking_charges
-- Purpose: Store payment method directly instead of encoding in notes field

ALTER TABLE public.booking_charges
ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';

COMMENT ON COLUMN public.booking_charges.payment_method IS 'Payment method used for this charge: cash, mobile_money, or card';
