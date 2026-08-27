-- Close the remaining anon EXECUTE holes on SECURITY DEFINER functions in public,
-- and stop the two highest-value invoice RPCs trusting their caller for RBAC.
--
-- Follows 20260811100100 (five functions) and 20260827110750 (invite and booking
-- RPCs). A full audit on 27 August 2026 using has_function_privilege() rather
-- than raw proacl string matching found the previous counts were understated:
-- 49 of the 216 SECURITY DEFINER functions in public are executable by anon,
-- not the 24 that carry an explicit "anon=X" ACL entry. The rest are reachable
-- through the "=X/postgres" entry, which is a grant to PUBLIC and therefore
-- covers anon as well. create_invoice_transaction and
-- record_invoice_payment_transaction are both in that second group: they were
-- reported as authenticated-only, but PUBLIC makes them anonymously callable at
-- POST /rest/v1/rpc/<name> with the anon key that ships in every browser bundle.
--
-- Every call site was traced to its client before anything was listed here. No
-- .rpc() call exists in any client component in the app, so the browser-side
-- anon client never calls an RPC at all. This migration therefore needs no
-- accompanying code deploy and can be applied in either order relative to one.

-- ---------------------------------------------------------------------------
-- 1. Shared permission guard
--
-- SECURITY DEFINER functions that the cookie client must keep calling cannot be
-- protected by a grant alone, because "authenticated" is every signed-in staff
-- account regardless of role. The guard below moves the RBAC decision inside
-- the function so it holds for any caller, not just the ones that happen to go
-- through a server action that checks first.
--
-- The service-role key keeps its unconditional path: cron jobs and the admin
-- client have already passed whatever check their route enforces, and several
-- of them run with no end-user identity at all.
-- ---------------------------------------------------------------------------

create or replace function public.assert_rpc_permission(p_module text, p_action text)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_role text;
  v_uid  uuid;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');

  -- Trusted server-side path: service_role key (cron, admin client).
  if v_role = 'service_role' then
    return;
  end if;

  v_uid := auth.uid();

  if v_uid is null or not public.user_has_permission(v_uid, p_module, p_action) then
    raise exception 'permission_denied: %.%', p_module, p_action
      using errcode = '42501';
  end if;
end;
$function$;

