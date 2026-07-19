-- Prevent overlapping bookings for the same room (double-booking race fix)
--
-- The existing booking_dedup migration only blocks EXACT duplicates
-- (same guest_id + room_id + identical check_in/check_out) and double-click
-- retries via client_request_id. It does NOT stop the real race:
--
--   Request A: book room 5 for Jul 1–5   (guest Alice)
--   Request B: book room 5 for Jul 3–8   (guest Bob)   <-- different guest AND dates
--
-- Both pass the availability read (neither is committed yet) and both pass the
-- exact-duplicate index, so both insert -> room 5 is double-booked.
--
-- The only race-proof fix is a database-level guarantee. A GiST exclusion
-- constraint rejects any two non-cancelled bookings on the same room whose
-- date ranges overlap. It protects EVERY insert path at once (create-booking
-- function, client booking-engine, onsite, group) with no application changes.
--
-- Semantics chosen to exactly match the app's existing availability check
-- (rooms-availability.js / create-booking.js:  check_in < newOut AND
-- check_out > newIn, and busy = status <> 'cancelled'):
--   * daterange bounds '[)' (half-open): a checkout day and the next guest's
--     checkin day may be equal without conflicting (back-to-back stays OK).
--   * predicate  status IN ('reserved','confirmed','checked-in')  : only LIVE
--     holds on a room block it. Terminal rows (checked-out, completed, no-show,
--     cancelled) do NOT block — two historical stays on one room can legitimately
--     have overlapping date ranges once the first guest has checked out, and those
--     are not double-bookings. This matches the "active booking" set already used
--     by booking_dedup.sql. (For a FUTURE date window this is equivalent to the
--     app's availability check, since terminal bookings have past dates.)
--   * rows with NULL room_id / check_in / check_out are excluded so they can't
--     over-block (an unbounded daterange would otherwise collide with everything).

-- GiST over a scalar (room_id) plus a range needs btree_gist.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Pre-check: surface existing overlaps so this migration aborts cleanly instead
-- of failing partway through constraint creation. Resolve the listed conflicts
-- (cancel/adjust one side) and re-run.
DO $$
DECLARE
  overlap_count integer;
BEGIN
  SELECT count(*) INTO overlap_count
  FROM public.bookings a
  JOIN public.bookings b
    ON a.room_id = b.room_id
   AND a.id < b.id
   AND a.check_in  < b.check_out
   AND a.check_out > b.check_in
  WHERE a.status IN ('reserved','confirmed','checked-in')
    AND b.status IN ('reserved','confirmed','checked-in')
    AND a.room_id  IS NOT NULL
    AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL
    AND b.check_in IS NOT NULL AND b.check_out IS NOT NULL;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add bookings_no_room_overlap: % overlapping active booking pair(s) already exist. Resolve them (cancel/adjust one side) and re-run. Query: SELECT a.id, b.id, a.room_id, a.check_in, a.check_out, a.status, b.check_in, b.check_out, b.status FROM bookings a JOIN bookings b ON a.room_id=b.room_id AND a.id<b.id AND a.check_in<b.check_out AND a.check_out>b.check_in WHERE a.status IN (''reserved'',''confirmed'',''checked-in'') AND b.status IN (''reserved'',''confirmed'',''checked-in'');',
      overlap_count;
  END IF;
END $$;

-- Add the exclusion constraint (guarded so re-runs are no-ops; constraints have
-- no IF NOT EXISTS form).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_room_overlap'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_no_room_overlap
      EXCLUDE USING gist (
        room_id WITH =,
        daterange(check_in, check_out, '[)') WITH &&
      )
      WHERE (
        status IN ('reserved','confirmed','checked-in')
        AND room_id  IS NOT NULL
        AND check_in IS NOT NULL
        AND check_out IS NOT NULL
      );
  END IF;
END $$;
