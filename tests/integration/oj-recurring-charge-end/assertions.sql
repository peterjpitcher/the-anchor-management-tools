\set ON_ERROR_STOP on
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET test.has_permission = 'true';
CREATE FUNCTION pg_temp.assert_true(value boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', message; END IF; END; $$;
CREATE FUNCTION pg_temp.expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught = MESSAGE_TEXT; END;
  IF caught IS NULL OR position(expected IN caught) = 0 THEN
    RAISE EXCEPTION 'Expected error containing %, got %', expected, caught;
  END IF;
END; $$;
BEGIN;
INSERT INTO public.oj_vendor_recurring_charges(id, vendor_id, description, amount_ex_vat, created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Monthly fixture',100,'2026-01-01');
INSERT INTO public.oj_recurring_charge_instances(vendor_id, recurring_charge_id, period_yyyymm, period_start, period_end,
 coverage_start, coverage_end, description_snapshot, amount_ex_vat_snapshot)
VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-09','2026-09-01','2026-09-30','2026-09-01','2026-09-30','Earlier arrears',100);
DO $$ DECLARE preview jsonb; result jsonb;
BEGIN
 preview := public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15');
 PERFORM pg_temp.assert_true((preview->>'totalExVat')::numeric = 148.39, 'Earlier arrears plus 15/31 final month');
 PERFORM pg_temp.assert_true((preview->>'totalIncVat')::numeric = 178.07, 'VAT rounded after ex VAT');
 PERFORM pg_temp.assert_true((SELECT end_date IS NULL FROM public.oj_vendor_recurring_charges LIMIT 1),'Preview did not end charge');
 PERFORM pg_temp.expect_error($q$SELECT public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15',false,'{}')$q$, 'Refresh the preview');
 PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.oj_recurring_charge_instances),'Stale confirmation rolled back new instance');
 result := public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15',false,preview);
 PERFORM pg_temp.assert_true(result->>'preview' = 'false','Confirmed closure');
 PERFORM pg_temp.assert_true((SELECT is_active AND end_date = '2026-10-15' FROM public.oj_vendor_recurring_charges LIMIT 1),'Ended remains eligible for arrears');
 PERFORM pg_temp.assert_true((SELECT amount_ex_vat_snapshot = 48.39 AND coverage_end = '2026-10-15' FROM public.oj_recurring_charge_instances WHERE period_yyyymm='2026-10'),'Final instance materialised');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.audit_logs),'Audit written atomically');
 PERFORM pg_temp.expect_error($q$UPDATE public.oj_vendor_recurring_charges SET is_active=false$q$,'cannot be changed');
 PERFORM pg_temp.expect_error($q$INSERT INTO public.oj_recurring_charge_instances(vendor_id,recurring_charge_id,period_yyyymm,period_start,period_end,description_snapshot,amount_ex_vat_snapshot) VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-11','2026-11-01','2026-11-30','stale',100)$q$,'Charge has ended');
 PERFORM pg_temp.expect_error($q$SELECT public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15',false,'{}')$q$, 'already has');
END; $$;
ROLLBACK;
BEGIN;
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Cap fixture',100,'2026-01-01');
INSERT INTO public.oj_recurring_charge_instances(vendor_id,recurring_charge_id,period_yyyymm,period_start,period_end,coverage_start,coverage_end,description_snapshot,amount_ex_vat_snapshot)
VALUES
('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-10','2026-10-01','2026-10-31','2026-10-01','2026-10-31','Cap part',33.33),
('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-10-S1','2026-10-01','2026-10-31','2026-10-01','2026-10-31','Cap remainder',66.67),
('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-11','2026-11-01','2026-11-30','2026-11-01','2026-11-30','Future',100);
DO $$ DECLARE preview jsonb;
BEGIN
 preview := public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15');
 PERFORM pg_temp.assert_true((preview->>'totalExVat')::numeric=48.39,'Cap family prorates once');
 PERFORM public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15',false,preview);
 PERFORM pg_temp.assert_true((SELECT sum(amount_ex_vat_snapshot)=48.39 AND count(*)=2 FROM public.oj_recurring_charge_instances),'Split total and future removal');
END; $$;
ROLLBACK;
BEGIN;
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,frequency,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Quarter fixture',300,'quarterly','2026-01-01');
INSERT INTO public.oj_recurring_charge_instances(vendor_id,recurring_charge_id,period_yyyymm,period_start,period_end,coverage_start,coverage_end,description_snapshot,amount_ex_vat_snapshot,status,invoice_id)
VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-07','2026-07-01','2026-07-31','2026-07-01','2026-09-30','Quarter',300,'billed','00000000-0000-4000-8000-000000000030');
SELECT pg_temp.expect_error($q$SELECT public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-08-15')$q$,'already on an invoice');
SELECT pg_temp.assert_true((public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-11-15')->>'totalExVat')::numeric=150, 'Next anniversary, 46/92 days');
INSERT INTO public.oj_billing_runs(vendor_id,status) VALUES ('00000000-0000-4000-8000-000000000020','processing');
SELECT pg_temp.expect_error($q$SELECT public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-11-15')$q$,'Billing is in progress');
DELETE FROM public.oj_billing_runs;
SET test.has_permission='false';
SELECT pg_temp.expect_error($q$SELECT public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-11-15')$q$,'permission');
SET test.has_permission='true';
SET request.jwt.claim.sub='';
SELECT pg_temp.expect_error($q$SELECT public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-11-15')$q$,'permission');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.oj_end_recurring_charge(uuid,date,boolean,jsonb)','execute'),'Anon cannot call closure');
SELECT pg_temp.assert_true(has_function_privilege('authenticated','public.oj_end_recurring_charge(uuid,date,boolean,jsonb)','execute'),'Authenticated entrypoint');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.oj_guard_ended_charge_instance()','execute'),'No public trigger execution');
ROLLBACK;
BEGIN;
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Role fixture',100,'2026-10-01');
SET LOCAL ROLE authenticated;
DO $$ DECLARE preview jsonb;
BEGIN
 preview := public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-01');
 PERFORM public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-01',false,preview);
END; $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.oj_recurring_charge_instances),'Edit user closure succeeds despite manage-only instance RLS');
SELECT pg_temp.assert_true((SELECT amount_ex_vat_snapshot=3.23 FROM public.oj_recurring_charge_instances),'First day closure');
ROLLBACK;
BEGIN;
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,frequency,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Leap year fixture',366,'annually','2024-01-01');
SELECT pg_temp.assert_true((public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2024-02-29')->>'totalExVat')::numeric=60,'Annual first cycle anchored to creation month, 60/366 days');
ROLLBACK;
BEGIN;
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Reissue fixture',100,'2026-01-01');
INSERT INTO public.invoices VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000020',null);
DO $$ DECLARE versions jsonb; result jsonb; preview jsonb;
BEGIN
 SELECT jsonb_object_agg(id::text,updated_at) INTO versions FROM public.oj_vendor_recurring_charges;
 result := public.oj_reissue_invoice_with_charge_versions('00000000-0000-4000-8000-000000000030','rebuild_draft','{}','[]','{}','{}','[]',versions);
 PERFORM pg_temp.assert_true(result->>'stub'='true','Unchanged versions delegate to existing reissue transaction');
 preview := public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-04');
 PERFORM public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-04',false,preview);
 -- A separate clock value makes the stale-version assertion deterministic within one transaction.
 UPDATE public.oj_vendor_recurring_charges SET updated_at=updated_at+interval '1 second';
 BEGIN
  PERFORM public.oj_reissue_invoice_with_charge_versions('00000000-0000-4000-8000-000000000030','rebuild_draft','{}','[]','{}','{}','[]',versions);
  RAISE EXCEPTION 'FAILED: stale reissue accepted';
 EXCEPTION WHEN OTHERS THEN
  IF position('Recurring charges changed' IN SQLERRM)=0 THEN RAISE; END IF;
 END;
END; $$;
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.oj_reissue_invoice_with_charge_versions(uuid,text,jsonb,jsonb,uuid[],uuid[],jsonb,jsonb)','execute'),'Reissue wrapper remains service only');
ROLLBACK;
BEGIN;
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET test.has_permission = 'true';
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Missed months fixture',100,'2026-08-01');
SELECT pg_temp.assert_true((public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15')->>'totalExVat')::numeric=248.39,'Unmaterialised completed cycles are preserved in preview');
INSERT INTO public.oj_recurring_charge_instances(vendor_id,recurring_charge_id,period_yyyymm,period_start,period_end,description_snapshot,amount_ex_vat_snapshot,status)
VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-08','2026-08-01','2026-08-31','Reserved fixture',100,'billing_pending');
SELECT pg_temp.expect_error($q$SELECT public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15')$q$,'reserved for an invoice');
ROLLBACK;
BEGIN;
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,frequency,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Legacy annual fixture',1200,'annually','2026-01-01');
INSERT INTO public.oj_recurring_charge_instances(vendor_id,recurring_charge_id,period_yyyymm,period_start,period_end,description_snapshot,amount_ex_vat_snapshot,status)
VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-01','2026-01-01','2026-01-31','Legacy null coverage fixture',1200,'paid');
SELECT pg_temp.expect_error($q$SELECT public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-07-15')$q$,'already on an invoice');
ROLLBACK;
BEGIN;
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Penny allocation fixture',0.03,'2026-10-01');
INSERT INTO public.oj_recurring_charge_instances(vendor_id,recurring_charge_id,period_yyyymm,period_start,period_end,coverage_start,coverage_end,description_snapshot,amount_ex_vat_snapshot)
SELECT '00000000-0000-4000-8000-000000000020'::uuid,'00000000-0000-4000-8000-000000000010'::uuid,'2026-10-S'||n,'2026-10-01'::date,'2026-10-31'::date,'2026-10-01'::date,'2026-10-31'::date,'Penny part',0.01 FROM generate_series(1,3) n;
DO $$ DECLARE preview jsonb;
BEGIN
 preview:=public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-16');
 PERFORM pg_temp.assert_true((preview->>'totalExVat')::numeric=0.02,'Three tiny parts rounded as one period');
 PERFORM public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-16',false,preview);
 PERFORM pg_temp.assert_true((SELECT sum(amount_ex_vat_snapshot)=0.02 AND min(amount_ex_vat_snapshot)>=0 FROM public.oj_recurring_charge_instances),'No negative penny remainder');
END; $$;
ROLLBACK;
BEGIN;
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET test.has_permission = 'true';
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Future ending fixture',100,'2026-09-01');
DO $$ DECLARE preview jsonb;
BEGIN
 preview:=public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-11-15');
 PERFORM pg_temp.assert_true((preview->>'totalExVat')::numeric=250,'Future ending retains September/October and half November');
 PERFORM public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-11-15',false,preview);
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.oj_recurring_charge_instances WHERE period_end<='2026-09-30'),'September billing cannot invoice future service early');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.oj_recurring_charge_instances WHERE period_end<='2026-10-31'),'October respects monthly eligibility');
 PERFORM pg_temp.assert_true((SELECT amount_ex_vat_snapshot=50 AND coverage_end='2026-11-15' FROM public.oj_recurring_charge_instances WHERE period_yyyymm='2026-11'),'Future last month prorates correctly');
END; $$;
ROLLBACK;
BEGIN;
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Reserved reissue fixture',100,'2026-10-01');
INSERT INTO public.invoices VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000020',null);
INSERT INTO public.oj_recurring_charge_instances(vendor_id,recurring_charge_id,period_yyyymm,period_start,period_end,coverage_start,coverage_end,description_snapshot,amount_ex_vat_snapshot,status)
VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','2026-10','2026-10-01','2026-10-31','2026-10-01','2026-10-31','Reserved',100,'billing_pending');
DO $$ DECLARE versions jsonb; virtual jsonb;
BEGIN
 SELECT jsonb_object_agg(id::text,updated_at) INTO versions FROM public.oj_vendor_recurring_charges;
 virtual:='[{"vendor_id":"00000000-0000-4000-8000-000000000020","recurring_charge_id":"00000000-0000-4000-8000-000000000010","period_yyyymm":"2026-10","period_start":"2026-10-01","period_end":"2026-10-31","coverage_start":"2026-10-01","coverage_end":"2026-10-31","description_snapshot":"Reserved","amount_ex_vat_snapshot":100,"vat_rate_snapshot":20,"sort_order_snapshot":0}]';
 BEGIN
  PERFORM public.oj_reissue_invoice_with_charge_versions('00000000-0000-4000-8000-000000000030','rebuild_draft','{}','[]','{}','{}',virtual,versions);
  RAISE EXCEPTION 'FAILED: reissue stole a reserved virtual row';
 EXCEPTION WHEN OTHERS THEN IF position('snapshot changed' IN SQLERRM)=0 THEN RAISE; END IF; END;
 INSERT INTO public.oj_billing_runs(vendor_id,status) VALUES('00000000-0000-4000-8000-000000000020','processing');
 BEGIN
  PERFORM public.oj_reissue_invoice_with_charge_versions('00000000-0000-4000-8000-000000000030','rebuild_draft','{}','[]','{}','{}','[]',versions);
  RAISE EXCEPTION 'FAILED: reissue ignored active billing';
 EXCEPTION WHEN OTHERS THEN IF position('Billing is in progress' IN SQLERRM)=0 THEN RAISE; END IF; END;
END; $$;
ROLLBACK;
