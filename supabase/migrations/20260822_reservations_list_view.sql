-- A list view that returns what the Reservations table draws, and nothing else.
--
-- The page fetched `bookings?select=*` — 1,098 KB for 1,003 rows — of which two
-- thirds is `special_requests`. That column stores the guest snapshot, the room
-- snapshot, the group data and the payment events as HTML comments, and the
-- browser downloaded all of it to render a row showing a name, a room, a date
-- and a payment label.
--
-- Everything the list needs is extracted here instead, so the wire carries the
-- fields rather than the blob. The guest name and room number are resolved here
-- too, which is what lets the page stop fetching the whole guests table (292 KB)
-- and the whole properties table alongside it.
--
-- Columns are the ones the table actually draws. Anything a dialog needs when a
-- row is opened is fetched then, for that row, rather than for all thousand.
-- The comments stay exactly as they are: this is a view, it reads what is
-- already stored and changes nothing.
--
-- security_invoker keeps the caller's RLS in force — a view would otherwise run
-- with the definer's rights and quietly bypass it.

-- Dropped first: `create or replace view` cannot remove a column, so a shape
-- change would fail against an existing view.
drop view if exists public.reservations_list;

create view public.reservations_list
with (security_invoker = on) as
select
  b.id,
  b.guest_id,
  b.room_id,
  b.check_in,
  b.check_out,
  b.status,
  b.source,
  b.total_price,
  b.discount_amount,
  b.final_amount,
  b.num_guests,
  b.payment_method,
  b.invoice_number,
  b.created_at,

  -- Displayed name and email: the snapshot taken at booking time wins, because
  -- it does not move when the shared guests row is edited.
  coalesce(
    nullif(substring(b.special_requests from '<!-- GUEST_SNAPSHOT:(.*?) -->'), '')::jsonb ->> 'name',
    g.name
  ) as guest_name,
  coalesce(
    nullif(substring(b.special_requests from '<!-- GUEST_SNAPSHOT:(.*?) -->'), '')::jsonb ->> 'email',
    g.email
  ) as guest_email,

  -- The live room, falling back to the number recorded at booking time for a
  -- room since renamed or removed.
  coalesce(
    p.room_number,
    nullif(substring(b.special_requests from '<!-- ROOM_SNAPSHOT:(.*?) -->'), '')::jsonb ->> 'roomNumber'
  ) as room_number,

  -- Group membership: the reference is displayed, the id is what Manage Group
  -- queries by.
  nullif(substring(b.special_requests from '<!-- GROUP_DATA:(.*?) -->'), '')::jsonb ->> 'groupId'
    as group_id,
  nullif(substring(b.special_requests from '<!-- GROUP_DATA:(.*?) -->'), '')::jsonb ->> 'groupReference'
    as group_reference,

  -- What has been paid, for the balance shown on the row and at check-out.
  coalesce(
    (nullif(substring(b.special_requests from '<!-- PAYMENT_DATA:(.*?) -->'), '')::jsonb ->> 'amountPaid')::numeric,
    0
  ) as amount_paid,

  -- The methods the guest actually paid with, as a short array rather than the
  -- payment events themselves: a row shows "Cash" or "Cash + Momo", and the
  -- events behind that label are only needed when a row is opened.
  (
    select array_agg(distinct e ->> 'method')
    from jsonb_array_elements(
      coalesce(nullif(substring(b.special_requests from '<!-- PAYMENT_EVENTS:(.*?) -->'), '')::jsonb, '[]'::jsonb)
    ) as e
    where e ->> 'method' is not null
  ) as payment_methods,

  -- The row shows room + charges. Summing here means the page no longer pulls
  -- every charge in the hotel to add up a column.
  coalesce((
    select sum(c.amount) from public.booking_charges c where c.booking_id = b.id
  ), 0) as charges_total

from public.bookings b
left join public.guests g on g.id = b.guest_id
left join public.properties p on p.id = b.room_id;

comment on view public.reservations_list is
  'Reservations list rows with the special_requests metadata already extracted. Draws the table without shipping the blob.';

-- The list is read by date and by status; charges are summed per booking.
create index if not exists idx_bookings_check_in on public.bookings (check_in);
create index if not exists idx_bookings_status_check_in on public.bookings (status, check_in);
create index if not exists idx_bookings_created_at on public.bookings (created_at desc);
create index if not exists idx_booking_charges_booking_id on public.booking_charges (booking_id);

grant select on public.reservations_list to authenticated, service_role;
