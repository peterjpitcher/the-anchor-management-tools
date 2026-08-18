-- Reconstruct the payment records behind invoices that were marked paid without one.
--
-- Marking an invoice paid set paid_amount and wrote no payment row. Most of the
-- app reads paid_amount, but the client statement rebuilds what a customer has
-- paid from payment records, so on a statement that money simply never arrived.
-- Live effect on 2026-08-18: Barons Pubs' statement demanded GBP 2,878.13 they
-- had settled in February, printed in red as over 90 days overdue, and Golden
-- Barrels' balance was overstated by GBP 500.00.
--
-- Eight invoices are affected, GBP 12,855.63 in total. The code path that caused
-- it is fixed separately, so this is a one-off repair of the existing rows.
--
-- Dating: each payment takes the date its invoice was first audited as moving to
-- 'paid', which is the only evidence held of when the money was recognised. That
-- is a reconstruction, not a bank date, and the note on each row says so.
--
-- Safety: inserts only the shortfall between paid_amount and payments already
-- recorded, so an invoice settled partly by real payments cannot be double
-- counted. Guarded by NOT EXISTS on the marker note, so re-running does nothing.

INSERT INTO public.invoice_payments (invoice_id, payment_date, amount, payment_method, reference, notes)
SELECT
  i.id,
  COALESCE(
    (
      SELECT MIN(a.created_at)::date
        FROM public.audit_logs a
       WHERE a.resource_type = 'invoice'
         AND a.resource_id = i.id::text
         AND a.new_values->>'status' = 'paid'
    ),
    i.updated_at::date,
    i.invoice_date
  ),
  ROUND(
    COALESCE(i.paid_amount, 0)
      - COALESCE((SELECT SUM(p.amount) FROM public.invoice_payments p WHERE p.invoice_id = i.id), 0),
    2
  ),
  NULL,
  NULL,
  'Backfilled 2026-08-18: reconstructed from the invoice being marked paid, which previously recorded no payment. Date taken from the audit trail, not a bank statement.'
FROM public.invoices i
WHERE i.deleted_at IS NULL
  AND COALESCE(i.paid_amount, 0) > 0
  AND COALESCE((SELECT SUM(p.amount) FROM public.invoice_payments p WHERE p.invoice_id = i.id), 0)
      < COALESCE(i.paid_amount, 0)
  AND NOT EXISTS (
    SELECT 1
      FROM public.invoice_payments p
     WHERE p.invoice_id = i.id
       AND p.notes LIKE 'Backfilled 2026-08-18:%'
  );
