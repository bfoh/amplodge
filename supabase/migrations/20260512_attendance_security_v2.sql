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
