-- Update Room Types Configuration
-- This migration ensures all 5 room types exist with correct capacities

-- Add Standard Room if it doesn't exist
INSERT INTO room_types (id, name, description, base_price, capacity, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    'Standard Room',
    'Comfortable and affordable, perfect for budget travelers',
    360,
    2,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM room_types WHERE name = 'Standard Room'
);

-- Add Executive Suite if it doesn't exist
INSERT INTO room_types (id, name, description, base_price, capacity, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    'Executive Suite',
    'Premium accommodation with extra space and luxury features',
    460,
    2,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM room_types WHERE name = 'Executive Suite'
);

-- Add Deluxe Room if it doesn't exist
INSERT INTO room_types (id, name, description, base_price, capacity, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    'Deluxe Room',
    'More spacious with upgraded amenities',
    560,
    2,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM room_types WHERE name = 'Deluxe Room'
);

-- Add Family Room if it doesn't exist
INSERT INTO room_types (id, name, description, base_price, capacity, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    'Family Room',
    'Ideal for families, accommodates more guests',
    650,
    4,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM room_types WHERE name = 'Family Room'
);

-- Add Presidential Suite if it doesn't exist
INSERT INTO room_types (id, name, description, base_price, capacity, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    'Presidential Suite',
    'Our most luxurious accommodation with exclusive amenities and premium services',
    1200,
    5,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM room_types WHERE name = 'Presidential Suite'
);

-- Update capacities for any existing room types that have wrong values
UPDATE room_types SET capacity = 2, updated_at = NOW() WHERE name = 'Standard Room' AND (capacity IS NULL OR capacity != 2);
UPDATE room_types SET capacity = 2, updated_at = NOW() WHERE name = 'Executive Suite' AND (capacity IS NULL OR capacity != 2);
UPDATE room_types SET capacity = 2, updated_at = NOW() WHERE name = 'Deluxe Room' AND (capacity IS NULL OR capacity != 2);
UPDATE room_types SET capacity = 4, updated_at = NOW() WHERE name = 'Family Room' AND (capacity IS NULL OR capacity != 4);
UPDATE room_types SET capacity = 5, updated_at = NOW() WHERE name = 'Presidential Suite' AND (capacity IS NULL OR capacity != 5);
