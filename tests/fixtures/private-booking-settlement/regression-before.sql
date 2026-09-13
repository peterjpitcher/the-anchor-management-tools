CREATE FUNCTION public.fixture_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %', label; END IF; END;
$$;
CREATE FUNCTION public.fixture_throws(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected %, got %', expected, SQLERRM;
  END;
  RAISE EXCEPTION 'Expected failure: %', expected;
END;
$$;

INSERT INTO invoices(id,invoice_number,due_date,total_amount,status,sent_at,paypal_order_id)
VALUES('8a590bb4-487b-4522-929b-b5c6c3f81071','FIXTURE-REPAIR','2026-09-09',994.80,'partially_paid',now(),'1NX08920NB808283W'),
('00000000-0000-0000-0000-000000000010','FIXTURE-CONCURRENT','2026-09-09',120,'sent',now(),NULL),
('00000000-0000-0000-0000-000000000011','FIXTURE-SECOND','2026-09-09',120,'sent',now(),NULL);
INSERT INTO private_bookings(customer_name,id,event_date,start_time,guest_count,status,invoice_id,invoice_deposit_treatment,deposit_amount,deposit_paid_date)
VALUES('Fixture booking','c28527fe-a373-460d-85a8-e509b78d6eba','2026-09-10','19:00',24,'confirmed','8a590bb4-487b-4522-929b-b5c6c3f81071','deducted',250,'2026-08-28'),
('Fixture booking','00000000-0000-0000-0000-000000000020','2026-09-10','19:00',10,'confirmed','00000000-0000-0000-0000-000000000010','held_separately',250,'2026-08-28');
INSERT INTO private_booking_items(booking_id,item_type,description,unit_price)
VALUES('c28527fe-a373-460d-85a8-e509b78d6eba','other','Fixture event',829),
('00000000-0000-0000-0000-000000000020','other','Fixture event',100);
INSERT INTO invoice_payments(invoice_id,payment_date,amount,payment_method,source_kind)
VALUES('8a590bb4-487b-4522-929b-b5c6c3f81071','2026-08-28',250,'other','booking_deposit');
UPDATE invoices SET paid_amount=250 WHERE id='8a590bb4-487b-4522-929b-b5c6c3f81071';
SELECT fixture_throws($q$SELECT record_invoice_paypal_payment_atomic('8a590bb4-487b-4522-929b-b5c6c3f81071',744.80,'BEFORE-FAIL',NULL)$q$, 'invoice_payments_payment_method_check');
SELECT fixture_assert(calculate_private_booking_balance('c28527fe-a373-460d-85a8-e509b78d6eba')=994.80,'old balance ignores deposit credit');
