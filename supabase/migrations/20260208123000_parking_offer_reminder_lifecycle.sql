alter table public.parking_bookings
  add column if not exists initial_request_sms_sent boolean not null default false,
  add column if not exists unpaid_week_before_sms_sent boolean not null default false,
  add column if not exists unpaid_day_before_sms_sent boolean not null default false,
  add column if not exists paid_start_three_day_sms_sent boolean not null default false,
  add column if not exists paid_end_three_day_sms_sent boolean not null default false;

update public.parking_bookings
set
  initial_request_sms_sent = coalesce(initial_request_sms_sent, false),
  unpaid_week_before_sms_sent = coalesce(unpaid_week_before_sms_sent, false),
  unpaid_day_before_sms_sent = coalesce(unpaid_day_before_sms_sent, false),
  paid_start_three_day_sms_sent = coalesce(paid_start_three_day_sms_sent, false),
  paid_end_three_day_sms_sent = coalesce(paid_end_three_day_sms_sent, false)
where
  initial_request_sms_sent is null
  or unpaid_week_before_sms_sent is null
  or unpaid_day_before_sms_sent is null
  or paid_start_three_day_sms_sent is null
  or paid_end_three_day_sms_sent is null;

create index if not exists parking_bookings_unpaid_offer_reminders_idx
  on public.parking_bookings (
    status,
    payment_status,
    unpaid_week_before_sms_sent,
    unpaid_day_before_sms_sent,
    payment_due_at
  );

create index if not exists parking_bookings_paid_start_three_day_idx
  on public.parking_bookings (
    status,
    payment_status,
    paid_start_three_day_sms_sent,
    start_at
  );

create index if not exists parking_bookings_paid_end_three_day_idx
  on public.parking_bookings (
    status,
    payment_status,
    paid_end_three_day_sms_sent,
    end_at
  );
