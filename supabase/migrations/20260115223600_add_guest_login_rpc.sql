-- Create RPC function to authenticate guest by Room Number and Last Name

CREATE OR REPLACE FUNCTION login_guest(room_num text, last_name_input text)
RETURNS json
SECURITY DEFINER
AS $$
DECLARE
    found_token uuid;
    found_name text;
BEGIN
    -- Input normalization: trim whitespace
    room_num := trim(room_num);
    last_name_input := trim(last_name_input);

    SELECT b.guest_token, g.name
    INTO found_token, found_name
    FROM bookings b
    JOIN rooms r ON b.room_id = r.id
    JOIN guests g ON b.guest_id = g.id
    WHERE r.number = room_num
    AND b.status IN ('confirmed', 'checked_in')
    AND b.check_out_date >= CURRENT_DATE -- Must be active
    -- Case-insensitive suffix match for Last Name
    -- Matches "Doe" in "John Doe" or "DOE"
    AND g.name ILIKE '%' || last_name_input
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
            'error', 'No active booking found for this Room and Name combination.'
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION login_guest(text, text) TO postgres, anon, authenticated, service_role;
