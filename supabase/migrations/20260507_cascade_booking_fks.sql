-- Booking deletion was failing with FK violations because invoices and
-- housekeeping_tasks reference bookings(id) without ON DELETE CASCADE.
-- The trash icon would surface a generic "Failed to delete booking" toast
-- and the row would stay. This migration relaxes those constraints.
--
-- Strategy:
--  - invoices.booking_id              -> ON DELETE CASCADE
--    (an invoice without its booking is meaningless)
--  - housekeeping_tasks.booking_id    -> ON DELETE SET NULL
--    (the task may still need to be completed even if the booking is gone)
--  - activity_logs.entity_id          -> no FK by design (free text), skip
--
-- Idempotent: drops the existing constraint by name (if any) before adding.

BEGIN;

-- ---------------------------------------------------------------------------
-- invoices.booking_id -> ON DELETE CASCADE
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoices') THEN
    -- Drop whatever FK currently exists on invoices.booking_id, regardless of name.
    EXECUTE (
      SELECT string_agg(
        format('ALTER TABLE public.invoices DROP CONSTRAINT %I;', conname),
        E'\n'
      )
      FROM pg_constraint
      WHERE conrelid = 'public.invoices'::regclass
        AND contype = 'f'
        AND conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.invoices'::regclass AND attname = 'booking_id')
        ]
    );

    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- housekeeping_tasks.booking_id -> ON DELETE SET NULL
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'housekeeping_tasks') THEN
    -- Make sure the column is nullable first (SET NULL needs it).
    ALTER TABLE public.housekeeping_tasks
      ALTER COLUMN booking_id DROP NOT NULL;

    EXECUTE (
      SELECT string_agg(
        format('ALTER TABLE public.housekeeping_tasks DROP CONSTRAINT %I;', conname),
        E'\n'
      )
      FROM pg_constraint
      WHERE conrelid = 'public.housekeeping_tasks'::regclass
        AND contype = 'f'
        AND conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.housekeeping_tasks'::regclass AND attname = 'booking_id')
        ]
    );

    ALTER TABLE public.housekeeping_tasks
      ADD CONSTRAINT housekeeping_tasks_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
