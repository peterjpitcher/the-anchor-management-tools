-- Rollback for 20260911172100_private_booking_queue_cancel_stale_texts.sql
--
-- Puts the 21 cancelled texts back to 'pending', exactly as production held them on
-- 11 September 2026. Hand-run SQL, like everything in this folder. No other column was changed,
-- so nothing else needs restoring.
--
-- Think before running it: all 21 go straight back into the approval queue and the Messages
-- count, and any of them would send if someone pressed Send Now. That includes balance
-- reminders for deadlines that have passed and texts for bookings that are cancelled.
--
-- It only touches a row that is still 'cancelled' with no sent_at. If any of the 21 has changed
-- since the migration, the count check fails and nothing is rolled back.

DO $rollback$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.booking_periods') IS NULL THEN
    RAISE NOTICE 'rollback private_booking_queue_cancel_stale_texts: not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_periods WHERE id = '8a4535ee-9547-4672-b20a-489457b46376') THEN
    RAISE NOTICE 'rollback private_booking_queue_cancel_stale_texts: not the production dataset; nothing changed';
    RETURN;
  END IF;

  UPDATE public.private_booking_sms_queue
     SET status = 'pending'
   WHERE id IN ('1fb55f56-ce7d-47f3-ab4a-3c95da94aa18',
                '6111a638-6335-49f4-925c-ef8909049f4e',
                '952576fa-8ccf-4e66-8be8-595432c45d01',
                '86a18b61-f354-4ed1-b126-d3d85f98f581',
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
     AND status = 'cancelled'
     AND sent_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 21 THEN RAISE EXCEPTION 'expected 21 row(s), matched %', v_rows; END IF;

  RAISE NOTICE 'rollback private_booking_queue_cancel_stale_texts: 21 texts back to pending';
END
$rollback$;
