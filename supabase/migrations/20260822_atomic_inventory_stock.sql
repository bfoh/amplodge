-- Atomic inventory stock movements.
--
-- The client used to read stock_quantity, subtract in JavaScript, and write the
-- result back. Two sales of the same item at the same moment both read the same
-- starting figure, so one of the deductions was silently lost and the shelf no
-- longer matched the system — the classic lost update.
--
-- adjust_inventory_stock() does the arithmetic inside a single UPDATE, which
-- takes a row lock, so concurrent movements queue instead of overwriting each
-- other. The transaction log row is written in the same statement's
-- transaction, so stock and its audit trail can never disagree.
--
-- Stock is deliberately allowed to go negative, exactly as before: a sale must
-- never be blocked because the count has drifted, and a negative figure is a
-- visible signal that a restock was missed.

create or replace function public.adjust_inventory_stock(
  p_inventory_id uuid,
  p_delta integer,
  p_type text,
  p_staff_id text default null,
  p_staff_name text default null,
  p_notes text default ''
)
returns table (remaining_stock integer, transaction_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_stock integer;
  v_transaction_id uuid;
begin
  if p_delta = 0 then
    raise exception 'adjust_inventory_stock: delta must be non-zero'
      using errcode = '22023';
  end if;

  if p_type not in ('sale', 'restock', 'adjustment') then
    raise exception 'adjust_inventory_stock: type must be sale, restock or adjustment (got %)', p_type
      using errcode = '22023';
  end if;

  -- Atomic read-modify-write: the row is locked for the duration of the
  -- statement, so a concurrent movement waits and applies to the new figure.
  update public.inventory
     set stock_quantity = stock_quantity + p_delta,
         updated_at = now()
   where id = p_inventory_id
  returning stock_quantity into v_new_stock;

  if not found then
    raise exception 'adjust_inventory_stock: inventory item % not found', p_inventory_id
      using errcode = 'P0002';
  end if;

  insert into public.inventory_transactions (
    inventory_id, type, quantity, remaining_stock, staff_id, staff_name, notes
  ) values (
    p_inventory_id, p_type, p_delta, v_new_stock, p_staff_id, p_staff_name, nullif(p_notes, '')
  )
  returning id into v_transaction_id;

  return query select v_new_stock, v_transaction_id;
end;
$$;

comment on function public.adjust_inventory_stock(uuid, integer, text, text, text, text) is
  'Atomically move inventory stock by p_delta and log the movement. Negative delta = sale/consumption, positive = restock. Returns the resulting stock level and the transaction id.';

grant execute on function public.adjust_inventory_stock(uuid, integer, text, text, text, text)
  to authenticated, service_role;
