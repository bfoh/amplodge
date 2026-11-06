-- Door locks: which lock each room has, the reception PC that writes cards,
-- and every key card written.
--
-- The hotel's Joney locks take guest cards written by a USB encoder on one
-- reception PC. A small Windows app there (the lock bridge) writes a card only
-- when it holds an order signed by key-card-order, and reports the result to
-- key-card-receipt. These tables are written ONLY by those Netlify functions
-- (service role). Signed-in staff may read room_locks and key_cards; nobody
-- in the browser may read lock_encoders, which holds the device credentials.
--
-- key_cards is the record of who was given access to which door until when.
-- It is not editable from the browser (activity_logs is), so it is the audit
-- trail for door access.
--
-- Deploy order does not matter: nothing calls the functions until an encoder
-- PC is paired, and the portal hides door-lock features until room_locks has
-- rows. Idempotent.

-- ─── room_locks: the lock number(s) a room's guest card opens ────────────────
-- Normally one row per room. A suite with two doors (110+109) has two rows.
-- lock_no is the 8-digit number the lock software uses for that door.
create table if not exists public.room_locks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  lock_no text not null unique check (lock_no ~ '^[0-9]{8}$'),
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists room_locks_room_id_idx on public.room_locks (room_id);

-- ─── lock_encoders: the paired reception PC(s) ───────────────────────────────
-- The bridge proves who it is with a device token; only its sha256 is stored,
-- as with clock_kiosks. A pairing code (also stored hashed) is valid for ten
-- minutes and is swapped once for the token.
create table if not exists public.lock_encoders (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  token_hash text unique,
  pairing_code_hash text unique,
  pairing_expires_at timestamptz,
  created_by uuid,            -- staff.id of the admin who started pairing
  paired_at timestamptz,
  last_seen_at timestamptz,
  bridge_version text,
  dll_version text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── key_cards: one row per physical card written ────────────────────────────
create table if not exists public.key_cards (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  -- Snapshot at issue time, so the record survives edits and deletions.
  guest_name text,
  room_number text,
  lock_nos text[] not null,
  order_nonce text not null,
  card_no smallint not null check (card_no between 0 and 15),
  issue_time timestamptz not null,   -- the start time written on the card
  valid_until timestamptz not null,  -- the end time written on the card
  status text not null default 'pending' check (status in (
    'pending',        -- ordered, not yet written
    'issued',         -- written and confirmed by the bridge
    'failed',         -- the write failed; the card does not open anything
    'unknown',        -- the write was cut off; read the card to find out
    'returned',       -- back at reception
    'not_returned',   -- the guest left with it; it opens the door until it expires
    'killed_at_door', -- cancelled at the door with the lock software's card
    'erased'          -- erased on the encoder
  )),
  encoder_id uuid references public.lock_encoders(id),
  issued_by uuid,     -- staff.id
  updated_by uuid,    -- staff.id of the last status change from the portal
  error text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_nonce, card_no)
);
create index if not exists key_cards_booking_id_idx on public.key_cards (booking_id);
create index if not exists key_cards_live_idx on public.key_cards (status, valid_until);

-- ─── Access ──────────────────────────────────────────────────────────────────
alter table public.room_locks enable row level security;
alter table public.lock_encoders enable row level security;
alter table public.key_cards enable row level security;

drop policy if exists room_locks_read on public.room_locks;
create policy room_locks_read on public.room_locks
  for select to authenticated using (true);

drop policy if exists key_cards_read on public.key_cards;
create policy key_cards_read on public.key_cards
  for select to authenticated using (true);

-- lock_encoders: no policies, so no browser access at all.

-- The Key cards page updates live.
do $$
begin
  begin alter publication supabase_realtime add table public.key_cards; exception when duplicate_object then null; end;
end $$;
