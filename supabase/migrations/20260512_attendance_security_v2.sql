-- Attendance Security v2
-- Adds device binding, override request flow, server-authoritative clock-in,
-- and server-aggregated reporting. Additive only; no data migration required.
--
-- Important: This codebase uses snake_case columns at the DB layer; the
-- supabase-wrapper.ts translates to/from camelCase for the TS API. All new
-- columns and tables below stay in snake_case.
--
-- Plan: docs/superpowers/plans/2026-05-12-attendance-security-redesign.md
-- Spec: docs/superpowers/specs/2026-05-12-attendance-security-redesign.md

-- ─── Part 1: Schema additions ─────────────────────────────────────────────────

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
  add column if not exists flags text[] not null default '{}';

create index if not exists hr_attendance_date_idx
  on public.hr_attendance (date desc);

create index if not exists hr_attendance_staff_date_idx
  on public.hr_attendance (staff_id, date desc);

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

create index if not exists override_status_idx
  on public.attendance_override_requests (status, requested_at desc);

create index if not exists override_staff_idx
  on public.attendance_override_requests (staff_id, requested_at desc);

-- Realtime publication. Wrapped in DO block so re-running doesn't fail when
-- a table is already in the publication.
do $$
begin
  begin
    alter publication supabase_realtime add table public.staff_device_bindings;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.attendance_override_requests;
  exception when duplicate_object then null;
  end;
end $$;

-- ─── Part 2: RPCs ─────────────────────────────────────────────────────────────

-- Hotel constants. Single source of truth; client-side `MAX_DISTANCE_METERS_V2`
-- in attendance-service.ts must match `radius`.
create or replace function public._amp_hotel()
returns table (lat numeric, lng numeric, radius numeric)
language sql immutable as $$
  select 6.7127::numeric, -1.6250::numeric, 150::numeric
$$;

-- Haversine distance in metres.
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

-- Token validation — mirrors client logic so server is authoritative.
create or replace function public.validate_clock_token(p_token text)
returns boolean language plpgsql stable security definer as $$
declare
  decoded text;
  w bigint;
  current_w bigint;
begin
  begin
    decoded := convert_from(decode(p_token, 'base64'), 'UTF8');
    w := decoded::bigint;
  exception when others then
    return false;
  end;
  current_w := floor(extract(epoch from now()) / 600)::bigint;
  return w = current_w or w = current_w - 1;
end $$;

-- Atomic clock-in: validates token + geofence + device binding, writes record.
create or replace function public.clock_in_attendance(
  p_token text,
  p_staff_id text,
  p_staff_name text,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric,
  p_samples jsonb,
  p_device_fp text,
  p_device_label text,
  p_override_request_id text default null
) returns jsonb language plpgsql security definer as $$
declare
  hotel record;
  dist numeric;
  effective_dist numeric;
  binding record;
  override_rec record;
  rec_id text;
  flags_arr text[] := '{}';
  rec_status text := 'present';
  override_approved boolean := false;
