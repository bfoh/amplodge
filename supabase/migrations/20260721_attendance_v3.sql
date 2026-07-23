-- ═══════════════════════════════════════════════════════════════════════════
-- Attendance v3 — tamper-resistant staff attendance
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Replaces the v2 security model. Five layers:
--   1. Presence      — HMAC-signed rotating QR (secret never leaves the DB)
--                      + server geofence with multi-sample analysis.
--   2. Identity      — selfie photo at clock-in AND clock-out (private bucket)
--                      + device binding with admin-approved rebind.
--   3. Authority     — RLS on every table; all mutations via security-definer
--                      RPCs that derive identity from auth.uid(), never params.
--   4. Detection     — anomaly engine (GPS scatter, impossible travel, mock
--                      detection, shift-aware lateness, long-shift auto-close).
--   5. Accountability— append-only hash-chained attendance_events log;
--                      adjustments with mandatory reasons replace edits/deletes.
--
-- Idempotent: safe to run whether or not 20260512_attendance_security_v2.sql
-- was applied. Apply via the Supabase dashboard SQL editor (repo convention).
-- After applying, run scripts/verify_attendance_v3.sql.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── Part 1: Settings & secrets ─────────────────────────────────────────────

create table if not exists public.attendance_settings (
  id int primary key default 1,
  geofence_lat numeric not null default 6.7127,      -- AMP Lodge, Kumasi
  geofence_lng numeric not null default -1.6250,
  geofence_radius_m numeric not null default 150,
  max_accuracy_m numeric not null default 100,       -- reject fixes worse than this
  photo_required boolean not null default true,
  long_shift_hours numeric not null default 16,      -- auto-close open records older than this
  qr_window_seconds int not null default 60,
  grace_minutes_default int not null default 10,
  updated_at timestamptz not null default now(),
  constraint attendance_settings_singleton check (id = 1)
);
insert into public.attendance_settings (id) values (1) on conflict (id) do nothing;

-- HMAC secret for QR tokens. No grants to anon/authenticated at all — only
-- security-definer functions can read it, so it never reaches a client.
create table if not exists public.attendance_secrets (
  id int primary key default 1,
  secret text not null default (gen_random_uuid()::text || gen_random_uuid()::text),
  created_at timestamptz not null default now(),
  constraint attendance_secrets_singleton check (id = 1)
);
insert into public.attendance_secrets (id) values (1) on conflict (id) do nothing;
revoke all on public.attendance_secrets from anon, authenticated;

-- ─── Part 2: Schema evolution ───────────────────────────────────────────────
-- v2 columns first (if not exists) so this migration is self-sufficient even
-- where v2 was never applied, then the v3 columns.

alter table public.hr_attendance
  add column if not exists device_fingerprint text,
  add column if not exists gps_lat numeric,
  add column if not exists gps_lng numeric,
  add column if not exists gps_accuracy numeric,
  add column if not exists gps_distance numeric,
  add column if not exists gps_samples jsonb,
  add column if not exists override_reason text,
  add column if not exists override_requested_at timestamptz,
  add column if not exists override_approved_by text,
  add column if not exists override_approved_at timestamptz,
  add column if not exists flags text[] not null default '{}',
  -- v3
  add column if not exists clock_in_at timestamptz,
  add column if not exists clock_out_at timestamptz,
  add column if not exists clock_in_photo_path text,
  add column if not exists clock_out_photo_path text,
  add column if not exists clock_out_gps_lat numeric,
  add column if not exists clock_out_gps_lng numeric,
  add column if not exists clock_out_gps_accuracy numeric,
  add column if not exists clock_out_gps_distance numeric,
  add column if not exists clock_out_gps_samples jsonb,
  add column if not exists shift_id text,
  add column if not exists scheduled_start text,
  add column if not exists late_minutes int not null default 0,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text,
  add column if not exists void_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

create index if not exists hr_attendance_date_idx on public.hr_attendance (date desc);
create index if not exists hr_attendance_staff_date_idx on public.hr_attendance (staff_id, date desc);
create index if not exists hr_attendance_open_idx on public.hr_attendance (staff_id) where clock_out_at is null;

-- v2 support tables (self-sufficiency) + v3 additions
create table if not exists public.staff_device_bindings (
  staff_id text primary key,
  device_fingerprint text not null,
  device_label text,
  bound_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  reset_count int not null default 0
);

create table if not exists public.attendance_override_requests (
  id text primary key,
  staff_id text not null,
  staff_name text not null,
  reason text not null,
  reason_note text,
  gps_lat numeric,
  gps_lng numeric,
  gps_accuracy numeric,
  gps_distance numeric,
  device_fingerprint text,
  device_label text,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  admin_note text
);
create index if not exists override_status_idx on public.attendance_override_requests (status, requested_at desc);
create index if not exists override_staff_idx on public.attendance_override_requests (staff_id, requested_at desc);

-- Per-staff weekly shift schedule. end_time < start_time means overnight.
create table if not exists public.hr_shifts (
  id text primary key,
  staff_id text not null,
  weekday int not null check (weekday between 0 and 6),  -- 0 = Sunday (extract(dow))
  start_time time not null,
  end_time time not null,
  grace_minutes int not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_shifts_staff_weekday unique (staff_id, weekday)
);
create index if not exists hr_shifts_staff_idx on public.hr_shifts (staff_id);

-- Append-only, hash-chained audit log. Written only by security-definer RPCs
-- (no client access at all). Any retroactive edit breaks the chain.
create table if not exists public.attendance_events (
  id bigserial primary key,
  record_id text,
  staff_id text,
  event_type text not null,
  payload jsonb not null default '{}',
  actor text,
  created_at timestamptz not null default now(),
  prev_hash text,
  hash text not null
);
create index if not exists attendance_events_record_idx on public.attendance_events (record_id);
create index if not exists attendance_events_staff_idx on public.attendance_events (staff_id, created_at desc);

