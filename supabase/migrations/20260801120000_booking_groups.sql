-- Real relational backbone for group bookings.
--
-- Group bookings (a guest reserving multiple rooms under one reservation)
-- previously existed only as a JSON blob hidden inside an HTML comment in
-- each booking's free-text special_requests column, re-parsed independently
-- in 9+ places across the app and the invoice netlify function. This adds a
-- proper booking_groups table plus an indexed group_id FK on bookings so
-- group membership, billing info, and the primary room are queryable and
-- consistent everywhere.
--
-- No backfill: existing groups (created before this migration) keep working
-- via the application's fallback reader, which still parses the legacy
-- GROUP_DATA comment when a booking has no group_id. New groups use this
-- table exclusively.

CREATE TABLE IF NOT EXISTS public.booking_groups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_reference     text UNIQUE NOT NULL,
  billing_contact     jsonb,
  additional_charges  jsonb NOT NULL DEFAULT '[]'::jsonb,
  discount            jsonb,
  primary_booking_id  uuid,
  invoice_number      text,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by          text,
  created_by_name     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.booking_groups(id);

CREATE INDEX IF NOT EXISTS bookings_group_id_idx
  ON public.bookings (group_id) WHERE group_id IS NOT NULL;

-- primary_booking_id intentionally has no FK constraint to bookings: the
-- primary room's booking row can be deleted/reassigned independently
-- (removeGroupMember promotes a new primary), and a hard FK would force
-- ordering headaches on that write. Application code is the sole writer.

ALTER TABLE public.booking_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON public.booking_groups
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable write access for authenticated users" ON public.booking_groups
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.booking_groups
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for authenticated users" ON public.booking_groups
  FOR DELETE USING (auth.role() = 'authenticated');
