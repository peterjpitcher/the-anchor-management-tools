SET timezone = 'UTC';
SELECT fixture_assert(calculate_private_booking_balance('c28527fe-a373-460d-85a8-e509b78d6eba')=744.80,'applied deposit deducted once');
SELECT fixture_assert(calculate_private_booking_balance('00000000-0000-0000-0000-000000000020')=120,'held deposit stays separate');
SELECT fixture_throws($q$UPDATE invoice_payments SET amount=200 WHERE source_kind='booking_deposit'$q$,'invoice credit resolution');
SELECT fixture_throws($q$DELETE FROM invoice_payments WHERE source_kind='booking_deposit'$q$,'invoice credit resolution');
SELECT fixture_throws($q$UPDATE private_bookings SET deposit_amount=200 WHERE id='c28527fe-a373-460d-85a8-e509b78d6eba'$q$,'invoice credit resolution');
SELECT fixture_throws($q$SELECT * FROM reserve_refund_balance('private_booking','c28527fe-a373-460d-85a8-e509b78d6eba',250,50,'paypal','Fixture',NULL)$q$,'invoice credit resolution');
SELECT fixture_assert((SELECT count(*)=0 FROM payment_refunds),'rejected refund created no reservation');

-- Payments after invoicing must synchronise and must never be counted twice.
SELECT record_balance_payment('c28527fe-a373-460d-85a8-e509b78d6eba',100,'cash');
SELECT fixture_assert((SELECT paid_amount=350 FROM invoices WHERE id='8a590bb4-487b-4522-929b-b5c6c3f81071'),'booking insertion mirrored');
SELECT fixture_assert(calculate_private_booking_balance('c28527fe-a373-460d-85a8-e509b78d6eba')=644.80,'mirror not double counted');
SELECT fixture_throws($q$UPDATE invoice_payments SET amount=101 WHERE source_kind='booking_payment'$q$,'original booking payment');
SELECT fixture_throws($q$DELETE FROM invoice_payments WHERE source_kind='booking_payment'$q$,'original booking payment');
UPDATE private_booking_payments SET amount=150 WHERE booking_id='c28527fe-a373-460d-85a8-e509b78d6eba';
SELECT fixture_assert((SELECT paid_amount=400 FROM invoices WHERE id='8a590bb4-487b-4522-929b-b5c6c3f81071'),'booking edit mirrored');
DELETE FROM private_booking_payments WHERE booking_id='c28527fe-a373-460d-85a8-e509b78d6eba';
SELECT fixture_assert((SELECT paid_amount=250 FROM invoices WHERE id='8a590bb4-487b-4522-929b-b5c6c3f81071'),'booking deletion removes mirror before source foreign key');

-- Simulate the old four-argument application racing the dated recovery.
SELECT record_invoice_paypal_payment_atomic('8a590bb4-487b-4522-929b-b5c6c3f81071',744.80,'62921439S0526370F','1NX08920NB808283W');
SELECT fixture_assert((SELECT status='paid' AND paid_amount=994.80 FROM invoices WHERE id='8a590bb4-487b-4522-929b-b5c6c3f81071'),'PayPal completes invoice');
SELECT fixture_assert((SELECT final_payment_date IS NOT NULL FROM private_bookings WHERE id='c28527fe-a373-460d-85a8-e509b78d6eba'),'PayPal completes booking');
SELECT fixture_assert((SELECT balance_remaining=0 AND total_balance_paid=994.80 AND payment_status='Fully Paid' FROM private_bookings_with_details WHERE id='c28527fe-a373-460d-85a8-e509b78d6eba'),'view uses same payment ledger');
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('8a590bb4-487b-4522-929b-b5c6c3f81071',744.81,'62921439S0526370F',NULL)$q$,'paypal_capture_conflict');
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000011',744.80,'62921439S0526370F',NULL)$q$,'paypal_capture_conflict');
SELECT fixture_throws($q$SELECT record_balance_payment('c28527fe-a373-460d-85a8-e509b78d6eba',1,'cash')$q$,'exceeds remaining balance');
SELECT fixture_throws($q$UPDATE invoices SET status='void' WHERE id='8a590bb4-487b-4522-929b-b5c6c3f81071'$q$,'Cancel the invoice');
SELECT fixture_throws($q$SELECT cancel_private_booking_invoice_atomic('c28527fe-a373-460d-85a8-e509b78d6eba','Fixture',NULL)$q$,'invoice_has_real_payments');
SELECT fixture_throws($q$UPDATE private_bookings SET invoice_id=NULL WHERE id='c28527fe-a373-460d-85a8-e509b78d6eba'$q$,'invoice_has_real_payments');

