-- Undo 20260822_lock_internal_tables.sql.
--
-- Run this only if locking staff, activity_logs or hr_payroll broke something
-- in the app. It puts the tables back the way they were: readable and writable
-- by anyone holding the anon key, which is every visitor to the site.
--
-- That is the state the tables were in before, so this restores working
-- behaviour at the cost of the exposure — a deliberate trade for a few minutes
-- while the real problem is found, not somewhere to leave things.

do $$
declare
  tbl text;
  pol text;
begin
  foreach tbl in array array['staff', 'activity_logs', 'hr_payroll'] loop
    if to_regclass('public.' || tbl) is null then continue; end if;

    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy %I on public.%I', pol, tbl);
    end loop;

    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      tbl || '_open', tbl
    );
  end loop;
end $$;
