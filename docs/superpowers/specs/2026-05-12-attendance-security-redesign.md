# Staff Attendance Security & Reporting Redesign — Design Spec

**Date:** 2026-05-12
**Project:** AMP Lodge Hotel Management System
**Feature:** Hardened staff clock-in/out + admin reporting
**Approach:** Layered upgrade (additive, zero-break)

---

## 1. Goals

1. Eliminate practical cheating paths (off-site clock-in, QR screenshot reuse, login sharing).
2. Improve GPS accuracy and reduce false positives/negatives.
3. Give admins proper weekly / monthly / quarterly / yearly reports.
4. Preserve every existing feature: QR URL format, attendance records, CSV export, manual logging, live-now panel, all other HR tabs.

---

## 2. Non-Goals

- No selfie / photo capture (defer).
- No schema rewrite of `hr_attendance` (additive only).
- No change to QR code URL format or token rotation cadence.
- No change to other HR tabs (leave, payroll, performance, applications, revenue).

---

## 3. Threat Model & Defenses

| Attack | Current Status | New Defense |
|---|---|---|
| Screenshot QR, scan from home | Mitigated by 10-min rotation; client validation bypassable | Token validation moved to Supabase RPC |
| Fake GPS / mock location app | Soft-flagged only | 150m + accuracy-aware hard-block server-side |
| Share login with off-site colleague | No defense | Device fingerprint binding per staff |
| New phone every shift | No defense | Admin-only device binding reset |
| Craft fake `?t=` URL | Client-side check bypassable | Server RPC enforces window |
| Clock in for absent friend | No defense | Three-factor: token + GPS + bound device |
| GPS drift falsely blocks legitimate staff | N/A (soft-flag) | Real-time override request → admin approves |

Three-factor proof: **valid token + within geofence + bound device**. Any factor failing → block + override path.

---

## 4. Data Layer

### 4.1 Additive migration on `hr_attendance`

All new columns nullable. Old rows unaffected.

```sql
alter table hr_attendance
  add column device_fingerprint text,
  add column gps_lat numeric,
  add column gps_lng numeric,
  add column gps_accuracy numeric,
  add column gps_distance numeric,
  add column gps_samples jsonb,
  add column override_reason text,
  add column override_requested_at timestamptz,
  add column override_approved_by text,
  add column override_approved_at timestamptz,
  add column flags text[] default '{}';
```

`flags` examples: `outside_geofence`, `device_mismatch`, `low_gps_accuracy`, `manual`, `override_approved`, `token_grace`.

### 4.2 New table `staff_device_bindings`

```sql
create table staff_device_bindings (
  staff_id text primary key,
  device_fingerprint text not null,
  device_label text,
  bound_at timestamptz default now(),
  last_used_at timestamptz default now(),
  reset_count int default 0
);
```

One device per staff. Admin reset increments `reset_count` (audit).

### 4.3 New table `attendance_override_requests`

```sql
create table attendance_override_requests (
  id text primary key,
  staff_id text not null,
  staff_name text not null,
  reason text not null,           -- 'gps_drift' | 'new_device' | 'other'
  reason_note text,
  gps_lat numeric,
  gps_lng numeric,
  gps_accuracy numeric,
  gps_distance numeric,
  device_fingerprint text,
  device_label text,
  status text default 'pending',  -- 'pending' | 'approved' | 'rejected' | 'expired'
  requested_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by text,
  admin_note text
);

create index on attendance_override_requests (status, requested_at desc);
```

Override request auto-expires after 15 minutes if untouched.

### 4.4 Indexes for reporting

```sql
create index if not exists hr_attendance_date_idx on hr_attendance (date desc);
create index if not exists hr_attendance_staff_date_idx on hr_attendance (staff_id, date desc);
```

---

## 5. Server-Side RPCs

All `security definer`. RLS unchanged elsewhere.

### 5.1 `validate_clock_token(p_token text) returns boolean`

Decodes base64 token, compares to current 10-min window or previous window (grace).

### 5.2 `clock_in_attendance(...) returns jsonb`

