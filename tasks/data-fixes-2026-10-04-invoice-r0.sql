-- Data fixes that follow R0 of tasks/spec-2026-10-04-invoice-issuing-and-chasing.md.
--
-- APPLIED to production on 4 October 2026 at 18:53 UTC, with the owner's yes. Read back
-- afterwards: the expected rows changed (4 client records, 2 invoices). Kept as the record of
-- what was run: do not run it again.
--
-- They were run only AFTER R0.1 (reminders paused), the R0.2 code fix and R0.5 (auto-send
-- removed) were confirmed live on the production deployment. Run before that and:
--   - the next save on the Vendors page wipes fix 1 again (the R0.2 code fix stops that), and
--   - the old reminder job would start emailing these customers its "Final Reminder".
--
-- Not a migration: this is a one-off repair, so it does not live in supabase/migrations.
-- No customer details are written in this file. Every value is copied from another row.
-- Checked read-only against production on 4 October 2026: the four client records each have
-- exactly one linked booking with one contact email, and that email is the address each of
-- their invoices was actually sent to.

-- ---------------------------------------------------------------------------------------
-- Fix 1. Restore the email on the four private hire client records wiped by the Vendors page.
-- ---------------------------------------------------------------------------------------

-- Before: expect four rows, has_email false, booking_emails 1, matches_sent_to true.
select v.id,
       coalesce(v.email, '') <> '' as has_email,
       count(distinct lower(pb.contact_email)) as booking_emails,
       bool_and(exists (
         select 1 from public.invoices i2
         where i2.vendor_id = v.id and lower(i2.sent_to) = lower(pb.contact_email)
       )) as matches_sent_to
from public.invoice_vendors v
join public.invoices i on i.vendor_id = v.id and i.deleted_at is null
join public.private_booking_invoices pbi on pbi.invoice_id = i.id
join public.private_bookings pb on pb.id = pbi.booking_id
where v.id in (
  '08d4cf8c-0bed-4221-aec3-a589e863b2d5',
  '7e031d01-d29b-4735-8a39-02fcb0c6c61e',
  '8f5c2405-38c7-4d0c-8231-190fb445d7b7',
  'ecd9189d-f6f6-4dc8-9221-66c2e512b134'
)
group by v.id, v.email
order by v.id;

begin;

update public.invoice_vendors v
set email = src.contact_email,
    updated_at = now()
from (
  select distinct i.vendor_id, pb.contact_email
  from public.invoices i
  join public.private_booking_invoices pbi on pbi.invoice_id = i.id
  join public.private_bookings pb on pb.id = pbi.booking_id
  where i.deleted_at is null
    and coalesce(pb.contact_email, '') <> ''
) src
where v.id = src.vendor_id
  and v.id in (
    '08d4cf8c-0bed-4221-aec3-a589e863b2d5',
    '7e031d01-d29b-4735-8a39-02fcb0c6c61e',
    '8f5c2405-38c7-4d0c-8231-190fb445d7b7',
    'ecd9189d-f6f6-4dc8-9221-66c2e512b134'
  )
  -- Only where it is still blank: never overwrite an address someone has since entered.
  and coalesce(v.email, '') = '';

-- Expect: UPDATE 4. Anything else, ROLLBACK and look again.
commit;

-- After: expect four rows, has_email true.
select id, coalesce(email, '') <> '' as has_email
from public.invoice_vendors
where id in (
  '08d4cf8c-0bed-4221-aec3-a589e863b2d5',
  '7e031d01-d29b-4735-8a39-02fcb0c6c61e',
  '8f5c2405-38c7-4d0c-8231-190fb445d7b7',
  'ecd9189d-f6f6-4dc8-9221-66c2e512b134'
)
order by id;

-- Side effect to know about: once these records have an address, recording a payment for one
-- of these guests emails them a receipt, as it already does for every other client.

-- ---------------------------------------------------------------------------------------
-- Fix 2. Record when the two recurring invoices were really emailed.
--
-- INV-003WD and INV-003WV were emailed by the recurring job on 1 September and 1 October 2026
-- (one log row each), but the job never wrote sent_at, so the reminder job treats them as
-- never delivered. The date and the address come from each invoice's own email log row.
-- ---------------------------------------------------------------------------------------

-- Before: expect two rows, sent_at null, log_rows 1.
select i.invoice_number, i.status, i.sent_at,
       (select count(*) from public.invoice_email_logs l
         where l.invoice_id = i.id and l.status = 'sent' and l.subject like 'Invoice %') as log_rows
from public.invoices i
where i.id in ('18e42324-f9d1-4344-b431-82268a22834b', 'f8bc6ad0-a500-4028-bd44-e874e9223f5a')
order by i.invoice_number;

begin;

update public.invoices i
set sent_at = src.sent_at,
    sent_to = src.sent_to
from (
  select distinct on (l.invoice_id) l.invoice_id, l.created_at as sent_at, l.sent_to
  from public.invoice_email_logs l
  where l.status = 'sent' and l.subject like 'Invoice %'
  order by l.invoice_id, l.created_at asc
) src
where i.id = src.invoice_id
  and i.id in ('18e42324-f9d1-4344-b431-82268a22834b', 'f8bc6ad0-a500-4028-bd44-e874e9223f5a')
  -- Only where it is still empty.
  and i.sent_at is null;

-- Expect: UPDATE 2. Anything else, ROLLBACK and look again.
commit;

-- After: expect INV-003WD sent 1 September 2026 and INV-003WV sent 1 October 2026.
select invoice_number, status, sent_at, sent_to is not null as has_sent_to
from public.invoices
where id in ('18e42324-f9d1-4344-b431-82268a22834b', 'f8bc6ad0-a500-4028-bd44-e874e9223f5a')
order by invoice_number;

-- What this changes: with reminders paused, nothing is emailed to the customer. The owner's
-- alert (and later his daily summary) starts to include these two invoices. INV-003WD is
-- already overdue and will be listed for him to chase by hand.
