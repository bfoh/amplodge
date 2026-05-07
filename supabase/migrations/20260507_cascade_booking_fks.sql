-- Booking deletion was failing with FK violations because invoices reference
-- bookings(id) without ON DELETE CASCADE. The trash icon would surface a
-- generic "Failed to delete booking" toast and the row would stay. This
-- migration relaxes that constraint.
--
-- Strategy:
--  - invoices.booking_id -> ON DELETE CASCADE (an invoice without its booking
--    is meaningless).
--  - housekeeping_tasks does NOT have a booking_id column in this schema
--    (it ties to property_id + room_number instead), so no FK change needed.
--    Earlier revision of this migration tried to alter it and failed with
--    `42703: column "booking_id" of relation does not exist`.
--  - activity_logs.entity_id is free text, no FK by design, skip.
--
-- Idempotent: drops whichever FK currently exists on invoices.booking_id
-- (regardless of constraint name) before adding the cascading version.
-- Guarded with column-existence check so re-runs and odd schemas are no-ops.

BEGIN;

DO $$
DECLARE
  drop_sql text;
BEGIN
  -- No-op if the column itself doesn't exist (e.g. a fresh schema where
  -- invoices.booking_id was renamed/removed). Prevents 42703 errors.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'booking_id'
  ) THEN
    RAISE NOTICE 'invoices.booking_id not present, skipping FK migration';
    RETURN;
  END IF;

  -- Drop whatever FK currently exists on invoices.booking_id, regardless of
  -- the constraint name Supabase generated.
  SELECT string_agg(
           format('ALTER TABLE public.invoices DROP CONSTRAINT %I;', conname),
           E'\n'
         )
    INTO drop_sql
    FROM pg_constraint
   WHERE conrelid = 'public.invoices'::regclass
     AND contype  = 'f'
     AND conkey = ARRAY[
           (SELECT attnum
              FROM pg_attribute
             WHERE attrelid = 'public.invoices'::regclass
               AND attname  = 'booking_id')
         ];

  IF drop_sql IS NOT NULL THEN
    EXECUTE drop_sql;
  END IF;

  -- Add (or re-add) the cascading FK.
  ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_booking_id_fkey
    FOREIGN KEY (booking_id)
    REFERENCES public.bookings(id)
    ON DELETE CASCADE;
END $$;

COMMIT;
