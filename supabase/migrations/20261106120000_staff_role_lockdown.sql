-- Any signed-in account could make itself the owner.
--
-- 20260822_lock_internal_tables.sql gave `authenticated` full INSERT, UPDATE
-- and DELETE on public.staff (using/with check true). Every Netlify function
-- that needs an admin trusts staff.role (netlify/functions/_lib/auth.js,
-- requireAdmin), and so does the staff portal. So a receptionist could run
--   update staff set role = 'owner' where user_id = <their own id>
-- from the browser console, and from then on create and delete employees, read
-- payroll and revenue, and pass every admin check on the server. They could
-- also delete the owner's row and lock the hotel out of its own admin.
--
-- The browser no longer needs any of that:
--   - adding an employee writes the staff row in create-employee (admin only);
--   - editing one goes through update-employee, deleting through
--     delete-employee (both admin only, service role);
--   - the only browser write left is bookingChargesService giving a signed-in
--     account that has no staff row its own least-privilege row, so the money
--     it takes is attributable (src/services/booking-charges-service.ts).
--
-- So: signed-in accounts may read staff rows, and may insert ONE thing — a row
-- for themselves, with no privileges ('staff', or the column's default
-- 'receptionist', which the app grants nothing). No browser UPDATE or DELETE.
-- The service role bypasses RLS, so the functions keep working unchanged.
--
-- Deploy order: ship the functions and site that write the staff row in
-- create-employee FIRST, then apply this. Applied before them, adding an
-- employee fails at the staff-row step (the account is created; re-adding the
-- same email recovers it).
--
-- Rollback: re-run the staff section of 20260822_lock_internal_tables.sql.

do $$
declare
  pol text;
begin
  -- Dropped by discovery, as in 20260822: policy names on this table have not
  -- been consistent across migrations.
  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'staff'
  loop
    execute format('drop policy %I on public.staff', pol);
  end loop;
end $$;

alter table public.staff enable row level security;

create policy staff_read on public.staff
  for select to authenticated
  using (true);

create policy staff_insert_self on public.staff
  for insert to authenticated
  with check (user_id = auth.uid() and role in ('staff', 'receptionist'));

-- Nothing for anon: the public site never reads staff.
