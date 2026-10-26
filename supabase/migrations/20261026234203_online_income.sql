-- Money taken online, in one place (BK-117, customer bookings review of 24 October 2026; owner
-- decision D33).
--
-- Nothing in the app showed what was taken online, what was refunded, what was kept and what PayPal
-- charged: the P&L counts only till and cash-up sales, so prepaid tickets, parking, private-hire
-- payments and deposits kept after a no-show never reached it. The owner decided online booking
-- money is its own line in the P&L, kept off the till.
--
-- 1. paypal_capture_fees: PayPal's fee for each capture, keyed by the capture id, written by the app
--    from the capture response (seller_receivable_breakdown.paypal_fee) and the capture webhook.
--    One table instead of a column on each of the five places a capture is recorded. Fees for
--    captures before this release are not known.
-- 2. online_income_movements: one row per online payment, read from where each kind is actually
--    recorded (checked against production on 26 October 2026):
--      * table deposits: table_bookings (paypal_deposit_capture_id, deposit_amount_locked), never
--        the payments ledger, which holds no PayPal deposit; historic Stripe deposits from payments;
--        refunds from payment_refunds (source_type 'table_booking');
--      * private-hire deposits: private_bookings paid by PayPal; refunds from payment_refunds;
--      * event tickets: payments from PayPal (prepaid_event, seat_increase), one row per booking,
--        less PayPal refund rows in payments;
--      * PayPal invoice payments (invoice_payments source_kind 'paypal'); is_booking_money says
--        whether the invoice belongs to a private hire;
--      * parking: parking_booking_payments from PayPal; refunds from payment_refunds ('parking').
--    Door money recorded by hand (payments provider 'manual') is in the till already and is left
--    out, as are invoice copies of booking payments (source_kind booking_payment, booking_deposit).
--    Each row is dated by the day the money was taken (London) and carries what was refunded since.
--    status: held (the visit is still to come), applied (a deposit set against the bill), kept
--    (cancelled or no-show, nothing refunded), earned (the night has passed), paid, refunded or
--    part_refunded.
--
-- Both are read only by the server, through the service role after the app's cash-up permission
-- check: anon and authenticated hold nothing. The view runs as the caller (security_invoker), so it
-- never reaches more than its caller could.
--
-- Deploy: apply before the code that reads the view or writes fees. Rollback:
-- tasks/online-income/rollback.sql (drops both; recorded fees are lost). Tested by
-- scripts/testing/online-income-postgres.py.

