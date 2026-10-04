-- Additive schema only. No existing charge is ended by this migration.
ALTER TABLE public.oj_vendor_recurring_charges ADD COLUMN end_date date;

-- A billing run and a closure cannot begin using different charge definitions.
CREATE FUNCTION public.oj_lock_recurring_charges_for_billing() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'processing' THEN
    PERFORM id FROM public.oj_vendor_recurring_charges
      WHERE vendor_id = NEW.vendor_id ORDER BY id FOR SHARE;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.oj_lock_recurring_charges_for_billing() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oj_lock_recurring_charges_for_billing
BEFORE INSERT OR UPDATE OF status ON public.oj_billing_runs
FOR EACH ROW EXECUTE FUNCTION public.oj_lock_recurring_charges_for_billing();

-- Reject stale full-price or post-end inserts, including invoice reissue.
CREATE FUNCTION public.oj_guard_ended_charge_instance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE last_day date; frequency text; service_end date;
BEGIN
  SELECT end_date, oj_vendor_recurring_charges.frequency INTO last_day, frequency FROM public.oj_vendor_recurring_charges
    WHERE id = NEW.recurring_charge_id FOR SHARE;
  service_end := coalesce(NEW.coverage_end, CASE frequency
    WHEN 'quarterly' THEN (NEW.period_start + interval '3 months')::date - 1
    WHEN 'annually' THEN (NEW.period_start + interval '12 months')::date - 1
    ELSE NEW.period_end END);
  IF last_day IS NOT NULL AND
     (COALESCE(NEW.coverage_start, NEW.period_start) > last_day OR
      service_end > last_day) THEN
    RAISE EXCEPTION 'Charge has ended. Refresh the billing preview before continuing.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.oj_guard_ended_charge_instance() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oj_guard_ended_charge_instance
BEFORE INSERT OR UPDATE ON public.oj_recurring_charge_instances
FOR EACH ROW EXECUTE FUNCTION public.oj_guard_ended_charge_instance();

CREATE FUNCTION public.oj_guard_ended_charge_definition() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.end_date IS NOT NULL AND
     (NEW.end_date IS DISTINCT FROM OLD.end_date OR
      NEW.is_active IS DISTINCT FROM OLD.is_active OR
      NEW.amount_ex_vat IS DISTINCT FROM OLD.amount_ex_vat OR
      NEW.vat_rate IS DISTINCT FROM OLD.vat_rate OR
      NEW.frequency IS DISTINCT FROM OLD.frequency OR
      NEW.description IS DISTINCT FROM OLD.description) THEN
    RAISE EXCEPTION 'An ended charge cannot be changed. Create a new charge to restart service.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.oj_guard_ended_charge_definition() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oj_guard_ended_charge_definition
BEFORE UPDATE ON public.oj_vendor_recurring_charges
FOR EACH ROW EXECUTE FUNCTION public.oj_guard_ended_charge_definition();

