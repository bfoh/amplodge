-- Update Room Types Configuration
-- This migration updates room type capacities and adds the Presidential Suite

-- Update Executive Suite capacity to 2
UPDATE room_types 
SET capacity = 2, updated_at = NOW()
WHERE name = 'Executive Suite' AND (capacity IS NULL OR capacity != 2);

-- Update Family Room capacity to 4
UPDATE room_types 
SET capacity = 4, updated_at = NOW()
WHERE name = 'Family Room' AND (capacity IS NULL OR capacity != 4);

-- Ensure all other room types have correct capacities
UPDATE room_types 
SET capacity = 2, updated_at = NOW()
WHERE name IN ('Standard Room', 'Deluxe Room') AND (capacity IS NULL OR capacity != 2);

-- Add Presidential Suite if it doesn't exist
INSERT INTO room_types (id, name, description, base_price, capacity, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    'Presidential Suite',
    'Our most luxurious accommodation with exclusive amenities and premium services',
    500,
    5,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM room_types WHERE name = 'Presidential Suite'
);

-- Update Presidential Suite capacity if it exists but has wrong capacity
UPDATE room_types 
SET capacity = 5, updated_at = NOW()
WHERE name = 'Presidential Suite' AND (capacity IS NULL OR capacity != 5);
