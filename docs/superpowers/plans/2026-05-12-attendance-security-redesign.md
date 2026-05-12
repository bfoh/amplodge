# Attendance Security & Reporting Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden staff clock-in/out with server-side token validation, accuracy-aware geofence enforcement, per-staff device binding, real-time override approvals, and add weekly / monthly / quarterly / yearly admin reports — preserving every existing surface (QR URL, table records, CSV export, manual logging, other HR tabs).

**Architecture:** Layered/additive. New Supabase migration adds nullable columns to `hr_attendance` + two new tables (`staff_device_bindings`, `attendance_override_requests`). New RPCs (`security definer`) own the authoritative clock-in/out path. Client gets new helper modules (`device-fingerprint.ts`, extended `attendance-service.ts`) and two new admin components (`OverridePanel.tsx`, `ReportsPanel.tsx`). `ClockPage.tsx` rewritten around a state machine that maps RPC error codes to specific UI states. Old client functions and old record shapes stay intact for backward compatibility.

**Tech Stack:** React 18 + Vite, TypeScript 5.8, Supabase (Postgres + RPCs), `qrcode.react`, `sonner` toasts, `lucide-react`, Tailwind, shadcn/ui Radix primitives, `date-fns`. No new dependencies.

**Repo state at plan time:**
- Branch: `feat/attendance-security-redesign` (already cut from `main`, spec committed)
- Spec: `docs/superpowers/specs/2026-05-12-attendance-security-redesign.md`
- No unit test framework configured. Verification = `npm run lint:types`, `npm run build`, and manual QA per task.

**Recon-verified facts:**
- `hr_attendance` table accessed via `db.hr_attendance.list/create/update/delete` wrapper (`src/lib/db.ts:61`).
- No existing Supabase migration creates `hr_attendance` — table likely created out-of-band; migration here only ALTERs.
- Hotel coords: lat `6.7127`, lng `-1.6250`, current radius `500m` (`attendance-service.ts:48-58`).
- Token: base64(`floor(Date.now() / (10 * 60 * 1000))`); validated client-side via `current` or `current-1` window.
- QR URL: `${origin}/staff/clock?t=<token>` — must remain identical.
- `useStaffRole()` returns `{ userId, staffRecord, role, isLoading }`.
- `useSubscription(table)` returns a value that bumps when realtime fires for that table.
- ClockPage route: `/staff/clock?t=TOKEN`, full-screen, no sidebar.
- HRPage `AttendanceTab` panel order today: QR → LiveNow → Stats → Records table.

---

## File Structure

### Files Created

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260512_attendance_security_v2.sql` | Schema additions: nullable columns on `hr_attendance`, new tables `staff_device_bindings` and `attendance_override_requests`, indexes, and all RPCs. Idempotent. |
| `src/services/device-fingerprint.ts` | `getDeviceFingerprint(): Promise<{ fp, label }>` — composite SHA-256 hash with persisted salt. |
| `src/components/hr/OverridePanel.tsx` | Admin panel showing pending override requests with approve/reject. Auto-hides when empty. Realtime via `useSubscription`. |
| `src/components/hr/ReportsPanel.tsx` | Day/week/month/quarter/year/custom range reports with summary cards + per-staff table + CSV export. |

### Files Modified

| Path | Change |
|---|---|
| `src/services/attendance-service.ts` | Add `clockInServer`, `clockOutServer`, `resolveLocationMultiSample`, `requestOverride`, `subscribeToOverrideRequest`, `approveOverride`, `rejectOverride`, `resetDeviceBinding`, `getAttendanceReport`. Keep all existing exports untouched. |
| `src/pages/staff/ClockPage.tsx` | Rewrite to state-machine driven, server-RPC-backed flow with override UI. Visual feel preserved. |
| `src/pages/staff/HRPage.tsx` | In `AttendanceTab`, render `<OverridePanel />` after `<QRPanel />` and `<ReportsPanel />` after `<LiveNowPanel />`. Add `Device` and `Flags` columns to desktop table; mirror in mobile cards. |
| `src/lib/db.ts` | Add `staff_device_bindings` and `attendance_override_requests` to `TypedDB`. |

### Files Deleted

None.

---

## Task 1: Confirm baseline

**Files:** none (git ops + sanity)

- [ ] **Step 1: Confirm branch + clean tree**

```bash
cd /Users/ebenezerbarning/Desktop/projectamp/amplodge
git status --short
git rev-parse --abbrev-ref HEAD
```

Expected: clean tree (or only the committed spec), branch = `feat/attendance-security-redesign`.

- [ ] **Step 2: Confirm baseline lint + build pass**

```bash
npm run lint:types
npm run build
```

Expected: both succeed. If they fail, fix infra issues before proceeding (not part of this feature).

- [ ] **Step 3: No commit needed** — baseline already pinned by spec commit.

---

## Task 2: Migration — schema additions + indexes

**Files:**
- Create: `supabase/migrations/20260512_attendance_security_v2.sql`

- [ ] **Step 1: Write migration (schema part only — RPCs land in Task 3)**

```sql
-- supabase/migrations/20260512_attendance_security_v2.sql
-- Part 1: Schema additions. Additive only; no data movement.

-- ─── hr_attendance: new nullable columns ───────────────────────────────
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

-- ─── staff_device_bindings ─────────────────────────────────────────────
create table if not exists public.staff_device_bindings (
  staff_id text primary key,
  device_fingerprint text not null,
  device_label text,
  bound_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  reset_count int not null default 0
);

-- ─── attendance_override_requests ──────────────────────────────────────
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

-- Enable realtime for new tables (matches existing pattern)
alter publication supabase_realtime add table public.staff_device_bindings;
alter publication supabase_realtime add table public.attendance_override_requests;
```

- [ ] **Step 2: Apply locally**

```bash
# Apply via Supabase CLI if available; otherwise paste into Supabase SQL editor for the project.
npx supabase db push 2>/dev/null || echo "Supabase CLI not linked; apply manually in SQL editor"
```

Expected: success, or run manually. Note: `alter publication ... add table` may fail with `relation already in publication` — that's OK; rerun without those two lines if needed.

- [ ] **Step 3: Verify schema**

```bash
# In Supabase SQL editor:
# select column_name from information_schema.columns where table_name='hr_attendance' order by 1;
# Expect: clockIn, clockOut, createdAt, date, device_fingerprint, flags, gps_accuracy,
#         gps_distance, gps_lat, gps_lng, gps_samples, hoursWorked, id, notes,
#         override_approved_at, override_approved_by, override_reason,
#         override_requested_at, staffId, staffName, status
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260512_attendance_security_v2.sql
git commit -m "feat(attendance): add schema for device binding + override requests"
```

---

## Task 3: RPCs — server-side enforcement

**Files:**
- Modify: `supabase/migrations/20260512_attendance_security_v2.sql` (append RPC definitions)

- [ ] **Step 1: Append RPCs to the migration file**

Append the following SQL to `supabase/migrations/20260512_attendance_security_v2.sql`:

```sql
-- ─── Part 2: RPCs ──────────────────────────────────────────────────────

-- Constants packaged as a tiny helper view
create or replace function public._amp_hotel() returns table (lat numeric, lng numeric, radius numeric)
language sql immutable as $$
  select 6.7127::numeric, -1.6250::numeric, 150::numeric
$$;

-- Haversine distance in metres (server-authoritative)
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

-- Token validation — mirrors client logic, single source of truth on server.
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
  status text := 'present';
  override_approved boolean := false;
