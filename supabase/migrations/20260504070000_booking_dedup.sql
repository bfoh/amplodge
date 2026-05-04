-- Booking deduplication: client idempotency key + active-booking uniqueness
--
-- Adds two layers of duplicate-insert defense at the database level so the
-- application no longer relies on a stale-read client-side check that two
-- racing requests can both pass.
--
-- 1. client_request_id (uuid, nullable, unique-when-set):
--    The booking submit handler generates one UUID per intentional click and
--    sends it with createBooking. A retry of the same click (e.g. a double
--    click before React renders the loading state) hits this constraint and
--    Postgres returns 23505. The application catches that and re-reads the
--    existing row instead of inserting a duplicate.
--
-- 2. (guest_id, room_id, check_in, check_out) unique among ACTIVE bookings:
--    Even without an idempotency key (older clients, server-side scripts,
--    etc.) the same guest cannot have two active bookings for the same room
--    on the same dates. Cancelled and checked-out rows are excluded so a
--    legitimate re-booking after a cancel still works.

-- Add the column if it doesn't already exist (table was created out-of-band)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

-- Defense (1): unique idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS bookings_client_request_id_key
  ON public.bookings (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Defense (2): no two active bookings for the same guest+room+dates.
--
-- Pre-check: surface any existing duplicates so this migration aborts cleanly
-- rather than failing partway through index creation. Resolve duplicates
-- manually (collapse status, cancel one, etc.) and re-run.
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count FROM (
    SELECT 1
    FROM public.bookings
    WHERE status IN ('reserved','confirmed','checked-in')
    GROUP BY guest_id, room_id, check_in, check_out
    HAVING count(*) > 1
  ) AS conflicts;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create bookings_no_exact_dup: % duplicate (guest_id, room_id, check_in, check_out) groups exist among active bookings. Resolve them and re-run this migration.',
      conflict_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_no_exact_dup
  ON public.bookings (guest_id, room_id, check_in, check_out)
  WHERE status IN ('reserved','confirmed','checked-in');
