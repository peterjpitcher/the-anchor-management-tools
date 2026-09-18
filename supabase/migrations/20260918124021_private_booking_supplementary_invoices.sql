-- Target tfcasgxopxegwrabvwat. Apply only after approval of this exact SQL.
SET lock_timeout = '5s';
CREATE TABLE public.private_booking_invoices (
 booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE RESTRICT,
 invoice_id uuid PRIMARY KEY REFERENCES public.invoices(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('original','supplementary')),
 created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX private_booking_invoices_booking_idx ON public.private_booking_invoices(booking_id);
CREATE TABLE public.private_booking_charge_batches (
 id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','void')),
 invoice_id uuid UNIQUE REFERENCES public.invoices(id) ON DELETE RESTRICT,
 lines jsonb NOT NULL, due_date date NOT NULL, reference text,
 delivery_state text NOT NULL DEFAULT 'not_sent' CHECK(delivery_state IN ('not_sent','sending','sent','failed')),
 delivery_claim_id uuid, delivery_error text,
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(lines)='array'), CHECK(status <> 'issued' OR invoice_id IS NOT NULL)
);
CREATE INDEX private_booking_charge_batches_booking_idx ON public.private_booking_charge_batches(booking_id);
CREATE TABLE public.private_booking_payment_receipts (
 id uuid PRIMARY KEY, booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount > 0), payment_date date NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','card','bank_transfer','cheque','other')),
 reference text, notes text, allocations jsonb NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_payments ADD COLUMN receipt_id uuid REFERENCES public.private_booking_payment_receipts(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX invoice_payment_receipt_allocation_key ON public.invoice_payments(receipt_id,invoice_id) WHERE receipt_id IS NOT NULL;
ALTER TABLE public.private_bookings ADD COLUMN receipt_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.private_booking_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_booking_charge_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_booking_payment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_booking_invoices,public.private_booking_charge_batches,public.private_booking_payment_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.private_booking_invoices,public.private_booking_charge_batches,public.private_booking_payment_receipts TO service_role;
GRANT SELECT ON public.private_booking_invoices,public.private_booking_charge_batches,public.private_booking_payment_receipts TO authenticated;
CREATE POLICY booking_invoices_read ON public.private_booking_invoices FOR SELECT TO authenticated USING (public.user_has_permission(auth.uid(),'private_bookings','view') AND public.user_has_permission(auth.uid(),'private_bookings','view_pricing'));
CREATE POLICY booking_batches_read ON public.private_booking_charge_batches FOR SELECT TO authenticated USING (public.user_has_permission(auth.uid(),'private_bookings','view') AND public.user_has_permission(auth.uid(),'private_bookings','view_pricing'));
CREATE POLICY booking_receipts_read ON public.private_booking_payment_receipts FOR SELECT TO authenticated USING (public.user_has_permission(auth.uid(),'private_bookings','view') AND public.user_has_permission(auth.uid(),'private_bookings','view_pricing'));
INSERT INTO public.private_booking_invoices(booking_id,invoice_id,kind)
SELECT id,invoice_id,'original' FROM public.private_bookings WHERE invoice_id IS NOT NULL;

CREATE FUNCTION public.reserve_private_booking_receipt_version(p_booking_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_version integer;
BEGIN
 UPDATE public.private_bookings SET receipt_version=GREATEST(receipt_version,COALESCE((SELECT max(version) FROM public.private_booking_documents WHERE booking_id=p_booking_id AND document_type='receipt'),0))+1 WHERE id=p_booking_id RETURNING receipt_version INTO v_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
 RETURN v_version;
END $$;

CREATE FUNCTION public.sync_private_booking_invoice_association()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF OLD.invoice_id IS DISTINCT FROM NEW.invoice_id AND EXISTS(SELECT 1 FROM public.private_booking_charge_batches WHERE booking_id=NEW.id AND status='issued') THEN
   RAISE EXCEPTION 'Resolve supplementary invoices before replacing the original invoice';
 END IF;
 IF NEW.invoice_id IS NOT NULL THEN
 IF EXISTS(SELECT 1 FROM public.private_booking_invoices WHERE invoice_id=NEW.invoice_id AND (booking_id<>NEW.id OR kind<>'original')) THEN RAISE EXCEPTION 'invoice_already_associated'; END IF;
 INSERT INTO public.private_booking_invoices(booking_id,invoice_id,kind) VALUES(NEW.id,NEW.invoice_id,'original') ON CONFLICT(invoice_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER private_booking_invoice_association AFTER INSERT OR UPDATE OF invoice_id ON public.private_bookings FOR EACH ROW EXECUTE FUNCTION public.sync_private_booking_invoice_association();

CREATE FUNCTION public.get_private_booking_aggregate_gross_total(p_booking_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 BEGIN
 PERFORM public.assert_rpc_permission('private_bookings','view');
 IF COALESCE(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' AND NOT public.user_has_permission(auth.uid(),'private_bookings','view_pricing') THEN RETURN NULL; END IF;
 RETURN public.get_booking_gross_total(p_booking_id) + COALESCE((SELECT SUM(i.total_amount) FROM public.private_booking_charge_batches b JOIN public.invoices i ON i.id=b.invoice_id WHERE b.booking_id=p_booking_id AND b.status='issued' AND i.deleted_at IS NULL AND i.status <> 'void'),0);
 END
$$;
CREATE OR REPLACE FUNCTION public.private_booking_settlement_rows(p_booking_id uuid)
RETURNS TABLE(amount numeric,paid_at timestamptz,method text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT p.amount::numeric,p.created_at::timestamptz,p.method::text FROM public.private_booking_payments p WHERE p.booking_id=p_booking_id
 UNION ALL
 SELECT p.amount::numeric,(p.payment_date::timestamp AT TIME ZONE 'Europe/London')::timestamptz,p.payment_method::text
 FROM public.private_booking_invoices a JOIN public.private_bookings b ON b.id=a.booking_id JOIN public.invoices i ON i.id=a.invoice_id JOIN public.invoice_payments p ON p.invoice_id=a.invoice_id
 WHERE b.id=p_booking_id AND i.deleted_at IS NULL AND i.status <> 'void'
 AND (a.kind='supplementary' OR a.invoice_id=b.invoice_id)
 AND (p.source_kind IS NULL OR p.source_kind NOT IN ('booking_payment','booking_deposit') OR (p.source_kind='booking_deposit' AND a.kind='original' AND b.invoice_deposit_treatment='deducted'))
$$;
CREATE OR REPLACE FUNCTION public.lock_invoice_settlement(p_invoice_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_booking_id uuid;
BEGIN
 SELECT b.id INTO v_booking_id FROM public.private_bookings b WHERE b.invoice_id=p_invoice_id OR EXISTS(SELECT 1 FROM public.private_booking_invoices a WHERE a.booking_id=b.id AND a.invoice_id=p_invoice_id) FOR UPDATE;
 PERFORM 1 FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
 RETURN v_booking_id;
END $$;
CREATE FUNCTION public.invoice_effective_amount(p_invoice_id uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT GREATEST(0,i.total_amount-COALESCE((SELECT SUM(c.amount_inc_vat) FROM public.credit_notes c WHERE c.invoice_id=i.id AND c.status='issued'),0)) FROM public.invoices i WHERE i.id=p_invoice_id
$$;
CREATE OR REPLACE FUNCTION public.calculate_private_booking_balance(p_booking_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_invoice_id uuid; v_balance numeric;
BEGIN
 PERFORM public.assert_rpc_permission('private_bookings','view');
 SELECT invoice_id INTO v_invoice_id FROM public.private_bookings WHERE id=p_booking_id;
 IF v_invoice_id IS NULL THEN
 RETURN GREATEST(0,public.get_booking_gross_total(p_booking_id)-COALESCE((SELECT SUM(amount) FROM public.private_booking_settlement_rows(p_booking_id)),0));
 END IF;
 SELECT COALESCE(SUM(GREATEST(0,public.invoice_effective_amount(i.id)-COALESCE((SELECT SUM(p.amount) FROM public.invoice_payments p WHERE p.invoice_id=i.id),0))),0) INTO v_balance
 FROM public.private_booking_invoices a JOIN public.invoices i ON i.id=a.invoice_id
 WHERE a.booking_id=p_booking_id AND (a.invoice_id=v_invoice_id OR a.kind='supplementary') AND i.deleted_at IS NULL AND i.status NOT IN ('void','written_off');
 RETURN v_balance;
END $$;
CREATE OR REPLACE FUNCTION public.apply_balance_payment_status(p_booking_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_date timestamptz; v_method text;
BEGIN
 PERFORM 1 FROM public.private_bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF public.get_private_booking_aggregate_gross_total(p_booking_id)>0 AND public.calculate_private_booking_balance(p_booking_id)=0
 AND NOT EXISTS(SELECT 1 FROM public.private_booking_invoices a JOIN public.invoices i ON i.id=a.invoice_id WHERE a.booking_id=p_booking_id AND i.status='written_off') THEN
 SELECT paid_at,method INTO v_date,v_method FROM public.private_booking_settlement_rows(p_booking_id) ORDER BY paid_at DESC NULLS LAST,method LIMIT 1;
 END IF;
 UPDATE public.private_bookings SET final_payment_date=v_date,final_payment_method=v_method WHERE id=p_booking_id AND (final_payment_date IS DISTINCT FROM v_date OR final_payment_method IS DISTINCT FROM v_method);
END $$;

CREATE FUNCTION public.save_private_booking_charge_batch(p_booking_id uuid,p_batch_id uuid,p_expected_revision integer,p_lines jsonb,p_due_date date,p_reference text,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE b public.private_bookings%ROWTYPE; d public.private_booking_charge_batches%ROWTYPE; l jsonb; q numeric; u numeric; v numeric; x numeric;
BEGIN
 SELECT * INTO b FROM public.private_bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.invoice_id IS NULL OR b.status NOT IN ('confirmed','completed') THEN RAISE EXCEPTION 'booking_not_eligible_for_extras'; END IF;
 IF p_due_date IS NULL OR p_due_date < (now() AT TIME ZONE 'Europe/London')::date THEN RAISE EXCEPTION 'select_current_or_future_due_date'; END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_extra_lines'; END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
 q:=(l->>'quantity')::numeric; u:=(l->>'unit_price')::numeric; v:=(l->>'vat_rate')::numeric; x:=COALESCE((l->>'discount_percentage')::numeric,0);
 IF NULLIF(btrim(l->>'description'),'') IS NULL OR length(l->>'description')>2000 OR q IS NULL OR u IS NULL OR v IS NULL OR q<=0 OR q>100000 OR u<0 OR u>1000000 OR v<0 OR v>100 OR v::text='NaN' OR q<>round(q,3) OR u<>round(u,2) OR x<>round(x,2) OR v<>round(v,2) OR x<0 OR x>100 OR q::text='NaN' OR u::text='NaN' OR x::text='NaN' THEN RAISE EXCEPTION 'invalid_extra_line'; END IF;
 END LOOP;
 SELECT * INTO d FROM public.private_booking_charge_batches WHERE id=p_batch_id FOR UPDATE;
 IF FOUND THEN
 IF d.booking_id<>p_booking_id OR d.status<>'draft' OR d.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_charge_batch'; END IF;
 UPDATE public.private_booking_charge_batches SET lines=p_lines,due_date=p_due_date,reference=p_reference,revision=revision+1,updated_at=now() WHERE id=p_batch_id RETURNING * INTO d;
 ELSE
 IF p_expected_revision IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'stale_charge_batch'; END IF;
 INSERT INTO public.private_booking_charge_batches(id,booking_id,lines,due_date,reference,created_by) VALUES(p_batch_id,p_booking_id,p_lines,p_due_date,p_reference,p_actor_id) RETURNING * INTO d;
 END IF;
 RETURN to_jsonb(d);
END $$;

CREATE FUNCTION public.discard_private_booking_charge_batch(p_booking_id uuid,p_batch_id uuid,p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE d public.private_booking_charge_batches%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.private_bookings WHERE id=p_booking_id FOR UPDATE;
 UPDATE public.private_booking_charge_batches SET status='void',revision=revision+1,updated_at=now() WHERE id=p_batch_id AND booking_id=p_booking_id AND status='draft' AND revision=p_expected_revision RETURNING * INTO d;
 IF NOT FOUND THEN RAISE EXCEPTION 'stale_charge_batch'; END IF;
 RETURN to_jsonb(d);
END $$;

CREATE FUNCTION public.issue_private_booking_charge_batch(p_booking_id uuid,p_batch_id uuid,p_expected_revision integer,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE b public.private_bookings%ROWTYPE; d public.private_booking_charge_batches%ROWTYPE; i public.invoices%ROWTYPE; original public.invoices%ROWTYPE; n integer; encoded text:=''; subtotal numeric; discount numeric; vat numeric; total numeric;
BEGIN
 SELECT * INTO b FROM public.private_bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.invoice_id IS NULL OR b.status NOT IN ('confirmed','completed') THEN RAISE EXCEPTION 'booking_not_eligible_for_extras'; END IF;
 SELECT * INTO d FROM public.private_booking_charge_batches WHERE id=p_batch_id AND booking_id=p_booking_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'charge_batch_not_found'; END IF;
 IF d.status='issued' THEN SELECT * INTO i FROM public.invoices WHERE id=d.invoice_id; RETURN jsonb_build_object('created',false,'invoice',to_jsonb(i),'batch',to_jsonb(d)); END IF;
 IF d.status<>'draft' OR d.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_charge_batch'; END IF;
 IF d.due_date < (now() AT TIME ZONE 'Europe/London')::date THEN RAISE EXCEPTION 'select_current_or_future_due_date'; END IF;
 SELECT * INTO original FROM public.invoices WHERE id=b.invoice_id FOR UPDATE;
 IF original.deleted_at IS NOT NULL OR original.status IN ('void','written_off') THEN RAISE EXCEPTION 'original_invoice_not_collectible'; END IF;
 SELECT round(SUM(q*u-q*u*x/100),2),0,SUM(round((q*u-q*u*x/100)*v/100,2)) INTO subtotal,discount,vat
 FROM (SELECT (l->>'quantity')::numeric q,(l->>'unit_price')::numeric u,COALESCE((l->>'discount_percentage')::numeric,0) x,(l->>'vat_rate')::numeric v FROM jsonb_array_elements(d.lines) l) s;
 total:=subtotal-discount+vat;
 IF total IS NULL OR total<=0 THEN RAISE EXCEPTION 'extras_total_must_be_positive'; END IF;
 SELECT next_sequence+5000 INTO n FROM public.get_and_increment_invoice_series('INV') LIMIT 1;
 WHILE n>0 LOOP encoded:=substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',n%36+1,1)||encoded; n:=floor(n/36); END LOOP;
 INSERT INTO public.invoices(invoice_number,vendor_id,invoice_date,due_date,reference,invoice_discount_percentage,subtotal_amount,discount_amount,vat_amount,total_amount,status)
 VALUES('INV-'||lpad(encoded,5,'0'),original.vendor_id,(now() AT TIME ZONE 'Europe/London')::date,d.due_date,d.reference,0,subtotal,discount,vat,total,'sent') RETURNING * INTO i;
 INSERT INTO public.invoice_line_items(invoice_id,catalog_item_id,description,quantity,unit_price,discount_percentage,vat_rate,display_order)
 SELECT i.id,NULLIF(l->>'catalog_item_id','')::uuid,l->>'description',(l->>'quantity')::numeric,(l->>'unit_price')::numeric,COALESCE((l->>'discount_percentage')::numeric,0),(l->>'vat_rate')::numeric,ord::integer
 FROM jsonb_array_elements(d.lines) WITH ORDINALITY AS s(l,ord);
 INSERT INTO public.private_booking_invoices(booking_id,invoice_id,kind,created_by) VALUES(p_booking_id,i.id,'supplementary',p_actor_id);
 UPDATE public.private_booking_charge_batches SET status='issued',invoice_id=i.id,revision=revision+1,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 PERFORM public.apply_balance_payment_status(p_booking_id);
 RETURN jsonb_build_object('created',true,'invoice',to_jsonb(i),'batch',to_jsonb(d));
END $$;

CREATE FUNCTION public.cancel_private_booking_charge_batch(p_booking_id uuid,p_batch_id uuid,p_reason text,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE d public.private_booking_charge_batches%ROWTYPE; i public.invoices%ROWTYPE;
BEGIN
 IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'cancel_reason_required'; END IF;
 PERFORM 1 FROM public.private_bookings WHERE id=p_booking_id FOR UPDATE;
 SELECT * INTO d FROM public.private_booking_charge_batches WHERE id=p_batch_id AND booking_id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR d.status<>'issued' THEN RAISE EXCEPTION 'charge_batch_not_issued'; END IF;
 PERFORM public.lock_invoice_settlement(d.invoice_id);
 SELECT * INTO i FROM public.invoices WHERE id=d.invoice_id;
 IF EXISTS(SELECT 1 FROM public.invoice_payments WHERE invoice_id=i.id) THEN RAISE EXCEPTION 'invoice_has_real_payments'; END IF;
 IF i.paypal_order_id IS NOT NULL THEN RAISE EXCEPTION 'Resolve the pending PayPal order before cancelling the invoice'; END IF;
 UPDATE public.private_booking_charge_batches SET status='void',revision=revision+1,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 UPDATE public.invoices SET status='void',internal_notes=concat_ws(E'\n',internal_notes,format('[VOIDED %s by %s] %s',now(),p_actor_id,p_reason)),updated_at=now() WHERE id=i.id RETURNING * INTO i;
 PERFORM public.apply_balance_payment_status(p_booking_id);
 RETURN jsonb_build_object('invoice',to_jsonb(i),'batch',to_jsonb(d));
END $$;

CREATE FUNCTION public.record_private_booking_allocated_payment(p_booking_id uuid,p_receipt_id uuid,p_payment_date date,p_amount numeric,p_method text,p_reference text,p_notes text,p_allocations jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE b public.private_bookings%ROWTYPE; r public.private_booking_payment_receipts%ROWTYPE; a jsonb; i public.invoices%ROWTYPE; amount numeric; allocated numeric; payments jsonb;
BEGIN
 SELECT * INTO b FROM public.private_bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.status NOT IN ('confirmed','completed') THEN RAISE EXCEPTION 'booking_not_payable'; END IF;
 SELECT * INTO r FROM public.private_booking_payment_receipts WHERE id=p_receipt_id;
 IF FOUND THEN
 IF r.booking_id<>p_booking_id OR r.amount IS DISTINCT FROM p_amount OR r.payment_date IS DISTINCT FROM p_payment_date OR r.method IS DISTINCT FROM p_method OR r.reference IS DISTINCT FROM p_reference OR r.notes IS DISTINCT FROM p_notes OR r.allocations IS DISTINCT FROM p_allocations THEN RAISE EXCEPTION 'receipt_idempotency_conflict'; END IF;
 ELSE
 IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_payment_date IS NULL OR p_payment_date>(now() AT TIME ZONE 'Europe/London')::date THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 IF jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_allocations)=0 THEN RAISE EXCEPTION 'allocations_required'; END IF;
 SELECT SUM((x->>'amount')::numeric) INTO allocated FROM jsonb_array_elements(p_allocations) x;
 IF allocated IS DISTINCT FROM p_amount OR (SELECT count(DISTINCT x->>'invoice_id') FROM jsonb_array_elements(p_allocations) x) <> jsonb_array_length(p_allocations) THEN RAISE EXCEPTION 'allocation_total_mismatch'; END IF;
 INSERT INTO public.private_booking_payment_receipts(id,booking_id,amount,payment_date,method,reference,notes,allocations,created_by) VALUES(p_receipt_id,p_booking_id,p_amount,p_payment_date,p_method,p_reference,p_notes,p_allocations,p_actor_id);
 FOR a IN SELECT value FROM jsonb_array_elements(p_allocations) ORDER BY value->>'invoice_id' LOOP
 amount:=(a->>'amount')::numeric;
 IF amount IS NULL OR amount<=0 OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid_allocation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.private_booking_invoices WHERE booking_id=p_booking_id AND invoice_id=(a->>'invoice_id')::uuid) THEN RAISE EXCEPTION 'invoice_not_on_booking'; END IF;
 PERFORM public.lock_invoice_settlement((a->>'invoice_id')::uuid);
 SELECT * INTO i FROM public.invoices WHERE id=(a->>'invoice_id')::uuid;
 IF i.deleted_at IS NOT NULL OR i.status IN ('void','written_off') OR amount>public.invoice_effective_amount(i.id)-COALESCE((SELECT SUM(p.amount) FROM public.invoice_payments p WHERE p.invoice_id=i.id),0) THEN RAISE EXCEPTION 'allocation_exceeds_invoice_balance'; END IF;
 INSERT INTO public.invoice_payments(invoice_id,amount,payment_date,payment_method,reference,notes,receipt_id) VALUES(i.id,amount,p_payment_date,p_method,p_reference,p_notes,p_receipt_id);
 END LOOP;
 END IF;
 SELECT jsonb_agg(to_jsonb(p)) INTO payments FROM public.invoice_payments p WHERE receipt_id=p_receipt_id;
 RETURN jsonb_build_object('receipt_id',p_receipt_id,'payments',payments);
END $$;

CREATE OR REPLACE FUNCTION public.guard_linked_invoice_money()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.total_amount IS DISTINCT FROM OLD.total_amount
    OR NEW.subtotal_amount IS DISTINCT FROM OLD.subtotal_amount
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.invoice_discount_percentage IS DISTINCT FROM OLD.invoice_discount_percentage
    OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount)
    AND EXISTS (SELECT 1 FROM public.private_booking_invoices WHERE invoice_id = OLD.id) THEN
    RAISE EXCEPTION 'Resolve the linked invoice before changing booking prices';
  END IF;
  IF TG_OP = 'DELETE' OR (NEW.status IN ('void', 'written_off') AND NEW.status IS DISTINCT FROM OLD.status)
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF EXISTS (SELECT 1 FROM public.private_bookings WHERE invoice_id = OLD.id) OR EXISTS (SELECT 1 FROM public.private_booking_charge_batches WHERE invoice_id=OLD.id AND status='issued') THEN
      RAISE EXCEPTION 'Cancel the invoice from its private booking after resolving its payments';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_linked_invoice_item_prices()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
    AND NEW.description IS NOT DISTINCT FROM OLD.description
    AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
    AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
    AND NEW.discount_percentage IS NOT DISTINCT FROM OLD.discount_percentage
    AND NEW.vat_rate IS NOT DISTINCT FROM OLD.vat_rate THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.private_booking_invoices
    WHERE invoice_id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
                         CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END)) THEN
    RAISE EXCEPTION 'Resolve the linked invoice before changing booking prices';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_invoice_payment_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE; v_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'payment_invoice_cannot_change';
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  PERFORM public.lock_invoice_settlement(v_id);
  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_id;
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.receipt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Allocated receipts cannot be edited or deleted; resolve a credit or refund';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.receipt_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.private_booking_payment_receipts r JOIN public.private_booking_invoices a ON a.booking_id=r.booking_id
    WHERE r.id=NEW.receipt_id AND a.invoice_id=NEW.invoice_id AND r.payment_date=NEW.payment_date AND r.method=NEW.payment_method AND NEW.source_kind IS NULL AND NEW.source_payment_id IS NULL AND r.reference IS NOT DISTINCT FROM NEW.reference AND r.notes IS NOT DISTINCT FROM NEW.notes
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.allocations) x WHERE (x->>'invoice_id')::uuid=NEW.invoice_id AND (x->>'amount')::numeric=NEW.amount)) THEN
    RAISE EXCEPTION 'invalid_receipt_allocation';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source_kind = 'paypal' THEN
    IF TG_OP = 'DELETE' OR NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
      RAISE EXCEPTION 'PayPal captures cannot be changed or deleted; resolve a refund or credit';
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source_kind = 'booking_payment' THEN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'Edit or delete the original booking payment';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.source_kind IS DISTINCT FROM OLD.source_kind
      OR NEW.source_payment_id IS DISTINCT FROM OLD.source_payment_id) THEN
      RAISE EXCEPTION 'Edit or delete the original booking payment';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.source_kind = 'booking_payment' THEN
    IF EXISTS(SELECT 1 FROM public.private_booking_invoices WHERE invoice_id=NEW.invoice_id AND kind='supplementary') THEN RAISE EXCEPTION 'Booking payment copies belong to the original invoice'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.private_booking_payments p
      WHERE p.id = NEW.source_payment_id AND p.amount = NEW.amount
        AND NOT EXISTS (SELECT 1 FROM public.private_bookings b WHERE b.invoice_id = NEW.invoice_id AND b.id <> p.booking_id)
        AND (p.created_at AT TIME ZONE 'Europe/London')::date = NEW.payment_date
        AND (CASE WHEN p.method IN ('cash','card') THEN p.method ELSE 'other' END) = NEW.payment_method
        AND p.notes IS NOT DISTINCT FROM NEW.notes) THEN
      RAISE EXCEPTION 'Edit or delete the original booking payment';
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source_kind = 'booking_deposit'
     AND EXISTS (SELECT 1 FROM public.private_bookings WHERE invoice_id = v_id AND invoice_deposit_treatment = 'deducted') THEN
    RAISE EXCEPTION 'Applied deposit requires invoice credit resolution';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.source_kind='booking_deposit' AND EXISTS(SELECT 1 FROM public.private_booking_invoices WHERE invoice_id=NEW.invoice_id AND kind='supplementary') THEN RAISE EXCEPTION 'Deposits cannot be applied again to supplementary invoices'; END IF;
  IF TG_OP <> 'DELETE' THEN
    IF v_invoice.deleted_at IS NOT NULL OR v_invoice.status IN ('void', 'written_off') THEN
      RAISE EXCEPTION 'invoice_not_payable';
    END IF;
    IF NEW.amount IS NULL OR NEW.amount::text IN ('NaN', 'Infinity', '-Infinity') OR NEW.amount <= 0 OR NEW.amount <> round(NEW.amount, 2) THEN
      RAISE EXCEPTION 'invalid_payment_amount';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_private_booking_payment_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_booking public.private_bookings%ROWTYPE; v_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
    RAISE EXCEPTION 'payment_booking_cannot_change';
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.booking_id ELSE NEW.booking_id END;
  SELECT * INTO v_booking FROM public.private_bookings WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF TG_OP='INSERT' AND v_booking.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'Select invoice allocations for this payment'; END IF;
  IF v_booking.invoice_id IS NOT NULL THEN
    PERFORM public.lock_invoice_settlement(v_booking.invoice_id);
    IF EXISTS (SELECT 1 FROM public.invoices WHERE id = v_booking.invoice_id
               AND (deleted_at IS NOT NULL OR status IN ('void', 'written_off'))) THEN
      RAISE EXCEPTION 'invoice_not_payable';
    END IF;
  END IF;
  -- Delete the mirror before the foreign key can replace its source id with NULL.
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.invoice_payments WHERE source_kind = 'booking_payment' AND source_payment_id = OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_invoice_settlement(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_booking_id uuid; v_paid numeric;
BEGIN
  v_booking_id := public.lock_invoice_settlement(p_invoice_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.invoice_payments WHERE invoice_id = p_invoice_id;
  UPDATE public.invoices
  SET paid_amount = v_paid,
      status = CASE
        WHEN status IN ('void', 'written_off') THEN status
        WHEN v_paid >= public.invoice_effective_amount(p_invoice_id) THEN 'paid'
        WHEN v_paid > 0 THEN 'partially_paid'
        WHEN sent_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.private_booking_charge_batches WHERE invoice_id=p_invoice_id AND status='issued') THEN 'draft'
        WHEN due_date < (now() AT TIME ZONE 'Europe/London')::date THEN 'overdue'
        ELSE 'sent' END,
      updated_at = now()
  WHERE id = p_invoice_id;
  IF v_booking_id IS NOT NULL THEN PERFORM public.apply_balance_payment_status(v_booking_id); END IF;
END;
$function$
;

CREATE OR REPLACE VIEW public.private_bookings_with_details WITH(security_invoker=true) AS  SELECT pb.id,
    pb.customer_id,
    pb.customer_name,
    pb.contact_phone,
    pb.contact_email,
    pb.event_date,
    pb.start_time,
    pb.setup_time,
    pb.end_time,
    pb.end_time_next_day,
    pb.guest_count,
    pb.event_type,
    pb.status,
    pb.deposit_amount,
    pb.deposit_paid_date,
    pb.deposit_payment_method,
    pb.total_amount,
    pb.balance_due_date,
    pb.final_payment_date,
    pb.final_payment_method,
    pb.calendar_event_id,
    pb.contract_version,
    pb.internal_notes,
    pb.customer_requests,
    pb.created_by,
    pb.created_at,
    pb.updated_at,
    pb.setup_date,
    pb.discount_type,
    pb.discount_amount,
    pb.discount_reason,
    pb.customer_first_name,
    pb.customer_last_name,
    pb.customer_full_name,
    pb.date_tbd,
    c.mobile_number AS customer_mobile,
    (get_booking_discounted_total(pb.id)+COALESCE((SELECT sum(i.subtotal_amount-i.discount_amount) FROM public.private_booking_charge_batches b JOIN public.invoices i ON i.id=b.invoice_id WHERE b.booking_id=pb.id AND b.status='issued'),0)) AS calculated_total,
        CASE
            WHEN (pb.deposit_paid_date IS NOT NULL) THEN 'Paid'::text
            WHEN (COALESCE(pb.deposit_amount, (0)::numeric) <= (0)::numeric) THEN 'Not Required'::text
            WHEN (pb.status = 'confirmed'::text) THEN 'Required'::text
            ELSE 'Not Required'::text
        END AS deposit_status,
    (pb.event_date - CURRENT_DATE) AS days_until_event,
    pb.contract_note,
    pb.hold_expiry,
    get_private_booking_settlement_total(pb.id) AS total_balance_paid,
    calculate_private_booking_balance(pb.id) AS balance_remaining,
        CASE
            WHEN (calculate_private_booking_balance(pb.id) <= (0)::numeric) THEN 'Fully Paid'::text
            WHEN (get_private_booking_settlement_total(pb.id) > (0)::numeric) THEN 'Partially Paid'::text
            ELSE 'Unpaid'::text
        END AS payment_status,
    (get_booking_vat_amount(pb.id)+COALESCE((SELECT sum(i.vat_amount) FROM public.private_booking_charge_batches b JOIN public.invoices i ON i.id=b.invoice_id WHERE b.booking_id=pb.id AND b.status='issued'),0)) AS vat_amount,
    public.get_private_booking_aggregate_gross_total(pb.id) AS gross_total
   FROM (private_bookings pb
     LEFT JOIN customers c ON ((pb.customer_id = c.id)));

CREATE OR REPLACE FUNCTION public.record_invoice_payment_transaction(p_payment_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_invoice public.invoices%ROWTYPE; v_payment public.invoice_payments%ROWTYPE;
  v_invoice_id uuid := (p_payment_data->>'invoice_id')::uuid;
  v_amount numeric := (p_payment_data->>'amount')::numeric;
  v_paid numeric;
BEGIN
  PERFORM public.assert_rpc_permission('invoices', 'edit');
  PERFORM public.lock_invoice_settlement(v_invoice_id);
  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_invoice_id;
  IF v_invoice.deleted_at IS NOT NULL OR v_invoice.status IN ('void', 'written_off') THEN
    RAISE EXCEPTION 'invoice_not_payable';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.invoice_payments WHERE invoice_id = v_invoice_id;
  IF v_amount IS NULL OR v_amount::text IN ('NaN', 'Infinity', '-Infinity') OR v_amount <= 0 OR v_amount <> round(v_amount, 2) THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;
  IF v_amount > public.invoice_effective_amount(v_invoice.id) - v_paid THEN RAISE EXCEPTION 'Payment amount exceeds outstanding balance'; END IF;
  INSERT INTO public.invoice_payments(invoice_id, payment_date, amount, payment_method, reference, notes)
  VALUES(v_invoice_id, (p_payment_data->>'payment_date')::date, v_amount,
    p_payment_data->>'payment_method', p_payment_data->>'reference', p_payment_data->>'notes')
  RETURNING * INTO v_payment;
  RETURN to_jsonb(v_payment);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_paypal_payment_atomic(
  p_invoice_id uuid, p_amount numeric, p_capture_id text, p_order_id text, p_captured_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_existing public.invoice_payments%ROWTYPE;
  v_booking_id uuid;
  v_inserted uuid;
BEGIN
  IF NULLIF(btrim(p_capture_id), '') IS NULL THEN RAISE EXCEPTION 'capture_id_required'; END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'invalid_payment_amount';
  END IF;
  v_booking_id := public.lock_invoice_settlement(p_invoice_id);
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF v_invoice.deleted_at IS NOT NULL OR v_invoice.status IN ('void', 'written_off') THEN
    RAISE EXCEPTION 'invoice_not_payable';
  END IF;
  INSERT INTO public.invoice_payments(invoice_id, payment_date, amount, payment_method, reference, notes, source_kind)
  VALUES(p_invoice_id, (COALESCE(p_captured_at, now()) AT TIME ZONE 'Europe/London')::date,
    p_amount, 'paypal', btrim(p_capture_id), 'Paid online by the customer via PayPal.', 'paypal')
  ON CONFLICT (reference) WHERE source_kind = 'paypal' DO NOTHING RETURNING id INTO v_inserted;
  IF v_inserted IS NULL THEN
    SELECT * INTO v_existing FROM public.invoice_payments
    WHERE source_kind = 'paypal' AND reference = btrim(p_capture_id);
    IF v_existing.invoice_id IS DISTINCT FROM p_invoice_id OR v_existing.amount IS DISTINCT FROM p_amount THEN
      RAISE EXCEPTION 'paypal_capture_conflict';
    END IF;
    PERFORM public.recalculate_invoice_settlement(p_invoice_id);
  END IF;
  UPDATE public.invoices
  SET paypal_order_id = CASE WHEN status = 'paid' THEN NULL ELSE paypal_order_id END,
      paypal_reconciliation_attempts = CASE WHEN status = 'paid' THEN 0 ELSE paypal_reconciliation_attempts END,
      paypal_reconciliation_last_error = CASE WHEN status = 'paid' THEN NULL ELSE paypal_reconciliation_last_error END
  WHERE id = p_invoice_id RETURNING * INTO v_invoice;
  RETURN jsonb_build_object('recorded', v_inserted IS NOT NULL, 'already_recorded', v_inserted IS NULL,
    'paid_amount', v_invoice.paid_amount, 'status', v_invoice.status,
    'invoice_number', v_invoice.invoice_number, 'private_booking_id', v_booking_id,
    'overpaid_amount', GREATEST(0, v_invoice.paid_amount - public.invoice_effective_amount(v_invoice.id)));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_paypal_payment_atomic(
  p_invoice_id uuid, p_amount numeric, p_capture_id text, p_order_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  SELECT public.record_invoice_paypal_payment_atomic(p_invoice_id, p_amount, p_capture_id, p_order_id, NULL::timestamptz);
$$;

CREATE FUNCTION public.guard_booking_credit_settlement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM public.assert_rpc_permission('invoices',CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'edit' END);
 v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
 IF TG_OP='UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN RAISE EXCEPTION 'credit_invoice_cannot_change'; END IF;
 PERFORM public.lock_invoice_settlement(v_id);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE FUNCTION public.after_booking_credit_settlement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN PERFORM public.recalculate_invoice_settlement(CASE WHEN TG_OP='DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END); RETURN NULL; END $$;
CREATE TRIGGER booking_credit_settlement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.credit_notes FOR EACH ROW EXECUTE FUNCTION public.guard_booking_credit_settlement();
CREATE TRIGGER booking_credit_settlement_changed AFTER INSERT OR UPDATE OR DELETE ON public.credit_notes FOR EACH ROW EXECUTE FUNCTION public.after_booking_credit_settlement();

REVOKE ALL ON FUNCTION public.reserve_private_booking_receipt_version(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_private_booking_receipt_version(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.sync_private_booking_invoice_association() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_private_booking_invoice_association() TO service_role;

REVOKE ALL ON FUNCTION public.get_private_booking_aggregate_gross_total(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_booking_aggregate_gross_total(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.private_booking_settlement_rows(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.private_booking_settlement_rows(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lock_invoice_settlement(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_invoice_settlement(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.invoice_effective_amount(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_effective_amount(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_private_booking_balance(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_private_booking_balance(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.apply_balance_payment_status(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_balance_payment_status(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.save_private_booking_charge_batch(uuid,uuid,integer,jsonb,date,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_private_booking_charge_batch(uuid,uuid,integer,jsonb,date,text,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.discard_private_booking_charge_batch(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.discard_private_booking_charge_batch(uuid,uuid,integer) TO service_role;

REVOKE ALL ON FUNCTION public.issue_private_booking_charge_batch(uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_private_booking_charge_batch(uuid,uuid,integer,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_private_booking_charge_batch(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_private_booking_charge_batch(uuid,uuid,text,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_private_booking_allocated_payment(uuid,uuid,date,numeric,text,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_private_booking_allocated_payment(uuid,uuid,date,numeric,text,text,text,jsonb,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.guard_linked_invoice_money() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_linked_invoice_money() TO service_role;

REVOKE ALL ON FUNCTION public.guard_linked_invoice_item_prices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_linked_invoice_item_prices() TO service_role;

REVOKE ALL ON FUNCTION public.guard_invoice_payment_settlement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_invoice_payment_settlement() TO service_role;

REVOKE ALL ON FUNCTION public.guard_private_booking_payment_settlement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_private_booking_payment_settlement() TO service_role;

REVOKE ALL ON FUNCTION public.recalculate_invoice_settlement(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_invoice_settlement(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_invoice_payment_transaction(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment_transaction(jsonb) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid,numeric,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid,numeric,text,text,timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_paypal_payment_atomic(uuid,numeric,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.guard_booking_credit_settlement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_booking_credit_settlement() TO service_role;

REVOKE ALL ON FUNCTION public.after_booking_credit_settlement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.after_booking_credit_settlement() TO service_role;

GRANT EXECUTE ON FUNCTION public.calculate_private_booking_balance(uuid),public.get_private_booking_aggregate_gross_total(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_credit_note_atomic(p_invoice_id uuid, p_amount_ex_vat numeric, p_reason text, p_created_by uuid)
 RETURNS TABLE(id uuid, credit_note_number text, amount_inc_vat numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_year integer := extract(year from timezone('Europe/London', now()))::integer;
  v_next_seq integer := 1;
  v_last_number text;
  v_vat_rate numeric;
  v_amount_inc_vat numeric;
  v_credit_note public.credit_notes%ROWTYPE;
BEGIN
  PERFORM public.assert_rpc_permission('invoices','create');
  IF COALESCE(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' AND (auth.uid() IS NULL OR NOT public.user_has_permission(auth.uid(), 'invoices', 'create')) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_created_by IS NULL OR (COALESCE(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' AND p_created_by <> auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_invoice_id IS NULL OR v_reason = '' THEN
    RAISE EXCEPTION 'invoice_id_and_reason_required';
  END IF;

  IF p_amount_ex_vat IS NULL OR p_amount_ex_vat <= 0 OR p_amount_ex_vat::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'credit_note_amount_must_be_positive';
  END IF;

  PERFORM public.lock_invoice_settlement(p_invoice_id);
  SELECT *
    INTO v_invoice
    FROM public.invoices
   WHERE invoices.id = p_invoice_id
     AND invoices.deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  v_vat_rate := CASE
    WHEN coalesce(v_invoice.subtotal_amount, 0) > 0
      THEN round((coalesce(v_invoice.vat_amount, 0) / v_invoice.subtotal_amount) * 10000) / 100
    ELSE 20
  END;
  v_amount_inc_vat := round((p_amount_ex_vat * (1 + v_vat_rate / 100)) * 100) / 100;

  IF v_amount_inc_vat > public.invoice_effective_amount(p_invoice_id) THEN RAISE EXCEPTION 'Credit exceeds remaining invoice charges'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('credit_notes:' || v_year::text));

  SELECT cn.credit_note_number
    INTO v_last_number
    FROM public.credit_notes cn
   WHERE cn.credit_note_number ILIKE ('CN-' || v_year::text || '-%')
   ORDER BY cn.credit_note_number DESC
   LIMIT 1;

  IF v_last_number IS NOT NULL THEN
    v_next_seq := coalesce(substring(v_last_number from '^CN-[0-9]{4}-([0-9]+)$')::integer, 0) + 1;
  END IF;

  INSERT INTO public.credit_notes (
    credit_note_number,
    invoice_id,
    vendor_id,
    amount_ex_vat,
    vat_rate,
    amount_inc_vat,
    reason,
    status,
    created_by
  )
  VALUES (
    'CN-' || v_year::text || '-' || lpad(v_next_seq::text, 3, '0'),
    v_invoice.id,
    v_invoice.vendor_id,
    p_amount_ex_vat,
    v_vat_rate,
    v_amount_inc_vat,
    v_reason,
    'issued',
    p_created_by
  )
  RETURNING * INTO v_credit_note;

  RETURN QUERY SELECT
    v_credit_note.id,
    v_credit_note.credit_note_number::text,
    v_credit_note.amount_inc_vat::numeric;
END;
$function$
;
REVOKE ALL ON FUNCTION public.create_credit_note_atomic(uuid,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_credit_note_atomic(uuid,numeric,text,uuid) TO service_role;
CREATE OR REPLACE VIEW public.private_booking_summary WITH(security_invoker=true) AS  SELECT pb.id,
    pb.customer_id,
    pb.customer_name,
    pb.contact_phone,
    pb.contact_email,
    pb.event_date,
    pb.start_time,
    pb.setup_time,
    pb.end_time,
    pb.guest_count,
    pb.event_type,
    pb.status,
    pb.deposit_amount,
    pb.deposit_paid_date,
    pb.deposit_payment_method,
    pb.total_amount,
    pb.balance_due_date,
    pb.final_payment_date,
    pb.final_payment_method,
    pb.calendar_event_id,
    pb.contract_version,
    pb.internal_notes,
    pb.customer_requests,
    pb.created_by,
    pb.created_at,
    pb.updated_at,
    c.first_name,
    c.last_name,
    (COALESCE(( SELECT sum(private_booking_items.line_total) AS sum
           FROM private_booking_items
          WHERE (private_booking_items.booking_id = pb.id)), (0)::numeric)+COALESCE((SELECT SUM(i.subtotal_amount-i.discount_amount) FROM public.private_booking_charge_batches b JOIN public.invoices i ON i.id=b.invoice_id WHERE b.booking_id=pb.id AND b.status='issued'),0)) AS calculated_total,
        CASE
            WHEN (pb.deposit_paid_date IS NOT NULL) THEN 'Paid'::text
            WHEN (pb.status = 'confirmed'::text) THEN 'Required'::text
            ELSE 'Not Required'::text
        END AS deposit_status,
    (pb.event_date - CURRENT_DATE) AS days_until_event
   FROM (private_bookings pb
     LEFT JOIN customers c ON ((pb.customer_id = c.id)));

-- Restrictive policies also constrain the existing permissive ALL policy.
-- Other document types retain their current access rules.
CREATE POLICY booking_receipt_document_read_guard ON public.private_booking_documents AS RESTRICTIVE FOR SELECT TO authenticated
 USING(document_type <> 'receipt' OR (public.user_has_permission(auth.uid(),'private_bookings','view') AND public.user_has_permission(auth.uid(),'private_bookings','view_pricing')));
CREATE POLICY booking_receipt_document_insert_guard ON public.private_booking_documents AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(document_type <> 'receipt' OR public.is_super_admin(auth.uid()));
CREATE POLICY booking_receipt_document_update_guard ON public.private_booking_documents AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(document_type <> 'receipt' OR public.is_super_admin(auth.uid()))
 WITH CHECK(document_type <> 'receipt' OR public.is_super_admin(auth.uid()));
CREATE POLICY booking_receipt_document_delete_guard ON public.private_booking_documents AS RESTRICTIVE FOR DELETE TO authenticated
 USING(document_type <> 'receipt' OR public.is_super_admin(auth.uid()));

CREATE FUNCTION public.claim_private_booking_extra_delivery(p_booking_id uuid,p_invoice_id uuid,p_actor_id uuid,p_resend boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE d public.private_booking_charge_batches%ROWTYPE; claim uuid;
BEGIN
 PERFORM 1 FROM public.private_bookings WHERE id=p_booking_id FOR UPDATE;
 SELECT * INTO d FROM public.private_booking_charge_batches WHERE booking_id=p_booking_id AND invoice_id=p_invoice_id FOR UPDATE;
 IF NOT FOUND OR d.status<>'issued' THEN RAISE EXCEPTION 'charge_batch_not_issued'; END IF;
 IF d.delivery_state='sending' OR (d.delivery_state IN ('sent','failed') AND NOT COALESCE(p_resend,false)) THEN
 RETURN jsonb_build_object('claimed',false,'state',d.delivery_state); END IF;
 claim:=gen_random_uuid();
 UPDATE public.private_booking_charge_batches SET delivery_state='sending',delivery_claim_id=claim,delivery_error=NULL,updated_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('claimed',true,'state','sending','claim_id',claim);
END $$;
CREATE FUNCTION public.finish_private_booking_extra_delivery(p_booking_id uuid,p_invoice_id uuid,p_claim_id uuid,p_sent boolean,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE state text;
BEGIN
 PERFORM 1 FROM public.private_bookings WHERE id=p_booking_id FOR UPDATE;
 UPDATE public.private_booking_charge_batches SET delivery_state=CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
 delivery_error=CASE WHEN p_sent THEN NULL ELSE left(p_error,2000) END,updated_at=now()
 WHERE booking_id=p_booking_id AND invoice_id=p_invoice_id AND delivery_state='sending' AND delivery_claim_id=p_claim_id RETURNING delivery_state INTO state;
 IF NOT FOUND THEN RAISE EXCEPTION 'delivery_claim_conflict'; END IF;
 RETURN jsonb_build_object('state',state);
END $$;
REVOKE ALL ON FUNCTION public.claim_private_booking_extra_delivery(uuid,uuid,uuid,boolean),public.finish_private_booking_extra_delivery(uuid,uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_private_booking_extra_delivery(uuid,uuid,uuid,boolean),public.finish_private_booking_extra_delivery(uuid,uuid,uuid,boolean,text) TO service_role;

-- Preserve invoker RLS and existing grants; credits use the same caller-visible rows.
CREATE OR REPLACE FUNCTION public.get_invoice_summary_stats()
 RETURNS TABLE(total_outstanding numeric, total_overdue numeric, total_draft numeric, total_this_month numeric, count_outstanding integer, count_overdue integer, count_draft integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE 
      WHEN i.status NOT IN ('paid', 'void', 'written_off')
        THEN GREATEST(0,i.total_amount-COALESCE(credits.amount,0)-COALESCE(i.paid_amount,0)) 
      ELSE 0 
    END), 0) AS total_outstanding,
    COALESCE(SUM(CASE 
      WHEN i.status = 'overdue' 
        THEN GREATEST(0,i.total_amount-COALESCE(credits.amount,0)-COALESCE(i.paid_amount,0)) 
      ELSE 0 
    END), 0) AS total_overdue,
    COALESCE(SUM(CASE 
      WHEN i.status = 'draft' 
        THEN i.total_amount 
      ELSE 0 
    END), 0) AS total_draft,
    COALESCE(SUM(CASE 
      WHEN i.status = 'paid' 
        AND DATE_TRUNC('month', i.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
        THEN i.total_amount 
      ELSE 0 
    END), 0) AS total_this_month,
    COUNT(CASE 
      WHEN i.status NOT IN ('paid', 'void', 'written_off') AND i.total_amount-COALESCE(credits.amount,0)-COALESCE(i.paid_amount,0)>0
        THEN 1 
    END)::INTEGER AS count_outstanding,
    COUNT(CASE 
      WHEN i.status = 'overdue' AND i.total_amount-COALESCE(credits.amount,0)-COALESCE(i.paid_amount,0)>0
        THEN 1 
    END)::INTEGER AS count_overdue,
    COUNT(CASE 
      WHEN i.status = 'draft' 
        THEN 1 
    END)::INTEGER AS count_draft
  FROM public.invoices i
  LEFT JOIN (SELECT invoice_id,SUM(amount_inc_vat)::numeric AS amount FROM public.credit_notes WHERE status='issued' GROUP BY invoice_id) credits ON credits.invoice_id=i.id
  WHERE i.deleted_at IS NULL;
END;
$function$
;
RESET lock_timeout;
