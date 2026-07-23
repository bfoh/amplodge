-- ────────────────────────────────────────────────────────────────────────────
-- Attendance v3.1 — PROTOTYPE: per-scan single-use clock nonces
-- ────────────────────────────────────────────────────────────────────────────
--
-- WHY: v3's QR token is a pure function of time + a shared secret
--   (validate_clock_token in 20260721_attendance_v3.sql). Every staff member
--   sees the SAME code and it stays server-valid for 60–120s. That makes the
--   "presence proof" relayable in real time: photograph the entrance QR, send
--   the /staff/clock?t=... URL over WhatsApp, and a colleague clocks in from
--   anywhere (GPS is client-supplied and spoofable). Broadcasting the rolling
--   code to a group chat scales that to unlimited remote clock-ins.
--
-- FIX (this migration): replace the time-window HMAC token with a nonce that is
--   (a) random and unguessable, (b) SINGLE-USE, and (c) short-TTL. Single-use
--   kills broadcast/replay — the first successful scan burns it. Short TTL kills
--   slow relay — by the time the URL reaches a chat it has expired.
--
-- STRATEGY: the nonce rides in the existing `p_token` parameter and is minted
--   by a new admin RPC. `validate_clock_token` is repurposed from HMAC verify
--   to an atomic single-use claim; a companion `_amp_peek_nonce` does a
--   non-consuming validity check. The two clock RPCs are redefined (section 6)
--   to PEEK early and BURN late — the nonce is consumed only as the last gate
--   before the row write (consume-on-success). `mint_clock_nonce` returns the
--   same JSON shape as `get_clock_token` {ok, token, expires_in}, so the client
--   change is one line (point the kiosk at mint_clock_nonce; QR URL unchanged).
--
-- SCOPE / KNOWN PROTOTYPE LIMITATIONS (see NOTES at bottom):
--   * Consume-on-success is TOCTOU by design: peek early, burn late. The burn
--     is the authoritative gate, so correctness holds — a nonce-race loser
--     writes nothing and simply rescans.
--   * mint_clock_nonce is still admin-only, so the kiosk still needs an admin
--     session. The device-scoped kiosk credential is a separate follow-up
--     (NOTES #2). This migration only closes the relay/broadcast hole.
--   * GPS remains client-supplied — the nonce does not fix location spoofing.
--     That needs a server-observed presence signal (LAN/BLE/reverse-proxy IP),
--     NOTES #3.
--
-- Apply via the Supabase SQL editor after 20260721 + 20260723. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

-- ─── 1. Settings: nonce lifetime + reuse budget ─────────────────────────────
-- nonce_ttl_seconds : how long a minted nonce stays claimable. Keep it short
--   (relay resistance) but above worst-case camera-focus + round-trip latency.
-- nonce_max_uses    : successful claims allowed per nonce. 1 = strict single-use
--   (best relay resistance; simultaneous scanners of the same frame collide and
--   the loser rescans). Raise ONLY if a busy shared screen needs throughput —
--   every extra use is an extra relay opportunity. Pair a raise with a shorter
--   TTL and a faster kiosk rotation.
alter table public.attendance_settings
  add column if not exists nonce_ttl_seconds int not null default 15,
  add column if not exists nonce_max_uses    int not null default 1;

-- ─── 2. Nonce store ─────────────────────────────────────────────────────────
-- No RLS policies and no grants => zero direct client access. Only the
-- security-definer mint/consume RPCs below ever touch this table, exactly like
-- attendance_secrets in v3.
create table if not exists public.clock_nonces (
  id           text primary key default encode(gen_random_bytes(16), 'hex'),
  minted_by    uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  max_uses     int not null default 1,
  uses         int not null default 0,
  last_used_at timestamptz,
  last_used_by uuid
);
create index if not exists clock_nonces_expiry_idx on public.clock_nonces (expires_at);

alter table public.clock_nonces enable row level security;
revoke all on public.clock_nonces from anon, authenticated;

-- ─── 3. Mint (kiosk) ────────────────────────────────────────────────────────
-- Admin-only for now (kiosk runs an admin session, same as get_clock_token).
-- Returns the same {ok, token, expires_in} shape as get_clock_token so the
-- kiosk hook maps it unchanged.
create or replace function public.mint_clock_nonce()
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  ttl  int;
  muse int;
  nid  text;
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select nonce_ttl_seconds, nonce_max_uses
    into ttl, muse
    from public.attendance_settings where id = 1;
  ttl  := coalesce(ttl, 15);
  muse := greatest(1, coalesce(muse, 1));

  -- Lazy GC: drop nonces long past expiry so the table stays small.
  delete from public.clock_nonces where expires_at < now() - interval '2 minutes';

  nid := encode(gen_random_bytes(16), 'hex');
  insert into public.clock_nonces (id, minted_by, expires_at, max_uses)
    values (nid, auth.uid(), now() + make_interval(secs => ttl), muse);

  return jsonb_build_object('ok', true, 'token', nid, 'expires_in', ttl);
end $$;

-- ─── 4. Consume — redefine validate_clock_token as an atomic single-use claim ─
-- v3's version was STABLE and HMAC-verified a time window. This one is VOLATILE
-- and claims a nonce row in a single UPDATE. The UPDATE takes a row lock, so
-- concurrent scanners of the same nonce serialize and only `max_uses` of them
-- observe a claim — race-safe without an advisory lock.
--
-- clock_in_attendance / clock_out_attendance already call
-- `public.validate_clock_token(p_token)`; because they are SECURITY DEFINER and
-- own-schema, they keep EXECUTE even after we drop the client grant below.
create or replace function public.validate_clock_token(p_token text)
returns boolean language plpgsql volatile security definer
set search_path = public as $$
declare
  claimed boolean := false;
begin
  if p_token is null or p_token = '' then
    return false;
  end if;

  update public.clock_nonces
     set uses         = uses + 1,
         last_used_at = now(),
         last_used_by = auth.uid()
   where id = p_token
     and expires_at > now()
     and uses < max_uses
  returning true into claimed;

  return coalesce(claimed, false);
end $$;

-- ─── 4b. Peek — non-consuming validity check ────────────────────────────────
-- Used early in clock_in/out to fast-reject a bad/expired/spent nonce WITHOUT
-- burning it. The authoritative single-use burn is validate_clock_token above,
-- called as the last gate before the write (consume-on-success). Peek is a
-- STABLE read; racing peeks are fine — the burn is the real gate.
create or replace function public._amp_peek_nonce(p_token text)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists(
    select 1 from public.clock_nonces
    where id = p_token and expires_at > now() and uses < max_uses
  )
$$;

-- ─── 5. Grants ──────────────────────────────────────────────────────────────
-- Nonce consumption must NOT be a client-callable primitive: if authenticated
-- could call validate_clock_token directly it could burn everyone's live
-- nonces (griefing / denial of clock-in). v3 granted it to authenticated
-- (Part 10) — revoke that. Only the clock RPCs consume it, internally.
revoke execute on function public.validate_clock_token(text) from public, anon, authenticated;
revoke execute on function public._amp_peek_nonce(text)       from public, anon, authenticated;
grant  execute on function public.mint_clock_nonce()          to authenticated;

-- get_clock_token (v3 HMAC minter) is now dead weight — its tokens no longer
-- validate. Leave it callable but neutralize it so a stale kiosk build can't
-- display codes the server will always reject.
create or replace function public.get_clock_token()
returns jsonb language plpgsql security definer
set search_path = public as $$
begin
  if not public._amp_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  -- Superseded by mint_clock_nonce (20260724). Kept for signature stability.
  return jsonb_build_object('ok', false, 'error', 'deprecated_use_mint_clock_nonce');
end $$;

-- ─── 6. Consume-on-success: redefine the two clock RPCs ─────────────────────
-- These are byte-for-byte the v3 bodies (20260721 Part 8) with exactly two
-- surgical changes each:
--   * step 3 / early token check  ->  _amp_peek_nonce (non-consuming)
--   * a new burn gate immediately before the row write  ->  validate_clock_token
-- Placing the burn last means any earlier rejection (geofence, accuracy, photo,
-- device_mismatch, duplicate) returns WITHOUT spending the nonce, and the burn
-- gates the write so a nonce-race loser never leaves a written row.

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

  -- 3. Nonce validity — PEEK ONLY (consume-on-success; burned at step 10.5).
  if not public._amp_peek_nonce(p_token) then
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

  -- 10.5 Burn the nonce — LAST gate before the write. Single-use atomic claim.
  --      Reached only after every rejection above passed, so a failed scan
  --      never spends it; and it gates the insert, so a race loser writes
  --      nothing. Losing the race here => rescan the current QR.
  if not public.validate_clock_token(p_token) then
    perform public._amp_record_attempt(staff_key, 'invalid_token');
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
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
  -- Nonce validity — PEEK ONLY; burned just before the update below.
  if not public._amp_peek_nonce(p_token) then
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

  -- Burn the nonce — LAST gate before the write (consume-on-success). Race
  -- loser writes nothing and rescans.
  if not public.validate_clock_token(p_token) then
    perform public._amp_record_attempt(staff_key, 'invalid_token');
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

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

-- Re-grant the two redefined RPCs (create-or-replace preserves grants, but be
-- explicit in case a prior drop cleared them).
grant execute on function public.clock_in_attendance(text, numeric, numeric, numeric, jsonb, boolean, text, text, text, text) to authenticated;
grant execute on function public.clock_out_attendance(text, numeric, numeric, numeric, jsonb, boolean, text) to authenticated;

-- ─── NOTES / follow-ups (not in this prototype) ─────────────────────────────
-- 1. [DONE in section 6] Consume-on-success — nonce is burned only as the last
--    gate before the write, so a legit scan that fails geofence/photo/device
--    never wastes it, and a nonce-race loser leaves no partial row.
-- 2. Device-scoped kiosk credential: add a `clock_kiosks(id, key_hash, label,
--    active)` table and `mint_clock_nonce_kiosk(p_kiosk_key text)` callable by
--    anon, verifying the hashed key. Removes the permanent-admin-session risk
--    on the reception screen. Rotate/revoke keys per device.
-- 3. Server-observed presence to replace client GPS: bind mint to the lodge
--    LAN egress IP (check x-forwarded-for at the edge) or a BLE beacon token,
--    so the nonce can only originate on-site.
-- 4. Optional hardening: store only a hash of the nonce id (like a password),
--    and add a per-staff consume rate limit reusing _amp_record_attempt.