begin
  -- 1. Token
  if not public.validate_clock_token(p_token) then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- 2. Resolve override if provided
  if p_override_request_id is not null then
    select * into override_rec
      from public.attendance_override_requests
      where id = p_override_request_id
        and staff_id = p_staff_id
        and status = 'approved'
        and resolved_at > now() - interval '15 minutes';
    if found then
      override_approved := true;
      flags_arr := array_append(flags_arr, 'override_approved');
    end if;
  end if;

  -- 3. Geofence
  select * into hotel from public._amp_hotel();
  if p_lat is null or p_lng is null then
    dist := null;
    if not override_approved then
      return jsonb_build_object('ok', false, 'error', 'no_location');
    end if;
    flags_arr := array_append(flags_arr, 'no_location');
  else
    dist := public._amp_haversine(p_lat, p_lng, hotel.lat, hotel.lng);
    effective_dist := greatest(0, dist - coalesce(p_accuracy, 0));
    if effective_dist > hotel.radius and not override_approved then
      return jsonb_build_object(
        'ok', false, 'error', 'outside_geofence',
        'distance', dist, 'accuracy', p_accuracy
      );
    end if;
    if effective_dist > hotel.radius then
      flags_arr := array_append(flags_arr, 'outside_geofence');
    end if;
    if coalesce(p_accuracy, 0) > 100 then
      flags_arr := array_append(flags_arr, 'low_gps_accuracy');
    end if;
  end if;

  -- 4. Device binding
  select * into binding from public.staff_device_bindings where staff_id = p_staff_id;
  if not found then
    insert into public.staff_device_bindings
      (staff_id, device_fingerprint, device_label, bound_at, last_used_at)
      values (p_staff_id, p_device_fp, p_device_label, now(), now());
    flags_arr := array_append(flags_arr, 'device_first_bind');
  elsif binding.device_fingerprint <> p_device_fp then
    if not override_approved then
      return jsonb_build_object('ok', false, 'error', 'device_mismatch');
    end if;
    flags_arr := array_append(flags_arr, 'device_mismatch');
  else
    update public.staff_device_bindings
      set last_used_at = now()
      where staff_id = p_staff_id;
  end if;

  -- 5. Late detection (after 09:00 Africa/Accra)
  if extract(hour from (now() at time zone 'Africa/Accra')) >= 9 then
    rec_status := 'late';
  end if;

  -- 6. Insert record
  rec_id := 'att_' || extract(epoch from now())::bigint || '_' ||
            substr(md5(random()::text), 1, 6);

  insert into public.hr_attendance (
    id, staff_id, staff_name, date, clock_in, clock_out,
    hours_worked, status, notes, created_at,
    device_fingerprint, gps_lat, gps_lng, gps_accuracy, gps_distance, gps_samples,
    override_reason, override_requested_at, override_approved_by,
    override_approved_at, flags
  ) values (
    rec_id,
    p_staff_id,
    p_staff_name,
    to_char(now() at time zone 'Africa/Accra', 'YYYY-MM-DD'),
    to_char(now() at time zone 'Africa/Accra', 'HH24:MI:SS'),
    '',
    0,
    rec_status,
    case
      when dist is null then 'GPS: unavailable'
      else 'Within hotel (' || round(dist) || ' m)'
    end,
    now()::text,
    p_device_fp, p_lat, p_lng, p_accuracy, dist, p_samples,
    case when override_approved then override_rec.reason else null end,
    case when override_approved then override_rec.requested_at else null end,
    case when override_approved then override_rec.resolved_by else null end,
    case when override_approved then override_rec.resolved_at else null end,
    flags_arr
  );

  -- 7. Burn override
  if override_approved then
    update public.attendance_override_requests
      set status = 'consumed'
      where id = p_override_request_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'record_id', rec_id, 'flags', flags_arr, 'distance', dist
  );
end $$;

-- Clock-out — finds newest open record (today or yesterday for overnight).
create or replace function public.clock_out_attendance(
  p_token text,
  p_staff_id text
) returns jsonb language plpgsql security definer as $$
declare
  rec record;
  in_sec int;
  out_sec int;
  hours numeric;
  is_next_day boolean;
begin
  if not public.validate_clock_token(p_token) then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select * into rec from public.hr_attendance
    where staff_id = p_staff_id
      and (clock_out is null or clock_out = '')
      and status <> 'init'
      and date::date >= ((now() at time zone 'Africa/Accra')::date - 1)
    order by date desc, clock_in desc
    limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_open_record');
  end if;

  is_next_day := rec.date <> to_char(now() at time zone 'Africa/Accra', 'YYYY-MM-DD');
  in_sec := extract(epoch from rec.clock_in::time);
  out_sec := extract(epoch from (now() at time zone 'Africa/Accra')::time)
           + case when is_next_day then 86400 else 0 end;
  hours := greatest(0, (out_sec - in_sec) / 3600.0);

  update public.hr_attendance
    set clock_out = to_char(now() at time zone 'Africa/Accra', 'HH24:MI:SS'),
        hours_worked = round(hours::numeric, 2)
    where id = rec.id;

  return jsonb_build_object(
    'ok', true, 'record_id', rec.id, 'hours', round(hours::numeric, 2)
  );
end $$;

