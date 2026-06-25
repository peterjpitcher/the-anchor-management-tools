-- Lock down SECURITY DEFINER functions that the application only ever invokes
-- through the service-role admin client (createAdminClient), plus internal/unused
-- transaction wrappers. None of these are called via the cookie/user client
-- (createClient from @/lib/supabase/server) or the browser/anon client, so they
-- have no legitimate need for the anon/authenticated EXECUTE grant.
--
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon and authenticated
-- on every new public function (on top of the PUBLIC default). For these
-- privileged mutations that means any authenticated — and in several cases any
-- anonymous — caller can invoke them directly via the PostgREST /rest/v1/rpc
-- endpoint, bypassing the application-layer checkUserPermission / token / Turnstile
-- guards entirely (e.g. import another business's invoice data, reissue an
-- invoice, reserve a refund balance, complete employee onboarding, or transition
-- a recruitment application's status). The functions self-authorise nothing at
-- the database layer, so the only protection is the app layer they are reached
-- through. Revoking EXECUTE from PUBLIC/anon/authenticated and granting solely to
-- service_role removes the escalation surface while leaving every legitimate
-- (admin-client) call path working. Mirrors 20260709000001_rbac_permission_replace_atomicity_grant.sql.
--
-- Verified (repo-wide): every call site below uses the service-role admin client,
-- or the function has no application call site at all. Functions owned by postgres,
-- so internal SQL-to-SQL calls (e.g. the mileage orchestrators calling
-- insert_mileage_trip_legs_v01 / recalculate_mileage_tax_year_v01) execute as the
-- owner and are unaffected by these grant changes.

-- Invoices / OJ Projects (admin-client only)
REVOKE EXECUTE ON FUNCTION public.update_invoice_with_line_items(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reissue_oj_invoice_transaction(uuid, text, jsonb, jsonb, uuid[], uuid[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.replace_oj_invoice_transaction(uuid, jsonb, jsonb, uuid[], uuid[], text, uuid) FROM PUBLIC, anon, authenticated;

-- Menu (admin-client only)
REVOKE EXECUTE ON FUNCTION public.menu_update_ingredient_pack_cost(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_dish_transaction(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_menu_target_gp_transaction(numeric, uuid, text) FROM PUBLIC, anon, authenticated;

-- Receipts (admin-client only)
REVOKE EXECUTE ON FUNCTION public.apply_receipt_group_classification_atomic(text, public.receipt_transaction_status[], boolean, uuid, text, boolean, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.import_receipt_batch_transaction(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Employees / onboarding (admin-client only; onboarding routes are unauthenticated, token-gated)
REVOKE EXECUTE ON FUNCTION public.create_employee_transaction(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_employee_invite(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_employee_invite(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.replace_employee_emergency_contacts(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_employee_onboarding(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_employee_invite_account(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_guest_transaction(uuid, jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Recruitment appointment atomicity (admin-client only; booking routes are unauthenticated, token-gated)
REVOKE EXECUTE ON FUNCTION public.recruitment_claim_appointment_slot(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recruitment_reschedule_appointment(uuid, uuid, text, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recruitment_transition_application_status_actor(uuid, text, text, jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recruitment_transition_application_status(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Refunds / private-booking payments (admin-client only)
REVOKE EXECUTE ON FUNCTION public.reserve_refund_balance(text, uuid, numeric, numeric, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_balance_payment_status(uuid) FROM PUBLIC, anon, authenticated;

-- Bookings / parking transaction wrappers (no application call site)
REVOKE EXECUTE ON FUNCTION public.create_table_booking_transaction(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_parking_booking_transaction(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Mileage (admin-client orchestrators + their internal SQL helpers)
REVOKE EXECUTE ON FUNCTION public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalculate_mileage_tax_year_v01(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.insert_mileage_trip_legs_v01(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;

-- Grant solely to service_role.
GRANT EXECUTE ON FUNCTION public.update_invoice_with_line_items(uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reissue_oj_invoice_transaction(uuid, text, jsonb, jsonb, uuid[], uuid[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_oj_invoice_transaction(uuid, jsonb, jsonb, uuid[], uuid[], text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.menu_update_ingredient_pack_cost(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_dish_transaction(uuid, jsonb, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_menu_target_gp_transaction(numeric, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_receipt_group_classification_atomic(text, public.receipt_transaction_status[], boolean, uuid, text, boolean, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.import_receipt_batch_transaction(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_employee_transaction(jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_employee_invite(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_employee_invite(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_employee_emergency_contacts(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_employee_onboarding(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_employee_invite_account(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_guest_transaction(uuid, jsonb, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.recruitment_claim_appointment_slot(uuid, uuid, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.recruitment_reschedule_appointment(uuid, uuid, text, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.recruitment_transition_application_status_actor(uuid, text, text, jsonb, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.recruitment_transition_application_status(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_refund_balance(text, uuid, numeric, numeric, text, text, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_balance_payment_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_table_booking_transaction(jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_parking_booking_transaction(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_mileage_tax_year_v01(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_mileage_trip_legs_v01(uuid, jsonb, integer) TO service_role;