-- New functions in public are granted EXECUTE to PUBLIC by default in this
-- project, which is the very hole this migration closes. Shut it immediately.
-- The guard is only ever called from inside SECURITY DEFINER functions owned by
-- postgres, so postgres owning it is the only grant required.
revoke all on function public.assert_rpc_permission(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Internal RBAC on the money RPCs the cookie client legitimately calls
--
-- These three must stay callable by "authenticated" because a server action
-- invokes them through the cookie client. Bodies below are the live definitions
-- unchanged except for the guard added as the first statement, so this is a
-- permission change only and no business logic moves.
--
-- Module and action match the check the calling server action already performs,
-- so no existing user loses an ability they have today:
--   create_invoice_transaction          invoices:create
--     src/app/actions/invoices.ts:440 -> src/services/invoices.ts:98 (cookie)
--     src/app/actions/recurring-invoices.ts:486 -> :533 (cookie)
--     src/services/invoices.ts:150 and the oj-projects-billing cron (service_role)
--   record_invoice_payment_transaction  invoices:edit
--     src/app/actions/invoices.ts:798 -> src/services/invoices.ts:169 (cookie)
--     src/services/receipts/receiptInvoiceReconciliation.ts:237 (service_role)
--   convert_quote_to_invoice_atomic     invoices:create
--     src/app/actions/quotes.ts:736 -> :742 (cookie)
--
-- create_credit_note_atomic is deliberately NOT rewritten here: it already
-- carries an equivalent internal check (auth.uid() plus invoices:create plus a
-- p_created_by match), which is why an anonymous caller could never actually
-- raise a credit note despite holding EXECUTE. It only needs the revoke below.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_invoice_transaction(p_invoice_data jsonb, p_line_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_invoice_id UUID;
  v_invoice_record JSONB;
BEGIN
  PERFORM public.assert_rpc_permission('invoices', 'create');

  -- 1. Insert Invoice
  INSERT INTO invoices (
    invoice_number,
    vendor_id,
    invoice_date,
    due_date,
    reference,
    invoice_discount_percentage,
    subtotal_amount,
    discount_amount,
    vat_amount,
    total_amount,
    notes,
    internal_notes,
    status
  ) VALUES (
    p_invoice_data->>'invoice_number',
    (p_invoice_data->>'vendor_id')::UUID,
    (p_invoice_data->>'invoice_date')::DATE,
    (p_invoice_data->>'due_date')::DATE,
    p_invoice_data->>'reference',
    (p_invoice_data->>'invoice_discount_percentage')::DECIMAL,
    (p_invoice_data->>'subtotal_amount')::DECIMAL,
    (p_invoice_data->>'discount_amount')::DECIMAL,
    (p_invoice_data->>'vat_amount')::DECIMAL,
    (p_invoice_data->>'total_amount')::DECIMAL,
    p_invoice_data->>'notes',
    p_invoice_data->>'internal_notes',
    (p_invoice_data->>'status') -- status is text/varchar, not an enum
  )
  RETURNING id INTO v_invoice_id;

  -- 2. Insert Line Items
  IF jsonb_array_length(p_line_items) > 0 THEN
    INSERT INTO invoice_line_items (
      invoice_id,
      catalog_item_id,
      description,
      quantity,
      unit_price,
      discount_percentage,
      vat_rate
    )
    SELECT
      v_invoice_id,
      (item->>'catalog_item_id')::UUID,
      item->>'description',
      (item->>'quantity')::DECIMAL,
      (item->>'unit_price')::DECIMAL,
      (item->>'discount_percentage')::DECIMAL,
      (item->>'vat_rate')::DECIMAL
    FROM jsonb_array_elements(p_line_items) AS item;
  END IF;

  -- 3. Return the created invoice
  SELECT to_jsonb(i) INTO v_invoice_record
  FROM invoices i
  WHERE i.id = v_invoice_id;

  RETURN v_invoice_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment_transaction(p_payment_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payment_id UUID;
  v_invoice_id UUID;
  v_amount DECIMAL;
  v_current_paid DECIMAL;
  v_total DECIMAL;
  v_new_paid DECIMAL;
  v_new_status text; -- Changed from invoice_status to text
  v_payment_record JSONB;
BEGIN
  PERFORM public.assert_rpc_permission('invoices', 'edit');

  v_invoice_id := (p_payment_data->>'invoice_id')::UUID;
  v_amount := (p_payment_data->>'amount')::DECIMAL;

  -- 1. Get current invoice details
  SELECT paid_amount, total_amount, status 
  INTO v_current_paid, v_total, v_new_status
  FROM invoices 
  WHERE id = v_invoice_id
  FOR UPDATE; -- Lock the row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_amount > (v_total - v_current_paid) THEN
    RAISE EXCEPTION 'Payment amount exceeds outstanding balance';
  END IF;

  -- 2. Insert Payment
  INSERT INTO invoice_payments (
    invoice_id,
    payment_date,
    amount,
    payment_method,
    reference,
    notes
  ) VALUES (
    v_invoice_id,
    (p_payment_data->>'payment_date')::DATE,
    v_amount,
    p_payment_data->>'payment_method',
    p_payment_data->>'reference',
    p_payment_data->>'notes'
  )
  RETURNING id INTO v_payment_id;

  -- 3. Update Invoice Status
  v_new_paid := v_current_paid + v_amount;
  
  IF v_new_paid >= v_total THEN
    v_new_status := 'paid';
  ELSIF v_new_paid > 0 AND v_new_status NOT IN ('void', 'written_off') THEN
    v_new_status := 'partially_paid';
  END IF;

  UPDATE invoices
  SET 
    paid_amount = v_new_paid,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = v_invoice_id;

  -- 4. Return Payment Record
  SELECT to_jsonb(ip) INTO v_payment_record
  FROM invoice_payments ip
  WHERE ip.id = v_payment_id;

  RETURN v_payment_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.convert_quote_to_invoice_atomic(p_quote_id uuid, p_invoice_date date, p_due_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quote public.quotes;
  v_line_count integer;
  v_sequence integer;
  v_number integer;
  v_remainder integer;
  v_encoded text := '';
  v_invoice_number text;
  v_invoice public.invoices;
BEGIN
  PERFORM public.assert_rpc_permission('invoices', 'create');

  SELECT *
  INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;

  IF v_quote.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only accepted quotes can be converted to invoices';
  END IF;

  IF v_quote.converted_to_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'This quote has already been converted to an invoice';
  END IF;

  SELECT count(*)
  INTO v_line_count
  FROM public.quote_line_items
  WHERE quote_id = p_quote_id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Quote has no line items and cannot be converted';
  END IF;

  SELECT next_sequence
  INTO v_sequence
  FROM public.get_and_increment_invoice_series('INV')
  LIMIT 1;

  v_number := v_sequence + 5000;

  IF v_number = 0 THEN
    v_encoded := '0';
  END IF;

  WHILE v_number > 0 LOOP
    v_remainder := v_number % 36;
    v_encoded := substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', v_remainder + 1, 1) || v_encoded;
    v_number := floor(v_number / 36);
  END LOOP;

  v_invoice_number := 'INV-' || lpad(v_encoded, 5, '0');

  INSERT INTO public.invoices (
    invoice_number,
    vendor_id,
    invoice_date,
    due_date,
    reference,
    invoice_discount_percentage,
    subtotal_amount,
    discount_amount,
    vat_amount,
    total_amount,
    notes,
    internal_notes,
    status
  )
  VALUES (
    v_invoice_number,
    v_quote.vendor_id,
    p_invoice_date,
    p_due_date,
    v_quote.reference,
    v_quote.quote_discount_percentage,
    v_quote.subtotal_amount,
    v_quote.discount_amount,
    v_quote.vat_amount,
    v_quote.total_amount,
    v_quote.notes,
    v_quote.internal_notes,
    'draft'
  )
  RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_line_items (
    invoice_id,
    catalog_item_id,
    description,
    quantity,
    unit_price,
    discount_percentage,
    vat_rate
  )
  SELECT
    v_invoice.id,
    catalog_item_id,
    description,
    quantity,
    unit_price,
    discount_percentage,
    vat_rate
  FROM public.quote_line_items
  WHERE quote_id = p_quote_id;

  UPDATE public.quotes
  SET converted_to_invoice_id = v_invoice.id,
      updated_at = now()
  WHERE id = p_quote_id
    AND status = 'accepted'
    AND converted_to_invoice_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote conversion could not be finalized';
  END IF;

  RETURN jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'quote_number', v_quote.quote_number
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Close anon EXECUTE on every remaining SECURITY DEFINER function
--
-- Revoking from "public" as well as "anon" is the part that actually matters:
-- most of these never had an explicit anon grant, they were reachable through
-- the PUBLIC grant that Postgres applies to every new function in this project.
--
-- Verified before writing this list: none of the 47 relies on PUBLIC for its
-- own access. Every one carries a separate "authenticated=X" and
-- "service_role=X" ACL entry, so these revokes cannot strip the app's or the
-- cron's access the way 20260811100100 did to the private-hire enquiry flow.
--
-- The six trigger functions below are included for hygiene only. PostgREST does
-- not expose functions returning trigger, and a trigger fires regardless of
-- whether the inserting role holds EXECUTE (verified against this database in a
-- rolled-back transaction), so revoking them changes no behaviour.
-- ---------------------------------------------------------------------------

revoke all on function public.assert_booking_within_service_window() from public, anon;
revoke all on function public.audit_balance_due_date_change() from public, anon;
revoke all on function public.calculate_refund_amount(p_booking_id uuid) from public, anon;
revoke all on function public.calculate_refundable_balance(p_source_type text, p_source_id uuid, p_original_amount numeric) from public, anon;
revoke all on function public.check_and_reserve_capacity(p_service_date date, p_booking_time time without time zone, p_party_size integer, p_booking_type table_booking_type, p_duration_minutes integer) from public, anon;
revoke all on function public.check_table_availability(p_date date, p_time time without time zone, p_party_size integer, p_duration_minutes integer, p_exclude_booking_id uuid) from public, anon;
revoke all on function public.claim_calendar_note_google_sync(p_note_id uuid, p_expected_generation bigint, p_lease_seconds integer) from public, anon;
revoke all on function public.compare_employee_versions(p_employee_id uuid, p_version1 integer, p_version2 integer) from public, anon;
revoke all on function public.convert_quote_to_invoice_atomic(p_quote_id uuid, p_invoice_date date, p_due_date date) from public, anon;
revoke all on function public.create_credit_note_atomic(p_invoice_id uuid, p_amount_ex_vat numeric, p_reason text, p_created_by uuid) from public, anon;
revoke all on function public.create_dish_transaction(p_dish_data jsonb, p_ingredients jsonb, p_recipes jsonb, p_assignments jsonb) from public, anon;
revoke all on function public.create_event_transaction(p_event_data jsonb, p_faqs jsonb) from public, anon;
revoke all on function public.create_invoice_transaction(p_invoice_data jsonb, p_line_items jsonb) from public, anon;
revoke all on function public.create_quote_transaction(p_quote_data jsonb, p_line_items jsonb) from public, anon;
revoke all on function public.create_recipe_transaction(p_recipe_data jsonb, p_ingredients jsonb) from public, anon;
revoke all on function public.create_table_booking_v05_core_legacy(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean, p_source text) from public, anon;
revoke all on function public.create_table_booking_v05_core_sunday_deposit_legacy(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean, p_source text) from public, anon;
revoke all on function public.current_user_employee_ids() from public, anon;
revoke all on function public.delete_expense_atomic(p_expense_id uuid) from public, anon;
revoke all on function public.draw_daily_spot_checks(p_business_date date, p_count integer) from public, anon;
revoke all on function public.enforce_event_communal_seat_allocation_v01() from public, anon;
revoke all on function public.enforce_table_booking_assignment_capacity_v01() from public, anon;
revoke all on function public.enqueue_calendar_note_google_sync() from public, anon;
revoke all on function public.get_category_regulars(p_category_id uuid, p_days_back integer) from public, anon;
revoke all on function public.get_cross_category_suggestions(p_target_category_id uuid, p_source_category_id uuid, p_limit integer) from public, anon;
revoke all on function public.get_customer_labels(p_customer_id uuid) from public, anon;
revoke all on function public.get_employee_at_timestamp(p_employee_id uuid, p_timestamp timestamp with time zone) from public, anon;
revoke all on function public.get_employee_changes_summary(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone) from public, anon;
revoke all on function public.get_event_ticket_type_capacity_v01(p_event_id uuid) from public, anon;
revoke all on function public.get_menu_outstanding_count() from public, anon;
revoke all on function public.get_user_permissions(p_user_id uuid) from public, anon;
revoke all on function public.holiday_year_for_date(p_date date) from public, anon;
revoke all on function public.menu_create_ingredient_with_price(p_name text, p_description text, p_default_unit menu_unit, p_storage_type menu_storage_type, p_purchase_department text, p_supplier_name text, p_supplier_sku text, p_brand text, p_pack_size numeric, p_pack_size_unit menu_unit, p_pack_cost numeric, p_portions_per_pack numeric, p_wastage_pct numeric, p_shelf_life_days integer, p_allergens text[], p_dietary_flags text[], p_notes text, p_is_active boolean, p_abv numeric) from public, anon;
revoke all on function public.menu_update_ingredient_with_price(p_ingredient_id uuid, p_name text, p_description text, p_default_unit menu_unit, p_storage_type menu_storage_type, p_purchase_department text, p_supplier_name text, p_supplier_sku text, p_brand text, p_pack_size numeric, p_pack_size_unit menu_unit, p_pack_cost numeric, p_portions_per_pack numeric, p_wastage_pct numeric, p_shelf_life_days integer, p_allergens text[], p_dietary_flags text[], p_notes text, p_is_active boolean, p_abv numeric) from public, anon;
revoke all on function public.record_balance_payment(p_booking_id uuid, p_amount numeric, p_method text, p_recorded_by uuid) from public, anon;
revoke all on function public.record_invoice_payment_transaction(p_payment_data jsonb) from public, anon;
revoke all on function public.record_onboarding_acknowledgement(p_token text, p_question text) from public, anon;
revoke all on function public.requeue_calendar_note_google_sync(p_note_id uuid, p_processing_token uuid) from public, anon;
revoke all on function public.requeue_stale_calendar_note_google_sync(p_today date, p_synced_before timestamp with time zone, p_limit integer) from public, anon;
revoke all on function public.restore_employee_version(p_employee_id uuid, p_version_number integer, p_user_id uuid) from public, anon;
revoke all on function public.save_onboarding_time_off(p_token text, p_answer text, p_blocks jsonb, p_submission_version integer) from public, anon;
revoke all on function public.sync_booking_default_item_v01(p_booking_id uuid) from public, anon;
revoke all on function public.trg_sync_booking_default_item() from public, anon;
revoke all on function public.update_event_transaction(p_event_id uuid, p_event_data jsonb, p_faqs jsonb) from public, anon;
revoke all on function public.update_recipe_transaction(p_recipe_id uuid, p_recipe_data jsonb, p_ingredients jsonb) from public, anon;
revoke all on function public.upsert_cashup_session_atomic(p_existing_id uuid, p_site_id uuid, p_session_date date, p_status text, p_notes text, p_payment_breakdowns jsonb, p_cash_counts jsonb, p_sales_breakdowns jsonb, p_user_id uuid) from public, anon;
revoke all on function public.validate_booking_against_policy(p_booking_type table_booking_type, p_booking_date date, p_booking_time time without time zone, p_party_size integer) from public, anon;

-- get_and_increment_invoice_series is NOT SECURITY DEFINER, so it already runs
-- as the caller and anon holds no grant on invoice_series. It was reported as a
-- way to burn invoice numbers anonymously; it is not, and that was confirmed
-- against the live grants. Revoked anyway so the invoice numbering path does not
-- depend on a table grant staying absent.
revoke all on function public.get_and_increment_invoice_series(p_series_code character varying) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Drop "authenticated" where every caller is already the service-role client
--
-- These are unguarded SECURITY DEFINER functions whose only route into the app
-- is createAdminClient(). Leaving them open to "authenticated" means any signed
-- in staff account, whatever its role, can call them straight through PostgREST.
-- Every reference in the repository was checked, generated types and mocked
-- tests excluded, and the client resolved for each one:
--   record_onboarding_acknowledgement    src/app/actions/employeeInvite.ts:1080  adminClient
--   save_onboarding_time_off             src/app/actions/employeeInvite.ts:1027  adminClient
--   claim_calendar_note_google_sync      src/lib/google-calendar-notes.ts:105    adminClient
--   requeue_calendar_note_google_sync    src/lib/google-calendar-notes.ts:487    adminClient
--   requeue_stale_calendar_note_google_sync
--                                        src/app/api/cron/pub-ops-calendar-note-sync/route.ts:101
--   draw_daily_spot_checks               src/app/actions/checklists-spotcheck.ts:216  adminClient
-- The two onboarding RPCs matter most: they are token-authorised, so a staff
-- login should not be a second way in.
--
-- The last three have no application caller at all. They are legacy overloads
-- and an internal helper, and should be dropped once someone has confirmed no
-- external integration calls them.
-- ---------------------------------------------------------------------------

revoke all on function public.record_onboarding_acknowledgement(p_token text, p_question text) from authenticated;
revoke all on function public.save_onboarding_time_off(p_token text, p_answer text, p_blocks jsonb, p_submission_version integer) from authenticated;
revoke all on function public.claim_calendar_note_google_sync(p_note_id uuid, p_expected_generation bigint, p_lease_seconds integer) from authenticated;
revoke all on function public.requeue_calendar_note_google_sync(p_note_id uuid, p_processing_token uuid) from authenticated;
revoke all on function public.requeue_stale_calendar_note_google_sync(p_today date, p_synced_before timestamp with time zone, p_limit integer) from authenticated;
revoke all on function public.draw_daily_spot_checks(p_business_date date, p_count integer) from authenticated;
revoke all on function public.create_table_booking_v05_core_legacy(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean, p_source text) from authenticated;
revoke all on function public.create_table_booking_v05_core_sunday_deposit_legacy(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text, p_notes text, p_sunday_lunch boolean, p_source text) from authenticated;
revoke all on function public.sync_booking_default_item_v01(p_booking_id uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 5. Explicit re-grants
--
-- The live ACLs already carry separate service_role entries, so the revokes
-- above cannot strip them. Stating the service path outright means a future ACL
-- change cannot quietly break the crons the way 20260811100100 did.
-- ---------------------------------------------------------------------------

grant execute on function public.record_onboarding_acknowledgement(p_token text, p_question text) to service_role;
grant execute on function public.save_onboarding_time_off(p_token text, p_answer text, p_blocks jsonb, p_submission_version integer) to service_role;
grant execute on function public.claim_calendar_note_google_sync(p_note_id uuid, p_expected_generation bigint, p_lease_seconds integer) to service_role;
grant execute on function public.requeue_calendar_note_google_sync(p_note_id uuid, p_processing_token uuid) to service_role;
grant execute on function public.requeue_stale_calendar_note_google_sync(p_today date, p_synced_before timestamp with time zone, p_limit integer) to service_role;
grant execute on function public.draw_daily_spot_checks(p_business_date date, p_count integer) to service_role;

-- The guarded money RPCs keep their authenticated grant on purpose: the server
-- actions call them through the cookie client, and section 2 now enforces the
-- RBAC check inside the function instead of trusting that caller.
grant execute on function public.create_invoice_transaction(p_invoice_data jsonb, p_line_items jsonb) to authenticated, service_role;
grant execute on function public.record_invoice_payment_transaction(p_payment_data jsonb) to authenticated, service_role;
grant execute on function public.convert_quote_to_invoice_atomic(p_quote_id uuid, p_invoice_date date, p_due_date date) to authenticated, service_role;
grant execute on function public.create_credit_note_atomic(p_invoice_id uuid, p_amount_ex_vat numeric, p_reason text, p_created_by uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Deliberately NOT revoked: user_has_permission and is_super_admin
--
-- Both are SECURITY DEFINER and both are anon-executable, so they look like they
-- belong in section 3. They are excluded because revoking them takes the app
-- down, which was proven against this database rather than assumed:
--
--   begin;
--   revoke all on function public.is_super_admin(uuid) from public, anon;
--   set local role anon;
--   select count(*) from public.mileage_trips;
--   -- ERROR: 42501: permission denied for function is_super_admin
--   rollback;
--
-- The cause is that 69 RLS policies across 39 tables are declared TO public
-- rather than TO authenticated, and anon holds SELECT on all 39. A policy
-- expression runs with the querying role's privileges, so today anon evaluates
-- user_has_permission(), gets false and sees zero rows. Take the EXECUTE away
-- and the same query raises 42501 instead of returning an empty set. Two of
-- those tables, business_hours and special_hours, are read by the public
-- website. This is the same shape of failure as the sixteen-day private-hire
-- enquiry outage in August.
--
-- Neither function leaks anything to anon: user_has_permission(uuid, text, text)
-- answers only "does this user id hold this permission" and is_super_admin(uuid)
-- likewise, both for a caller who must already know the uuid.
--
-- The real fix is to re-scope those 69 policies from TO public to
-- TO authenticated, after which both functions can be revoked from anon. That is
-- a separate change with its own blast radius and belongs in its own migration.
--
-- The durable fix for the whole class is to stop the default: ALTER DEFAULT
-- PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM public, plus a CI
-- assertion that fails when any function in public is executable by anon without
-- an explicit allowlist entry. Without it this audit has to be repeated every
-- few weeks, which is exactly what happened here.
-- ---------------------------------------------------------------------------