-- Provider identities and amounts are immutable, so replays cannot credit twice.
SELECT fixture_throws($q$UPDATE invoice_payments SET amount=700 WHERE reference='62921439S0526370F'$q$,'PayPal captures cannot be changed');
SELECT fixture_throws($q$UPDATE invoice_payments SET reference='CHANGED' WHERE reference='62921439S0526370F'$q$,'PayPal captures cannot be changed');
SELECT fixture_throws($q$DELETE FROM invoice_payments WHERE reference='62921439S0526370F'$q$,'PayPal captures cannot be changed');
-- Manual payment corrections reopen both summaries.
SELECT record_invoice_payment_transaction('{"invoice_id":"00000000-0000-0000-0000-000000000010","amount":120,"payment_method":"cash","payment_date":"2026-09-04","reference":"MANUAL-EDIT"}');
SELECT fixture_assert((SELECT final_payment_date IS NOT NULL FROM private_bookings WHERE id='00000000-0000-0000-0000-000000000020'),'manual payment completes booking');
UPDATE invoice_payments SET amount=110 WHERE reference='MANUAL-EDIT';
SELECT fixture_assert((SELECT final_payment_date IS NULL FROM private_bookings WHERE id='00000000-0000-0000-0000-000000000020'),'reducing manual payment reopens booking');
SELECT fixture_assert((SELECT status='partially_paid' AND paid_amount=110 FROM invoices WHERE id='00000000-0000-0000-0000-000000000010'),'reducing manual payment reopens invoice');
DELETE FROM invoice_payments WHERE reference='MANUAL-EDIT';

