-- Backfill guests.name where it is missing or stuck on the literal "Guest"
-- fallback that the booking engine used to write when the form submitted an
-- empty fullName.
--
-- Strategy:
--  1. Pull the GUEST_SNAPSHOT JSON out of the most recent linked booking's
--     special_requests column.
--  2. If snapshot.name is non-empty and not "Guest", use it.
--  3. Otherwise derive a readable name from the email local-part.
--
-- Idempotent: only updates rows whose current name is null/empty/"Guest".

BEGIN;

-- 1. Backfill from GUEST_SNAPSHOT in the latest booking per guest.
WITH snapshot_per_guest AS (
    SELECT DISTINCT ON (b.guest_id)
        b.guest_id,
        NULLIF(
            TRIM(BOTH '"' FROM (
                regexp_match(
                    b.special_requests,
                    '<!-- GUEST_SNAPSHOT:.*?"name"\s*:\s*"([^"]*)".*?-->'
                )
            )[1]),
            ''
        ) AS snapshot_name
    FROM bookings b
    WHERE b.special_requests IS NOT NULL
      AND b.special_requests LIKE '%GUEST_SNAPSHOT%'
    ORDER BY b.guest_id, b.created_at DESC
)
UPDATE guests g
SET name = s.snapshot_name
FROM snapshot_per_guest s
WHERE g.id = s.guest_id
  AND s.snapshot_name IS NOT NULL
  AND s.snapshot_name <> 'Guest'
  AND (g.name IS NULL OR g.name = '' OR g.name = 'Guest');

-- 2. Derive from email local-part for any guest still labelled "Guest"/empty.
--    "jane.doe@example.com" -> "Jane Doe"
UPDATE guests
SET name = INITCAP(
    REPLACE(
        REPLACE(SPLIT_PART(email, '@', 1), '.', ' '),
        '_', ' '
    )
)
WHERE (name IS NULL OR name = '' OR name = 'Guest')
  AND email IS NOT NULL
  AND email <> ''
  AND email NOT LIKE '%@guest.local'      -- skip placeholder emails
  AND email NOT LIKE 'fallback-%'         -- skip fallback fake emails
  AND SPLIT_PART(email, '@', 1) <> '';

-- 3. Last-resort tag so staff can spot orphans in the UI.
UPDATE guests
SET name = 'Guest #' || UPPER(SUBSTRING(id::text, 1, 4))
WHERE name IS NULL OR name = '' OR name = 'Guest';

COMMIT;
