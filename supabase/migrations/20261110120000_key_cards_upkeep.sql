-- Door locks, wave 4: blank card stock, lock upkeep, and the staff card register.
--
-- 1. hotel_settings.key_card_stock_item: the inventory item that counts blank key
--    cards (Settings → Door locks). A card a guest keeps, or a lost card, takes one
--    off it; a kept card brought back puts it back (the card functions do this).
-- 2. lock_upkeep: per door, when its batteries were changed, its clock set, a fault
--    seen and fixed. The locks are offline and cannot report this themselves.
-- 3. staff_key_cards: which staff hold which card made in Joney's program (master,
--    floor, cleaner), so a leaver's cards are collected or cancelled in LQ015.
--
-- Only records: no card is made or changed from here. Safe to run more than once.

alter table public.hotel_settings
  add column if not exists key_card_stock_item uuid references public.inventory(id) on delete set null;
comment on column public.hotel_settings.key_card_stock_item is
  'Inventory item counting blank key cards; kept and lost cards are taken off it.';

create table if not exists public.lock_upkeep (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  kind text not null check (kind in ('battery', 'clock', 'fault', 'fixed', 'note')),
  note text check (note is null or length(note) <= 500),
  done_on date not null default current_date,
  staff_id uuid,
  staff_name text,
  created_at timestamptz not null default now()
);
create index if not exists lock_upkeep_room_idx on public.lock_upkeep (room_id, done_on desc);
comment on table public.lock_upkeep is
  'Door lock upkeep per room: batteries changed, clock set, faults and fixes.';

create table if not exists public.staff_key_cards (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff(id) on delete set null,
  holder_name text not null check (length(holder_name) between 1 and 120),
  kind text not null check (kind in ('master', 'floor', 'cleaner', 'other')),
  label text check (label is null or length(label) <= 80),
  given_on date not null default current_date,
  ended_on date,
  ended_how text check (ended_how in ('returned', 'cancelled', 'lost')),
  note text check (note is null or length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((ended_on is null) = (ended_how is null))
);
create index if not exists staff_key_cards_staff_idx on public.staff_key_cards (staff_id) where ended_on is null;
comment on table public.staff_key_cards is
  'Staff cards made in Joney''s program (master, floor, cleaner): who holds which, until returned or cancelled in LQ015.';

alter table public.lock_upkeep enable row level security;
alter table public.staff_key_cards enable row level security;

-- Any staff member keeps the upkeep log (housekeeping changes batteries).
drop policy if exists lock_upkeep_staff on public.lock_upkeep;
create policy lock_upkeep_staff on public.lock_upkeep
  for all to authenticated
  using (exists (select 1 from public.staff s where s.user_id = auth.uid()))
  with check (exists (select 1 from public.staff s where s.user_id = auth.uid()));

-- Who holds a master card is for managers and up.
drop policy if exists staff_key_cards_managers on public.staff_key_cards;
create policy staff_key_cards_managers on public.staff_key_cards
  for all to authenticated
  using (exists (select 1 from public.staff s where s.user_id = auth.uid() and s.role in ('owner', 'admin', 'manager')))
  with check (exists (select 1 from public.staff s where s.user_id = auth.uid() and s.role in ('owner', 'admin', 'manager')));

notify pgrst, 'reload schema';