-- Provider dates are London dates even when PostgreSQL runs in UTC.
SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000011',10,'LONDON-DATE',NULL,'2026-09-04T23:30:00Z');
SELECT fixture_assert((SELECT payment_date='2026-09-05' FROM invoice_payments WHERE reference='LONDON-DATE'),'London capture date');
UPDATE invoice_payments SET payment_date='2026-09-04' WHERE reference='LONDON-DATE';
INSERT INTO invoices(id,invoice_number,due_date,total_amount,status,sent_at)
VALUES('00000000-0000-0000-0000-000000000013','FIXTURE-DELETE','2026-09-09',120,'sent',now());
SELECT record_invoice_payment_transaction('{"invoice_id":"00000000-0000-0000-0000-000000000013","amount":10,"payment_method":"cash","payment_date":"2026-09-04","reference":"DELETE-MANUAL"}');
DELETE FROM invoice_payments WHERE reference='DELETE-MANUAL';
SELECT fixture_assert((SELECT paid_amount=0 AND status='sent' FROM invoices WHERE id='00000000-0000-0000-0000-000000000013'),'deletion resets invoice');
UPDATE invoices SET status='void' WHERE id='00000000-0000-0000-0000-000000000011';
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000011',10,'VOID',NULL)$q$,'invoice_not_payable');
SELECT fixture_throws($q$SELECT record_invoice_payment_transaction('{"invoice_id":"00000000-0000-0000-0000-000000000011","amount":10,"payment_method":"cash","payment_date":"2026-09-04"}')$q$,'invoice_not_payable');
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000010',0,'ZERO',NULL)$q$,'invalid_payment_amount');
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000010',1.001,'ROUNDING',NULL)$q$,'invalid_payment_amount');
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000010','NaN'::numeric,'NAN',NULL)$q$,'invalid_payment_amount');
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000010','Infinity'::numeric,'INF',NULL)$q$,'invalid_payment_amount');
INSERT INTO invoices(id,invoice_number,due_date,total_amount,status)
VALUES('00000000-0000-0000-0000-000000000012','FIXTURE-OVERPAY','2026-09-09',120,'sent');
SELECT fixture_assert((record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000012',130,'OVERPAY',NULL)->>'overpaid_amount')::numeric=10,'actual excess capture retained and flagged');
SELECT fixture_assert((SELECT paid_amount=130 FROM invoices WHERE id='00000000-0000-0000-0000-000000000012'),'overpayment is never clipped');

-- Reuse actual permission helper with an invoice-only staff fixture. Internal
-- booking recalculation must not require this person to have booking.view.
GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
GRANT EXECUTE ON FUNCTION public.fixture_throws(text,text), public.fixture_assert(boolean,text) TO authenticated,service_role,anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
SET ROLE authenticated;
SET request.jwt.claims='{"role":"authenticated"}';
SET fixture.user_id='00000000-0000-0000-0000-000000000099';
SET fixture.permission='invoices.edit';
SELECT record_invoice_payment_transaction('{"invoice_id":"00000000-0000-0000-0000-000000000010","amount":5,"payment_method":"cash","payment_date":"2026-09-04"}');
SELECT fixture_throws($q$SELECT calculate_private_booking_balance('00000000-0000-0000-0000-000000000020')$q$,'permission_denied');
SET fixture.permission='private_bookings.view';
SELECT fixture_assert(calculate_private_booking_balance('00000000-0000-0000-0000-000000000020')=115,'booking-only staff can see invoice-origin money');
SELECT fixture_throws($q$SELECT * FROM private_booking_settlement_rows('00000000-0000-0000-0000-000000000020')$q$,'permission denied');
RESET ROLE;
SET request.jwt.claims='{"role":"service_role"}';
DELETE FROM invoice_payments WHERE invoice_id='00000000-0000-0000-0000-000000000010';

-- The real invoice creation function must still copy earlier booking payments,
-- accept a deposit credit and permit cancellation when no real payment exists.
INSERT INTO private_bookings(id,customer_name,event_date,start_time,status,deposit_amount,deposit_paid_date)
VALUES('00000000-0000-0000-0000-000000000030','Fixture cancellation','2026-09-10','19:00','confirmed',20,'2026-09-01'),
('00000000-0000-0000-0000-000000000031','Fixture earlier payment','2026-09-10','19:00','confirmed',0,NULL);
INSERT INTO private_booking_items(booking_id,item_type,description,unit_price)
VALUES('00000000-0000-0000-0000-000000000030','other','Fixture event',100),
('00000000-0000-0000-0000-000000000031','other','Fixture event',100);
SELECT record_balance_payment('00000000-0000-0000-0000-000000000031',30,'cash');
SELECT fixture_throws($q$INSERT INTO invoice_payments(invoice_id,payment_date,amount,payment_method,source_payment_id,source_kind)
SELECT '00000000-0000-0000-0000-000000000010',(created_at AT TIME ZONE 'Europe/London')::date,amount,'cash',id,'booking_payment'
FROM private_booking_payments WHERE booking_id='00000000-0000-0000-0000-000000000031'$q$,'original booking payment');
SELECT create_private_booking_invoice_atomic('00000000-0000-0000-0000-000000000030','2026-09-01','2026-09-09',NULL,'deducted',
 '[{"description":"Fixture event","quantity":1,"unit_price":100,"vat_rate":20}]','{"subtotal_amount":100,"vat_amount":20,"total_amount":120}',NULL);
SELECT create_private_booking_invoice_atomic('00000000-0000-0000-0000-000000000031','2026-09-01','2026-09-09',NULL,'held_separately',
 '[{"description":"Fixture event","quantity":1,"unit_price":100,"vat_rate":20}]','{"subtotal_amount":100,"vat_amount":20,"total_amount":120}',NULL);
SELECT fixture_assert((SELECT i.paid_amount=30 FROM private_bookings b JOIN invoices i ON i.id=b.invoice_id WHERE b.id='00000000-0000-0000-0000-000000000031'),'pre-invoice payment copied once');
SELECT fixture_assert(calculate_private_booking_balance('00000000-0000-0000-0000-000000000031')=90,'pre-invoice payment not doubled');
SELECT fixture_throws($q$UPDATE private_booking_items SET unit_price=101 WHERE booking_id='00000000-0000-0000-0000-000000000031'$q$,'Resolve the linked invoice');
SELECT fixture_throws($q$DELETE FROM private_booking_items WHERE booking_id='00000000-0000-0000-0000-000000000031'$q$,'Resolve the linked invoice');
SELECT fixture_throws($q$INSERT INTO private_booking_items(booking_id,item_type,description,unit_price) VALUES('00000000-0000-0000-0000-000000000031','other','Fixture extra',1)$q$,'Resolve the linked invoice');
SELECT fixture_throws($q$UPDATE private_bookings SET discount_type='fixed',discount_amount=1 WHERE id='00000000-0000-0000-0000-000000000031'$q$,'Resolve the linked invoice');
SELECT fixture_throws($q$UPDATE invoices SET total_amount=121 WHERE id=(SELECT invoice_id FROM private_bookings WHERE id='00000000-0000-0000-0000-000000000031')$q$,'Resolve the linked invoice');
SELECT fixture_throws($q$UPDATE invoice_line_items SET unit_price=101 WHERE invoice_id=(SELECT invoice_id FROM private_bookings WHERE id='00000000-0000-0000-0000-000000000031')$q$,'Resolve the linked invoice');
SELECT fixture_assert((SELECT i.total_amount=120 AND get_booking_gross_total(b.id)=120 FROM private_bookings b JOIN invoices i ON i.id=b.invoice_id WHERE b.id='00000000-0000-0000-0000-000000000031'),'price guards preserve both totals');
UPDATE private_booking_items SET notes='Fixture operational note' WHERE booking_id='00000000-0000-0000-0000-000000000031';
SELECT cancel_private_booking_invoice_atomic('00000000-0000-0000-0000-000000000030','Fixture cancellation',NULL);
SELECT fixture_assert((SELECT invoice_id IS NULL FROM private_bookings WHERE id='00000000-0000-0000-0000-000000000030'),'deposit-only cancellation unlinks');
SELECT fixture_assert(calculate_private_booking_balance('00000000-0000-0000-0000-000000000030')=120,'cancelled deposit credit no longer reduces event price');

SELECT fixture_assert(NOT has_function_privilege('anon','public.record_invoice_paypal_payment_atomic(uuid,numeric,text,text,timestamptz)','EXECUTE'),'anon cannot record capture');
SELECT fixture_assert(NOT has_function_privilege('authenticated','public.record_invoice_paypal_payment_atomic(uuid,numeric,text,text,timestamptz)','EXECUTE'),'authenticated cannot call trusted capture RPC');
SELECT fixture_assert(has_function_privilege('service_role','public.record_invoice_paypal_payment_atomic(uuid,numeric,text,text,timestamptz)','EXECUTE'),'service role can record capture');
SET ROLE anon;
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('00000000-0000-0000-0000-000000000010',1,'ANON',NULL)$q$,'permission denied');
SELECT fixture_throws($q$SELECT calculate_private_booking_balance('00000000-0000-0000-0000-000000000020')$q$,'permission denied');
RESET ROLE;
SET request.jwt.claims='{}';
SET fixture.user_id='';
SELECT fixture_throws($q$SELECT get_private_booking_settlement_total('c28527fe-a373-460d-85a8-e509b78d6eba')$q$,'permission_denied');
SET request.jwt.claims='{"role":"service_role"}';
SELECT 'PASS settlement ledger, mirrors, invalid states, dates, permissions and retries';
