-- Staff records, payroll and the activity log are readable by anyone with the
-- anon key — which is every visitor, because that key ships in the JavaScript.
--
-- Measured against production on 2026-08-22, with no login at all: staff 14
-- rows (names, emails, roles), hr_payroll 4 rows (salaries), activity_logs
-- 14,278 rows. booking_charges, standalone_sales, hr_attendance and invoices
-- already return nothing to an anonymous caller, so the pattern below is the
-- one the rest of the schema already follows.
--
-- Two tables the public genuinely needs are deliberately NOT touched here:
-- bookings and guests are still open, because the public booking page reads and
-- writes them directly as an anonymous visitor. Closing those means moving that
-- page onto the rooms-availability and create-booking functions first, which is
-- a separate change with its own testing.
--
-- The one exception carved out below: the public booking page and the contact
-- form both write activity_logs while nobody is signed in, so anonymous INSERT
-- stays. Reading the log requires a session.

-- Existing policies are dropped by discovery rather than by name — this schema
-- has been through several migrations and the names are not consistent.
do $$
declare
  tbl text;
  pol text;
begin
  foreach tbl in array array['staff', 'activity_logs', 'hr_payroll'] loop
    if to_regclass('public.' || tbl) is null then
      raise notice 'skipping %, not present', tbl;
      continue;
    end if;

    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy %I on public.%I', pol, tbl);
    end loop;

    execute format('alter table public.%I enable row level security', tbl);
  end loop;
end $$;

-- Staff: the app reads and maintains these once someone is signed in. The
-- Employees page creates rows, and bookingChargesService creates one for a
-- signed-in account that lacks it.
create policy staff_read   on public.staff for select to authenticated using (true);
create policy staff_write  on public.staff for insert to authenticated with check (true);
create policy staff_update on public.staff for update to authenticated using (true) with check (true);
create policy staff_delete on public.staff for delete to authenticated using (true);

-- Activity log: written from the public booking page and the contact form, so
-- anonymous inserts are allowed. Reading it is staff-only — it is a record of
-- who did what, with guest names in it.
create policy activity_logs_read   on public.activity_logs for select to authenticated using (true);
create policy activity_logs_append on public.activity_logs for insert to anon, authenticated with check (true);
create policy activity_logs_update on public.activity_logs for update to authenticated using (true) with check (true);
create policy activity_logs_delete on public.activity_logs for delete to authenticated using (true);

-- Payroll: nothing public has any business here.
create policy hr_payroll_read   on public.hr_payroll for select to authenticated using (true);
create policy hr_payroll_write  on public.hr_payroll for insert to authenticated with check (true);
create policy hr_payroll_update on public.hr_payroll for update to authenticated using (true) with check (true);
create policy hr_payroll_delete on public.hr_payroll for delete to authenticated using (true);

-- The service role bypasses RLS entirely, so every Netlify function keeps
-- working unchanged.
