-- ═══════════════════════════════════════════════════════════════════════════
-- Attendance v3 — post-deploy verification & abuse-drill script
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the Supabase dashboard SQL editor AFTER applying
-- supabase/migrations/20260721_attendance_v3.sql.
--
-- Section A: structural checks — every query should return the expected value.
-- Section B: simulated-RLS abuse tests — paste real UUIDs where marked.
-- Section C: hash-chain integrity check (run any time after go-live).
--
-- If any check fails, STOP and fix before rolling out the frontend.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Section A: structural checks ───────────────────────────────────────────

-- A1. RLS enabled on every attendance table → expect 8 rows, all true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('hr_attendance', 'staff_device_bindings',
    'attendance_override_requests', 'hr_shifts', 'attendance_events',
    'attendance_adjustments', 'attendance_attempts', 'attendance_settings')
order by tablename;

-- A2. Policies present → expect hr_attendance_select, override_select,
--     hr_shifts_select, attendance_events_select, attendance_adjustments_select,
--     attendance_settings_select (6 rows).
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and tablename in ('hr_attendance', 'staff_device_bindings',
    'attendance_override_requests', 'hr_shifts', 'attendance_events',
    'attendance_adjustments', 'attendance_attempts', 'attendance_settings')
order by tablename, policyname;

-- A3. Photo bucket exists, private, JPEG-only, 2 MB cap → expect 1 row.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'attendance-photos';

-- A4. v2 function signatures are gone → expect 0 rows.
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (
  (proname = 'clock_in_attendance' and pg_get_function_identity_arguments(oid) like '%p_staff_id%')
  or (proname = 'approve_attendance_override' and pg_get_function_identity_arguments(oid) like '%p_admin_id%')
  or proname = '_amp_hotel'
);

-- A5. Default EXECUTE-to-PUBLIC stripped → expect 0 rows.
select proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace,
lateral (select proacl::text as acl) a
where n.nspname = 'public'
  and (proname like '%attendance%' or proname like '\_amp\_%')
  and (acl is null or acl like '%=X/%');  -- PUBLIC still has execute

-- A6. Settings + secrets seeded → expect 1 row each; secrets must NOT be
--     readable by authenticated (checked in B4).
select id, geofence_radius_m, photo_required, qr_window_seconds
from public.attendance_settings;

-- A7. Role column protected → run as-is; expect 0 rows (no column-level
--     UPDATE grant left for anon/authenticated on staff.role).
select grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'staff'
  and column_name in ('role', 'user_id')
  and privilege_type = 'UPDATE'
  and grantee in ('anon', 'authenticated');

-- A8. Public API grants present → every row must be true. If any row is
--     false, the QR/clock pages fail with 42501 "permission denied" — apply
--     supabase/migrations/20260723_attendance_v3_grants_reapply.sql.
select p.proname,
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

-- ─── Section B: simulated-RLS abuse tests ───────────────────────────────────
-- Paste a real non-admin staff member's auth UUID here (Authentication → Users,
-- or: select user_id, name, role from staff;).
-- Then run each BEGIN…ROLLBACK block and compare with the expected result.

-- >>>>>>>>>>>>>>>>>>>>>>>>> EDIT THIS <<<<<<<<<<<<<<<<<<<<<<<<
-- \set staff_uuid '''00000000-0000-0000-0000-000000000000'''

-- B1. Direct PostgREST-style insert as that staff member → must FAIL with
--     "new row violates row-level security policy". (Forged attendance row.)
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"PASTE_STAFF_AUTH_UUID"}';
--   insert into public.hr_attendance (id, staff_id, staff_name, date, clock_in, clock_out, hours_worked, status, notes, created_at)
--     values ('att_forge_test', 'PASTE_STAFF_AUTH_UUID', 'Forge Test', '2026-07-21', '08:00:00', '', 0, 'present', '', now()::text);
-- rollback;

