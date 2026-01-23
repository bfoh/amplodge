-- Fix submit_guest_request to allow all booking statuses (not just active)
-- This allows guests to submit feedback or report issues even after checkout

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
    -- Validate Token - now accepts ANY booking with this token (not just active ones)
    SELECT id INTO target_booking_id
    FROM bookings
    WHERE guest_token = token_input;

    IF target_booking_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invalid or expired token');
    END IF;

    -- Insert Request
    INSERT INTO service_requests (booking_id, type, details)
    VALUES (target_booking_id, req_type, req_details);

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- Add delete policy for staff
CREATE POLICY IF NOT EXISTS "Staff can delete requests"
ON service_requests FOR DELETE
TO authenticated
USING (true);