```
inputs:  p_token, p_staff_id, p_staff_name,
         p_lat, p_lng, p_accuracy, p_samples (jsonb),
         p_device_fp, p_device_label,
         p_override_request_id (nullable)

logic:
  1. validate_clock_token → if false, return { ok:false, error:'invalid_token' }
  2. check distance from hotel using haversine on server
     effective_distance = max(0, distance - accuracy)
     if effective_distance > 150 AND no approved override:
       return { ok:false, error:'outside_geofence', distance, accuracy }
  3. check device binding:
       if no binding → insert binding (first-time staff)
       else if fp mismatch AND no approved override:
         return { ok:false, error:'device_mismatch' }
       else update last_used_at
  4. if override_request_id present and status='approved' for this staff:
       attach override metadata, mark request 'consumed', add flag 'override_approved'
  5. insert hr_attendance row with all GPS columns + flags
  6. return { ok:true, record_id, flags }
```

Hotel coords + radius stored as constants in RPC (single source of truth).

### 5.3 `clock_out_attendance(p_staff_id, p_token) returns jsonb`

Validates token, finds open record (today or yesterday for overnight shift), computes hours, writes clock_out.

### 5.4 `request_attendance_override(...) returns jsonb`

Inserts row in `attendance_override_requests` with `status='pending'`. Returns request id. Client polls or subscribes for approval.

### 5.5 `approve_attendance_override(p_request_id, p_admin_id, p_note) returns jsonb`

Admin-only (role check). Sets status='approved', resolved_at, resolved_by.

### 5.6 `reject_attendance_override(p_request_id, p_admin_id, p_note)`

Admin-only. status='rejected'.

### 5.7 `reset_device_binding(p_staff_id, p_admin_id) returns jsonb`

Admin-only. Deletes binding row + increments `reset_count` via audit log entry. Next clock-in re-binds.

### 5.8 `get_attendance_report(p_start date, p_end date) returns jsonb`

Server-aggregated metrics (faster than client-side for year-long ranges):
```
{
  totals: { hours, present_days, late, absent, overrides, outside_geofence },
  per_staff: [{ staff_id, name, days, hours, late, avg_per_day }],
  daily: [{ date, count, hours }]
}
```

---

## 6. Client Layer

### 6.1 Device fingerprint module — `src/services/device-fingerprint.ts`

```typescript
export async function getDeviceFingerprint(): Promise<{ fp: string; label: string }>
```

Composite SHA-256 of:
- `navigator.userAgent`
- `screen.width × screen.height × devicePixelRatio`
- `Intl.DateTimeFormat().resolvedOptions().timeZone`
- `navigator.hardwareConcurrency`
- Per-device random salt stored at `localStorage.amp_device_salt` (generated once)

Result truncated to 16 hex chars. Label = parsed browser + OS, e.g. `iPhone · Safari 17`.

### 6.2 Attendance service additions — `src/services/attendance-service.ts`

Extend, do not replace. New exports:

```typescript
export async function clockInServer(opts: {
  token: string
  staffId: string
  staffName: string
  location: LocationData
  samples: GpsSample[]
  device: { fp: string; label: string }
  overrideRequestId?: string
}): Promise<{ ok: true; record: AttendanceRecord } | { ok: false; error: ClockError; details?: any }>

export async function clockOutServer(staffId: string, token: string): Promise<...>

export async function resolveLocationMultiSample(
  count = 3,
  timeoutMs = 5000
): Promise<{ best: LocationData; samples: GpsSample[] } | 'denied' | null>

export async function requestOverride(opts: {
  staffId: string
  staffName: string
  reason: 'gps_drift' | 'new_device' | 'other'
  reasonNote?: string
  location?: LocationData
  device: { fp: string; label: string }
}): Promise<{ id: string }>

export async function getAttendanceReport(
  start: string, end: string
): Promise<AttendanceReport>
```

Existing fns (`clockIn`, `clockOut`, `getTodayRecord`, `getLiveAttendance`, `getRecentAttendance`, `parseLocationFromNotes`, `getNotesLabel`, `downloadCsv`, `generateClockUrl`, `secondsUntilNextToken`, `isValidToken`) stay untouched for backward compatibility.

### 6.3 Multi-sample GPS strategy

```
take up to 3 readings within 5 seconds total budget
pick reading with lowest accuracy value (best precision)
keep all 3 in gps_samples for audit
abort early if first reading has accuracy < 20m
```

Reduces false positives from transient bad readings.

### 6.4 ClockPage rewrite — `src/pages/staff/ClockPage.tsx`

Same visual feel (greeting, big time, big buttons, shift summary). New internal state machine:

