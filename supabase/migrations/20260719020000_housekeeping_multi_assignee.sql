-- Multi-staff housekeeping assignment.
--
-- Adds assigned_to_ids (jsonb array of staff ids) so a task can be assigned to
-- several housekeepers at once. The existing single `assigned_to` column is
-- kept as the PRIMARY assignee (first in the list) for backward compatibility
-- with any code/report that still reads it.
--
-- Existing rows: assigned_to_ids defaults to '[]'. The app reads
-- assigned_to_ids when non-empty, otherwise falls back to [assigned_to], so
-- previously-assigned tasks keep displaying their single assignee.

ALTER TABLE public.housekeeping_tasks
  ADD COLUMN IF NOT EXISTS assigned_to_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
