-- Key cards, money and guests (wave 3). Every column is new and optional. The app
-- runs without them, and each feature switches on once this has been run.
--
-- bookings.late_check_out    A later check-out time on check-out day ('14:00'), at
--                            most 18:00. The stay's cards stop an hour after it.
-- bookings.key_cards_until   The stay's cards stop on this day (at check-out time
--                            plus an hour) instead of the check-out day: for guests
--                            who pay night by night. Null means the whole stay.
-- bookings.checkout_sms_sent_on  The day the check-out morning SMS went, so it goes once.
-- hotel_settings.key_card_fee     The charge offered for a card kept or lost. Null or 0: none offered.
-- hotel_settings.checkout_morning_sms  Send guests leaving today an SMS in the morning.

alter table public.bookings add column if not exists late_check_out text
  constraint bookings_late_check_out_check check (late_check_out is null or late_check_out ~ '^(1[2-8]):00$');
alter table public.bookings add column if not exists key_cards_until date;
alter table public.bookings add column if not exists checkout_sms_sent_on date;

alter table public.hotel_settings add column if not exists key_card_fee numeric(10, 2)
  constraint hotel_settings_key_card_fee_check check (key_card_fee is null or key_card_fee >= 0);
alter table public.hotel_settings add column if not exists checkout_morning_sms boolean not null default true;

comment on column public.bookings.late_check_out is 'Late check-out time on check-out day (HH:00, 12:00 to 18:00). Key cards stop an hour after it.';
comment on column public.bookings.key_cards_until is 'Key cards stop on this day instead of the check-out day (guests paying night by night). Null: the whole stay.';
comment on column public.bookings.checkout_sms_sent_on is 'The day the check-out morning SMS was sent for this booking.';
comment on column public.hotel_settings.key_card_fee is 'Charge offered when a key card is kept or lost. Null or 0: none offered.';
comment on column public.hotel_settings.checkout_morning_sms is 'Send guests leaving today an SMS on check-out morning.';

-- PostgREST reads the new columns at once.
notify pgrst, 'reload schema';