-- Admin corrections: one row per changed field. Rows are never deleted.
create table if not exists public.attendance_adjustments (
  id text primary key,
  record_id text not null,
  admin_id text not null,
  field text not null,
  old_value text,
  new_value text,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists attendance_adjustments_record_idx on public.attendance_adjustments (record_id);

-- Rate limiting for clock attempts.
create table if not exists public.attendance_attempts (
  id bigserial primary key,
  staff_id text not null,
  result text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists attendance_attempts_idx on public.attendance_attempts (staff_id, attempted_at desc);

-- Realtime publication (guarded so re-runs don't fail)
do $$
begin
  begin alter publication supabase_realtime add table public.hr_attendance; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.staff_device_bindings; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.attendance_override_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.hr_shifts; exception when duplicate_object then null; end;
end $$;

-- ─── Part 3: Identity helpers (SECURITY DEFINER, never granted to clients) ──

create or replace function public._amp_requesting_staff()
returns public.staff language sql stable security definer
set search_path = public as $$
  select s.* from public.staff s where s.user_id = auth.uid() limit 1
$$;

create or replace function public._amp_is_admin()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists(
    select 1 from public.staff s
    where s.user_id = auth.uid() and s.role in ('owner', 'admin')
  )
$$;

-- ─── Part 4: RLS lockdown ───────────────────────────────────────────────────
-- Drop EVERY existing policy on attendance tables (names unknown — some may
-- have been created via dashboard), then recreate the minimal v3 set.

do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in (
        'hr_attendance', 'staff_device_bindings', 'attendance_override_requests',
        'hr_shifts', 'attendance_events', 'attendance_adjustments',
        'attendance_attempts', 'attendance_settings'
      )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

alter table public.hr_attendance enable row level security;
alter table public.staff_device_bindings enable row level security;
alter table public.attendance_override_requests enable row level security;
alter table public.hr_shifts enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_adjustments enable row level security;
alter table public.attendance_attempts enable row level security;
alter table public.attendance_settings enable row level security;

-- hr_attendance: staff read their own rows; admins read all.
-- NO insert/update/delete policies → direct PostgREST writes are denied.
-- All mutations flow through security-definer RPCs below.
create policy hr_attendance_select on public.hr_attendance
  for select to authenticated
  using (staff_id = auth.uid()::text or public._amp_is_admin());

-- override requests: staff read their own; admins read all. RPC-only writes
-- (closes the "approve your own override via PostgREST" hole).
create policy override_select on public.attendance_override_requests
  for select to authenticated
  using (staff_id = auth.uid()::text or public._amp_is_admin());

-- shifts: staff read their own; admins read all. RPC-only writes.
create policy hr_shifts_select on public.hr_shifts
  for select to authenticated
  using (staff_id = auth.uid()::text or public._amp_is_admin());

-- audit trail: admins read; nobody writes directly.
create policy attendance_events_select on public.attendance_events
  for select to authenticated using (public._amp_is_admin());
create policy attendance_adjustments_select on public.attendance_adjustments
  for select to authenticated using (public._amp_is_admin());

-- settings: any authenticated staff may read (client needs photo_required,
-- geofence radius for UX). Writes only via set_attendance_settings RPC.
create policy attendance_settings_select on public.attendance_settings
  for select to authenticated using (true);

-- staff_device_bindings and attendance_attempts: no policies at all →
-- zero direct client access (fingerprints are no longer harvestable).

-- ─── Part 5: Photo storage (private bucket) ─────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-photos', 'attendance-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'attendance_photos_%'
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- Staff upload only into their own folder (<auth.uid()>/...). No update/delete.
create policy attendance_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attendance-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Staff read their own photos; admins read all (for signed-URL minting client-side).
create policy attendance_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attendance-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public._amp_is_admin())
  );

-- ─── Part 6: Internal helpers ───────────────────────────────────────────────

-- Haversine distance in metres (kept from v2).
create or replace function public._amp_haversine(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
) returns numeric language plpgsql immutable as $$
declare
  r constant numeric := 6371000;
  to_rad constant numeric := pi() / 180;
  dlat numeric := (lat2 - lat1) * to_rad;
  dlng numeric := (lng2 - lng1) * to_rad;
  a numeric;
begin
  a := sin(dlat/2)^2 + cos(lat1*to_rad) * cos(lat2*to_rad) * sin(dlng/2)^2;
  return r * 2 * asin(sqrt(a));
end $$;

create or replace function public._amp_clock_window()
returns bigint language sql stable security definer
set search_path = public as $$
  select floor(extract(epoch from now()) / s.qr_window_seconds)::bigint
  from public.attendance_settings s where s.id = 1
$$;

create or replace function public._amp_token_secret()
returns text language sql stable security definer
set search_path = public as $$
  select secret from public.attendance_secrets where id = 1
$$;

-- Signed-token validation: token is "<window>.<hmac_hex>". Accepts the current
-- and previous window so a QR rotating mid-scan doesn't block staff.
create or replace function public.validate_clock_token(p_token text)
returns boolean language plpgsql stable security definer
set search_path = public as $$
declare
  w_text text;
  sig text;
  w bigint;
  cur bigint;
begin
  if p_token is null or position('.' in p_token) = 0 then
    return false;
  end if;
  w_text := split_part(p_token, '.', 1);
  sig := split_part(p_token, '.', 2);
  if sig is null or sig = '' then
    return false;
  end if;
  begin
    w := w_text::bigint;
  exception when others then
    return false;
  end;
  cur := public._amp_clock_window();
  if w <> cur and w <> cur - 1 then
    return false;
  end if;
  return encode(hmac(w_text, public._amp_token_secret(), 'sha256'), 'hex') = sig;
end $$;

-- Rate limiting: more than 5 failed attempts in 10 minutes → cool down.
create or replace function public._amp_rate_limited(p_staff_id text)
returns boolean language sql stable security definer
set search_path = public as $$
  select count(*) >= 5 from public.attendance_attempts
  where staff_id = p_staff_id
    and result <> 'ok'
    and attempted_at > now() - interval '10 minutes'
$$;

create or replace function public._amp_record_attempt(p_staff_id text, p_result text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  insert into public.attendance_attempts (staff_id, result) values (p_staff_id, p_result);
  -- lazy cleanup so the table stays small
  delete from public.attendance_attempts where attempted_at < now() - interval '1 day';
end $$;

-- Append-only hash-chained event log. Advisory lock serializes writers so the
-- chain can't fork under concurrent clock events.
create or replace function public._amp_log_event(
  p_record_id text,
  p_staff_id text,
  p_event_type text,
  p_payload jsonb,
  p_actor text
) returns void language plpgsql security definer
set search_path = public as $$
declare
  prev text;
  ts timestamptz := now();
  h text;
begin
  perform pg_advisory_xact_lock(884210);
  select hash into prev from public.attendance_events order by id desc limit 1;
  -- Canonical UTC rendering so the chain verifies regardless of the
  -- session TimeZone (timestamptz::text is session-dependent).
  h := encode(digest(
    coalesce(prev, '') || '|' || coalesce(p_record_id, '') || '|' ||
    p_event_type || '|' || coalesce(p_payload::text, '{}') || '|' ||
    coalesce(p_actor, '') || '|' ||
    to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ'),
    'sha256'), 'hex');
  insert into public.attendance_events
    (record_id, staff_id, event_type, payload, actor, created_at, prev_hash, hash)
  values
    (p_record_id, p_staff_id, p_event_type, p_payload, p_actor, ts, prev, h);
end $$;

-- Auto-close open records older than long_shift_hours (forgotten clock-outs).
create or replace function public._amp_autoclose(p_staff_id text)
returns void language plpgsql security definer
set search_path = public as $$
declare
  rec record;
  cutoff interval;
  in_ts timestamptz;
  out_ts timestamptz;
  hrs numeric;
begin
  select (s.long_shift_hours || ' hours')::interval into cutoff
  from public.attendance_settings s where s.id = 1;

  for rec in
    select * from public.hr_attendance
    where staff_id = p_staff_id
      and voided_at is null
      and (clock_out is null or clock_out = '')
      and status <> 'init'
  loop
    in_ts := coalesce(
      rec.clock_in_at,
      ((rec.date || ' ' || rec.clock_in)::timestamp at time zone 'Africa/Accra')
    );
    if in_ts is null or now() - in_ts < cutoff then
      continue;
    end if;
    out_ts := in_ts + cutoff;
    hrs := round(extract(epoch from cutoff) / 3600.0, 2);
    update public.hr_attendance
      set clock_out_at = out_ts,
          clock_out = to_char(out_ts at time zone 'Africa/Accra', 'HH24:MI:SS'),
          hours_worked = hrs,
          flags = array_append(coalesce(flags, '{}'), 'auto_closed')
      where id = rec.id;
    perform public._amp_log_event(rec.id, p_staff_id, 'auto_close',
      jsonb_build_object('clock_in_at', in_ts, 'auto_clock_out_at', out_ts, 'hours', hrs),
      'system');
  end loop;
end $$;

-- Max pairwise distance (metres) among GPS samples — spoofed feeds often jump.
create or replace function public._amp_gps_scatter(p_samples jsonb)
returns numeric language plpgsql immutable as $$
declare
  i int;
  j int;
  n int;
  d numeric;
  max_d numeric := 0;
begin
  if p_samples is null or jsonb_typeof(p_samples) <> 'array' then
    return 0;
  end if;
  n := jsonb_array_length(p_samples);
  if n < 2 then
    return 0;
  end if;
  for i in 0 .. n - 2 loop
    for j in i + 1 .. n - 1 loop
      d := public._amp_haversine(
        (p_samples->i->>'lat')::numeric, (p_samples->i->>'lng')::numeric,
        (p_samples->j->>'lat')::numeric, (p_samples->j->>'lng')::numeric
      );
      if d > max_d then
        max_d := d;
      end if;
    end loop;
  end loop;
  return max_d;
end $$;

-- Resolve the shift a clock-in belongs to: today's shift, or yesterday's
-- overnight shift whose window is still open. Returns the hr_shifts row
-- whose start is closest in the past (within 12 h), or null.
create or replace function public._amp_resolve_shift(p_staff_id text, p_now timestamptz)
returns public.hr_shifts language plpgsql stable security definer
set search_path = public as $$
declare
  local_now timestamp := p_now at time zone 'Africa/Accra';
  dow_today int := extract(dow from local_now)::int;
  dow_yesterday int := (dow_today + 6) % 7;
  best public.hr_shifts;
  best_age interval := interval '12 hours';
  cand record;
  start_ts timestamp;
  age interval;
begin
  for cand in
    select * from public.hr_shifts
    where staff_id = p_staff_id
      and (weekday = dow_today or (weekday = dow_yesterday and end_time < start_time))
  loop
    start_ts := (local_now::date - case when cand.weekday = dow_yesterday then 1 else 0 end)
                + cand.start_time;
    age := local_now - start_ts;
    if age >= interval '0' and age < best_age then
      best := cand;
      best_age := age;
    end if;
  end loop;
  return best;
end $$;

-- ─── Part 7: Retire v2 function signatures ──────────────────────────────────
-- create-or-replace can't change parameter lists; drop the old overloads so
-- only the v3 signatures remain callable.

drop function if exists public.clock_in_attendance(text, text, text, numeric, numeric, numeric, jsonb, text, text, text);
drop function if exists public.clock_out_attendance(text, text);
drop function if exists public.request_attendance_override(text, text, text, text, numeric, numeric, numeric, numeric, text, text);
drop function if exists public.approve_attendance_override(text, text, text);
drop function if exists public.reject_attendance_override(text, text, text);
drop function if exists public.reset_device_binding(text, text);
drop function if exists public._amp_hotel();

-- ─── Part 8: Public RPCs — clock in/out ─────────────────────────────────────
-- All security definer. Identity comes from auth.uid() via _amp_requesting_staff();
-- no parameter is ever trusted to identify the caller.

create or replace function public.get_clock_token()
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  w bigint;
  sig text;
  win int;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  select qr_window_seconds into win from public.attendance_settings where id = 1;
  w := public._amp_clock_window();
  sig := encode(hmac(w::text, public._amp_token_secret(), 'sha256'), 'hex');
  return jsonb_build_object(
    'ok', true,
    'token', w::text || '.' || sig,
    'expires_in', win - (extract(epoch from now())::bigint % win)
  );
end $$;

create or replace function public.clock_in_attendance(
  p_token text,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric,
  p_samples jsonb,
  p_mock_detected boolean,
  p_device_fp text,
  p_device_label text,
  p_photo_path text,
  p_override_request_id text default null
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  staff_rec public.staff;
  staff_key text;
  cfg public.attendance_settings;
  dist numeric;
  effective_dist numeric;
  scatter numeric;
  binding record;
  override_rec record;
  rec_id text;
  flags_arr text[] := '{}';
  rec_status text := 'present';
  override_approved boolean := false;
  shift_rec public.hr_shifts;
  local_now timestamp;
  expected_start timestamp;
  late_mins int := 0;
  last_rec record;
  travel_dist numeric;
  travel_hours numeric;
  dup_id text;
begin
  -- 1. Identity from the session — never from parameters.
  select * into staff_rec from public._amp_requesting_staff();
  if staff_rec.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  staff_key := staff_rec.user_id::text;
  select * into cfg from public.attendance_settings where id = 1;

  -- 2. Rate limit
  if public._amp_rate_limited(staff_key) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  -- 3. Signed QR token
  if not public.validate_clock_token(p_token) then
    perform public._amp_record_attempt(staff_key, 'invalid_token');
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- 4. Resolve an approved override (valid 15 min after approval)
  if p_override_request_id is not null then
    select * into override_rec
      from public.attendance_override_requests
      where id = p_override_request_id
        and staff_id = staff_key
        and status = 'approved'
        and resolved_at > now() - interval '15 minutes';
    if found then
      override_approved := true;
      flags_arr := array_append(flags_arr, 'override_approved');
    end if;
  end if;

  -- 5. Geofence
  if p_lat is null or p_lng is null then
    dist := null;
    if not override_approved then
      perform public._amp_record_attempt(staff_key, 'no_location');
      return jsonb_build_object('ok', false, 'error', 'no_location');
    end if;
    flags_arr := array_append(flags_arr, 'no_location');
  else
    dist := public._amp_haversine(p_lat, p_lng, cfg.geofence_lat, cfg.geofence_lng);
    effective_dist := greatest(0, dist - coalesce(p_accuracy, 0));
    if coalesce(p_accuracy, 9999) > cfg.max_accuracy_m and not override_approved then
      perform public._amp_record_attempt(staff_key, 'low_gps_accuracy');
      return jsonb_build_object('ok', false, 'error', 'low_gps_accuracy', 'accuracy', p_accuracy);
    end if;
    if effective_dist > cfg.geofence_radius_m and not override_approved then
      perform public._amp_record_attempt(staff_key, 'outside_geofence');
      return jsonb_build_object(
        'ok', false, 'error', 'outside_geofence',
        'distance', dist, 'accuracy', p_accuracy
      );
    end if;
    if effective_dist > cfg.geofence_radius_m then
      flags_arr := array_append(flags_arr, 'outside_geofence');
    end if;
    if coalesce(p_accuracy, 0) > cfg.max_accuracy_m then
      flags_arr := array_append(flags_arr, 'low_gps_accuracy');
    end if;
  end if;

  -- 6. Anomaly signals (never block alone — always surface for review)
  scatter := public._amp_gps_scatter(p_samples);
  if scatter > greatest(100, coalesce(p_accuracy, 0) * 3) then
    flags_arr := array_append(flags_arr, 'gps_inconsistent');
  end if;
  if coalesce(p_mock_detected, false) then
    flags_arr := array_append(flags_arr, 'mock_location_suspected');
  end if;

  -- Impossible travel: implied speed from the staff member's last known fix.
  select * into last_rec from public.hr_attendance
    where staff_id = staff_key and voided_at is null
      and (gps_lat is not null or clock_out_gps_lat is not null)
    order by created_at desc limit 1;
  if found and p_lat is not null then
    travel_dist := public._amp_haversine(
      coalesce(last_rec.clock_out_gps_lat, last_rec.gps_lat),
      coalesce(last_rec.clock_out_gps_lng, last_rec.gps_lng),
      p_lat, p_lng);
    travel_hours := greatest(extract(epoch from now() - coalesce(
      last_rec.clock_out_at, last_rec.clock_in_at,
      (last_rec.date || ' ' || last_rec.clock_in)::timestamp at time zone 'Africa/Accra'
    )) / 3600.0, 0.01);
    if travel_dist / 1000.0 / travel_hours > 500 then
      flags_arr := array_append(flags_arr, 'impossible_travel');
    end if;
  end if;

  -- 7. Photo proof: path must live in the caller's own storage folder.
  if cfg.photo_required then
    if p_photo_path is null
       or not (p_photo_path like staff_key || '/%')
       or not exists (
         select 1 from storage.objects
         where bucket_id = 'attendance-photos' and name = p_photo_path
       ) then
      if not override_approved then
        perform public._amp_record_attempt(staff_key, 'photo_required');
        return jsonb_build_object('ok', false, 'error', 'photo_required');
      end if;
      flags_arr := array_append(flags_arr, 'no_photo');
    end if;
  end if;

  -- 8. Device binding
  select * into binding from public.staff_device_bindings where staff_id = staff_key;
  if not found then
    insert into public.staff_device_bindings
      (staff_id, device_fingerprint, device_label, bound_at, last_used_at)
      values (staff_key, p_device_fp, p_device_label, now(), now());
    flags_arr := array_append(flags_arr, 'device_first_bind');
    perform public._amp_log_event(null, staff_key, 'device_bound',
      jsonb_build_object('device_label', p_device_label), staff_key);
  elsif binding.device_fingerprint <> coalesce(p_device_fp, '') then
    if not override_approved then
      perform public._amp_record_attempt(staff_key, 'device_mismatch');
      return jsonb_build_object('ok', false, 'error', 'device_mismatch');
    end if;
    if override_rec.reason = 'new_device' then
      -- Approved device change: rebind atomically at consumption.
      update public.staff_device_bindings
        set device_fingerprint = p_device_fp,
            device_label = coalesce(p_device_label, device_label),
            last_used_at = now()
        where staff_id = staff_key;
      flags_arr := array_append(flags_arr, 'device_rebind');
      perform public._amp_log_event(null, staff_key, 'device_rebind',
        jsonb_build_object('device_label', p_device_label, 'override', override_rec.id),
        coalesce(override_rec.resolved_by, 'admin'));
    else
      flags_arr := array_append(flags_arr, 'device_mismatch');
    end if;
  else
    update public.staff_device_bindings set last_used_at = now() where staff_id = staff_key;
  end if;

  -- 9. Forgotten clock-outs from previous shifts
  perform public._amp_autoclose(staff_key);

  -- 10. Duplicate guard: one open record at a time
  select id into dup_id from public.hr_attendance
    where staff_id = staff_key and voided_at is null
      and (clock_out is null or clock_out = '') and status <> 'init'
    limit 1;
  if dup_id is not null then
    return jsonb_build_object('ok', false, 'error', 'already_clocked_in', 'record_id', dup_id);
  end if;

  -- 11. Shift-aware lateness
  local_now := now() at time zone 'Africa/Accra';
  shift_rec := public._amp_resolve_shift(staff_key, now());
  if shift_rec.id is not null then
    expected_start := (local_now::date - case
      when shift_rec.weekday = (extract(dow from local_now)::int + 6) % 7
           and shift_rec.weekday <> extract(dow from local_now)::int
      then 1 else 0 end) + shift_rec.start_time;
    late_mins := greatest(0, floor(extract(epoch from
      (local_now - (expected_start + (shift_rec.grace_minutes || ' minutes')::interval))) / 60)::int);
    if late_mins > 0 then
      rec_status := 'late';
    end if;
  end if;

  -- 12. Insert (legacy text columns kept in sync for old UI/CSV consumers)
  rec_id := 'att_' || extract(epoch from now())::bigint || '_' ||
            substr(md5(random()::text), 1, 6);
  insert into public.hr_attendance (
    id, staff_id, staff_name, date, clock_in, clock_out,
    hours_worked, status, notes, created_at,
    device_fingerprint, gps_lat, gps_lng, gps_accuracy, gps_distance, gps_samples,
    override_reason, override_requested_at, override_approved_by, override_approved_at,
    flags, clock_in_at, clock_in_photo_path, shift_id, scheduled_start, late_minutes
  ) values (
    rec_id, staff_key, staff_rec.name,
    to_char(local_now, 'YYYY-MM-DD'), to_char(local_now, 'HH24:MI:SS'), '',
    0, rec_status,
    case when dist is null then 'GPS: unavailable'
         else 'Within hotel (' || round(dist) || ' m)' end,
    now()::text,
    p_device_fp, p_lat, p_lng, p_accuracy, dist, p_samples,
    case when override_approved then override_rec.reason else null end,
    case when override_approved then override_rec.requested_at else null end,
    case when override_approved then override_rec.resolved_by else null end,
    case when override_approved then override_rec.resolved_at else null end,
    flags_arr, now(), p_photo_path,
    shift_rec.id,
    case when shift_rec.id is not null then shift_rec.start_time::text else null end,
    late_mins
  );

  perform public._amp_log_event(rec_id, staff_key, 'clock_in',
    jsonb_build_object('distance', dist, 'accuracy', p_accuracy, 'scatter', scatter,
      'late_minutes', late_mins, 'flags', flags_arr, 'photo', p_photo_path is not null),
    staff_key);

  -- 13. Burn the override
  if override_approved then
    update public.attendance_override_requests set status = 'consumed'
      where id = p_override_request_id;
    perform public._amp_log_event(rec_id, staff_key, 'override_consumed',
      jsonb_build_object('override_id', p_override_request_id), staff_key);
  end if;

  perform public._amp_record_attempt(staff_key, 'ok');
  return jsonb_build_object(
    'ok', true, 'record_id', rec_id, 'flags', flags_arr,
    'distance', dist, 'late_minutes', late_mins, 'status', rec_status
  );
end $$;

create or replace function public.clock_out_attendance(
  p_token text,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric,
  p_samples jsonb,
  p_mock_detected boolean,
  p_photo_path text
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  staff_rec public.staff;
  staff_key text;
  cfg public.attendance_settings;
  rec record;
  dist numeric;
  effective_dist numeric;
  scatter numeric;
  in_ts timestamptz;
  hours numeric;
  new_flags text[];
begin
  select * into staff_rec from public._amp_requesting_staff();
  if staff_rec.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  staff_key := staff_rec.user_id::text;
  select * into cfg from public.attendance_settings where id = 1;

  if public._amp_rate_limited(staff_key) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if not public.validate_clock_token(p_token) then
    perform public._amp_record_attempt(staff_key, 'invalid_token');
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- Close any stale open records first, then find the active one.
  perform public._amp_autoclose(staff_key);

  select * into rec from public.hr_attendance
    where staff_id = staff_key
      and (clock_out is null or clock_out = '')
      and status <> 'init'
      and voided_at is null
      and date::date >= ((now() at time zone 'Africa/Accra')::date - 1)
    order by date desc, clock_in desc
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_open_record');
  end if;

  -- Geofence parity with clock-in (no override path — blocked staff call admin,
  -- who corrects via adjust_attendance_record with a reason).
  if p_lat is null or p_lng is null then
    perform public._amp_record_attempt(staff_key, 'no_location');
    return jsonb_build_object('ok', false, 'error', 'no_location');
  end if;
  dist := public._amp_haversine(p_lat, p_lng, cfg.geofence_lat, cfg.geofence_lng);
  effective_dist := greatest(0, dist - coalesce(p_accuracy, 0));
  if coalesce(p_accuracy, 9999) > cfg.max_accuracy_m then
    perform public._amp_record_attempt(staff_key, 'low_gps_accuracy');
    return jsonb_build_object('ok', false, 'error', 'low_gps_accuracy', 'accuracy', p_accuracy);
  end if;
  if effective_dist > cfg.geofence_radius_m then
    perform public._amp_record_attempt(staff_key, 'outside_geofence');
    return jsonb_build_object(
      'ok', false, 'error', 'outside_geofence', 'distance', dist, 'accuracy', p_accuracy);
  end if;

  -- Photo parity with clock-in.
  if cfg.photo_required then
    if p_photo_path is null
       or not (p_photo_path like staff_key || '/%')
       or not exists (
         select 1 from storage.objects
         where bucket_id = 'attendance-photos' and name = p_photo_path
       ) then
      perform public._amp_record_attempt(staff_key, 'photo_required');
      return jsonb_build_object('ok', false, 'error', 'photo_required');
    end if;
  end if;

  new_flags := coalesce(rec.flags, '{}');
  scatter := public._amp_gps_scatter(p_samples);
  if scatter > greatest(100, coalesce(p_accuracy, 0) * 3) then
    new_flags := array_append(new_flags, 'gps_inconsistent_out');
  end if;
  if coalesce(p_mock_detected, false) then
    new_flags := array_append(new_flags, 'mock_location_suspected_out');
  end if;

  in_ts := coalesce(
    rec.clock_in_at,
    (rec.date || ' ' || rec.clock_in)::timestamp at time zone 'Africa/Accra'
  );
  hours := greatest(0, round((extract(epoch from now() - in_ts) / 3600.0)::numeric, 2));

  update public.hr_attendance
    set clock_out = to_char(now() at time zone 'Africa/Accra', 'HH24:MI:SS'),
        clock_out_at = now(),
        hours_worked = hours,
        clock_out_gps_lat = p_lat,
        clock_out_gps_lng = p_lng,
        clock_out_gps_accuracy = p_accuracy,
        clock_out_gps_distance = dist,
        clock_out_gps_samples = p_samples,
        clock_out_photo_path = p_photo_path,
        flags = new_flags
    where id = rec.id;

  perform public._amp_log_event(rec.id, staff_key, 'clock_out',
    jsonb_build_object('hours', hours, 'distance', dist, 'accuracy', p_accuracy,
      'scatter', scatter, 'photo', p_photo_path is not null),
    staff_key);

  perform public._amp_record_attempt(staff_key, 'ok');
  return jsonb_build_object('ok', true, 'record_id', rec.id, 'hours', hours);
end $$;

-- ─── Part 9: Public RPCs — overrides, admin actions, shifts, reads ──────────

create or replace function public.request_attendance_override(
  p_reason text,
  p_reason_note text,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric,
  p_distance numeric,
  p_device_fp text,
  p_device_label text
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  staff_rec public.staff;
  staff_key text;
  req_id text;
begin
  select * into staff_rec from public._amp_requesting_staff();
  if staff_rec.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  staff_key := staff_rec.user_id::text;
  if p_reason not in ('gps_drift', 'new_device', 'other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;
  -- one pending request at a time
  if exists (select 1 from public.attendance_override_requests
             where staff_id = staff_key and status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'already_pending');
  end if;
  req_id := 'ovr_' || extract(epoch from now())::bigint || '_' ||
            substr(md5(random()::text), 1, 6);
  insert into public.attendance_override_requests (
    id, staff_id, staff_name, reason, reason_note,
    gps_lat, gps_lng, gps_accuracy, gps_distance,
    device_fingerprint, device_label
  ) values (
    req_id, staff_key, staff_rec.name, p_reason, p_reason_note,
    p_lat, p_lng, p_accuracy, p_distance,
    p_device_fp, p_device_label
  );
  perform public._amp_log_event(null, staff_key, 'override_request',
    jsonb_build_object('override_id', req_id, 'reason', p_reason), staff_key);
  return jsonb_build_object('ok', true, 'id', req_id);
end $$;

create or replace function public.approve_attendance_override(
  p_request_id text,
  p_note text default null
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  rows_affected int;
  req record;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  update public.attendance_override_requests
    set status = 'approved', resolved_at = now(),
        resolved_by = auth.uid()::text, admin_note = p_note
    where id = p_request_id and status = 'pending'
    returning * into req;
  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  perform public._amp_log_event(null, req.staff_id, 'override_approved',
    jsonb_build_object('override_id', p_request_id, 'note', p_note), auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reject_attendance_override(
  p_request_id text,
  p_note text default null
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  rows_affected int;
  req record;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  update public.attendance_override_requests
    set status = 'rejected', resolved_at = now(),
        resolved_by = auth.uid()::text, admin_note = p_note
    where id = p_request_id and status = 'pending'
    returning * into req;
  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  perform public._amp_log_event(null, req.staff_id, 'override_rejected',
    jsonb_build_object('override_id', p_request_id, 'note', p_note), auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reset_device_binding(p_staff_id text)
returns jsonb language plpgsql security definer
set search_path = public as $$
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  update public.staff_device_bindings set reset_count = reset_count + 1
    where staff_id = p_staff_id;
  delete from public.staff_device_bindings where staff_id = p_staff_id;
  perform public._amp_log_event(null, p_staff_id, 'device_reset', '{}', auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

-- Admin correction. Replaces silent edit/delete: mandatory reason, one
-- adjustment row per changed field, full event trail. Pass null to leave a
-- field unchanged.
create or replace function public.adjust_attendance_record(
  p_record_id text,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_reason text
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  rec record;
  admin_key text;
  in_ts timestamptz;
  out_ts timestamptz;
  adj_id text;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  select * into rec from public.hr_attendance where id = p_record_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  admin_key := auth.uid()::text;
  in_ts := coalesce(p_clock_in_at, rec.clock_in_at,
    (rec.date || ' ' || rec.clock_in)::timestamp at time zone 'Africa/Accra');
  out_ts := coalesce(p_clock_out_at, rec.clock_out_at);
  if out_ts is not null and out_ts < in_ts then
    return jsonb_build_object('ok', false, 'error', 'out_before_in');
  end if;

  if p_clock_in_at is not null and p_clock_in_at is distinct from rec.clock_in_at then
    adj_id := 'adj_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
    insert into public.attendance_adjustments (id, record_id, admin_id, field, old_value, new_value, reason)
      values (adj_id, p_record_id, admin_key, 'clock_in',
              coalesce(rec.clock_in_at::text, rec.date || ' ' || rec.clock_in), p_clock_in_at::text, p_reason);
  end if;
  if p_clock_out_at is not null and p_clock_out_at is distinct from rec.clock_out_at then
    adj_id := 'adj_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
    insert into public.attendance_adjustments (id, record_id, admin_id, field, old_value, new_value, reason)
      values (adj_id, p_record_id, admin_key, 'clock_out',
              coalesce(rec.clock_out_at::text, rec.clock_out), p_clock_out_at::text, p_reason);
  end if;

  update public.hr_attendance
    set clock_in_at = in_ts,
        clock_out_at = out_ts,
        date = to_char(in_ts at time zone 'Africa/Accra', 'YYYY-MM-DD'),
        clock_in = to_char(in_ts at time zone 'Africa/Accra', 'HH24:MI:SS'),
        clock_out = case when out_ts is null then ''
                         else to_char(out_ts at time zone 'Africa/Accra', 'HH24:MI:SS') end,
        hours_worked = case when out_ts is null then 0
                            else greatest(0, round((extract(epoch from out_ts - in_ts) / 3600.0)::numeric, 2)) end,
        flags = array_append(coalesce(flags, '{}'), 'adjusted')
    where id = p_record_id;

  perform public._amp_log_event(p_record_id, rec.staff_id, 'adjustment',
    jsonb_build_object('reason', p_reason, 'clock_in_at', in_ts, 'clock_out_at', out_ts),
    admin_key);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.void_attendance_record(p_record_id text, p_reason text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  rec record;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  update public.hr_attendance
    set voided_at = now(), voided_by = auth.uid()::text, void_reason = p_reason
    where id = p_record_id and voided_at is null
    returning * into rec;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform public._amp_log_event(p_record_id, rec.staff_id, 'void',
    jsonb_build_object('reason', p_reason), auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mark_attendance_reviewed(p_record_id text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  rec record;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  update public.hr_attendance
    set reviewed_at = now(), reviewed_by = auth.uid()::text
    where id = p_record_id
    returning * into rec;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform public._amp_log_event(p_record_id, rec.staff_id, 'reviewed', '{}', auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

-- Admin manual entry (forgotten phone, kiosk outage...). Audited like
-- everything else; flagged manual_entry for payroll visibility.
create or replace function public.admin_manual_attendance(
  p_staff_id text,
  p_date date,
  p_clock_in text,
  p_clock_out text,
  p_reason text
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  target public.staff;
  in_ts timestamptz;
  out_ts timestamptz;
  hours numeric := 0;
  rec_id text;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  select * into target from public.staff where user_id::text = p_staff_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_staff');
  end if;
  in_ts := (p_date::text || ' ' || p_clock_in)::timestamp at time zone 'Africa/Accra';
  if p_clock_out is not null and p_clock_out <> '' then
    out_ts := (p_date::text || ' ' || p_clock_out)::timestamp at time zone 'Africa/Accra';
    if out_ts < in_ts then
      out_ts := out_ts + interval '1 day';  -- overnight
    end if;
    hours := greatest(0, round((extract(epoch from out_ts - in_ts) / 3600.0)::numeric, 2));
  end if;
  rec_id := 'att_' || extract(epoch from now())::bigint || '_' ||
            substr(md5(random()::text), 1, 6);
  insert into public.hr_attendance (
    id, staff_id, staff_name, date, clock_in, clock_out,
    hours_worked, status, notes, created_at, flags, clock_in_at, clock_out_at
  ) values (
    rec_id, p_staff_id, target.name,
    to_char(in_ts at time zone 'Africa/Accra', 'YYYY-MM-DD'),
    to_char(in_ts at time zone 'Africa/Accra', 'HH24:MI:SS'),
    coalesce(case when out_ts is null then null else to_char(out_ts at time zone 'Africa/Accra', 'HH24:MI:SS') end, ''),
    hours, 'present', 'Manual entry: ' || p_reason, now()::text,
    array['manual_entry'], in_ts, out_ts
  );
  perform public._amp_log_event(rec_id, p_staff_id, 'manual_entry',
    jsonb_build_object('reason', p_reason, 'date', p_date,
      'clock_in', p_clock_in, 'clock_out', p_clock_out),
    auth.uid()::text);
  return jsonb_build_object('ok', true, 'record_id', rec_id);
end $$;

-- ─── Shifts ─────────────────────────────────────────────────────────────────

create or replace function public.upsert_shift(
  p_staff_id text,
  p_weekday int,
  p_start time,
  p_end time,
  p_grace int default 10
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  sid text;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  if p_weekday < 0 or p_weekday > 6 then
    return jsonb_build_object('ok', false, 'error', 'invalid_weekday');
  end if;
  sid := 'shf_' || substr(md5(p_staff_id || ':' || p_weekday), 1, 12);
  insert into public.hr_shifts (id, staff_id, weekday, start_time, end_time, grace_minutes)
    values (sid, p_staff_id, p_weekday, p_start, p_end, coalesce(p_grace, 10))
  on conflict (staff_id, weekday) do update
    set start_time = excluded.start_time,
        end_time = excluded.end_time,
        grace_minutes = excluded.grace_minutes,
        updated_at = now();
  perform public._amp_log_event(null, p_staff_id, 'shift_change',
    jsonb_build_object('weekday', p_weekday, 'start', p_start, 'end', p_end, 'grace', p_grace),
    auth.uid()::text);
  return jsonb_build_object('ok', true, 'shift_id', sid);
end $$;

create or replace function public.delete_shift(p_shift_id text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  sh record;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  delete from public.hr_shifts where id = p_shift_id returning * into sh;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform public._amp_log_event(null, sh.staff_id, 'shift_delete',
    jsonb_build_object('weekday', sh.weekday), auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_shifts(p_staff_id text default null)
returns jsonb language sql stable security definer
set search_path = public as $$
  select case when not public._amp_is_admin()
    then jsonb_build_object('ok', false, 'error', 'not_admin')
    else jsonb_build_object('ok', true, 'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'staff_id', h.staff_id, 'weekday', h.weekday,
        'start_time', h.start_time, 'end_time', h.end_time,
        'grace_minutes', h.grace_minutes) order by h.staff_id, h.weekday)
      from public.hr_shifts h
      where p_staff_id is null or h.staff_id = p_staff_id
    ), '[]'::jsonb))
  end
$$;

-- ─── Settings ───────────────────────────────────────────────────────────────

create or replace function public.set_attendance_settings(
  p_geofence_lat numeric default null,
  p_geofence_lng numeric default null,
  p_geofence_radius_m numeric default null,
  p_max_accuracy_m numeric default null,
  p_photo_required boolean default null,
  p_long_shift_hours numeric default null,
  p_qr_window_seconds int default null,
  p_grace_minutes_default int default null
) returns jsonb language plpgsql security definer
set search_path = public as $$
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  update public.attendance_settings set
    geofence_lat = coalesce(p_geofence_lat, geofence_lat),
    geofence_lng = coalesce(p_geofence_lng, geofence_lng),
    geofence_radius_m = coalesce(p_geofence_radius_m, geofence_radius_m),
    max_accuracy_m = coalesce(p_max_accuracy_m, max_accuracy_m),
    photo_required = coalesce(p_photo_required, photo_required),
    long_shift_hours = coalesce(p_long_shift_hours, long_shift_hours),
    qr_window_seconds = coalesce(p_qr_window_seconds, qr_window_seconds),
    grace_minutes_default = coalesce(p_grace_minutes_default, grace_minutes_default),
    updated_at = now()
  where id = 1;
  perform public._amp_log_event(null, null, 'settings_change',
    jsonb_build_object('geofence_radius_m', p_geofence_radius_m,
      'photo_required', p_photo_required, 'qr_window_seconds', p_qr_window_seconds),
    auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

-- ─── Reads ──────────────────────────────────────────────────────────────────

create or replace function public.get_my_attendance(p_days int default 14)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  staff_key text;
begin
  select user_id::text into staff_key from public.staff where user_id = auth.uid() limit 1;
  if staff_key is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  return jsonb_build_object('ok', true, 'records', coalesce((
    select jsonb_agg(r order by r->>'date' desc, r->>'clock_in' desc) from (
      select jsonb_build_object(
        'id', id, 'date', date, 'clock_in', clock_in, 'clock_out', clock_out,
        'clock_in_at', clock_in_at, 'clock_out_at', clock_out_at,
        'hours_worked', hours_worked, 'status', status, 'late_minutes', late_minutes,
        'scheduled_start', scheduled_start, 'flags', flags,
        'gps_distance', gps_distance, 'clock_in_photo_path', clock_in_photo_path,
        'clock_out_photo_path', clock_out_photo_path
      ) as r
      from public.hr_attendance
      where staff_id = staff_key and voided_at is null and status <> 'init'
        and date::date >= (now() at time zone 'Africa/Accra')::date - greatest(p_days, 1)
    ) t
  ), '[]'::jsonb));
end $$;

create or replace function public.get_live_attendance()
returns jsonb language plpgsql stable security definer
set search_path = public as $$
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  return jsonb_build_object('ok', true, 'records', coalesce((
    select jsonb_agg(r order by r->>'clock_in') from (
      select jsonb_build_object(
        'id', a.id, 'staff_id', a.staff_id, 'staff_name', a.staff_name,
        'date', a.date, 'clock_in', a.clock_in, 'clock_out', a.clock_out,
        'clock_in_at', a.clock_in_at, 'hours_worked', a.hours_worked,
        'status', a.status, 'late_minutes', a.late_minutes,
        'scheduled_start', a.scheduled_start, 'flags', a.flags,
        'gps_distance', a.gps_distance, 'gps_accuracy', a.gps_accuracy,
        'clock_in_photo_path', a.clock_in_photo_path,
        'clock_out_photo_path', a.clock_out_photo_path,
        'reviewed_at', a.reviewed_at
      ) as r
      from public.hr_attendance a
      where a.voided_at is null and a.status <> 'init'
        and (
          a.date = to_char(now() at time zone 'Africa/Accra', 'YYYY-MM-DD')
          or (a.date = to_char((now() at time zone 'Africa/Accra')::date - 1, 'YYYY-MM-DD')
              and (a.clock_out is null or a.clock_out = ''))
        )
    ) t
  ), '[]'::jsonb));
end $$;

-- ─── Report (shift-aware, payroll-ready) ────────────────────────────────────

create or replace function public.get_attendance_report(p_start date, p_end date)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  totals jsonb;
  per_staff jsonb;
  daily jsonb;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  with days as (
    select generate_series(p_start, p_end, interval '1 day')::date d
  ),
  staff_list as (
    select distinct staff_id, staff_name from public.hr_attendance
      where date::date between p_start and p_end
    union
    select distinct s.user_id::text, s.name from public.staff s
      join public.hr_shifts hs on hs.staff_id = s.user_id::text
  ),
  sched as (
    select sl.staff_id, sl.staff_name, d.d,
      extract(epoch from (
        case when hs.end_time < hs.start_time
             then (hs.end_time + interval '24 hours') - hs.start_time
             else hs.end_time - hs.start_time end
      )) / 3600.0 as sched_hours
    from staff_list sl
    cross join days d
    left join public.hr_shifts hs
      on hs.staff_id = sl.staff_id and hs.weekday = extract(dow from d.d)::int
  ),
  att as (
    select staff_id, date::date d,
      sum(hours_worked) hrs,
      bool_or(status in ('present', 'late')) present,
      bool_or(status = 'late') late,
      sum(late_minutes) late_minutes,
      count(*) filter (where 'override_approved' = any(flags)) overrides,
      count(*) filter (where 'outside_geofence' = any(flags)) outside,
      count(*) filter (where cardinality(flags) > 0) flagged
    from public.hr_attendance
    where date::date between p_start and p_end
      and status <> 'init' and voided_at is null
    group by staff_id, date::date
  ),
  per_day as (
    select sc.staff_id, sc.staff_name, sc.d, sc.sched_hours,
      coalesce(att.hrs, 0) hrs, coalesce(att.present, false) present,
      coalesce(att.late, false) late, coalesce(att.late_minutes, 0) late_minutes,
      coalesce(att.overrides, 0) overrides, coalesce(att.outside, 0) outside,
      coalesce(att.flagged, 0) flagged
    from sched sc left join att on att.staff_id = sc.staff_id and att.d = sc.d
  ),
  per_staff_agg as (
    select staff_id, max(staff_name) name,
      count(*) filter (where present) days,
      round(sum(hrs)::numeric, 2) hours,
      round(coalesce(sum(sched_hours), 0)::numeric, 2) scheduled_hours,
      round(least(sum(hrs), coalesce(sum(sched_hours), 0))::numeric, 2) regular_hours,
      round(greatest(0, sum(hrs) - coalesce(sum(sched_hours), 0))::numeric, 2) overtime_hours,
      count(*) filter (where late) late,
      sum(late_minutes) late_minutes,
      count(*) filter (where sched_hours is not null and not present) absent,
      sum(overrides) overrides, sum(outside) outside, sum(flagged) flagged
    from per_day
    group by staff_id
  )
  select
    jsonb_build_object(
      'hours', coalesce(round(sum(hrs)::numeric, 1), 0),
      'scheduled_hours', coalesce(round(sum(sched_hours)::numeric, 1), 0),
      'present_days', count(*) filter (where present),
      'late', count(*) filter (where late),
      'late_minutes', coalesce(sum(late_minutes), 0),
      'absent', count(*) filter (where sched_hours is not null and not present),
      'overrides', coalesce(sum(overrides), 0),
      'outside_geofence', coalesce(sum(outside), 0),
      'flagged', coalesce(sum(flagged), 0)
    ),
    coalesce((select jsonb_agg(jsonb_build_object(
        'staff_id', staff_id, 'name', name, 'days', days, 'hours', hours,
        'scheduled_hours', scheduled_hours, 'regular_hours', regular_hours,
        'overtime_hours', overtime_hours, 'late', late, 'late_minutes', late_minutes,
        'absent', absent, 'overrides', overrides, 'outside_geofence', outside,
        'flagged', flagged
      ) order by name) from per_staff_agg), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'date', d, 'count', cnt, 'hours', hrs
      ) order by d) from (
        select d, count(*) filter (where present) cnt, round(sum(hrs)::numeric, 1) hrs
        from per_day group by d
      ) dd), '[]'::jsonb)
  into totals, per_staff, daily
  from per_day;

  return jsonb_build_object('ok', true, 'totals', totals, 'per_staff', per_staff, 'daily', daily);
end $$;

-- ─── Part 10: Grants ────────────────────────────────────────────────────────
-- Strip the default EXECUTE-to-PUBLIC from every attendance-related function
-- (including any v2 leftovers), then grant only the public API, only to
-- authenticated users. Internal _amp_* helpers get no client grant at all.

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

grant execute on function public.get_clock_token() to authenticated;
grant execute on function public.clock_in_attendance(text, numeric, numeric, numeric, jsonb, boolean, text, text, text, text) to authenticated;
grant execute on function public.clock_out_attendance(text, numeric, numeric, numeric, jsonb, boolean, text) to authenticated;
grant execute on function public.request_attendance_override(text, text, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.approve_attendance_override(text, text) to authenticated;
grant execute on function public.reject_attendance_override(text, text) to authenticated;
grant execute on function public.reset_device_binding(text) to authenticated;
grant execute on function public.adjust_attendance_record(text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.void_attendance_record(text, text) to authenticated;
grant execute on function public.mark_attendance_reviewed(text) to authenticated;
grant execute on function public.admin_manual_attendance(text, date, text, text, text) to authenticated;
grant execute on function public.get_my_attendance(int) to authenticated;
grant execute on function public.get_live_attendance() to authenticated;
grant execute on function public.get_attendance_report(date, date) to authenticated;
grant execute on function public.upsert_shift(text, int, time, time, int) to authenticated;
grant execute on function public.delete_shift(text) to authenticated;
grant execute on function public.get_shifts(text) to authenticated;
grant execute on function public.set_attendance_settings(numeric, numeric, numeric, numeric, boolean, numeric, int, int) to authenticated;
grant execute on function public.validate_clock_token(text) to authenticated;

-- ─── Part 11: Privilege-escalation guard ────────────────────────────────────
-- Every v3 admin check reads staff.role. Without this, any authenticated
-- session could self-promote via PostgREST (Supabase grants table-level UPDATE
-- on public.* by default) and approve their own overrides. Column-level
-- revoke closes it while leaving legitimate name/phone edits working.
-- Role changes go through the admin-checked RPC below (mirrors the client-side
-- rules in rbac.ts: admins cannot grant owner; owners can grant anything).

revoke update (role, user_id) on public.staff from anon, authenticated;

create or replace function public.set_staff_role(p_staff_uuid uuid, p_role text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  caller_role text;
  target record;
begin
  select role into caller_role from public.staff where user_id = auth.uid() limit 1;
  if caller_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  if p_role not in ('staff', 'manager', 'admin', 'owner') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;
  -- admins cannot grant or revoke owner
  if caller_role = 'admin' then
    if p_role = 'owner' then
      return jsonb_build_object('ok', false, 'error', 'owner_role_reserved');
    end if;
    if exists (select 1 from public.staff where id = p_staff_uuid and role = 'owner') then
      return jsonb_build_object('ok', false, 'error', 'owner_role_reserved');
    end if;
  end if;
  update public.staff set role = p_role where id = p_staff_uuid
    returning id, user_id, name into target;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform public._amp_log_event(null, target.user_id::text, 'role_change',
    jsonb_build_object('staff_uuid', p_staff_uuid, 'new_role', p_role), auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.set_staff_role(uuid, text) from public, anon, authenticated;
grant execute on function public.set_staff_role(uuid, text) to authenticated;
