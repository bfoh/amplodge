-- Add 'room_extension' to allowed categories for booking_charges
ALTER TABLE public.booking_charges 
DROP CONSTRAINT booking_charges_category_check;

ALTER TABLE public.booking_charges 
ADD CONSTRAINT booking_charges_category_check 
CHECK (category IN ('food_beverage', 'room_service', 'minibar', 'laundry', 'phone_internet', 'parking', 'room_extension', 'other'));
