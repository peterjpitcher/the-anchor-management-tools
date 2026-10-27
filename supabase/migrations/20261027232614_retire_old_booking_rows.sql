-- Release 28 of the customer bookings review of 24 October 2026: the one-off clean-ups the owner
-- approved in decision D36. Every row is named by id, as read from production on 27 October 2026,
-- and every step counts the rows it is about to change first and stops the whole migration if
-- the count is not exactly what was measured that day, so it can never touch more than was
-- approved. Old values are copied into two backup tables before anything changes, and
-- tasks/retire-old-booking-rows/rollback.sql puts them back.
--
-- 1. BK-223, the 6 payment holds left 'active' on finished table bookings. 5 bookings are
--    completed and become 'consumed'; TB-1E02507C was cancelled and becomes 'released'.
--      a49473d6 TB-F1993D68 completed   e0b28ee4 TB-474F79BD completed (PayPal)
--      50a6c60b TB-E1AF5B3F completed (PayPal)   5d1ad4e4 TB-CEDE872F completed (PayPal)
--      8459bb64 TB-88CB4A1A completed (PayPal)   c2ec59e7 TB-1E02507C cancelled
--    consumed_at or released_at is the time this runs.
--
-- 2. BK-223, the 9 'pending' table_deposit payments rows that will never be paid through that
--    row: 4 on PayPal-paid bookings (GBP 320, the deposit is on the booking) and 5 on finished
--    bookings whose deposit was never taken that way (TB-F1993D68 GBP 80, TB-D544BC1D, TB-A4E87EB4,
--    TB-6EE1F145 and TB-B1848E6A GBP 70 each). They become 'void', kept for history with a note in
--    metadata, so the ledger no longer shows deposits as owed. 'void' is added to
--    payments_status_check for this; every reader of payments filters on the statuses it wants
--    (succeeded, refunded and so on), so a void row is left out everywhere. The 6 'failed' rows
--    are correct end states and are not touched.
--
-- 3. BK-224, confirmed_at on the 4 PayPal-paid bookings that never got one, set to when PayPal
--    captured the deposit (the capture's create_time in PayPal's PAYMENT.CAPTURE.COMPLETED event
--    in webhook_logs; for TB-88CB4A1A the card_capture_completed_at the capture code wrote, which
--    is what the code now copies into confirmed_at):
--      TB-474F79BD 2026-04-18 11:35:11 UTC   TB-E1AF5B3F 2026-04-18 19:37:37 UTC
--      TB-CEDE872F 2026-04-23 12:02:59 UTC   TB-88CB4A1A 2026-07-07 16:28:35.223 UTC
--
-- 4. BK-224, TB-CEDE872F reads as fully paid although GBP 50.25 of its GBP 80 deposit was refunded
--    by PayPal on 26 April 2026 (deposit_refund_status partially_refunded): payment_status becomes
--    'partial_refund'.
--
-- 5. BK-224, the 26 confirmed bookings (25 from August to December 2025, TB-A914C100 a walk-in of
--    7 March 2026, all dates past) that read 'payment pending' with no deposit of any kind: no
--    PayPal capture, no locked or requested amount, no waiver and no payments row. payment_status
--    becomes NULL, which is what the booking functions write when nothing is owed. The 13 TB-W
--    walk-ins in the same state are cleared by release 9's 20261026211052 and are excluded here.
--    TB-B1848E6A is not among them: it was asked for a deposit that was never paid, so 'pending'
--    stays true for it.
--
-- 6. BK-166, the 48 rows of pending_bookings, the table of the booking-confirmation flow retired
--    in 2025 (created 15 July to 31 December 2025; 40 linked to a customer, 37 phone numbers). Each
--    holds a mobile number and a copy of the first text, which greets the guest by name; nothing
--    has written to the table since. The rows are deleted; the empty table stays, so the GDPR
--    export and erasure code that lists it keeps working.
--
-- 7. BK-176, the 2 short links that still point at the retired /g/<token>/card-capture page
--    (ugvve2, never clicked; jhqcbq, last clicked 7 March 2026). They expire now, so they go to
--    the website's home page like any expired link.
--
-- Backups, both service_role only with row level security on:
--   retired_pending_bookings_20261027   the 48 rows in full. These hold personal data (phone
--                                       numbers, first names in the copied text): drop the table
--                                       once the owner is happy, as a separate step, so the delete
--                                       really removes the data.
--   retired_row_values_20261027         the old values of every other column changed, as JSON.
--
-- updated_at moves on the changed rows (their triggers set it); the rollback restores it.
-- Status changes on booking_holds are audited by trg_audit_booking_hold_status, as always.
-- Tested by scripts/testing/retire-old-booking-rows-postgres.py.

