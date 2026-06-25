alter table public.private_bookings
  add column if not exists has_open_dispute boolean not null default false;

comment on column public.private_bookings.has_open_dispute
  is 'Structured flag for open payment disputes or chargebacks that require manual cancellation/refund review.';
