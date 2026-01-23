-- Update RPC function to authenticate guest by Room Number and FIRST Name (prefix match)

DROP FUNCTION IF EXISTS login_guest(text, text);

CREATE OR REPLACE FUNCTION login_guest(p_room_num text, p_name_input text)
RETURNS json
SECURITY DEFINER
AS $$
DECLARE
    found_token uuid;
    found_name text;
BEGIN
    -- Input normalization: trim whitespace
    p_room_num := trim(p_room_num);
    p_name_input := trim(p_name_input);

    SELECT b.guest_token, g.name
    INTO found_token, found_name
    FROM bookings b
    JOIN rooms r ON b.room_id = r.id
    JOIN guests g ON b.guest_id = g.id
    WHERE r.number = p_room_num
    AND b.status IN ('confirmed', 'checked_in')
    AND b.check_out_date >= CURRENT_DATE -- Must be active
    -- Case-insensitive PREFIX match for First Name
    -- Matches "John" in "John Doe" or "John"
    AND g.name ILIKE p_name_input || '%'
    ORDER BY b.check_in_date DESC
    LIMIT 1;

    IF found_token IS NOT NULL THEN
        RETURN json_build_object(
            'success', true, 
            'token', found_token,
            'guest_name', found_name
        );
    ELSE
        RETURN json_build_object(
            'success', false, 
            'error', 'No active booking found for this Room and Name.'
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION login_guest(text, text) TO postgres, anon, authenticated, service_role;