-- B2. Staff reading attendance rows → must see ONLY their own rows.
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"PASTE_STAFF_AUTH_UUID"}';
--   select count(*) as visible_rows,
--          count(*) filter (where staff_id = 'PASTE_STAFF_AUTH_UUID') as own_rows
--   from public.hr_attendance;
-- rollback;

-- B3. Self-approving an override via direct update → must FAIL (no UPDATE
--     policy on attendance_override_requests).
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"PASTE_STAFF_AUTH_UUID"}';
--   update public.attendance_override_requests set status = 'approved' where true;
-- rollback;

-- B4. Reading the token secret / device fingerprints as staff → must FAIL
--     with permission denied.
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"PASTE_STAFF_AUTH_UUID"}';
--   select * from public.attendance_secrets;      -- permission denied
--   select * from public.staff_device_bindings;   -- 0 rows or permission denied
-- rollback;

-- B5. Self-promotion to admin → must FAIL with
--     "permission denied for column role".
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"PASTE_STAFF_AUTH_UUID"}';
--   update public.staff set role = 'admin' where user_id = 'PASTE_STAFF_AUTH_UUID';
-- rollback;

-- B6. Clock-in with a FORGED token as staff → expect ok:false / invalid_token.
--     (First mint what a REAL token looks like, as postgres, to compare.)
select w::text || '.' || encode(hmac(w::text, (select secret from public.attendance_secrets where id = 1), 'sha256'), 'hex') as example_valid_token
from (select floor(extract(epoch from now()) / 60) as w) t;
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"PASTE_STAFF_AUTH_UUID"}';
--   select public.clock_in_attendance(
--     'forged.deadbeef', 6.7127, -1.6250, 10, '[]'::jsonb, false,
--     'fp_test', 'test phone', null, null);   -- → {"ok": false, "error": "invalid_token"}
-- rollback;

-- B7. Admin-only RPCs as staff → expect not_admin for each.
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"PASTE_STAFF_AUTH_UUID"}';
--   select public.get_clock_token();                                   -- not_admin
--   select public.get_live_attendance();                               -- not_admin
--   select public.approve_attendance_override('ovr_x', null);          -- not_admin
--   select public.set_staff_role('00000000-0000-0000-0000-000000000000', 'admin');  -- not_admin
-- rollback;

-- ─── Section C: hash-chain integrity (safe to run any time) ─────────────────
-- Returns any rows whose stored hash doesn't match a recomputation over the
-- chain up to that row. Expect 0 rows — anything else means the audit log
-- was tampered with out-of-band.
with recursive chain as (
  select e.id, e.record_id, e.event_type, e.payload, e.actor, e.created_at,
         e.prev_hash, e.hash,
         encode(digest(
           coalesce((select hash from public.attendance_events p where p.id = (
             select max(id) from public.attendance_events where id < e.id)), '') || '|' ||
           coalesce(e.record_id, '') || '|' || e.event_type || '|' ||
           coalesce(e.payload::text, '{}') || '|' || coalesce(e.actor, '') || '|' ||
           e.created_at::text, 'sha256'), 'hex') as expected_hash
  from public.attendance_events e
)
select id, record_id, event_type, created_at
from chain
where hash <> expected_hash
   or prev_hash is distinct from (select hash from public.attendance_events p
       where p.id = (select max(id) from public.attendance_events where id < chain.id))
limit 20;

-- ─── Manual phone drills (after frontend deploy) ────────────────────────────
--  1. Fake-GPS app at hotel coords → clock-in succeeds but record shows
--     gps_inconsistent / mock_location_suspected in the Review Queue.
--  2. Photograph the QR, try from outside the geofence → outside_geofence.
--  3. Clock in, leave premises, try to clock out → outside_geofence.
--  4. Try clocking in on a second phone → device_mismatch → request
--     "new device" override → admin approves → works, flagged device_rebind.
--  5. Disconnect → clear "no connection" state; no offline queueing.
--  6. Admin voids a record with a reason → row stays, marked void; event log
--     entry visible; report excludes it.
