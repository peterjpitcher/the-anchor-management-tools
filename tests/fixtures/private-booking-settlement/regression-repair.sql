SELECT fixture_assert((SELECT count(*)=1 FROM invoice_payments WHERE reference='62921439S0526370F'),'recovery idempotent');
SELECT fixture_assert((SELECT payment_date='2026-09-04' AND amount=744.80 FROM invoice_payments WHERE reference='62921439S0526370F'),'recovery corrects old-client capture date');
SELECT fixture_assert((SELECT paid_amount=994.80 AND status='paid' FROM invoices WHERE id='8a590bb4-487b-4522-929b-b5c6c3f81071'),'recovery settled invoice');
SELECT fixture_assert((SELECT final_payment_date AT TIME ZONE 'Europe/London'='2026-09-04'::timestamp AND final_payment_method='paypal' FROM private_bookings WHERE id='c28527fe-a373-460d-85a8-e509b78d6eba'),'recovery booking date and method');
SELECT 'PASS verified-capture recovery and repeated recovery';