-- Override request lifecycle
create or replace function public.request_attendance_override(
  p_staff_id text,
  p_staff_name text,
  p_reason text,
  p_reason_note text,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric,
  p_distance numeric,
  p_device_fp text,
  p_device_label text
) returns jsonb language plpgsql security definer as $$
declare
  req_id text;
begin
  req_id := 'ovr_' || extract(epoch from now())::bigint || '_' ||
            substr(md5(random()::text), 1, 6);
  insert into public.attendance_override_requests (
    id, staff_id, staff_name, reason, reason_note,
    gps_lat, gps_lng, gps_accuracy, gps_distance,
    device_fingerprint, device_label
  ) values (
    req_id, p_staff_id, p_staff_name, p_reason, p_reason_note,
    p_lat, p_lng, p_accuracy, p_distance,
    p_device_fp, p_device_label
  );
  return jsonb_build_object('ok', true, 'id', req_id);
end $$;

create or replace function public.approve_attendance_override(
  p_request_id text,
  p_admin_id text,
  p_note text default null
) returns jsonb language plpgsql security definer as $$
declare rows_affected int;
begin
  update public.attendance_override_requests
    set status = 'approved',
        resolved_at = now(),
        resolved_by = p_admin_id,
        admin_note = p_note
    where id = p_request_id and status = 'pending';
  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reject_attendance_override(
  p_request_id text,
  p_admin_id text,
  p_note text default null
) returns jsonb language plpgsql security definer as $$
declare rows_affected int;
begin
  update public.attendance_override_requests
    set status = 'rejected',
        resolved_at = now(),
        resolved_by = p_admin_id,
        admin_note = p_note
    where id = p_request_id and status = 'pending';
  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reset_device_binding(
  p_staff_id text,
  p_admin_id text
) returns jsonb language plpgsql security definer as $$
begin
  -- Bump reset_count audit before deleting (no-op if missing)
  update public.staff_device_bindings
    set reset_count = reset_count + 1
    where staff_id = p_staff_id;
  delete from public.staff_device_bindings where staff_id = p_staff_id;
  return jsonb_build_object('ok', true, 'reset_by', p_admin_id);
end $$;

-- Server-aggregated report. Uses the date column (text 'YYYY-MM-DD') and casts
-- to date for range filtering.
create or replace function public.get_attendance_report(
  p_start date,
  p_end date
) returns jsonb language plpgsql stable security definer as $$
declare
  totals jsonb;
  per_staff jsonb;
  daily jsonb;
begin
  select jsonb_build_object(
    'hours', coalesce(round(sum(hours_worked)::numeric, 1), 0),
    'present_days', count(*) filter (where status in ('present', 'late')),
    'late', count(*) filter (where status = 'late'),
    'absent', count(*) filter (where status = 'absent'),
    'overrides', count(*) filter (where 'override_approved' = any(flags)),
    'outside_geofence', count(*) filter (where 'outside_geofence' = any(flags))
  ) into totals
    from public.hr_attendance
    where date::date between p_start and p_end and status <> 'init';

  select coalesce(jsonb_agg(s order by s->>'name'), '[]'::jsonb) into per_staff
    from (
      select jsonb_build_object(
        'staff_id', staff_id,
        'name', staff_name,
        'days', count(*) filter (where status in ('present', 'late')),
        'hours', round(coalesce(sum(hours_worked),0)::numeric, 1),
        'late', count(*) filter (where status = 'late'),
        'avg_per_day', round(
          coalesce(sum(hours_worked),0)::numeric
          / nullif(count(*) filter (where status in ('present', 'late')), 0),
          1
        )
      ) as s
      from public.hr_attendance
      where date::date between p_start and p_end and status <> 'init'
      group by staff_id, staff_name
    ) t;

  select coalesce(jsonb_agg(d order by d->>'date'), '[]'::jsonb) into daily
    from (
      select jsonb_build_object(
        'date', date,
        'count', count(*) filter (where status in ('present', 'late')),
        'hours', round(coalesce(sum(hours_worked),0)::numeric, 1)
      ) as d
      from public.hr_attendance
      where date::date between p_start and p_end and status <> 'init'
      group by date
    ) t;

  return jsonb_build_object('totals', totals, 'per_staff', per_staff, 'daily', daily);
end $$;
