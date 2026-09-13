-- Cancel stale private booking texts that are still waiting for staff approval.
--
-- Approved by the owner on 11 September 2026 (items 10 and 11 of the SSOT reconciliation):
--   10 Cancel the queued texts for private bookings that are already cancelled.
--   11 Cancel every balance reminder still waiting for approval that was queued before
--      11 September 2026. The owner: "don't send historic ones".
--
-- Both use the queue's own 'cancelled' status, the same single-column write the app makes when a
-- booking is cancelled (src/lib/private-bookings/queue-cleanup.ts). Nothing is deleted and no
-- other column changes. None of these texts can have gone out: every row is 'pending', with no
-- sent_at, and all six trigger types wait for a member of staff to press Send Now
-- (src/lib/private-bookings/sms-approval.ts).
--
-- WHAT CHANGES (read-only check of production, 11 September 2026)
--   [10] 3 texts for bookings whose status is 'cancelled':
--        1fb55f56-ce7d-47f3-ab4a-3c95da94aa18  booking_cancelled_retention  queued 11 Jul 2026
--        6111a638-6335-49f4-925c-ef8909049f4e  deposit_reminder_3day        queued  6 Jul 2026
--        952576fa-8ccf-4e66-8be8-595432c45d01  deposit_reminder_3day        queued 27 Jul 2026
--   [11] 18 balance reminders (21day 5, 16day 5, 15day 4, due 4) queued between 6 July and
--        8 September 2026, for 5 confirmed bookings. Every one of those balances fell due on or
--        before 10 September 2026, and the one booking with an event still to come (24 September)
--        has its final payment recorded, so sending any of them now would chase a deadline that
--        has passed. The monitor cron cannot queue them again: it only chases balances due today
--        or later.
--   The two sets do not overlap: 21 rows in all. The one other pending row (a deposit reminder
--   for a draft booking, queued 9 September) is not touched.
--
-- HOW IT GUARDS ITSELF
--   One DO block: all of it applies, or none of it. On a database without the christmas-2026
--   booking period it raises a NOTICE and changes nothing. On production each UPDATE names its
--   rows by id and also requires status 'pending', no sent_at and the captured trigger type,
--   booking status or queue date. A count other than 3 or 18 raises an exception. Afterwards no
--   pending or approved text may remain for a cancelled booking, and no pending balance reminder
--   queued before 11 September 2026, or the whole block rolls back.
--
-- Rollback: supabase/rollbacks/20260911172100_private_booking_queue_cancel_stale_texts.sql

DO $migration$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.booking_periods') IS NULL THEN
    RAISE NOTICE 'private_booking_queue_cancel_stale_texts: no booking_periods table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_periods WHERE id = '8a4535ee-9547-4672-b20a-489457b46376') THEN
    RAISE NOTICE 'private_booking_queue_cancel_stale_texts: christmas-2026 booking period absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [10] texts queued for bookings that are already cancelled
  UPDATE public.private_booking_sms_queue AS q
     SET status = 'cancelled'
   WHERE q.id IN ('1fb55f56-ce7d-47f3-ab4a-3c95da94aa18',
                  '6111a638-6335-49f4-925c-ef8909049f4e',
                  '952576fa-8ccf-4e66-8be8-595432c45d01')
     AND q.status = 'pending'
     AND q.sent_at IS NULL
     AND q.trigger_type IN ('booking_cancelled_retention', 'deposit_reminder_3day')
     AND EXISTS (SELECT 1 FROM public.private_bookings AS pb
                  WHERE pb.id = q.booking_id AND pb.status = 'cancelled');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 3 THEN RAISE EXCEPTION '[10] expected 3 row(s), matched %', v_rows; END IF;

  -- [11] balance reminders waiting for approval, queued before 11 September 2026 (London)
  UPDATE public.private_booking_sms_queue AS q
     SET status = 'cancelled'
   WHERE q.id IN ('86a18b61-f354-4ed1-b126-d3d85f98f581',
                  'f70728f6-23f7-41fc-9ac8-b623b8b66d3e',
                  'af7d6632-048e-4fd5-b5c9-872aefd90bb6',
                  '67871c89-751f-43ac-8831-247eafd723e3',
                  'fb8137fc-a196-442f-9e03-69b2d1a1980a',
                  '4a31d93c-7cc7-4568-a01c-fe321c42f13f',
                  '47f20575-5008-4cca-8181-864db3ac704f',
                  '8c103126-18da-4e4b-8a97-cf49488a2232',
                  '2ca94052-bd9f-407d-98eb-0e54115a6798',
                  'c30dcd27-2c4c-4acf-960b-7be013dbd60c',
                  '22d396d0-935e-4166-a267-97390c4139a0',
                  '0c111af6-493e-47d6-9cab-2dc9ad33399a',
                  '45891ff8-9abc-4c34-a172-0a7ef796e441',
                  'c513ec26-56e0-432f-b6e6-f42ebcc867f3',
                  'b9e8d98d-153c-4931-ac4b-d1c408832849',
                  '196ea9da-b107-42a9-9e37-693314981276',
                  '7b6e8099-9199-451f-b5d6-2cec2c6014ae',
                  '85c5a263-9ac0-45e8-ac1e-5822bea433ad')
     AND q.status = 'pending'
     AND q.sent_at IS NULL
     AND q.approved_at IS NULL
     AND q.trigger_type IN ('balance_reminder_21day', 'balance_reminder_16day',
                            'balance_reminder_15day', 'balance_reminder_due')
     AND q.created_at < (timestamp '2026-09-11 00:00' AT TIME ZONE 'Europe/London');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 18 THEN RAISE EXCEPTION '[11] expected 18 row(s), matched %', v_rows; END IF;

  -- Nothing of either kind may be left waiting.
  SELECT count(*) INTO v_rows
    FROM public.private_booking_sms_queue AS q
   WHERE q.status IN ('pending', 'approved')
     AND EXISTS (SELECT 1 FROM public.private_bookings AS pb
                  WHERE pb.id = q.booking_id AND pb.status = 'cancelled');
  IF v_rows <> 0 THEN RAISE EXCEPTION '[10] % text(s) still waiting for a cancelled booking', v_rows; END IF;

  SELECT count(*) INTO v_rows
    FROM public.private_booking_sms_queue AS q
   WHERE q.status IN ('pending', 'approved')
     AND q.trigger_type IN ('balance_reminder_21day', 'balance_reminder_16day',
                            'balance_reminder_15day', 'balance_reminder_due')
     AND q.created_at < (timestamp '2026-09-11 00:00' AT TIME ZONE 'Europe/London');
  IF v_rows <> 0 THEN RAISE EXCEPTION '[11] % balance reminder(s) queued before 11 September still waiting', v_rows; END IF;

  RAISE NOTICE 'private_booking_queue_cancel_stale_texts: 21 texts cancelled';
END
$migration$;