-- The same transaction computes the preview and applies exactly those rules.
-- SECURITY DEFINER is needed because edit users cannot mutate instances under
-- the existing manage-only RLS policy. The function verifies edit permission.
CREATE FUNCTION public.oj_end_recurring_charge(
  p_charge_id uuid, p_end_date date, p_preview boolean DEFAULT true, p_expected jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  charge public.oj_vendor_recurring_charges%ROWTYPE;
  item record;
  cycle_start date;
  cycle_end date;
  bill_end date;
  interval_months integer;
  changes jsonb := '[]'::jsonb;
  proposal jsonb;
  total_ex numeric := 0;
  total_inc numeric := 0;
  amount numeric;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.user_has_permission(auth.uid(), 'oj_projects', 'edit'), false) THEN
    RAISE EXCEPTION 'You do not have permission to end recurring charges';
  END IF;
  IF p_end_date IS NULL THEN RAISE EXCEPTION 'Last service date is required'; END IF;
  SELECT * INTO charge FROM public.oj_vendor_recurring_charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Charge not found'; END IF;
  interval_months := CASE charge.frequency WHEN 'quarterly' THEN 3 WHEN 'annually' THEN 12 ELSE 1 END;
  IF NOT charge.is_active THEN RAISE EXCEPTION 'Activate the charge before ending it'; END IF;
  IF charge.end_date IS NOT NULL THEN RAISE EXCEPTION 'This charge already has a last service date'; END IF;
  IF p_end_date < (charge.created_at AT TIME ZONE 'Europe/London')::date THEN
    RAISE EXCEPTION 'Last service date cannot be before the charge was created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.oj_billing_runs WHERE vendor_id = charge.vendor_id AND status = 'processing') THEN
    RAISE EXCEPTION 'Billing is in progress for this client. Try again when it finishes.';
  END IF;
  PERFORM id FROM public.oj_recurring_charge_instances WHERE recurring_charge_id = charge.id ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.oj_recurring_charge_instances
    WHERE recurring_charge_id = charge.id AND status = 'billing_pending') THEN
    RAISE EXCEPTION 'A charge is reserved for an invoice. Finish or release that invoice first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.oj_recurring_charge_instances
    WHERE recurring_charge_id = charge.id AND (invoice_id IS NOT NULL OR status IN ('billed', 'paid'))
      AND COALESCE(coverage_end, CASE WHEN interval_months > 1 THEN (period_start + make_interval(months => interval_months))::date - 1 ELSE period_end END) > p_end_date) THEN
    RAISE EXCEPTION 'Service after that date is already on an invoice. Correct or credit that invoice separately first.';
  END IF;

  -- Keep earlier arrears, remove only service strictly after the chosen date.
  -- Split cap remainders are rounded as a group, so pennies are not lost.
  FOR item IN
    WITH pending AS (
      SELECT *, COALESCE(coverage_start, period_start) AS service_start,
        COALESCE(coverage_end, CASE WHEN interval_months > 1 THEN (period_start + make_interval(months => interval_months))::date - 1 ELSE period_end END) AS service_end
      FROM public.oj_recurring_charge_instances
      WHERE recurring_charge_id = charge.id AND status = 'unbilled' AND invoice_id IS NULL
    ), calculated AS (
      SELECT *, CASE WHEN service_start > p_end_date THEN 0
        WHEN service_end <= p_end_date THEN amount_ex_vat_snapshot
        ELSE floor(100 * amount_ex_vat_snapshot * (p_end_date - service_start + 1)::numeric /
          (service_end - service_start + 1)) / 100 END AS individual,
        sum(amount_ex_vat_snapshot) OVER (PARTITION BY service_start, service_end) AS group_amount,
        row_number() OVER (PARTITION BY service_start, service_end ORDER BY id) AS allocation_position
      FROM pending
    )
    SELECT *, individual + CASE WHEN service_start <= p_end_date AND service_end > p_end_date
      AND allocation_position <= round(100 * (round(group_amount *
        (p_end_date - service_start + 1)::numeric / (service_end - service_start + 1), 2) -
        sum(individual) OVER (PARTITION BY service_start, service_end)))
      THEN 0.01 ELSE 0 END AS final_amount
    FROM calculated ORDER BY service_start, id
  LOOP
    amount := item.final_amount;
    proposal := jsonb_build_object('id', item.id, 'start', item.service_start,
      'end', LEAST(item.service_end, p_end_date), 'originalEnd', item.service_end,
      'amountExVat', amount, 'amountIncVat', amount + round(amount * item.vat_rate_snapshot / 100, 2),
      'previousAmountExVat', item.amount_ex_vat_snapshot,
      'removed', item.service_start > p_end_date);
    changes := changes || jsonb_build_array(proposal);
    IF item.service_start <= p_end_date THEN
      total_ex := total_ex + amount;
      total_inc := total_inc + amount + round(amount * item.vat_rate_snapshot / 100, 2);
      IF NOT p_preview AND item.service_end > p_end_date THEN
        UPDATE public.oj_recurring_charge_instances SET amount_ex_vat_snapshot = amount,
          coverage_start = item.service_start, coverage_end = p_end_date,
          period_end = LEAST(period_end, p_end_date),
          description_snapshot = description_snapshot || ' (final charge, prorated through ' || p_end_date::text || ')',
          updated_at = now() WHERE id = item.id;
      END IF;
    ELSIF NOT p_preview THEN
      DELETE FROM public.oj_recurring_charge_instances WHERE id = item.id;
    END IF;
  END LOOP;

  -- Materialise the last cycle if it has not yet reached a billing run. This
  -- also permits backdated closure without losing the final month's charge.
  IF NOT EXISTS (SELECT 1 FROM public.oj_recurring_charge_instances
    WHERE recurring_charge_id = charge.id AND COALESCE(coverage_start, period_start) <= p_end_date
      AND COALESCE(coverage_end, CASE WHEN interval_months > 1 THEN (period_start + make_interval(months => interval_months))::date - 1 ELSE period_end END) >= p_end_date) THEN
    interval_months := CASE charge.frequency WHEN 'quarterly' THEN 3 WHEN 'annually' THEN 12 ELSE 1 END;
    SELECT max(period_start) INTO cycle_start FROM public.oj_recurring_charge_instances
      WHERE recurring_charge_id = charge.id AND period_start <= p_end_date;
    IF cycle_start IS NULL THEN
      cycle_start := date_trunc('month', charge.created_at AT TIME ZONE 'Europe/London')::date;
    ELSE
      cycle_start := (cycle_start + make_interval(months => interval_months))::date;
    END IF;
    WHILE cycle_start <= p_end_date LOOP
    cycle_end := (cycle_start + make_interval(months => interval_months))::date - 1;
    bill_end := (date_trunc('month', cycle_start) + interval '1 month')::date - 1;
    amount := round(charge.amount_ex_vat * (LEAST(p_end_date, cycle_end) - cycle_start + 1)::numeric / (cycle_end - cycle_start + 1), 2);
    changes := changes || jsonb_build_array(jsonb_build_object('id', null, 'start', cycle_start,
      'end', LEAST(p_end_date, cycle_end), 'originalEnd', cycle_end, 'amountExVat', amount,
      'amountIncVat', amount + round(amount * charge.vat_rate / 100, 2),
      'previousAmountExVat', charge.amount_ex_vat, 'removed', false));
    total_ex := total_ex + amount;
    total_inc := total_inc + amount + round(amount * charge.vat_rate / 100, 2);
    IF NOT p_preview THEN
      INSERT INTO public.oj_recurring_charge_instances
        (vendor_id, recurring_charge_id, period_yyyymm, period_start, period_end,
         coverage_start, coverage_end, description_snapshot, amount_ex_vat_snapshot, vat_rate_snapshot, sort_order_snapshot)
      VALUES (charge.vendor_id, charge.id, to_char(cycle_start, 'YYYY-MM'), cycle_start, LEAST(bill_end, p_end_date),
        cycle_start, LEAST(p_end_date, cycle_end), charge.description || ' (service through ' || LEAST(p_end_date, cycle_end)::text || ')',
        amount, charge.vat_rate, charge.sort_order);
    END IF;
    cycle_start := (cycle_start + make_interval(months => interval_months))::date;
    END LOOP;
  END IF;
  result := jsonb_build_object('chargeId', charge.id, 'endDate', p_end_date, 'items', changes,
    'totalExVat', total_ex, 'totalIncVat', total_inc, 'preview', true);
  IF NOT p_preview AND p_expected IS DISTINCT FROM result THEN
    RAISE EXCEPTION 'The final charge has changed. Refresh the preview and confirm again.';
  END IF;
  IF NOT p_preview THEN
    UPDATE public.oj_vendor_recurring_charges SET end_date = p_end_date, updated_at = now() WHERE id = charge.id;
    INSERT INTO public.audit_logs(user_id, operation_type, resource_type, resource_id, operation_status, new_values, additional_info)
    VALUES(auth.uid(), 'update', 'oj_recurring_charge', charge.id::text, 'success',
      jsonb_build_object('end_date', p_end_date), result);
  END IF;
  RETURN result || jsonb_build_object('preview', p_preview);