begin
  -- 1. Token check
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

  -- 3. Geofence check (skip if override approved)
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

  -- 4. Device binding check
  select * into binding from public.staff_device_bindings where staff_id = p_staff_id;
  if not found then
    -- First-time clock for this staff → bind
    insert into public.staff_device_bindings (staff_id, device_fingerprint, device_label, bound_at, last_used_at)
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

  -- 5. Late detection (after 09:00 local)
  if extract(hour from now() at time zone 'Africa/Accra') >= 9 then
    status := 'late';
  end if;

  -- 6. Insert attendance record
  rec_id := 'att_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);

  insert into public.hr_attendance (
    id, "staffId", "staffName", date, "clockIn", "clockOut",
    "hoursWorked", status, notes, "createdAt",
    device_fingerprint, gps_lat, gps_lng, gps_accuracy, gps_distance, gps_samples,
    override_reason, override_requested_at, override_approved_by, override_approved_at, flags
  ) values (
    rec_id,
    p_staff_id,
    p_staff_name,
    to_char(now() at time zone 'Africa/Accra', 'YYYY-MM-DD'),
    to_char(now() at time zone 'Africa/Accra', 'HH24:MI:SS'),
    '',
    0,
    status,
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

  -- 7. Burn override so it can't be reused
  if override_approved then
    update public.attendance_override_requests
      set status = 'consumed'
      where id = p_override_request_id;
  end if;

  return jsonb_build_object('ok', true, 'record_id', rec_id, 'flags', flags_arr, 'distance', dist);
end $$;

-- Clock-out
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

  -- Find newest open record (today or yesterday for overnight shifts)
  select * into rec from public.hr_attendance
    where "staffId" = p_staff_id
      and ("clockOut" is null or "clockOut" = '')
      and status <> 'init'
      and date >= to_char((now() at time zone 'Africa/Accra')::date - 1, 'YYYY-MM-DD')
    order by date desc, "clockIn" desc
    limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_open_record');
  end if;

  is_next_day := rec.date <> to_char(now() at time zone 'Africa/Accra', 'YYYY-MM-DD');
  in_sec := extract(epoch from rec."clockIn"::time);
  out_sec := extract(epoch from (now() at time zone 'Africa/Accra')::time)
           + case when is_next_day then 86400 else 0 end;
  hours := greatest(0, (out_sec - in_sec) / 3600.0);

  update public.hr_attendance
    set "clockOut" = to_char(now() at time zone 'Africa/Accra', 'HH24:MI:SS'),
        "hoursWorked" = round(hours::numeric, 2)
    where id = rec.id;

  return jsonb_build_object('ok', true, 'record_id', rec.id, 'hours', round(hours::numeric, 2));
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
  req_id := 'ovr_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
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
begin
  update public.attendance_override_requests
    set status = 'approved',
        resolved_at = now(),
        resolved_by = p_admin_id,
        admin_note = p_note
    where id = p_request_id and status = 'pending';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reject_attendance_override(
  p_request_id text,
  p_admin_id text,
  p_note text default null
) returns jsonb language plpgsql security definer as $$
begin
  update public.attendance_override_requests
    set status = 'rejected',
        resolved_at = now(),
        resolved_by = p_admin_id,
        admin_note = p_note
    where id = p_request_id and status = 'pending';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reset_device_binding(
  p_staff_id text,
  p_admin_id text
) returns jsonb language plpgsql security definer as $$
begin
  update public.staff_device_bindings
    set reset_count = reset_count + 1
    where staff_id = p_staff_id;
  delete from public.staff_device_bindings where staff_id = p_staff_id;
  return jsonb_build_object('ok', true, 'reset_by', p_admin_id);
end $$;

-- Server-aggregated report (faster than client-side for year-long ranges)
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
    'hours', coalesce(round(sum("hoursWorked")::numeric, 1), 0),
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
        'staff_id', "staffId",
        'name', "staffName",
        'days', count(*) filter (where status in ('present', 'late')),
        'hours', round(coalesce(sum("hoursWorked"),0)::numeric, 1),
        'late', count(*) filter (where status = 'late'),
        'avg_per_day', round(
          coalesce(sum("hoursWorked"),0)::numeric
          / nullif(count(*) filter (where status in ('present', 'late')), 0)
          , 1)
      ) as s
      from public.hr_attendance
      where date::date between p_start and p_end and status <> 'init'
      group by "staffId", "staffName"
    ) t;

  select coalesce(jsonb_agg(d order by d->>'date'), '[]'::jsonb) into daily
    from (
      select jsonb_build_object(
        'date', date,
        'count', count(*) filter (where status in ('present', 'late')),
        'hours', round(coalesce(sum("hoursWorked"),0)::numeric, 1)
      ) as d
      from public.hr_attendance
      where date::date between p_start and p_end and status <> 'init'
      group by date
    ) t;

  return jsonb_build_object('totals', totals, 'per_staff', per_staff, 'daily', daily);
end $$;
```

- [ ] **Step 2: Apply RPC additions**

```bash
npx supabase db push 2>/dev/null || echo "Apply via Supabase SQL editor"
```

- [ ] **Step 3: Smoke-test in SQL editor**

```sql
-- Token validity:
select public.validate_clock_token(encode((floor(extract(epoch from now())/600)::bigint)::text::bytea, 'base64'));
-- Expect: true

-- Bad token:
select public.validate_clock_token('garbage');
-- Expect: false

-- Report (empty range OK):
select public.get_attendance_report('2026-05-01'::date, '2026-05-31'::date);
-- Expect: jsonb with totals/per_staff/daily
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260512_attendance_security_v2.sql
git commit -m "feat(attendance): add RPCs for server-side clock-in, overrides, reports"
```

---

## Task 4: Device fingerprint module

**Files:**
- Create: `src/services/device-fingerprint.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/services/device-fingerprint.ts
/**
 * Device fingerprint for attendance device-binding.
 *
 * Composite SHA-256 hash of stable browser/device signals plus a persisted
 * random salt. Truncated to 16 hex chars to keep it readable in admin UIs.
 *
 * The persisted salt makes the fingerprint stable across normal sessions but
 * resettable by clearing localStorage. This is intentional — we want a
 * fingerprint that survives reloads but doesn't try to defeat a determined
 * user clearing their storage (admin reset is the trust anchor for that case).
 */

const SALT_KEY = 'amp_device_salt'

