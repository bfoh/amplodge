-- Every new charge and sale must say who took the money.
--
-- Charges added from the guest folio saved created_by = null for months: the
-- dialog never stamped the staff member and nothing objected. 171 rows, GHS
-- 36,026, belonged to nobody — reported under "Unassigned", missing from the
-- staff revenue figures, and only recoverable by inferring who was in the app
-- at the time. Sales are the same shape of risk: standalone_sales.staff_id is
-- NOT NULL but defaults to an empty string, which passes the constraint while
-- meaning exactly the same thing.
--
-- The application now resolves the staff member on every path, and creates a
-- staff row for a signed-in account that lacks one. This is the backstop for
-- when it doesn't: a rule in the database, which no future caller can forget.
--
-- Deliberately a trigger rather than NOT NULL / CHECK: existing rows must stay
-- exactly as they are. 24 historical charges have evidence pointing two ways
-- and are honestly unattributed; a table constraint would have to be validated
-- against them and would either fail or force a guess.

create or replace function public.require_staff_on_charge()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    raise exception 'A charge must record the staff member who added it (booking_charges.created_by)'
      using errcode = '23514',
            hint = 'Pass createdBy, or let bookingChargesService resolve the signed-in user.';
  end if;
  return new;
end;
$$;

create or replace function public.require_staff_on_sale()
returns trigger
language plpgsql
as $$
begin
  if new.staff_id is null or btrim(new.staff_id) = '' then
    raise exception 'A sale must record the staff member who made it (standalone_sales.staff_id)'
      using errcode = '23514',
            hint = 'The sale dialog refuses to save without a signed-in staff member.';
  end if;
  return new;
end;
$$;

-- INSERT only. An UPDATE that leaves the column alone must keep working, so
-- that historical rows can still be corrected or re-attributed later.
drop trigger if exists booking_charges_require_staff on public.booking_charges;
create trigger booking_charges_require_staff
  before insert on public.booking_charges
  for each row execute function public.require_staff_on_charge();

drop trigger if exists standalone_sales_require_staff on public.standalone_sales;
create trigger standalone_sales_require_staff
  before insert on public.standalone_sales
  for each row execute function public.require_staff_on_sale();

comment on function public.require_staff_on_charge() is
  'Refuses a booking charge that records no staff member. Money with nobody attached cannot be reported against anyone.';
comment on function public.require_staff_on_sale() is
  'Refuses a standalone sale that records no staff member (null or blank staff_id).';
