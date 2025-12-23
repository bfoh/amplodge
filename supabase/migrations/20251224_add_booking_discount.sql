-- Add discount fields to bookings table
-- This enables staff to apply discounts during check-in

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_reason TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS final_amount DECIMAL(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discounted_by UUID;

-- Add comment for documentation
COMMENT ON COLUMN bookings.discount_amount IS 'Discount amount applied at check-in (in GH₵)';
COMMENT ON COLUMN bookings.discount_reason IS 'Reason for discount (Loyalty, Promo, Manager approval, etc.)';
COMMENT ON COLUMN bookings.final_amount IS 'Final amount after discount (total_price - discount_amount)';
COMMENT ON COLUMN bookings.discounted_by IS 'Staff ID who applied the discount';