function getOrCreateSalt(): string {
  try {
    let s = localStorage.getItem(SALT_KEY)
    if (!s) {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(SALT_KEY, s)
    }
    return s
  } catch {
    // Private mode or storage blocked — degrade to non-persistent salt
    return 'volatile-' + Math.random().toString(36).slice(2)
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function describeDevice(): string {
  const ua = navigator.userAgent
  const platform =
    /iPhone|iPad/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : 'Device'
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser'
  return `${platform} · ${browser}`
}

export async function getDeviceFingerprint(): Promise<{ fp: string; label: string }> {
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown-tz',
    String(navigator.hardwareConcurrency || 0),
    getOrCreateSalt(),
  ].join('|')
  const hash = await sha256Hex(parts)
  return { fp: hash.slice(0, 16), label: describeDevice() }
}
```

- [ ] **Step 2: Verify lint + types**

```bash
npm run lint:types
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/services/device-fingerprint.ts
git commit -m "feat(attendance): add device fingerprint module"
```

---

## Task 5: Extend attendance-service.ts (RPC + multi-sample GPS + reports)

**Files:**
- Modify: `src/services/attendance-service.ts`

- [ ] **Step 1: Append the new exports**

Append to the bottom of `src/services/attendance-service.ts` (do not edit existing exports):

```typescript
// ─── Server-RPC-backed flow (v2) ──────────────────────────────────────────────

import { supabase } from '@/lib/supabase-wrapper'

export type ClockError =
  | 'invalid_token'
  | 'no_location'
  | 'outside_geofence'
  | 'device_mismatch'
  | 'no_open_record'
  | 'network'
  | 'unknown'

export interface ClockSuccess {
  ok: true
  recordId: string
  flags: string[]
  distance: number | null
}

export interface ClockFailure {
  ok: false
  error: ClockError
  distance?: number
  accuracy?: number
}

export interface GpsSample {
  lat: number
  lng: number
  acc: number
  t: number
}

/**
 * Try up to `count` GPS reads within `timeoutMs`. Returns the best (lowest
 * accuracy value) reading plus all samples for audit. Aborts early if the
 * first reading is precise enough (< 20 m).
 */
export async function resolveLocationMultiSample(
  count = 3,
  timeoutMs = 5000
): Promise<{ best: LocationData; samples: GpsSample[] } | 'denied' | null> {
  if (!navigator.geolocation) return null
  const samples: GpsSample[] = []
  const start = Date.now()

  const readOnce = (): Promise<GpsSample | 'denied' | null> =>
    new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy,
          t: Date.now(),
        }),
        (err) => resolve(err.code === 1 ? 'denied' : null),
        { enableHighAccuracy: true, timeout: Math.max(1500, timeoutMs / count), maximumAge: 0 }
      )
    })

  for (let i = 0; i < count; i++) {
    if (Date.now() - start > timeoutMs) break
    const r = await readOnce()
    if (r === 'denied') return 'denied'
    if (r) {
      samples.push(r)
      if (r.acc < 20) break // good enough, stop early
    }
  }
  if (samples.length === 0) return null

  const best = samples.reduce((a, b) => (b.acc < a.acc ? b : a))
  const distance = distanceFromHotel(best.lat, best.lng)
  return {
    best: {
      lat: best.lat,
      lng: best.lng,
      accuracy: best.acc,
      distance,
      inside: distance <= MAX_DISTANCE_METERS_V2,
    },
    samples,
  }
}

// Hard-block radius (must match server `_amp_hotel()` radius).
export const MAX_DISTANCE_METERS_V2 = 150

/**
 * Server-authoritative clock-in. Calls the `clock_in_attendance` RPC.
 * Returns a discriminated union the caller switches on.
 */