END;
$$;
REVOKE ALL ON FUNCTION public.oj_end_recurring_charge(uuid, date, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oj_end_recurring_charge(uuid, date, boolean, jsonb) TO authenticated;

-- Keep the existing reissue transaction, but reserve its charge definitions
-- and reject a preview computed before a charge was ended or edited.
CREATE FUNCTION public.oj_reissue_invoice_with_charge_versions(
  p_source_invoice_id uuid, p_mode text, p_invoice_data jsonb, p_line_items jsonb,
  p_entry_ids uuid[], p_recurring_instance_ids uuid[], p_virtual_recurring_instances jsonb,
  p_charge_versions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE source_vendor uuid; charge record; expected_count integer;
  virtual jsonb; instance public.oj_recurring_charge_instances%ROWTYPE;
  virtual_ids uuid[] := '{}';
BEGIN
  SELECT vendor_id INTO source_vendor FROM public.invoices
    WHERE id = p_source_invoice_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source invoice not found'; END IF;
  IF p_charge_versions IS NULL OR jsonb_typeof(p_charge_versions) <> 'object' THEN
    RAISE EXCEPTION 'Charge versions are required';
  END IF;
  expected_count := 0;
  FOR charge IN SELECT id, updated_at FROM public.oj_vendor_recurring_charges
    WHERE vendor_id = source_vendor ORDER BY id FOR UPDATE
  LOOP
    expected_count := expected_count + 1;
    IF (p_charge_versions->>charge.id::text)::timestamptz IS DISTINCT FROM charge.updated_at THEN
      RAISE EXCEPTION 'Recurring charges changed. Refresh the invoice preview before continuing.';
    END IF;
  END LOOP;
  IF expected_count <> (SELECT count(*) FROM jsonb_object_keys(p_charge_versions)) THEN
    RAISE EXCEPTION 'Recurring charges changed. Refresh the invoice preview before continuing.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.oj_billing_runs WHERE vendor_id = source_vendor AND status = 'processing') THEN
    RAISE EXCEPTION 'Billing is in progress for this client. Try again when it finishes.';
  END IF;
  -- The older transaction does not store coverage fields from virtual rows.
  -- Materialise them here without overwriting an existing snapshot, then pass
  -- their IDs into that unchanged transaction.
  FOR virtual IN SELECT value FROM jsonb_array_elements(p_virtual_recurring_instances)
  LOOP
    IF (virtual->>'vendor_id')::uuid IS DISTINCT FROM source_vendor OR NOT EXISTS (
      SELECT 1 FROM public.oj_vendor_recurring_charges
      WHERE id = (virtual->>'recurring_charge_id')::uuid AND vendor_id = source_vendor
    ) THEN RAISE EXCEPTION 'Recurring charge does not belong to this invoice client'; END IF;
    INSERT INTO public.oj_recurring_charge_instances(vendor_id, recurring_charge_id,
      period_yyyymm, period_start, period_end, coverage_start, coverage_end,
      description_snapshot, amount_ex_vat_snapshot, vat_rate_snapshot, sort_order_snapshot)
    VALUES(source_vendor, (virtual->>'recurring_charge_id')::uuid,
      virtual->>'period_yyyymm', (virtual->>'period_start')::date, (virtual->>'period_end')::date,
      (virtual->>'coverage_start')::date, (virtual->>'coverage_end')::date,
      virtual->>'description_snapshot', (virtual->>'amount_ex_vat_snapshot')::numeric,
      (virtual->>'vat_rate_snapshot')::numeric, (virtual->>'sort_order_snapshot')::integer)
    ON CONFLICT (vendor_id, recurring_charge_id, period_yyyymm) DO NOTHING;
    SELECT * INTO instance FROM public.oj_recurring_charge_instances
      WHERE vendor_id = source_vendor AND recurring_charge_id = (virtual->>'recurring_charge_id')::uuid
        AND period_yyyymm = virtual->>'period_yyyymm' FOR UPDATE;
    IF instance.amount_ex_vat_snapshot IS DISTINCT FROM (virtual->>'amount_ex_vat_snapshot')::numeric
      OR instance.coverage_start IS DISTINCT FROM (virtual->>'coverage_start')::date
      OR instance.coverage_end IS DISTINCT FROM (virtual->>'coverage_end')::date
      OR instance.vat_rate_snapshot IS DISTINCT FROM (virtual->>'vat_rate_snapshot')::numeric
      OR instance.description_snapshot IS DISTINCT FROM virtual->>'description_snapshot'
      OR (instance.invoice_id IS NOT NULL AND instance.invoice_id <> p_source_invoice_id)
      OR instance.status <> 'unbilled' THEN
      RAISE EXCEPTION 'Recurring charge snapshot changed. Refresh the invoice preview.';
    END IF;
    virtual_ids := array_append(virtual_ids, instance.id);
  END LOOP;
  RETURN public.reissue_oj_invoice_transaction(p_source_invoice_id, p_mode, p_invoice_data,
    p_line_items, p_entry_ids, coalesce(p_recurring_instance_ids, '{}') || virtual_ids, '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.oj_reissue_invoice_with_charge_versions(uuid,text,jsonb,jsonb,uuid[],uuid[],jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oj_reissue_invoice_with_charge_versions(uuid,text,jsonb,jsonb,uuid[],uuid[],jsonb,jsonb)
  TO service_role;