```
states: 'loading' | 'idle' | 'acquiring' | 'submitting'
      | 'success_in' | 'success_out'
      | 'blocked_token' | 'blocked_geofence' | 'blocked_device'
      | 'override_pending' | 'override_rejected'

flow:
  loading → idle (record exists? show clock-out path)
  idle → tap → acquiring
  acquiring → resolveLocationMultiSample
  acquiring → submitting → clockInServer RPC
  submitting → success_in (happy path)
  submitting → blocked_geofence → show distance + 'Request override' button
  submitting → blocked_device  → 'New device? Request override' button
  blocked_* → tap override → fill reason → submit → override_pending
  override_pending → subscribe to attendance_override_requests for this id
                  → on approved → automatically retry clockInServer
                  → on rejected → override_rejected (show reason, allow new attempt)
```

UI per state:
- `blocked_geofence`: "You appear to be **{dist}m** from the hotel. If GPS is wrong, request a manager override."
- `blocked_device`: "This device is not registered for {name}. If you have a new phone, request a manager override."
- `override_pending`: animated badge + "Waiting for manager approval…" + cancel button.

### 6.5 Admin HR Page additions — `src/pages/staff/HRPage.tsx`

`AttendanceTab` gains two new collapsible panels and one new column.

**Panel order:**
1. QR Code Panel (unchanged)
2. **NEW** Override Requests Panel (only visible when pending count > 0)
3. Live Now Panel (unchanged)
4. Stats cards (unchanged)
5. **NEW** Reports Panel (collapsible, default open)
6. Attendance Records table (existing, +2 columns)

#### Override Requests Panel — `src/components/hr/OverridePanel.tsx`

Realtime via `useSubscription('attendance_override_requests')`.

```
┌─ ⚠ Override Requests — 2 pending ──────────────────┐
│ asare B · GPS drift · 287m away · iPhone · Safari  │
│   "GPS bad inside lobby"   [✓ Approve] [✗ Reject]  │
│ ────────────────────────────────────────────────── │
│ Daniella A · New device · — · Pixel · Chrome       │
│   "Lost old phone"          [✓ Approve] [✗ Reject] │
└────────────────────────────────────────────────────┘
```

Auto-hidden when 0 pending. Approve/reject calls respective RPC. Toast on result. Resolved requests fade out 3s.

#### Reports Panel — `src/components/hr/ReportsPanel.tsx`

```
┌─ Reports ──────────────────────────────────────────┐
│ [Day][Week][Month][Quarter][Year][Custom]  [Export]│
│ ◀ Nov 4 – Nov 10, 2026 ▶                          │
│                                                    │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐         │
│  │312h │ │ 47  │ │  3  │ │  2  │ │  1  │         │
│  │Total│ │Days │ │Late │ │Abs. │ │Ovrd.│         │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘         │
│                                                    │
│  Per-staff:                                        │
│  ┌────────────┬────┬──────┬────┬──────┐           │
│  │ Staff      │Days│Hours │Late│Avg/d │           │
│  ├────────────┼────┼──────┼────┼──────┤           │
│  │ asare B    │ 6  │42.5h │ 0  │7.1h  │           │
│  │ Daniella A │ 5  │38.0h │ 1  │7.6h  │           │
│  └────────────┴────┴──────┴────┴──────┘           │
└────────────────────────────────────────────────────┘
```

Implementation:
- Periods: Day, Week (Sun–Sat), Month, Quarter, Year, Custom (date range picker)
- Navigation: ◀ ▶ buttons step by period
- Data via `get_attendance_report` RPC (server-aggregated)
- Export CSV: per-staff totals + raw rows for chosen period
- Caches last-fetched range in memory; refetches on `useSubscription('hr_attendance')` bump

#### Records table — 2 new columns

| Existing | New | New |
|---|---|---|
| Staff, Date, In, Out, Hours, Status, Location, Notes, ✕ | **Device** | **Flags** |

Device column: shows label (truncated) + icon. Click → admin modal: reset binding, view history.
Flags column: chips for `override`, `outside`, `manual`, etc. Old rows show `—`.

Mobile card view: device + flags appear in the existing meta strip.

---

## 7. Files Touched

```
NEW:
  supabase/migrations/20260512_attendance_security_v2.sql
  src/services/device-fingerprint.ts
  src/components/hr/OverridePanel.tsx
  src/components/hr/ReportsPanel.tsx

MODIFIED:
  src/services/attendance-service.ts   (extend with new fns; do not delete old)
  src/pages/staff/ClockPage.tsx        (rewrite flow, keep visual feel)
  src/pages/staff/HRPage.tsx           (add OverridePanel + ReportsPanel + 2 columns in AttendanceTab)
  src/lib/db.ts                        (typed accessors for new tables)
```

