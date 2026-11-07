-- Door locks, part 2: what Joney's own SDK (V0925, received 2026-11-07) needs.
--
-- 1. A lock number is the 6-character code the Lock Management System shows for
--    each door (0-9 and A-F, e.g. 01020A; the same code as its "Export LockNo"
--    file), not 8 digits. Stored in capitals.
-- 2. Every key card carries a "DAI" (1..255). All cards of one stay share it;
--    the next stay in the room gets a different one. Once a card with a new DAI
--    has opened the door, the lock refuses cards with the old one, so the last
--    guest's card stops working as soon as the next guest goes in.
--
-- Safe to run more than once. Stops with a message, changing nothing, if a
-- lock number was already saved in the old 8-digit form.

do $$
declare c text;
begin
  if exists (select 1 from public.room_locks where lock_no !~ '^[0-9A-F]{6}$') then
    raise exception 'room_locks holds lock numbers in the old 8-digit form. Remove them on the Rooms page, run this again, then enter the 6-character codes from the Lock Management System.';
  end if;
  for c in
    select conname from pg_constraint
    where conrelid = 'public.room_locks'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%lock_no%'
  loop
    execute format('alter table public.room_locks drop constraint %I', c);
  end loop;
end $$;

alter table public.room_locks add constraint room_locks_lock_no_check check (lock_no ~ '^[0-9A-F]{6}$');
comment on column public.room_locks.lock_no is 'The 6-character lock code from Joney''s Lock Management System (0-9, A-F).';

alter table public.key_cards add column if not exists dai smallint;
do $$
begin
  alter table public.key_cards add constraint key_cards_dai_check check (dai between 1 and 255);
exception when duplicate_object then null;
end $$;
comment on column public.key_cards.dai is 'The card''s DAI: the same for every card of one stay, new for the next stay. A newer card used at the door locks out older ones.';
