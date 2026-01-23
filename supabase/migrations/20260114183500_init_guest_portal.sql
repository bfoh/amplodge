-- Create Service Requests Table and Guest Tokens

-- 1. Add guest_token to bookings
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS guest_token uuid DEFAULT gen_random_uuid();

-- Create index for faster lookup
CREATE INDEX IF NOT EXISTS idx_bookings_guest_token ON bookings(guest_token);

-- 2. Create Service Requests Table
CREATE TYPE service_request_type AS ENUM ('housekeeping', 'amenity', 'transport', 'problem', 'food', 'other');
CREATE TYPE service_request_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

CREATE TABLE IF NOT EXISTS service_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
    type service_request_type NOT NULL,
    status service_request_status DEFAULT 'pending',
    details text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. RLS Policies

-- Public access to read booking by token (for the Guest Portal login)
-- We use a stored function to securely fetch booking details by token without exposing the whole table
CREATE OR REPLACE FUNCTION get_booking_by_token(token_input uuid)
RETURNS TABLE (
    id uuid,
    guest_name text,
    room_number text,
    check_in date,
    check_out date,
    status text
) 
SECURITY DEFINER -- Runs with elevated privileges
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        g.name as guest_name,
        r.number as room_number,
        b.check_in_date,
        b.check_out_date,
        b.status
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    LEFT JOIN rooms r ON b.room_id = r.id
    WHERE b.guest_token = token_input
    AND b.status IN ('confirmed', 'checked_in')
    AND b.check_out_date >= CURRENT_DATE; -- Only active bookings
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on service_requests
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Guests can insert requests for their own booking
-- (This is tricky because Supabase Auth is usually for Users, not anonymous tokens)
-- We might need to handle the INSERT via a Database Function or Edge Function that validates the token.
-- For now, we will create a function `submit_guest_request` to handle this securely.

CREATE OR REPLACE FUNCTION submit_guest_request(
    token_input uuid,
    req_type service_request_type,
    req_details text
)
RETURNS json
SECURITY DEFINER
AS $$
DECLARE
    target_booking_id uuid;
BEGIN
    -- Validate Token
    SELECT id INTO target_booking_id
    FROM bookings
    WHERE guest_token = token_input
    AND status IN ('confirmed', 'checked_in');

    IF target_booking_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invalid or expired token');
    END IF;

    -- Insert Request
    INSERT INTO service_requests (booking_id, type, details)
    VALUES (target_booking_id, req_type, req_details);

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- Policy: Staff (Authenticated) can view and update all requests
CREATE POLICY "Staff can view all requests"
ON service_requests FOR SELECT
TO authenticated
USING (true); -- Assuming all auth users are staff for now, or check role

CREATE POLICY "Staff can update requests"
ON service_requests FOR UPDATE
TO authenticated
USING (true);