Zero file deletions. All UI/API surface changes additive.

---

## 8. Backward Compatibility Guarantees

1. **QR URL identical** — `/staff/clock?t=<base64-window>`. Existing printed QR codes still work; the routes still accept any token, even from old print-outs (validated by 10-min window logic).
2. **Existing records render** — new columns null → table displays `—`.
3. **`notes` LOC-encoding** — `parseLocationFromNotes` still called for old rows lacking native GPS columns.
4. **Public service signatures preserved** — `clockIn`, `clockOut`, `getTodayRecord`, `getLiveAttendance`, `getRecentAttendance`, `downloadCsv`, `generateClockUrl`, `secondsUntilNextToken`, `isValidToken`, `resolveLocation`, `parseLocationFromNotes`, `getNotesLabel`, `distanceFromHotel`, `isWithinHotel`, `exportToCsv` all keep their current signatures.
5. **Other HR tabs untouched** — leave, payroll, performance, applications, revenue logic unchanged.
6. **Manual logging dialog** — unchanged. Admin can still log historical attendance.
7. **CSV export** — still works; new fields appended as additional columns at end so existing spreadsheets that parse by column index break only if relying on trailing comma counts.

---

## 9. Roll-out Order

1. Apply migration (schema additions only — no data move).
2. Deploy RPCs (`validate_clock_token`, `clock_in_attendance`, `clock_out_attendance`, `request_attendance_override`, `approve_attendance_override`, `reject_attendance_override`, `reset_device_binding`, `get_attendance_report`).
3. Ship `device-fingerprint.ts` + extended `attendance-service.ts` (no UI change yet).
4. Ship new `ClockPage.tsx` (live to staff).
5. Ship `OverridePanel` + `ReportsPanel` in `HRPage`.
6. Add `Device` + `Flags` columns to records table.

Each step independently revertable.

---

## 10. Error Handling

| Failure | User-facing message | Server log |
|---|---|---|
| `invalid_token` | "QR expired. Scan latest QR at entrance." | warn |
| `outside_geofence` | "You're {dist}m from hotel. Request override?" | info |
| `device_mismatch` | "New device? Request override." | info |
| RPC network error | "Network problem. Retrying…" + auto-retry 3× | error |
| GPS denied | Override path with `reason=gps_drift, note='permission_denied'` | info |
| GPS timeout | Override path with `reason=gps_drift, note='timeout'` | info |

All RPC errors return shape `{ ok: false, error: <code>, details? }`. Client switches UI per `error` code only.

---

## 11. Testing

### Unit
- `device-fingerprint.ts` — deterministic across reloads, changes when salt cleared.
- `resolveLocationMultiSample` — picks best of N readings, time-budget respected, handles partial failures.
- `attendance-service` new fns — happy-path + each error code.

### Integration (Supabase test schema)
- `clock_in_attendance` end-to-end: token + geofence + device → record written.
- Override flow: request → approve → retry clock-in succeeds with `override_approved` flag.
- `get_attendance_report` aggregates match raw row sums.

### Manual QA checklist
- Old QR code printout still works.
- Old attendance records still render with `—` in new columns.
- Manual log dialog still creates a record.
- CSV export still downloads, opens cleanly in spreadsheet.
- All other HR tabs (leave, payroll, performance, applications, revenue) still load and function.
- Clock in at hotel (real GPS) succeeds.
- Clock in 1 km away gets blocked.
- Override request appears on admin page in real time.
- Reset device binding → next clock-in re-binds.

---

## 12. Open Questions

None at this stage. All major decisions locked:
- Anti-cheat: hard-block + override path
- Device binding: yes, first-use lock, admin reset
- Selfie: deferred
- Reports: sub-section inside Attendance tab
- Radius: 150m + accuracy-aware
- Server token validation: yes, via RPC

---

## 13. Acceptance Criteria

1. Staff cannot clock in from outside 150m + GPS-accuracy buffer without an approved override.
2. Staff cannot clock in on a device other than their bound device without an approved override.
3. Token validation runs server-side; tampered tokens rejected.
4. Admin sees pending override requests in real time and can approve/reject in <2 taps.
5. Admin can view per-staff attendance for any day, week, month, quarter, year, or custom range with summary metrics.
6. All existing functionality (QR display, manual logging, live now, CSV export, other HR tabs) continues to work identically.
7. Old attendance records pre-dating this work display gracefully (no broken UI).
