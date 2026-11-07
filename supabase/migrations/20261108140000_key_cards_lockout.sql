-- Lock-out cards. A door lock is offline, so a card that should be dead keeps
-- opening the door until its end time unless the lock is told at the door. A
-- lock-out card does that from the AMP Lodge app: a short guest card for the
-- empty room with a new DAI. Held to the lock once, it makes the lock refuse every
-- older card (tested at a door on 2026-11-07).
--
-- Adds key_cards.kind ('guest' or 'lockout') and the 'locked_out' status. It also
-- includes 'replaced' (20261108130000), so running only this one is enough.
-- Run it before deploying the key-card-lockout function.

alter table public.key_cards add column if not exists kind text not null default 'guest'
  constraint key_cards_kind_check check (kind in ('guest', 'lockout'));

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.key_cards'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.key_cards drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.key_cards add constraint key_cards_status_check check (status in (
  'pending',        -- ordered, not yet written
  'issued',         -- written and confirmed by the bridge
  'failed',         -- the write failed; the card does not open anything
  'unknown',        -- the write was cut off; read the card to find out
  'returned',       -- back at reception
  'not_returned',   -- the guest left with it; it opens the door until it expires, or until the next stay's card is used
  'killed_at_door', -- cancelled at the door with the lock software's card
  'erased',         -- erased on the encoder
  'replaced',       -- the stay got new cards (a card was lost); stops once a new card opens the door
  'locked_out'      -- a lock-out card was made for its door; stops once that card is used at the door
));
