-- ────────────────────────────────────────────────────────────────────────────
-- Remove shift schedules. Clock-in/out time recording is unchanged.
-- ────────────────────────────────────────────────────────────────────────────
--
-- Product decision: drop the per-staff weekly shift schedule (and the late/
-- absent detection it drove). Attendance now just records the actual clock-in
-- and clock-out time for each staff member — no schedule, no lateness.
--
-- The clock_in_attendance body is intentionally NOT rewritten. It resolves the
-- day's shift via _amp_resolve_shift and only computes lateness when a shift
-- exists. With every shift deleted and no way to create new ones, that lookup
-- always returns null, so:
--   * status is always 'present' (never 'late'/'absent'),
--   * late_minutes = 0, shift_id = null,
--   * clock_in_at / clock_out_at (and the legacy clock_in / clock_out text)
--     are still written exactly as before.
--
-- Existing historical rows keep whatever status/late_minutes they were given.
--
-- Apply after 20260721..20260726. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Clear all schedules.
delete from public.hr_shifts;

-- 2. Block creation/deletion of shifts from any client — the shift editor UI is
--    gone, and these RPCs must not be reachable via the API either. The read
--    helpers (_amp_resolve_shift, get_shifts) stay; they simply return nothing.
revoke execute on function public.upsert_shift(text, int, time, time, int) from public, anon, authenticated;
revoke execute on function public.delete_shift(text)                        from public, anon, authenticated;

-- Verify: no shifts remain, and the write RPCs are no longer granted to
-- authenticated.
select
  (select count(*) from public.hr_shifts) as shifts_remaining,
  has_function_privilege('authenticated', 'public.upsert_shift(text, int, time, time, int)', 'EXECUTE') as upsert_still_granted,
  has_function_privilege('authenticated', 'public.delete_shift(text)', 'EXECUTE') as delete_still_granted;
