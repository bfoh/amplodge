-- Deleting an employee did not delete them.
--
-- Two separate faults, both measured against production on 2026-09-15.
--
-- 1. booking_charges.created_by is a foreign key to staff(id) with no ON DELETE
--    rule, so the delete is NO ACTION. Eight of the twelve staff rows are
--    referenced by a charge — frimpomaa by 87 of them, Daniella by 55 — and
--    every one of those employees is undeletable: the DELETE raises 23503 and
--    the row stays on the Employees page.
--
-- 2. The four who are referenced by nothing did delete, but only their staff
--    row went. Their login survived: three auth users hold no staff row today
--    (asareblessing69@…, daniellaakesse@…, plus one diagnostic account), which
--    is what "the deleted employee's account still persists" means. That half
--    is fixed in netlify/functions/delete-employee.js.
--
-- The fix here has to let the staff row go WITHOUT losing who took the money.
-- 20260822_require_staff_on_revenue.sql exists precisely because charges
-- belonging to nobody vanish from the revenue reports while still showing on
-- analytics, so ON DELETE SET NULL is not available: it would move GHS of real
-- takings into "Unassigned" the moment someone leaves.
--
-- Instead the charge carries the name, the way bookings already carry
-- created_by_name next to created_by. created_by keeps the staff id it always
-- had — the revenue code already handles an id with no staff row behind it, and
-- now it has a name to print for one. The foreign key is dropped because that
-- id must be allowed to outlive the row it points at.

BEGIN;

ALTER TABLE public.booking_charges
  ADD COLUMN IF NOT EXISTS created_by_name text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid;

COMMENT ON COLUMN public.booking_charges.created_by_name IS
  'Name of the staff member who took the money, denormalised so the attribution survives their employment. Mirrors bookings.created_by_name.';

-- One person is written down under two ids. A booking and a standalone sale
-- record the auth user id; a charge records the staff ROW id. The staff row is
-- the only thing joining them, and deleting the employee removes it — after
-- which their charges and their bookings look like two different people, and
-- their week is reported as two rows, one of them labelled with whatever name
-- happened to be stamped first (usually their email address). Carrying the auth
-- id on the charge makes that join exact and permanent.
COMMENT ON COLUMN public.booking_charges.created_by_user_id IS
  'Auth user id of the staff member in created_by. Denormalised so a charge can still be matched to that person''s bookings once their staff row is gone.';

-- Fill both in while the staff rows are still there to read.
UPDATE public.booking_charges c
   SET created_by_name = COALESCE(NULLIF(btrim(c.created_by_name), ''), NULLIF(btrim(s.name), '')),
       created_by_user_id = COALESCE(c.created_by_user_id, s.user_id)
  FROM public.staff s
 WHERE c.created_by = s.id
   AND (
     (c.created_by_name IS NULL OR btrim(c.created_by_name) = '')
     OR c.created_by_user_id IS NULL
   );

-- Drop the foreign key on created_by, whatever Supabase named it. Discovery
-- rather than a literal name: this schema has been through several migrations
-- and the names are not consistent.
DO $$
DECLARE
  drop_sql text;
BEGIN
  SELECT string_agg(
           format('ALTER TABLE public.booking_charges DROP CONSTRAINT %I;', conname),
           E'\n'
         )
    INTO drop_sql
    FROM pg_constraint
   WHERE conrelid = 'public.booking_charges'::regclass
     AND contype  = 'f'
     AND conkey   = ARRAY[
           (SELECT attnum
              FROM pg_attribute
             WHERE attrelid = 'public.booking_charges'::regclass
               AND attname  = 'created_by')
         ];

  IF drop_sql IS NULL THEN
    RAISE NOTICE 'no foreign key on booking_charges.created_by, nothing to drop';
  ELSE
    EXECUTE drop_sql;
  END IF;
END $$;

COMMENT ON COLUMN public.booking_charges.created_by IS
  'Staff id that took the money. Deliberately NOT a foreign key: the attribution has to outlive the employee. Still refused when null by require_staff_on_charge().';

COMMIT;