CREATE TABLE public.paypal_capture_fees (
  capture_id text PRIMARY KEY CHECK (length(btrim(capture_id)) > 0),
  fee_amount numeric(10,2) NOT NULL CHECK (fee_amount >= 0),
  gross_amount numeric(10,2),
  net_amount numeric(10,2),
  currency text NOT NULL DEFAULT 'GBP',
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.paypal_capture_fees IS
  'PayPal''s fee for each capture, from the capture response or webhook (BK-117). Fees before October 2026 are not recorded.';

ALTER TABLE public.paypal_capture_fees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paypal_capture_fees FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.paypal_capture_fees TO service_role;

CREATE VIEW public.online_income_movements
WITH (security_invoker = true) AS
WITH london_today AS (
  SELECT (now() AT TIME ZONE 'Europe/London')::date AS today
),
completed_refunds AS (
  SELECT r.source_type, r.source_id, sum(r.amount) AS refunded
  FROM public.payment_refunds r
  WHERE r.status = 'completed'
  GROUP BY r.source_type, r.source_id
),
event_charges AS (
  SELECT
    p.event_booking_id,
    min(p.created_at) AS paid_at,
    sum(p.amount) AS gross,
    (array_agg(p.paypal_capture_id ORDER BY p.created_at) FILTER (WHERE p.paypal_capture_id IS NOT NULL))[1] AS capture_id
  FROM public.payments p
  WHERE p.payment_provider = 'paypal'
    AND p.charge_type IN ('prepaid_event', 'seat_increase')
    AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
    AND p.event_booking_id IS NOT NULL
  GROUP BY p.event_booking_id
),
event_refunds AS (
  SELECT p.event_booking_id, sum(p.amount) AS refunded
  FROM public.payments p
  WHERE p.payment_provider = 'paypal'
    AND p.charge_type = 'refund'
    AND p.status IN ('succeeded', 'refunded')
    AND p.event_booking_id IS NOT NULL
  GROUP BY p.event_booking_id
),
movements AS (
  -- Table deposits paid by PayPal, recorded on the booking.
  SELECT
    'table_deposit'::text AS source,
    tb.id AS source_id,
    (COALESCE(tb.card_capture_completed_at, tb.confirmed_at, tb.created_at) AT TIME ZONE 'Europe/London')::date AS money_date,
    tb.booking_reference::text AS booking_reference,
    tb.booking_date AS visit_date,
    COALESCE(tb.deposit_amount_locked, tb.deposit_amount, 0) AS gross,
    COALESCE(r.refunded, 0) AS refunded,
    'paypal'::text AS method,
    tb.paypal_deposit_capture_id AS capture_id,
    CASE
      WHEN tb.status::text IN ('cancelled', 'no_show') THEN 'kept'
      WHEN tb.booking_date >= t.today THEN 'held'
      ELSE 'applied'
    END AS state,
    true AS is_booking_money
  FROM public.table_bookings tb
  CROSS JOIN london_today t
  LEFT JOIN completed_refunds r ON r.source_type = 'table_booking' AND r.source_id = tb.id
  WHERE tb.paypal_deposit_capture_id IS NOT NULL

  UNION ALL

  -- Historic Stripe table deposits (the last was 14 March 2026), recorded in payments.
  SELECT
    'table_deposit',
    tb.id,
    (p.created_at AT TIME ZONE 'Europe/London')::date,
    tb.booking_reference::text,
    tb.booking_date,
    p.amount,
    COALESCE(p.refund_amount, CASE WHEN p.status = 'refunded' THEN p.amount ELSE 0 END),
    'stripe',
    p.stripe_payment_intent_id,
    CASE
      WHEN tb.status::text IN ('cancelled', 'no_show') THEN 'kept'
      WHEN tb.booking_date >= t.today THEN 'held'
      ELSE 'applied'
    END,
    true
  FROM public.payments p
  JOIN public.table_bookings tb ON tb.id = p.table_booking_id
  CROSS JOIN london_today t
  WHERE p.charge_type = 'table_deposit'
    AND p.payment_provider = 'stripe'
    AND p.status IN ('succeeded', 'refunded', 'partially_refunded')

  UNION ALL

  -- Private-hire deposits paid by PayPal, recorded on the booking.
  SELECT
    'private_hire_deposit',
    pb.id,
    (pb.deposit_paid_date AT TIME ZONE 'Europe/London')::date,
    COALESCE(NULLIF(btrim(pb.event_type), ''), 'Private hire'),
    pb.event_date,
    COALESCE(pb.deposit_amount, 0),
    COALESCE(r.refunded, 0),
    'paypal',
    pb.paypal_deposit_capture_id,
    CASE
      WHEN pb.status = 'cancelled' THEN 'kept'
      WHEN pb.event_date >= t.today THEN 'held'
      WHEN pb.invoice_deposit_treatment = 'deducted' THEN 'applied'
      ELSE 'held'
    END,
    true
  FROM public.private_bookings pb
  CROSS JOIN london_today t
  LEFT JOIN completed_refunds r ON r.source_type = 'private_booking' AND r.source_id = pb.id
  WHERE pb.deposit_payment_method = 'paypal'
    AND pb.deposit_paid_date IS NOT NULL

  UNION ALL

  -- Event tickets paid by PayPal, one row per booking.
  SELECT
    'event_ticket',
    b.id,
    (c.paid_at AT TIME ZONE 'Europe/London')::date,
    e.name,
    e.date,
    c.gross,
    COALESCE(er.refunded, 0),
    'paypal',
    c.capture_id,
    CASE
      WHEN b.status IN ('cancelled', 'expired') THEN 'kept'
      WHEN e.date >= t.today THEN 'held'
      ELSE 'earned'
    END,
    true
  FROM event_charges c
  JOIN public.bookings b ON b.id = c.event_booking_id
  LEFT JOIN public.events e ON e.id = b.event_id
  CROSS JOIN london_today t
  LEFT JOIN event_refunds er ON er.event_booking_id = c.event_booking_id

  UNION ALL

  -- Invoices paid through PayPal. A private hire's invoice is booking money.
  SELECT
    'invoice',
    ip.id,
    ip.payment_date,
    i.invoice_number::text,
    NULL::date,
    ip.amount,
    0,
    'paypal',
    ip.reference::text,
    'paid',
    (
      EXISTS (SELECT 1 FROM public.private_booking_invoices pbi WHERE pbi.invoice_id = i.id)
      OR EXISTS (SELECT 1 FROM public.private_bookings pb WHERE pb.invoice_id = i.id)
    )
  FROM public.invoice_payments ip
  JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE ip.source_kind = 'paypal'
    AND i.deleted_at IS NULL

  UNION ALL

  -- Parking paid by PayPal.
  SELECT
    'parking',
    pp.id,
    (COALESCE(pp.paid_at, pp.created_at) AT TIME ZONE 'Europe/London')::date,
    pk.reference,
    (pk.start_at AT TIME ZONE 'Europe/London')::date,
    pp.amount,
    COALESCE(r.refunded, CASE WHEN pp.refund_status = 'refunded' THEN pp.amount ELSE 0 END),
    'paypal',
    pp.transaction_id,
    'paid',
    true
  FROM public.parking_booking_payments pp
  JOIN public.parking_bookings pk ON pk.id = pp.booking_id
  LEFT JOIN completed_refunds r ON r.source_type = 'parking' AND r.source_id = pp.id
  WHERE pp.provider = 'paypal'
    AND pp.status::text IN ('paid', 'refunded')
)
SELECT
  m.source,
  m.source_id,
  m.money_date,
  m.booking_reference,
  m.visit_date,
  round(m.gross, 2)::numeric(10,2) AS gross,
  round(LEAST(m.refunded, m.gross), 2)::numeric(10,2) AS refunded,
  round(m.gross - LEAST(m.refunded, m.gross), 2)::numeric(10,2) AS net,
  m.method,
  m.capture_id,
  f.fee_amount AS paypal_fee,
  CASE
    WHEN m.refunded > 0 AND m.refunded >= m.gross THEN 'refunded'
    WHEN m.refunded > 0 THEN 'part_refunded'
    ELSE m.state
  END AS status,
  m.is_booking_money
FROM movements m
LEFT JOIN public.paypal_capture_fees f ON f.capture_id = m.capture_id;

COMMENT ON VIEW public.online_income_movements IS
  'Every online payment by the day it was taken, with refunds and PayPal fees (BK-117, D33). Manual door money and invoice copies are left out.';

REVOKE ALL ON public.online_income_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.online_income_movements TO service_role;

-- Prove it, so a later migration cannot quietly open either.
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.online_income_movements', 'SELECT')
     OR has_table_privilege('authenticated', 'public.online_income_movements', 'SELECT')
     OR has_table_privilege('anon', 'public.paypal_capture_fees', 'SELECT')
     OR has_table_privilege('authenticated', 'public.paypal_capture_fees', 'SELECT')
     OR has_table_privilege('authenticated', 'public.paypal_capture_fees', 'INSERT') THEN
    RAISE EXCEPTION 'online income is reachable by anon or authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.online_income_movements', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.paypal_capture_fees', 'INSERT') THEN
    RAISE EXCEPTION 'online income is not reachable by service_role';
  END IF;
END $$;