export async function clockInServer(opts: {
  token: string
  staffId: string
  staffName: string
  location: LocationData | null
  samples: GpsSample[]
  device: { fp: string; label: string }
  overrideRequestId?: string
}): Promise<ClockSuccess | ClockFailure> {
  try {
    const { data, error } = await supabase.rpc('clock_in_attendance', {
      p_token: opts.token,
      p_staff_id: opts.staffId,
      p_staff_name: opts.staffName,
      p_lat: opts.location?.lat ?? null,
      p_lng: opts.location?.lng ?? null,
      p_accuracy: opts.location?.accuracy ?? null,
      p_samples: opts.samples,
      p_device_fp: opts.device.fp,
      p_device_label: opts.device.label,
      p_override_request_id: opts.overrideRequestId ?? null,
    })
    if (error) return { ok: false, error: 'network' }
    if (!data?.ok) {
      return {
        ok: false,
        error: (data?.error as ClockError) ?? 'unknown',
        distance: data?.distance,
        accuracy: data?.accuracy,
      }
    }
    return { ok: true, recordId: data.record_id, flags: data.flags ?? [], distance: data.distance ?? null }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function clockOutServer(opts: {
  token: string
  staffId: string
}): Promise<{ ok: true; recordId: string; hours: number } | { ok: false; error: ClockError }> {
  try {
    const { data, error } = await supabase.rpc('clock_out_attendance', {
      p_token: opts.token,
      p_staff_id: opts.staffId,
    })
    if (error) return { ok: false, error: 'network' }
    if (!data?.ok) return { ok: false, error: (data?.error as ClockError) ?? 'unknown' }
    return { ok: true, recordId: data.record_id, hours: data.hours }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export type OverrideReason = 'gps_drift' | 'new_device' | 'other'

export interface OverrideRequest {
  id: string
  staffId: string
  staffName: string
  reason: OverrideReason
  reasonNote: string | null
  distance: number | null
  accuracy: number | null
  deviceLabel: string | null
  status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired'
  requestedAt: string
}

export async function requestOverride(opts: {
  staffId: string
  staffName: string
  reason: OverrideReason
  reasonNote?: string
  location: LocationData | null
  device: { fp: string; label: string }
}): Promise<{ id: string } | { error: string }> {
  try {
    const { data, error } = await supabase.rpc('request_attendance_override', {
      p_staff_id: opts.staffId,
      p_staff_name: opts.staffName,
      p_reason: opts.reason,
      p_reason_note: opts.reasonNote ?? null,
      p_lat: opts.location?.lat ?? null,
      p_lng: opts.location?.lng ?? null,
      p_accuracy: opts.location?.accuracy ?? null,
      p_distance: opts.location?.distance ?? null,
      p_device_fp: opts.device.fp,
      p_device_label: opts.device.label,
    })
    if (error || !data?.ok) return { error: error?.message ?? data?.error ?? 'unknown' }
    return { id: data.id }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function listPendingOverrides(): Promise<OverrideRequest[]> {
  const { data } = await supabase
    .from('attendance_override_requests')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
  return (data ?? []).map(rowToOverride)
}

export async function getOverride(id: string): Promise<OverrideRequest | null> {
  const { data } = await supabase
    .from('attendance_override_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return data ? rowToOverride(data) : null
}

function rowToOverride(r: any): OverrideRequest {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff_name,
    reason: r.reason,
    reasonNote: r.reason_note,
    distance: r.gps_distance ?? null,
    accuracy: r.gps_accuracy ?? null,
    deviceLabel: r.device_label ?? null,
    status: r.status,
    requestedAt: r.requested_at,
  }
}

export async function approveOverride(id: string, adminId: string, note?: string) {
  const { data, error } = await supabase.rpc('approve_attendance_override', {
    p_request_id: id, p_admin_id: adminId, p_note: note ?? null,
  })
  if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? 'approve_failed')
}

export async function rejectOverride(id: string, adminId: string, note?: string) {
  const { data, error } = await supabase.rpc('reject_attendance_override', {
    p_request_id: id, p_admin_id: adminId, p_note: note ?? null,
  })
  if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? 'reject_failed')
}

export async function resetDeviceBinding(staffId: string, adminId: string) {
  const { data, error } = await supabase.rpc('reset_device_binding', {
    p_staff_id: staffId, p_admin_id: adminId,
  })
  if (error || !data?.ok) throw new Error(error?.message ?? 'reset_failed')
}

// ─── Reporting ────────────────────────────────────────────────────────────────

export interface AttendanceReportTotals {
  hours: number
  present_days: number
  late: number
  absent: number
  overrides: number
  outside_geofence: number
}

export interface AttendanceReportStaff {
  staff_id: string
  name: string
  days: number
  hours: number
  late: number
  avg_per_day: number | null
}

export interface AttendanceReportDay {
  date: string
  count: number
  hours: number
}

export interface AttendanceReport {
  totals: AttendanceReportTotals
  per_staff: AttendanceReportStaff[]
  daily: AttendanceReportDay[]
}

export async function getAttendanceReport(startDate: string, endDate: string): Promise<AttendanceReport> {
  const { data, error } = await supabase.rpc('get_attendance_report', {
    p_start: startDate, p_end: endDate,
  })
  if (error) throw error
  return data as AttendanceReport
}
```

- [ ] **Step 2: Confirm `supabase` is exported from `supabase-wrapper`**

```bash
grep -n "^export const supabase\|^export { supabase" src/lib/supabase-wrapper.ts | head
```

If no match: add `export const supabase = createClient(...)` re-export there, or change the import to wherever the Supabase client is exposed (search: `grep -rn "createClient" src/lib | head`). Adjust the `import { supabase } from '@/lib/supabase-wrapper'` line in the appended block accordingly.

- [ ] **Step 3: Verify types**

```bash
npm run lint:types
```

Expected: pass. Fix any import-path mismatch found in Step 2.

- [ ] **Step 4: Commit**

```bash
git add src/services/attendance-service.ts
git commit -m "feat(attendance): add server-RPC flow, overrides, reports to attendance-service"
```

---

## Task 6: Rewrite ClockPage with state machine + override flow

**Files:**
- Modify: `src/pages/staff/ClockPage.tsx`

- [ ] **Step 1: Replace file contents**

Replace the entire contents of `src/pages/staff/ClockPage.tsx` with:

```tsx
/**
 * ClockPage — Staff clock-in/out via QR code scan (v2).
 *
 * Hardened flow:
 *  - Multi-sample GPS (best of 3 in 5 s)
 *  - Server-side validation (token + geofence + device binding) via RPC
 *  - Real-time override request flow for legitimately blocked staff
 *
 * Route: /staff/clock?t=TOKEN
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Loader2, LogIn, LogOut, CheckCircle2, AlertTriangle,
  MapPin, Clock, Home, Navigation, Smartphone, ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useStaffRole } from '@/hooks/use-staff-role'
import { supabase } from '@/lib/supabase-wrapper'
import {
  isValidToken,
  resolveLocationMultiSample,
  clockInServer,
  clockOutServer,
  requestOverride,
  getOverride,
  getTodayRecord,
  parseLocationFromNotes,
  type AttendanceRecord,
  type LocationData,
  type GpsSample,
  type OverrideReason,
  MAX_DISTANCE_METERS_V2,
} from '@/services/attendance-service'
import { getDeviceFingerprint } from '@/services/device-fingerprint'

type Phase =
  | 'loading'
  | 'idle'
  | 'acquiring'
  | 'submitting'
  | 'success_in'
  | 'success_out'
  | 'blocked_token'
  | 'blocked_geofence'
  | 'blocked_device'
  | 'blocked_no_location'
  | 'override_form'
  | 'override_pending'
  | 'override_rejected'

export function ClockPage() {
  const { userId, staffRecord, isLoading: roleLoading } = useStaffRole()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t') ?? ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [now, setNow] = useState(new Date())
  const [tokenWarning, setTokenWarning] = useState(false)
  const [location, setLocation] = useState<LocationData | null>(null)
  const [samples, setSamples] = useState<GpsSample[]>([])
  const [device, setDevice] = useState<{ fp: string; label: string } | null>(null)
  const [lastError, setLastError] = useState<{ distance?: number; accuracy?: number } | null>(null)
  const [overrideReason, setOverrideReason] = useState<OverrideReason>('gps_drift')
  const [overrideNote, setOverrideNote] = useState('')
  const [overrideId, setOverrideId] = useState<string | null>(null)
  const [overrideRejection, setOverrideRejection] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Token sanity (server validates authoritatively; this is a UX hint)
  useEffect(() => {
    if (token && !isValidToken(token)) setTokenWarning(true)
  }, [token])

  // Resolve device fingerprint once
  useEffect(() => {
    getDeviceFingerprint().then(setDevice)
  }, [])

  // Load today's record
  const loadRecord = useCallback(async (uid: string) => {
    const rec = await getTodayRecord(uid)
    setTodayRecord(rec)
    if (rec?.notes) {
      const loc = parseLocationFromNotes(rec.notes)
      if (loc) setLocation(loc)
    }
    setPhase('idle')
  }, [])

  useEffect(() => {
    if (!roleLoading && userId) loadRecord(userId)
  }, [roleLoading, userId, loadRecord])

  // ─── Clock-in ───────────────────────────────────────────────────────────────

  const doClockIn = useCallback(async (opts?: { overrideRequestId?: string }) => {
    if (!userId || !staffRecord || !device) return
    setPhase('acquiring')

    const gps = await resolveLocationMultiSample(3, 5000)
    let loc: LocationData | null = null
    let smp: GpsSample[] = []
    if (gps === 'denied' || gps === null) {
      // Allow attempt; server may still accept with override
      loc = null
      smp = []
    } else {
      loc = gps.best
      smp = gps.samples
      setLocation(loc)
      setSamples(smp)
    }

    setPhase('submitting')
    const res = await clockInServer({
      token,
      staffId: userId,
      staffName: staffRecord.name,
      location: loc,
      samples: smp,
      device,
      overrideRequestId: opts?.overrideRequestId,
    })

    if (res.ok) {
      setPhase('success_in')
      // Refresh local record
      await loadRecord(userId)
      if (res.distance != null && res.distance > MAX_DISTANCE_METERS_V2) {
        toast.warning(`Clocked in via override (${Math.round(res.distance)} m from hotel).`)
      } else {
        toast.success('Clocked in. Have a great shift!')
      }
      return
    }

    setLastError({ distance: res.distance, accuracy: res.accuracy })
    if (res.error === 'invalid_token') setPhase('blocked_token')
    else if (res.error === 'outside_geofence') setPhase('blocked_geofence')
    else if (res.error === 'device_mismatch') setPhase('blocked_device')
    else if (res.error === 'no_location') setPhase('blocked_no_location')
    else {
      setPhase('idle')
      toast.error('Network problem. Please try again.')
    }
  }, [userId, staffRecord, device, token, loadRecord])

  // ─── Clock-out ──────────────────────────────────────────────────────────────

  const doClockOut = useCallback(async () => {
    if (!userId) return
    setPhase('submitting')
    const res = await clockOutServer({ token, staffId: userId })
    if (res.ok) {
      setPhase('success_out')
      await loadRecord(userId)
      toast.success(`Clocked out. You worked ${res.hours}h — have a good rest!`)
    } else {
      setPhase('idle')
      if (res.error === 'invalid_token') {
        toast.error('QR expired. Scan the latest QR at the entrance.')
      } else if (res.error === 'no_open_record') {
        toast.error('No active clock-in found.')
      } else {
        toast.error('Network problem. Please try again.')
      }
    }
  }, [userId, token, loadRecord])

  // ─── Override flow ──────────────────────────────────────────────────────────

  const submitOverride = useCallback(async () => {
    if (!userId || !staffRecord || !device) return
    const res = await requestOverride({
      staffId: userId,
      staffName: staffRecord.name,
      reason: overrideReason,
      reasonNote: overrideNote.trim() || undefined,
      location,
      device,
    })
    if ('error' in res) {
      toast.error(`Could not submit override: ${res.error}`)
      return
    }
    setOverrideId(res.id)
    setPhase('override_pending')
    toast.info('Override sent to manager.')
  }, [userId, staffRecord, device, overrideReason, overrideNote, location])

  const cancelOverridePoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  // Poll override status while pending (realtime + 4 s fallback)
  useEffect(() => {
    if (phase !== 'override_pending' || !overrideId) return

    let active = true
    const channel = supabase
      .channel(`override-${overrideId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'attendance_override_requests', filter: `id=eq.${overrideId}` },
        (payload) => {
          if (!active) return
          handleOverrideUpdate(payload.new)
        }
      )
      .subscribe()

    pollRef.current = setInterval(async () => {
      if (!active) return
      const ovr = await getOverride(overrideId)
      if (ovr) handleOverrideUpdate(ovr)
    }, 4000)

    function handleOverrideUpdate(row: any) {
      const status = row?.status
      if (status === 'approved') {
        cancelOverridePoll()
        supabase.removeChannel(channel)
        // Retry clock-in carrying the override id
        doClockIn({ overrideRequestId: overrideId! })
      } else if (status === 'rejected') {
        cancelOverridePoll()
        supabase.removeChannel(channel)
        setOverrideRejection(row.admin_note ?? null)
        setPhase('override_rejected')
      }
    }

    return () => {
      active = false
      cancelOverridePoll()
      supabase.removeChannel(channel)
    }
  }, [phase, overrideId, doClockIn, cancelOverridePoll])

  // ─── Derived ────────────────────────────────────────────────────────────────

  const hasClockIn = Boolean(todayRecord?.clockIn)
  const hasClockOut = Boolean(todayRecord?.clockOut)
  const shiftDone = phase === 'success_out' || hasClockOut

  const todayDateStr = new Date().toISOString().split('T')[0]
  const isOvernightRecord = todayRecord?.date && todayRecord.date !== todayDateStr

  const greeting = () => {
    const h = now.getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  if (roleLoading || phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="bg-primary text-primary-foreground px-5 py-4 flex items-center gap-3 shadow-md">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
          <Clock className="w-4 h-4" />
        </div>
        <span className="font-bold text-base flex-1">AMP Lodge</span>
        <Link to="/staff/dashboard" className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white">
          <Home className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </div>

      {/* Token warning */}
      {tokenWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-start gap-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>This QR code may be expired. Scan the latest one at the hotel entrance.</span>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-8">
          {/* Greeting + live clock */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground">{greeting()},</p>
            <h1 className="text-2xl font-bold mt-0.5 mb-5">{staffRecord?.name || 'Staff'}</h1>
            <p className="text-5xl font-mono font-bold text-primary tracking-tight">{format(now, 'HH:mm:ss')}</p>
            <p className="text-sm text-muted-foreground mt-2">{format(now, 'EEEE, d MMMM yyyy')}</p>
          </div>

          {/* Shift summary */}
          {todayRecord && (
            <div className={`rounded-xl px-5 py-4 text-sm space-y-2 border ${isOvernightRecord ? 'bg-amber-50 border-amber-200' : 'bg-muted/40'}`}>
              {isOvernightRecord && (
                <p className="text-xs text-amber-700 font-medium">Overnight shift from {todayRecord.date}</p>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Clocked in</span><span className="font-semibold">{todayRecord.clockIn}</span></div>
              {todayRecord.clockOut && (
                <div className="flex justify-between"><span className="text-muted-foreground">Clocked out</span><span className="font-semibold">{todayRecord.clockOut}</span></div>
              )}
              {todayRecord.hoursWorked > 0 && (
                <div className="flex justify-between border-t pt-2 mt-1"><span className="text-muted-foreground">Hours</span><span className="font-semibold text-primary">{todayRecord.hoursWorked}h</span></div>
              )}
              {location && (
                <div className="flex justify-between items-center border-t pt-2 mt-1">
                  <span className="text-muted-foreground">Location</span>
                  <span className={`text-xs font-medium flex items-center gap-1 ${location.inside ? 'text-green-600' : 'text-amber-600'}`}>
                    <MapPin className="w-3 h-3" />
                    {location.inside ? `Hotel (${Math.round(location.distance)} m)` : `${Math.round(location.distance)} m away`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Action area */}
          {shiftDone ? (
            <div className="text-center space-y-2 py-4">
              <div className="flex items-center justify-center gap-2 text-green-600">
                <CheckCircle2 className="w-6 h-6" />
                <span className="text-lg font-semibold">Shift complete!</span>
              </div>
              <p className="text-sm text-muted-foreground">You worked {todayRecord?.hoursWorked ?? 0}h.</p>
            </div>
          ) : hasClockIn ? (
            <Button size="lg" variant="destructive" className="w-full h-16 text-lg font-semibold gap-3 rounded-xl shadow-lg"
              onClick={doClockOut} disabled={phase === 'submitting'}>
              {phase === 'submitting' ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogOut className="w-5 h-5" />}
              Clock Out
            </Button>
          ) : phase === 'idle' || phase === 'override_rejected' ? (
            <div className="space-y-3">
              {phase === 'override_rejected' && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
                  <p className="font-semibold mb-1">Override rejected</p>
                  {overrideRejection && <p className="text-xs">{overrideRejection}</p>}
                </div>
              )}
              <Button size="lg" className="w-full h-16 text-lg font-semibold gap-3 rounded-xl shadow-lg"
                onClick={() => doClockIn()}>
                <LogIn className="w-5 h-5" />
                Clock In
              </Button>
              <p className="text-center text-xs text-muted-foreground">Tap to start your shift</p>
            </div>
          ) : phase === 'acquiring' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Navigation className="w-6 h-6 text-primary animate-pulse" />
              <p className="text-sm text-muted-foreground">Acquiring your location…</p>
            </div>
          ) : phase === 'submitting' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Verifying…</p>
            </div>
          ) : phase === 'success_in' ? (
            <div className="text-center space-y-2 py-4">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
              <p className="text-lg font-semibold">Clocked in</p>
              <p className="text-sm text-muted-foreground">Have a productive shift!</p>
            </div>
          ) : phase === 'blocked_token' ? (
            <BlockedCard
              icon={<AlertTriangle className="w-6 h-6 text-amber-600" />}
              title="QR expired"
              body="Please scan the latest QR code at the hotel entrance."
            />
          ) : phase === 'blocked_geofence' ? (
            <BlockedCard
              icon={<MapPin className="w-6 h-6 text-amber-600" />}
              title="Outside hotel"
              body={`You appear to be ${lastError?.distance ? Math.round(lastError.distance) + ' m' : 'far'} from the hotel. If GPS is wrong, request a manager override.`}
              actionLabel="Request override"
              onAction={() => { setOverrideReason('gps_drift'); setPhase('override_form') }}
            />
          ) : phase === 'blocked_device' ? (
            <BlockedCard
              icon={<Smartphone className="w-6 h-6 text-amber-600" />}
              title="Unknown device"
              body="This device is not registered for your account. If you have a new phone, request a manager override."
              actionLabel="Request override"
              onAction={() => { setOverrideReason('new_device'); setPhase('override_form') }}
            />
          ) : phase === 'blocked_no_location' ? (
            <BlockedCard
              icon={<MapPin className="w-6 h-6 text-amber-600" />}
              title="Location unavailable"
              body="We couldn't read your GPS. Try again outside or request a manager override."
              actionLabel="Request override"
              onAction={() => { setOverrideReason('gps_drift'); setPhase('override_form') }}
            />
          ) : phase === 'override_form' ? (
            <div className="space-y-3 border rounded-xl p-4 bg-card">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <p className="font-semibold">Request manager override</p>
              </div>
              <Select value={overrideReason} onValueChange={(v) => setOverrideReason(v as OverrideReason)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gps_drift">GPS inaccurate</SelectItem>
                  <SelectItem value="new_device">New device</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Optional note for your manager…"
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                rows={3}
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPhase('idle')}>Cancel</Button>
                <Button className="flex-1" onClick={submitOverride}>Send</Button>
              </div>
            </div>
          ) : phase === 'override_pending' ? (
            <div className="text-center space-y-3 py-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
              <p className="font-semibold">Waiting for manager approval…</p>
              <p className="text-xs text-muted-foreground">Stay on this screen. You'll be clocked in automatically once approved.</p>
              <Button variant="ghost" size="sm" onClick={() => { setOverrideId(null); setPhase('idle') }}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function BlockedCard({
  icon, title, body, actionLabel, onAction,
}: {
  icon: React.ReactNode; title: string; body: string; actionLabel?: string; onAction?: () => void
}) {
  return (
    <div className="border rounded-xl p-5 space-y-3 bg-amber-50/40">
      <div className="flex items-center gap-2">{icon}<p className="font-semibold">{title}</p></div>
      <p className="text-sm text-muted-foreground">{body}</p>
      {actionLabel && onAction && (
        <Button className="w-full" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify types + build**

```bash
npm run lint:types
npm run build
```

Expected: both pass. If `supabase` import path differs, fix the import (see Task 5 Step 2 note).

- [ ] **Step 3: Manual smoke (local dev server)**

```bash
npm run dev
```

Then in browser:
1. Open `/staff/clock?t=<current-token>` (grab QR from HR page in a second tab).
2. Verify greeting + live clock renders.
3. Click Clock In — allow location → expect either `success_in` or `blocked_geofence` (if you're far from the hotel coords).
4. From `blocked_geofence`, click Request override → fill form → Send → expect `override_pending`.
5. In HR tab (admin), approve override (Task 7) — confirm staff page auto-completes clock-in.

(QA only — don't commit dev-only changes.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/staff/ClockPage.tsx
git commit -m "feat(attendance): rewrite ClockPage with server flow + override UI"
```

---

## Task 7: OverridePanel component

**Files:**
- Create: `src/components/hr/OverridePanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/hr/OverridePanel.tsx
/**
 * Admin panel for live override requests from staff who are blocked from
 * clocking in (GPS drift, new device, etc).
 *
 * Auto-hides when there are no pending requests. Realtime-driven via the
 * `attendance_override_requests` table subscription already wired through
 * `useSubscription`.
 */

import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, MapPin, Smartphone, Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useSubscription } from '@/hooks/use-subscription'
import {
  listPendingOverrides,
  approveOverride,
  rejectOverride,
  type OverrideRequest,
} from '@/services/attendance-service'

export function OverridePanel({ adminId }: { adminId: string }) {
  const [pending, setPending] = useState<OverrideRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setPending(await listPendingOverrides())
    } finally {
      setLoading(false)
    }
  }, [])

  const updatedAt = useSubscription('attendance_override_requests')

  useEffect(() => { refresh() }, [refresh, updatedAt])

  const handleApprove = async (id: string) => {
    setActing(id)
    try {
      await approveOverride(id, adminId)
      toast.success('Override approved.')
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setActing(null)
    }
  }

  const handleReject = async (id: string) => {
    setActing(id)
    try {
      await rejectOverride(id, adminId)
      toast.success('Override rejected.')
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setActing(null)
    }
  }

  if (loading) return null
  if (pending.length === 0) return null

  return (
    <div className="border-2 border-amber-300 bg-amber-50/60 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-amber-100/60 border-b border-amber-200">
        <ShieldAlert className="w-5 h-5 text-amber-700" />
        <span className="font-semibold text-amber-900">
          Override Requests — {pending.length} pending
        </span>
      </div>
      <div className="divide-y divide-amber-200">
        {pending.map(r => (
          <div key={r.id} className="px-4 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-semibold">{r.staffName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-900">
                  {reasonLabel(r.reason)}
                </span>
                {r.distance != null && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {Math.round(r.distance)} m
                  </span>
                )}
                {r.deviceLabel && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Smartphone className="w-3 h-3" /> {r.deviceLabel}
                  </span>
                )}
              </div>
              {r.reasonNote && (
                <p className="text-xs text-muted-foreground mt-1 italic">"{r.reasonNote}"</p>
              )}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-8 gap-1 text-green-700 hover:bg-green-50"
                disabled={acting === r.id} onClick={() => handleApprove(r.id)}>
                {acting === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Approve
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1 text-red-700 hover:bg-red-50"
                disabled={acting === r.id} onClick={() => handleReject(r.id)}>
                <X className="w-3.5 h-3.5" />
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function reasonLabel(r: string): string {
  switch (r) {
    case 'gps_drift': return 'GPS issue'
    case 'new_device': return 'New device'
    default: return 'Other'
  }
}
```

- [ ] **Step 2: Verify types**

```bash
npm run lint:types
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/hr/OverridePanel.tsx
git commit -m "feat(attendance): add admin OverridePanel for approving/rejecting override requests"
```

---

## Task 8: ReportsPanel component

**Files:**
- Create: `src/components/hr/ReportsPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/hr/ReportsPanel.tsx
/**
 * Admin reports — attendance summarized by Day / Week / Month / Quarter / Year / Custom.
 *
 * Backed by `get_attendance_report` RPC for server-side aggregation, so even a
 * year-long range stays cheap.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  format, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  addDays, addWeeks, addMonths, addQuarters, addYears,
} from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronLeft, ChevronRight, Download, BarChart3, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getAttendanceReport, type AttendanceReport } from '@/services/attendance-service'
import { useSubscription } from '@/hooks/use-subscription'

type Period = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

export function ReportsPanel() {
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState<Date>(new Date())
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [report, setReport] = useState<AttendanceReport | null>(null)
  const [loading, setLoading] = useState(false)

  const { start, end } = useMemo(() => rangeFor(period, anchor, customStart, customEnd), [period, anchor, customStart, customEnd])

  const refresh = useCallback(async () => {
    if (!start || !end) return
    setLoading(true)
    try {
      setReport(await getAttendanceReport(start, end))
    } catch {
      setReport(null)
      toast.error('Failed to load report.')
    } finally {
      setLoading(false)
    }
  }, [start, end])

  const updatedAt = useSubscription('hr_attendance')
  useEffect(() => { refresh() }, [refresh, updatedAt])

  const shift = (dir: -1 | 1) => {
    if (period === 'custom') return
    setAnchor((d) => {
      switch (period) {
        case 'day':     return addDays(d, dir)
        case 'week':    return addWeeks(d, dir)
        case 'month':   return addMonths(d, dir)
        case 'quarter': return addQuarters(d, dir)
        case 'year':    return addYears(d, dir)
        default:        return d
      }
    })
  }

  const handleExport = () => {
    if (!report || !start || !end) return
    const rows = [
      ['Staff', 'Days', 'Hours', 'Late', 'Avg per day'].join(','),
      ...report.per_staff.map(s => [
        `"${s.name}"`, s.days, s.hours, s.late, s.avg_per_day ?? '',
      ].join(',')),
    ].join('\n')
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance_report_${start}_to_${end}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-sm">Reports</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(['day', 'week', 'month', 'quarter', 'year', 'custom'] as Period[]).map(p => (
            <Button key={p} variant={period === p ? 'default' : 'outline'} size="sm" className="h-7 capitalize text-xs"
              onClick={() => setPeriod(p)}>
              {p}
            </Button>
          ))}
          <Button variant="outline" size="sm" className="h-7 gap-1.5 ml-1" onClick={handleExport} disabled={!report}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
        </div>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b bg-background">
        {period === 'custom' ? (
          <>
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 w-auto" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 w-auto" />
          </>
        ) : (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm font-medium flex-1 text-center">{labelFor(period, anchor)}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></Button>
          </>
        )}
      </div>

      <div className="p-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !report ? (
          <p className="text-sm text-muted-foreground text-center py-6">Pick a range to see the report.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <StatTile label="Hours" value={report.totals.hours} />
              <StatTile label="Days" value={report.totals.present_days} />
              <StatTile label="Late" value={report.totals.late} />
              <StatTile label="Absent" value={report.totals.absent} />
              <StatTile label="Overrides" value={report.totals.overrides} />
            </div>

            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {['Staff', 'Days', 'Hours', 'Late', 'Avg/day'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.per_staff.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">No records in this range.</td></tr>
                  )}
                  {report.per_staff.map(s => (
                    <tr key={s.staff_id}>
                      <td className="px-3 py-2 font-medium">{s.name}</td>
                      <td className="px-3 py-2">{s.days}</td>
                      <td className="px-3 py-2">{s.hours}h</td>
                      <td className="px-3 py-2">{s.late}</td>
                      <td className="px-3 py-2">{s.avg_per_day != null ? `${s.avg_per_day}h` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-3 bg-card">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}

function rangeFor(period: Period, anchor: Date, customStart: string, customEnd: string): { start: string; end: string } {
  const iso = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (period) {
    case 'day':     return { start: iso(anchor), end: iso(anchor) }
    case 'week':    return { start: iso(startOfWeek(anchor, { weekStartsOn: 1 })), end: iso(endOfWeek(anchor, { weekStartsOn: 1 })) }
    case 'month':   return { start: iso(startOfMonth(anchor)), end: iso(endOfMonth(anchor)) }
    case 'quarter': return { start: iso(startOfQuarter(anchor)), end: iso(endOfQuarter(anchor)) }
    case 'year':    return { start: iso(startOfYear(anchor)), end: iso(endOfYear(anchor)) }
    case 'custom':  return { start: customStart || '', end: customEnd || '' }
  }
}

function labelFor(period: Period, anchor: Date): string {
  switch (period) {
    case 'day':     return format(anchor, 'EEEE, d MMM yyyy')
    case 'week': {
      const s = startOfWeek(anchor, { weekStartsOn: 1 })
      const e = endOfWeek(anchor, { weekStartsOn: 1 })
      return `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`
    }
    case 'month':   return format(anchor, 'MMMM yyyy')
    case 'quarter': return `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`
    case 'year':    return String(anchor.getFullYear())
    default:        return ''
  }
}
```

- [ ] **Step 2: Verify types**

```bash
npm run lint:types
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/hr/ReportsPanel.tsx
git commit -m "feat(attendance): add admin ReportsPanel with day/week/month/quarter/year ranges"
```

---

## Task 9: Wire new panels into HRPage AttendanceTab + add Device/Flags columns

**Files:**
- Modify: `src/pages/staff/HRPage.tsx`

- [ ] **Step 1: Add imports**

Open `src/pages/staff/HRPage.tsx`. Locate the import block ending around line 75 (after `qrcode.react`). Add these imports right after:

```typescript
import { OverridePanel } from '@/components/hr/OverridePanel'
import { ReportsPanel } from '@/components/hr/ReportsPanel'
import { resetDeviceBinding } from '@/services/attendance-service'
import { Smartphone, ShieldCheck } from 'lucide-react'
```

(The `Smartphone` icon may already be in the `lucide-react` import block — if so, just add `ShieldCheck` there.)

- [ ] **Step 2: Render `OverridePanel` and `ReportsPanel` in `AttendanceTab`**

Find the `AttendanceTab` return block starting around line 525:

```tsx
return (
    <div className="space-y-5">
      {/* QR Code Panel */}
      <QRPanel />

      {/* Live Now */}
      <LiveNowPanel />
```

Update to:

```tsx
const { userId } = useStaffRole()

  return (
    <div className="space-y-5">
      {/* QR Code Panel */}
      <QRPanel />

      {/* Pending overrides (auto-hides when empty) */}
      {userId && <OverridePanel adminId={userId} />}

      {/* Live Now */}
      <LiveNowPanel />

      {/* Reports */}
      <ReportsPanel />
```

(Insert `const { userId } = useStaffRole()` at the top of `AttendanceTab` function alongside the existing `useState` hooks.)

- [ ] **Step 3: Add `Device` and `Flags` columns to desktop table header**

Find the header array around line 564:

```tsx
{['Staff Name', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Notes', ''].map(h => (
```

Replace with:

```tsx
{['Staff Name', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Location', 'Device', 'Flags', ''].map(h => (
```

(Renaming the existing `Notes` column to `Location` matches what it actually shows today.)

- [ ] **Step 4: Add Device + Flags cells to desktop table body**

Find the closing `</td>` of the existing `Notes` cell (around line 640) — just before the row's action `<td>` with the delete button. Insert two new cells right before that delete `<td>`:

```tsx
<td className="px-4 py-3 max-w-[160px]">
                      {(r as any).device_fingerprint ? (
                        <DeviceCell
                          staffId={r.staffId}
                          staffName={r.staffName}
                          fp={(r as any).device_fingerprint}
                          label={(r as any).device_label}
                          onReset={async () => {
                            if (!userId) return
                            if (!confirm(`Reset device binding for ${r.staffName}? Next clock-in will register a new device.`)) return
                            try {
                              await resetDeviceBinding(r.staffId, userId)
                              toast.success('Device binding reset.')
                            } catch (e) {
                              toast.error((e as Error).message)
                            }
                          }}
                        />
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <FlagsCell flags={(r as any).flags as string[] | null} />
                    </td>
```

(`r.staffId` is camelCase coming through the existing wrapper; if it surfaces as `staff_id` in the row, switch accordingly.)

- [ ] **Step 5: Mirror in mobile card view**

Find the mobile card view block starting around line 654 (`<div className="md:hidden space-y-3">`). Within each card, locate the closing `</div>` of the existing location block (right before the card's closing `</div>`). Insert a small flags strip just above it:

```tsx
{((r as any).flags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {((r as any).flags as string[]).map(f => (
                      <span key={f} className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
                        {f.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
```

- [ ] **Step 6: Add the two small helper components at the bottom of `HRPage.tsx`**

Append to the very end of the file:

```tsx
// ─── Device + Flags cell helpers ──────────────────────────────────────────────

function DeviceCell({ staffId, staffName, fp, label, onReset }: {
  staffId: string; staffName: string; fp: string; label: string | null; onReset: () => void | Promise<void>
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Smartphone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <span className="truncate flex-1" title={`${staffName} · ${fp}`}>{label || fp.slice(0, 8)}</span>
      <Button variant="ghost" size="icon" className="h-6 w-6"
        title="Reset device binding"
        onClick={onReset}>
        <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
      </Button>
    </div>
  )
}

function FlagsCell({ flags }: { flags: string[] | null }) {
  if (!flags || flags.length === 0) return <span className="text-muted-foreground text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map(f => (
        <span key={f} className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${flagStyle(f)}`}>
          {f.replace(/_/g, ' ')}
        </span>
      ))}
    </div>
  )
}

function flagStyle(f: string): string {
  if (f === 'outside_geofence' || f === 'device_mismatch') return 'bg-red-50 text-red-700 border-red-200'
  if (f === 'override_approved') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (f === 'device_first_bind') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (f === 'low_gps_accuracy' || f === 'no_location') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-stone-50 text-stone-700 border-stone-200'
}
```

- [ ] **Step 7: Verify types + build**

```bash
npm run lint:types
npm run build
```

Expected: both pass. Common type errors and fixes:
- `Property 'device_fingerprint' does not exist on type 'AttendanceRecord'` → already mitigated via `(r as any)` casts that match existing pattern in this file.
- Missing import of `useStaffRole` in `AttendanceTab` scope → it's imported at top of file already (line 6).

- [ ] **Step 8: Commit**

```bash
git add src/pages/staff/HRPage.tsx
git commit -m "feat(attendance): wire override panel, reports, device + flags columns into HRPage"
```

---

## Task 10: TypedDB entries for new tables

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Add the new wrappers**

Open `src/lib/db.ts`. Locate the `TypedDB` type definition (around line 44). Add the two new tables alongside the existing `hr_*` entries:

```typescript
hr_attendance: TableWrapper<any>
  hr_leave_requests: TableWrapper<any>
  hr_payroll: TableWrapper<any>
  hr_performance_reviews: TableWrapper<any>
  hr_job_applications: TableWrapper<any>
  hr_weekly_revenue: TableWrapper<any>
  staff_device_bindings: TableWrapper<any>            // <-- add
  attendance_override_requests: TableWrapper<any>     // <-- add
```

(Order matters only for readability; functionality comes from the `Record<string, TableWrapper<any>>` extension.)

- [ ] **Step 2: Verify types**

```bash
npm run lint:types
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "chore(db): register staff_device_bindings + attendance_override_requests"
```

---

## Task 11: Final lint + build + manual QA

**Files:** none

- [ ] **Step 1: Full lint pass**

```bash
npm run lint
```

Expected: pass. Fix any lint-fail caused by this work (do not touch unrelated warnings).

- [ ] **Step 2: Production build**

```bash
npm run build:prod
```

Expected: success. Bundle size delta should be minimal (no new dependencies).

- [ ] **Step 3: Manual QA checklist (run against deployed preview or local `npm run dev`)**

Tick each:

- [ ] Admin HR page loads; Attendance tab renders.
- [ ] QR code displays; URL still `/staff/clock?t=<token>`.
- [ ] Live Now panel renders.
- [ ] Reports panel renders; switching Day/Week/Month/Quarter/Year updates the totals.
- [ ] Reports Export downloads a CSV that opens cleanly.
- [ ] Existing attendance records still display in the records table (older rows show `—` in Device + Flags).
- [ ] Mobile card view renders cleanly on a small viewport (DevTools mobile mode).
- [ ] Manual log dialog still creates a record.
- [ ] Existing CSV export still works.
- [ ] Other HR tabs (Leave, Payroll, Performance, Applications, Revenue) still load.

Staff side:

- [ ] Scan QR (or open `/staff/clock?t=<live-token>`); page loads.
- [ ] At hotel (or within 150m of `6.7127, -1.6250` with mock GPS) → Clock In succeeds, success state shows.
- [ ] More than 150m away → Clock In blocks with "Outside hotel"; Request override CTA appears.
- [ ] Submit override → admin tab shows pending request in real time.
- [ ] Admin clicks Approve → staff page auto-completes clock-in.
- [ ] Admin clicks Reject (test on another request) → staff page shows rejection card.
- [ ] After clock-in, Clock Out works and computes hours.

Device-binding:

- [ ] First clock-in for a brand-new staff registers their device (visible in records table Device column).
- [ ] Clock-in from a second browser/profile (different fingerprint) blocks with `device_mismatch`.
- [ ] Admin clicks the ShieldCheck icon in Device cell → next clock-in re-binds the new device.

Token:

- [ ] Crafted bogus `?t=garbage` → blocked with `invalid_token`.
- [ ] Token from previous 10-min window still works (grace).
- [ ] Token from >20 min ago is rejected.

- [ ] **Step 4: Commit any final fixes from QA**

If QA surfaces issues, fix and commit per-task. If none:

```bash
echo "QA passed — no follow-up commits needed."
```

---

## Task 12: Push branch + open PR

**Files:** none

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/attendance-security-redesign
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --head feat/attendance-security-redesign \
  --title "feat(attendance): security & reporting redesign" \
  --body "$(cat <<'EOF'
## Summary
Hardens staff clock-in/out and adds proper admin reports.

### Anti-cheat
- Token validation moved to Supabase RPC (server-authoritative).
- Hard-block geofence: 150m + GPS-accuracy aware.
- Per-staff device fingerprint binding; admin reset via ShieldCheck icon.
- Three-factor proof at clock-in: token + GPS + device.

### Override flow
- Staff blocked legitimately (GPS drift, new phone) request manager override.
- Admin sees pending requests in real time, approves/rejects in two taps.
- Approved override auto-completes the staff clock-in attempt.

### Reports
- New Reports panel in HR → Attendance: Day / Week / Month / Quarter / Year / Custom.
- Server-aggregated via `get_attendance_report` RPC.
- Per-period CSV export.

### Compatibility
- QR URL format unchanged.
- All existing service signatures preserved.
- Old records render gracefully (`—` in new columns).
- Other HR tabs untouched.

### Migration
- One additive SQL migration (`20260512_attendance_security_v2.sql`) — schema + RPCs.
- Apply in Supabase before deploying frontend.

Spec: `docs/superpowers/specs/2026-05-12-attendance-security-redesign.md`
Plan: `docs/superpowers/plans/2026-05-12-attendance-security-redesign.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

**Spec coverage:**
- §3 threat model → Tasks 3 (RPCs), 5 (client RPC calls), 6 (ClockPage flow), 9 (admin panels) — all defenses implemented.
- §4 data layer → Task 2.
- §5 RPCs → Task 3 (all 8 RPCs).
- §6 client layer → Tasks 4 (fingerprint), 5 (service), 6 (ClockPage), 9 (HRPage).
- §7 files → matches "Files Created / Modified" lists exactly.
- §8 backward compat → Task 11 QA verifies; Task 9 keeps existing columns and `notes` rendering paths intact.
- §10 error handling → Task 6 maps each `ClockError` to a phase.
- §11 testing → Task 11 manual QA covers each item.
- §13 acceptance criteria → all seven covered by Task 11 QA bullets.

**Placeholder scan:** No `TBD` / `TODO` / "implement later" in this plan.

**Type consistency:** `ClockError`, `ClockSuccess`, `ClockFailure`, `OverrideRequest`, `AttendanceReport*` are all defined in Task 5 and used identically in Tasks 6, 7, 8. `MAX_DISTANCE_METERS_V2 = 150` matches the server `_amp_hotel().radius = 150`.

**Known soft spots flagged for the executor:**
- Supabase client import path (Task 5 Step 2) may need adjusting from `'@/lib/supabase-wrapper'` to wherever `createClient` is actually exposed in this repo — recon required at execution time.
- The existing `hr_attendance` table appears to be camelCase (`"staffId"`, `"clockIn"`, etc.); the RPCs use double-quoted camelCase column names to match. If the live table uses snake_case, RPCs must be adjusted to match.
- `alter publication supabase_realtime add table ...` may error if realtime is configured differently — non-fatal, comment out and proceed.
