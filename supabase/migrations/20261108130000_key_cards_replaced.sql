-- Lost key cards. Joney's SDK has no lost-card function, so a stay whose card is
-- lost gets new cards with a new DAI: the first time one of them opens the door,
-- the lock refuses every card with the old DAI (tested at a door on 2026-11-07).
-- The stay's old cards are then 'replaced'. Run this before deploying the
-- key-card-order change that writes the new status.

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
  'replaced'        -- the stay got new cards (a card was lost); stops once a new card opens the door
));
