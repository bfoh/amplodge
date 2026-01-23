-- Create RPC function to fetch guest requests securely by token

CREATE OR REPLACE FUNCTION get_guest_requests(token_input uuid)
RETURNS TABLE (
    id uuid,
    type service_request_type,
    status service_request_status,
    details text,
    created_at timestamptz
)
SECURITY DEFINER
AS $$
DECLARE
    target_booking_id uuid;
BEGIN
    -- Resolve token to booking_id
    SELECT id INTO target_booking_id
    FROM bookings
    WHERE guest_token = token_input;

    -- If token is invalid or booking not found, return empty
    IF target_booking_id IS NULL THEN
        RETURN;
    END IF;

    -- Return requests for this booking
    RETURN QUERY
    SELECT sr.id, sr.type, sr.status, sr.details, sr.created_at
    FROM service_requests sr
    WHERE sr.booking_id = target_booking_id
    ORDER BY sr.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant access to authenticated users (and anon if needed, depending on setup)
GRANT EXECUTE ON FUNCTION get_guest_requests(uuid) TO postgres, anon, authenticated, service_role;
