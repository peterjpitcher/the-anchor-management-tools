-- OJ Projects: stop reissued invoice rows stranding at billing_pending, and
-- make the monthly retainer project unique per client and month.
--
-- Background. `reissue_oj_invoice_transaction` and `replace_oj_invoice_transaction`
-- both attach rows to a new invoice with `status = 'billing_pending'` and
-- `billing_run_id = NULL`. Nothing then moved them on:
--   * the billing cron's eligibility queries only ever select 'unbilled'
--   * its recovery pass reaches rows through oj_billing_runs, so a null run id
--     made them unreachable
--   * this trigger only settled rows already marked 'billed'
-- so the work was neither invoiced nor invoiceable, and even paying the invoice
-- left it stuck. Live casualty: 6 entries and 1 recurring charge on a Golden
-- Barrels draft dated 2026-07-01, frozen since 1 July 2026.
--
-- The cron-side recovery is fixed separately in the route. This migration closes
-- the two database-side gaps: settle on send, and settle on paid.

CREATE OR REPLACE FUNCTION public.oj_mark_entries_paid_on_invoice_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid' THEN
    -- 'billing_pending' is included so that paying a reissued invoice settles
    -- its rows. Previously they stayed locked no matter what the client did.
    UPDATE public.oj_entries
       SET status = 'paid',
           paid_at = now(),
           billed_at = COALESCE(billed_at, now()),
           updated_at = now()
     WHERE invoice_id = NEW.id
       AND status IN ('billed', 'billing_pending');

    UPDATE public.oj_recurring_charge_instances
       SET status = 'paid',
           paid_at = now(),
           billed_at = COALESCE(billed_at, now()),
           updated_at = now()
     WHERE invoice_id = NEW.id
       AND status IN ('billed', 'billing_pending');

  ELSIF NEW.status IN ('sent', 'overdue', 'partially_paid') THEN
    -- The invoice has gone to the client, so the work it covers is billed. This
    -- is the transition that was missing entirely: a reissued draft could be
    -- sent and its rows would still read as locked mid-run.
    UPDATE public.oj_entries
       SET status = 'billed',
           billed_at = COALESCE(billed_at, now()),
           updated_at = now()
     WHERE invoice_id = NEW.id
       AND status = 'billing_pending';

    UPDATE public.oj_recurring_charge_instances
       SET status = 'billed',
           billed_at = COALESCE(billed_at, now()),
           updated_at = now()
     WHERE invoice_id = NEW.id
       AND status = 'billing_pending';
  END IF;

  -- Deliberately no 'void' branch. The reissue RPCs void the source invoice
  -- before moving its rows to the replacement, so releasing on void here would
  -- race with them. Voided invoices are released by the billing cron's recovery
  -- pass instead, where the ordering is known.

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.oj_mark_entries_paid_on_invoice_paid() IS
  'Settles OJ entries and recurring charge instances when their invoice is sent, becomes overdue, is partially paid, or is paid. Handles billing_pending as well as billed so that rows attached by an invoice reissue cannot strand.';

-- The retainer project for a client and month must be unique. Two code paths
-- create it (the retainer cron and the entries action), both by select-then-
-- insert, so a concurrent create could produce duplicates. After that every
-- later lookup uses .maybeSingle() and would throw, breaking entry logging for
-- that client and month until someone deleted a row by hand.
-- No duplicates exist today; this makes the race impossible rather than merely
-- unlikely, and both call sites now recover from the conflict by re-selecting.
CREATE UNIQUE INDEX IF NOT EXISTS oj_projects_retainer_period_uniq
  ON public.oj_projects (vendor_id, retainer_period_yyyymm)
  WHERE is_retainer;