DO $tidy$
DECLARE
  v_now timestamptz := now();
  v_n integer;
  v_holds_consumed uuid[] := ARRAY[
    'a49473d6-5403-424a-a9a7-b7a526c4aa46', 'e0b28ee4-f309-475f-802b-17ba2045c65a',
    '50a6c60b-5fa5-4172-b8f2-5a66bc7b1e5b', '5d1ad4e4-13af-4cf7-bb42-869cda472027',
    '8459bb64-c29e-4e34-96c4-e00b17354b5d']::uuid[];
  v_holds_released uuid[] := ARRAY['c2ec59e7-c700-41b3-9171-88b9eb6cd4e4']::uuid[];
  v_payments uuid[] := ARRAY[
    '101ca8d8-1495-4ec9-9fed-f255059dace0', 'b495d462-eb1d-42b6-8d1f-a2b5312f13e4',
    'e5d7a4e1-c830-49d5-a8eb-0a403e1d7f59', '0e553acd-f2eb-439c-b05d-1d32e522e2ae',
    'c2c1f525-1868-4f9f-9ee3-4bb797e62028', '8736973c-99e5-48c6-bfb4-6dcb148946a3',
    '09998ae2-8379-4f7f-b671-8a94029be5ce', '09d01125-ec07-4633-ad64-24c4d39755a5',
    '32665a4a-5f4e-44b5-9336-6bdd991d6cf1']::uuid[];
  v_partial_refund uuid := '8f7225cf-24ff-43f3-b26f-6934fecc9738';
  v_no_deposit uuid[] := ARRAY[
    'db0a49af-db7d-4b97-8916-ef1da483f6d8', '79c27e4c-7c0f-4128-ae3d-94a89ee2e6d3',
    '9b6e6ebd-cfda-4551-b3b0-3960300e136e', '017b7601-0a56-4e1d-b899-7bbea66e3632',
    '0730cb95-1d51-44c5-9507-1b7b90cb1c3e', '531b51ef-eb3d-4c5a-b16c-6f0a4051219f',
    'afa3ed5e-f07c-4898-8e26-5b3f9b3448e2', '0b049a4c-71fe-4961-af95-d605b0413042',
    '4892fef5-b896-4463-b980-6130cae6f8c9', '44434c1b-2502-4a4d-97ab-b2108dba7e8a',
    '40f6e085-04e1-4d62-bfef-722a8d73380c', 'e81baddc-34b7-43ae-a5c9-3addf43b94e6',
    'aef4dac1-4d99-4b21-8fed-cc30b5e7195d', '5343ecab-7d6c-4350-b261-3e7d1c4f175c',
    '7c5ed523-819e-4e81-aff6-02c5f5bd15a6', 'c3a3efab-afb1-4aca-83ac-ade0dfe72f1d',
    '127a94d0-0cb1-440b-9865-a2faf2506975', 'd11a9ca4-9770-4c96-a27a-6656d02913bc',
    '25bf551f-6dac-4932-b82a-54c472799a58', 'cf14c6a6-9095-434f-9fd9-131e1eb55463',
    '76e06fdb-1d47-4163-8a09-6dcf75ae6c67', '23f3f7d4-606c-4a37-9bee-c3f968ed55d0',
    '2553e39a-da41-4e00-9f17-75f180096c31', 'b65c4e04-d775-4c65-8d70-7faed8d1d782',
    'aa8e2ac6-2db3-4355-9cce-b7c8281710ba', 'e1bf6321-1f06-495a-b293-1b019e04409e']::uuid[];
  v_pending_bookings uuid[] := ARRAY[
    '09312823-19e9-46a7-8f9f-e17bf300dc24', '112ee317-440e-43a2-b2f1-9d7af223089d',
    '138956c2-eb35-46c6-ae54-8b43e2cb21de', '13bf035a-d7cf-4d2e-b3aa-e7d418bbf6ae',
    '16b1d27a-b588-4789-9934-a11916315cbe', '1c8a8fa5-0843-44f5-9357-00cdea632f75',
    '237f151b-b9b4-44ca-ba2b-9401c5786ea4', '2b2f7eaf-4e51-4547-9561-3af325643d51',
    '3474f0e7-753c-48d3-a6b9-bc36d3e58a30', '37e9982e-60d2-4453-8773-2ca813835d5a',
    '39df7093-2bef-47b3-9f20-5a9b06315457', '3d428703-7b1f-4a3b-ba21-ef641330f560',
    '4503ebd3-bee4-4e1a-9085-a9a45888a534', '49db4687-4ecd-4a1a-935d-205088729242',
    '4f831beb-6a17-4d6b-b2e8-3126f14d6b17', '5b4fe80e-a84b-45c1-8402-e5fa5d5066fe',
    '5bea63dd-efbb-453a-93e2-666e240aa4f5', '5fafd382-0ead-413e-a8b2-c85b6ce5afb1',
    '60e5316e-de6d-47c5-9294-82a0580b2ff7', '60eba5db-5979-483d-a8e3-4bbc5a9b42f6',
    '63b48ae1-695b-4e32-bf73-79e432057c57', '6c3a79bc-366f-4d70-a85e-44adc08596ff',
    '6dca4f40-393e-48f1-b5fa-c0f74c50dfff', '7af3b0e8-8d59-4944-9518-a25f9a742476',
    '7e4f83ef-195e-4dd4-8641-b9855c482ac7', '7fdcdb87-75c1-46a2-bd9b-a295b088b88d',
    '85e16c20-9211-44ec-97cf-86843e3128b0', '8e57343c-5b75-4d8a-8504-1ac19a89e80b',
    '8f9cda60-3230-458e-80c9-6e98b233f5d5', '977969ef-8ad1-4c49-96e1-127dabed9f1d',
    '9cbb5a76-8817-4795-b078-6a49259a7bf8', '9eedc3ca-a7d7-4b8b-8ffe-4f4dc7f7d565',
    'b2a4bbe1-c961-4e17-96f6-3037c985ff0a', 'b6b8c541-a2cf-4b21-a5ea-f6051021264c',
    'c86a528a-b68c-47c8-a53d-c664d07d2079', 'cdc5a110-9475-428a-a7fc-9a650c5e57e4',
    'd20c9d95-d905-4fbc-ab32-a6a6b13e56cd', 'ddb66102-2d4c-4e62-b7a8-80a1da66936d',
    'e3972230-3322-46ff-bafe-c9681ad8cff6', 'e6fa73ec-cab8-4528-904c-eddfef7758d2',
    'e7314205-5cb4-45ad-8852-35b912b80668', 'ec87dfda-6db1-4d9f-9627-9dcccca232e8',
    'ef955bd2-9e99-437a-89dd-48de1c6d42fe', 'f1f66c56-6046-468c-9454-d6d9c65082d8',
    'f21125e4-6f32-4ad1-b97f-1b24cac75fc7', 'f875a17b-6351-4f7f-8760-ad96f5a93f4c',
    'fa30ff2f-d8bc-4e5d-9b22-21aea63c0295', 'fec5fab2-2bf6-4164-a2ec-fd172f467941']::uuid[];
  v_short_links uuid[] := ARRAY['bee15717-9b20-4c65-823c-7479442a2e80', 'ce8c24e5-b189-441c-bc34-26453b1bc6ec']::uuid[];
