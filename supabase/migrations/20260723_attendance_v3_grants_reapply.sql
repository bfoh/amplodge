-- ═══════════════════════════════════════════════════════════════════════════
-- Attendance v3 — grants re-apply (fix for "permission denied for function
-- get_clock_token" on the QR display / clock pages)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Symptom: the Staff Clock-In QR panel and /staff/qr-display kiosk show
-- "Could not fetch a clock-in code — retrying…" forever. The browser receives
-- PostgreSQL 42501 (permission denied) from PostgREST, meaning the EXECUTE
-- grants from Part 10 of 20260721_attendance_v3.sql never landed (e.g. the
-- migration was applied from an earlier draft, or in pieces).
--
-- This file is IDEMPOTENT and defensive: revokes are resolved dynamically,
-- and every grant is applied only if the function actually exists — so it
-- converges the database to the intended state whether the original migration
-- was applied fully, partially, or from an earlier draft. Apply via the
-- Supabase dashboard SQL editor.
--
-- The final SELECT is a self-check: for every function that exists,
-- authenticated_can_execute must be true. Functions listed as missing were
-- never created — apply 20260721_attendance_v3.sql itself first.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Strip EXECUTE from public/anon/authenticated on every attendance-related
--    function (including any v2 leftovers), exactly as v3 Part 10 does.
do $$
declare f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '%attendance%'
           or p.proname like '\_amp\_%'
           or p.proname in ('validate_clock_token', 'get_clock_token',
                            'upsert_shift', 'delete_shift', 'get_shifts'))
  loop
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated',
                   f.proname, f.args);
  end loop;
end $$;

-- 2. Grant the public API to authenticated — dynamically, so a missing
--    function (partial original apply) is reported, not fatal.
do $$
declare
  api text[][] := array[
    ['get_clock_token', ''],
    ['clock_in_attendance', 'text, numeric, numeric, numeric, jsonb, boolean, text, text, text, text'],
    ['clock_out_attendance', 'text, numeric, numeric, numeric, jsonb, boolean, text'],
    ['request_attendance_override', 'text, text, numeric, numeric, numeric, numeric, text, text'],
    ['approve_attendance_override', 'text, text'],
    ['reject_attendance_override', 'text, text'],
    ['reset_device_binding', 'text'],
    ['adjust_attendance_record', 'text, timestamptz, timestamptz, text'],
    ['void_attendance_record', 'text, text'],
    ['mark_attendance_reviewed', 'text'],
    ['admin_manual_attendance', 'text, date, text, text, text'],
    ['get_my_attendance', 'int'],
    ['get_live_attendance', ''],
    ['get_attendance_report', 'date, date'],
    ['upsert_shift', 'text, int, time, time, int'],
    ['delete_shift', 'text'],
    ['get_shifts', 'text'],
    ['set_attendance_settings', 'numeric, numeric, numeric, numeric, boolean, numeric, int, int'],
    ['validate_clock_token', 'text'],
    ['set_staff_role', 'uuid, text']
  ];
  fn text[];
  fn_oid oid;
begin
  foreach fn slice 1 in array api loop
    -- Resolve via regprocedure so type aliases (int, time) match their
    -- canonical forms (integer, time without time zone) exactly as GRANT
    -- would; a missing function raises undefined_function → skip, don't abort.
    begin
      fn_oid := format('public.%I(%s)', fn[1], fn[2])::regprocedure::oid;
    exception when undefined_function then
      fn_oid := null;
    end;
    if fn_oid is not null then
      execute format('grant execute on function public.%I(%s) to authenticated', fn[1], fn[2]);
    else
      raise notice 'SKIP grant — function not found: %(%)', fn[1], fn[2];
    end if;
  end loop;
end $$;

-- ─── Self-check ─────────────────────────────────────────────────────────────
-- For every function that exists, authenticated_can_execute must be true.
-- Rows showing f = false mean the grant did not apply — do not roll out.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_clock_token', 'clock_in_attendance', 'clock_out_attendance',
    'request_attendance_override', 'approve_attendance_override',
    'reject_attendance_override', 'reset_device_binding',
    'adjust_attendance_record', 'void_attendance_record',
    'mark_attendance_reviewed', 'admin_manual_attendance',
    'get_my_attendance', 'get_live_attendance', 'get_attendance_report',
    'upsert_shift', 'delete_shift', 'get_shifts',
    'set_attendance_settings', 'validate_clock_token', 'set_staff_role'
  )
order by p.proname;