BEGIN
  -- One statement, so a refusal anywhere leaves nothing behind whatever runs it.
  PERFORM set_config('lock_timeout', '5s', true);

  CREATE TABLE public.retired_row_values_20261027 (
    source_table text NOT NULL,
    row_id uuid NOT NULL,
    old_values jsonb NOT NULL,
    copied_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_table, row_id)
  );
  COMMENT ON TABLE public.retired_row_values_20261027 IS
    'Old values of the rows changed by 20261027154849_retire_old_booking_rows (release 28, D36), for its rollback.';
  ALTER TABLE public.retired_row_values_20261027 ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.retired_row_values_20261027 FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON TABLE public.retired_row_values_20261027 TO service_role;

  CREATE TABLE public.retired_pending_bookings_20261027 (LIKE public.pending_bookings);
  COMMENT ON TABLE public.retired_pending_bookings_20261027 IS
    'The 48 pending_bookings rows deleted by 20261027154849_retire_old_booking_rows (BK-166), for its rollback. Holds phone numbers: drop once no longer needed.';
  ALTER TABLE public.retired_pending_bookings_20261027 ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.retired_pending_bookings_20261027 FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON TABLE public.retired_pending_bookings_20261027 TO service_role;

  ALTER TABLE public.payments DROP CONSTRAINT payments_status_check;
  ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'refunded'::text,
                               'partially_refunded'::text, 'void'::text]));

  -- 1. Payment holds.
  SELECT count(*) INTO v_n FROM public.booking_holds h JOIN public.table_bookings tb ON tb.id = h.table_booking_id
   WHERE h.id = ANY (v_holds_consumed) AND h.hold_type = 'payment_hold' AND h.status = 'active' AND tb.status = 'completed';
  IF v_n <> 5 THEN RAISE EXCEPTION 'retire_old_booking_rows: expected 5 active holds on completed bookings, found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.booking_holds h JOIN public.table_bookings tb ON tb.id = h.table_booking_id
   WHERE h.id = ANY (v_holds_released) AND h.hold_type = 'payment_hold' AND h.status = 'active' AND tb.status = 'cancelled';
  IF v_n <> 1 THEN RAISE EXCEPTION 'retire_old_booking_rows: expected 1 active hold on a cancelled booking, found %', v_n; END IF;

  INSERT INTO public.retired_row_values_20261027 (source_table, row_id, old_values)
  SELECT 'booking_holds', h.id, jsonb_build_object('status', h.status, 'consumed_at', h.consumed_at,
         'released_at', h.released_at, 'updated_at', h.updated_at)
    FROM public.booking_holds h WHERE h.id = ANY (v_holds_consumed || v_holds_released);

  UPDATE public.booking_holds SET status = 'consumed', consumed_at = v_now, updated_at = v_now
   WHERE id = ANY (v_holds_consumed) AND status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 5 THEN RAISE EXCEPTION 'retire_old_booking_rows: consumed % holds, expected 5', v_n; END IF;
  UPDATE public.booking_holds SET status = 'released', released_at = v_now, updated_at = v_now
   WHERE id = ANY (v_holds_released) AND status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'retire_old_booking_rows: released % holds, expected 1', v_n; END IF;

  -- 2. Pending ledger rows.
  SELECT count(*) INTO v_n FROM public.payments
   WHERE id = ANY (v_payments) AND charge_type = 'table_deposit' AND status = 'pending';
  IF v_n <> 9 THEN RAISE EXCEPTION 'retire_old_booking_rows: expected 9 pending table_deposit rows, found %', v_n; END IF;

  INSERT INTO public.retired_row_values_20261027 (source_table, row_id, old_values)
  SELECT 'payments', p.id, jsonb_build_object('status', p.status, 'metadata', p.metadata, 'updated_at', p.updated_at)
    FROM public.payments p WHERE p.id = ANY (v_payments);

  UPDATE public.payments
     SET status = 'void',
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'voided_at', v_now,
           'voided_reason', 'Stale pending row: PayPal deposits are recorded on the booking, and this one was never collected through this row (BK-223, release 28).'),
         updated_at = v_now
   WHERE id = ANY (v_payments) AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 9 THEN RAISE EXCEPTION 'retire_old_booking_rows: voided % payments rows, expected 9', v_n; END IF;

  -- 3. Confirmed times on the PayPal-paid bookings.
  SELECT count(*) INTO v_n FROM public.table_bookings
   WHERE id IN ('f922c595-f7ea-4177-a2f4-2eb21af968bd', '0aa68359-9a1c-439a-9047-ed6d1126362d',
                '8f7225cf-24ff-43f3-b26f-6934fecc9738', 'a66ed178-c0d1-4d1c-89b1-609fe7f23f59')
     AND confirmed_at IS NULL AND paypal_deposit_capture_id IS NOT NULL;
  IF v_n <> 4 THEN RAISE EXCEPTION 'retire_old_booking_rows: expected 4 PayPal-paid bookings without a confirmed time, found %', v_n; END IF;

  -- 4 needs TB-CEDE872F as measured: fully paid on the booking, partly refunded.
  SELECT count(*) INTO v_n FROM public.table_bookings
   WHERE id = v_partial_refund AND payment_status = 'completed' AND deposit_refund_status = 'partially_refunded';
  IF v_n <> 1 THEN RAISE EXCEPTION 'retire_old_booking_rows: TB-CEDE872F is no longer completed and partly refunded'; END IF;

  -- 5. Confirmed bookings showing 'pending' with no deposit of any kind.
  SELECT count(*) INTO v_n FROM public.table_bookings tb
   WHERE tb.id = ANY (v_no_deposit) AND tb.status = 'confirmed' AND tb.payment_status = 'pending'
     AND tb.paypal_deposit_capture_id IS NULL AND tb.deposit_amount_locked IS NULL AND tb.deposit_amount IS NULL
     AND NOT COALESCE(tb.deposit_waived, false)
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.table_booking_id = tb.id);
  IF v_n <> 26 THEN RAISE EXCEPTION 'retire_old_booking_rows: expected 26 confirmed bookings pending with no deposit, found %', v_n; END IF;

  INSERT INTO public.retired_row_values_20261027 (source_table, row_id, old_values)
  SELECT 'table_bookings', tb.id, jsonb_build_object('confirmed_at', tb.confirmed_at, 'payment_status', tb.payment_status,
         'updated_at', tb.updated_at)
    FROM public.table_bookings tb
   WHERE tb.id = ANY (v_no_deposit || ARRAY[
           'f922c595-f7ea-4177-a2f4-2eb21af968bd', '0aa68359-9a1c-439a-9047-ed6d1126362d',
           '8f7225cf-24ff-43f3-b26f-6934fecc9738', 'a66ed178-c0d1-4d1c-89b1-609fe7f23f59']::uuid[]);

  UPDATE public.table_bookings AS tb
     SET confirmed_at = v.confirmed_at
    FROM (VALUES
      ('f922c595-f7ea-4177-a2f4-2eb21af968bd'::uuid, '2026-04-18 11:35:11+00'::timestamptz),
      ('0aa68359-9a1c-439a-9047-ed6d1126362d'::uuid, '2026-04-18 19:37:37+00'::timestamptz),
      ('8f7225cf-24ff-43f3-b26f-6934fecc9738'::uuid, '2026-04-23 12:02:59+00'::timestamptz),
      ('a66ed178-c0d1-4d1c-89b1-609fe7f23f59'::uuid, '2026-07-07 16:28:35.223+00'::timestamptz)
    ) AS v(id, confirmed_at)
   WHERE tb.id = v.id AND tb.confirmed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 4 THEN RAISE EXCEPTION 'retire_old_booking_rows: set % confirmed times, expected 4', v_n; END IF;

  UPDATE public.table_bookings SET payment_status = 'partial_refund'
   WHERE id = v_partial_refund AND payment_status = 'completed';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'retire_old_booking_rows: set % partial refunds, expected 1', v_n; END IF;

  UPDATE public.table_bookings SET payment_status = NULL
   WHERE id = ANY (v_no_deposit) AND status = 'confirmed' AND payment_status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 26 THEN RAISE EXCEPTION 'retire_old_booking_rows: cleared % payment statuses, expected 26', v_n; END IF;

  -- 6. pending_bookings.
  SELECT count(*) INTO v_n FROM public.pending_bookings;
  IF v_n <> 48 THEN RAISE EXCEPTION 'retire_old_booking_rows: pending_bookings holds % rows, expected 48', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.pending_bookings WHERE id = ANY (v_pending_bookings);
  IF v_n <> 48 THEN RAISE EXCEPTION 'retire_old_booking_rows: % of the 48 measured pending_bookings rows are present', v_n; END IF;

  INSERT INTO public.retired_pending_bookings_20261027 SELECT * FROM public.pending_bookings WHERE id = ANY (v_pending_bookings);
  DELETE FROM public.pending_bookings WHERE id = ANY (v_pending_bookings);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 48 THEN RAISE EXCEPTION 'retire_old_booking_rows: deleted % pending_bookings rows, expected 48', v_n; END IF;

  -- 7. Card-capture short links.
  SELECT count(*) INTO v_n FROM public.short_links
   WHERE id = ANY (v_short_links) AND destination_url LIKE '%/card-capture' AND expires_at IS NULL;
  IF v_n <> 2 THEN RAISE EXCEPTION 'retire_old_booking_rows: expected 2 open card-capture short links, found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.short_links WHERE destination_url LIKE '%/card-capture%';
  IF v_n <> 2 THEN RAISE EXCEPTION 'retire_old_booking_rows: % short links point at card-capture, expected 2', v_n; END IF;

  INSERT INTO public.retired_row_values_20261027 (source_table, row_id, old_values)
  SELECT 'short_links', s.id, jsonb_build_object('expires_at', s.expires_at, 'updated_at', s.updated_at)
    FROM public.short_links s WHERE s.id = ANY (v_short_links);

  UPDATE public.short_links SET expires_at = v_now, updated_at = v_now
   WHERE id = ANY (v_short_links) AND expires_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 2 THEN RAISE EXCEPTION 'retire_old_booking_rows: expired % short links, expected 2', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.retired_row_values_20261027;
  IF v_n <> 6 + 9 + 30 + 2 THEN RAISE EXCEPTION 'retire_old_booking_rows: backed up % rows, expected 47', v_n; END IF;

  RAISE NOTICE 'retire_old_booking_rows: 6 holds, 9 ledger rows, 30 table bookings, 48 pending_bookings rows and 2 short links done';
END
$tidy$;
