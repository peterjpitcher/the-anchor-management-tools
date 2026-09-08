-- Part 1: Trigger functions — never called via RPC; triggers fire regardless of grant.
REVOKE EXECUTE ON FUNCTION public.enforce_booking_table_assignment_integrity_v05() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_oj_mileage_to_trips() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_template_change() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mgd_collection_sync_return() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_customer_category_stats() FROM anon, authenticated, PUBLIC;

-- Part 2: Server-side only (encryption / cron / job worker) — both roles revoked.
REVOKE EXECUTE ON FUNCTION public.encrypt_sensitive_audit_data(p_encryption_key text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_jobs(batch_size integer, job_types text[], lease_seconds integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_idempotency_keys() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_jobs() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_service_slots() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_receipt_duplicate_candidates() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_close_past_event_tasks() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_generate_weekly_slots() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rebuild_customer_category_stats() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_customer_labels_retroactively() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_slots_simple() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_service_slots_for_period(start_date date, days_ahead integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_service_slots_from_config(start_date date, days_ahead integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_slots_from_business_hours(p_start_date date, p_days_ahead integer) FROM anon, authenticated, PUBLIC;

-- Part 3: Admin / staff RPCs — revoke anon, keep authenticated.
REVOKE EXECUTE ON FUNCTION public.apply_balance_payment_status(p_booking_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.calculate_refund_amount(p_booking_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.calculate_refundable_balance(p_source_type text, p_source_id uuid, p_original_amount numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_and_reserve_capacity(p_service_date date, p_booking_time time without time zone, p_party_size integer, p_booking_type table_booking_type, p_duration_minutes integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_table_availability(p_date date, p_time time without time zone, p_party_size integer, p_duration_minutes integer, p_exclude_booking_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.compare_employee_versions(p_employee_id uuid, p_version1 integer, p_version2 integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.count_receipt_statuses() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_dish_transaction(p_dish_data jsonb, p_ingredients jsonb, p_recipes jsonb, p_assignments jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_employee_invite(p_email text, p_job_title text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_employee_invite(p_email text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_employee_transaction(p_employee_data jsonb, p_financial_data jsonb, p_health_data jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_event_transaction(p_event_data jsonb, p_faqs jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_invoice_transaction(p_invoice_data jsonb, p_line_items jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_parking_booking_transaction(p_booking_data jsonb, p_payment_order_data jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_private_booking_transaction(p_booking_data jsonb, p_items jsonb, p_customer_data jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_quote_transaction(p_quote_data jsonb, p_line_items jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_recipe_transaction(p_recipe_data jsonb, p_ingredients jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_short_link(p_destination_url text, p_link_type character varying, p_metadata jsonb, p_expires_at timestamp with time zone, p_custom_code character varying) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_next_waitlist_offer_v05(p_event_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.debug_booking_hours(p_date date, p_time time without time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_all_links_analytics(p_days integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_all_links_analytics_v2(p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_granularity text, p_include_bots boolean, p_timezone text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_all_users_unsafe() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_all_users_with_roles() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_bulk_sms_recipients(p_event_id uuid, p_booking_status text, p_sms_opt_in_only boolean, p_category_id uuid, p_created_after date, p_created_before date, p_search text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_category_regulars(p_category_id uuid, p_days_back integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_cross_category_suggestions(p_target_category_id uuid, p_source_category_id uuid, p_limit integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_cross_promo_audience(p_event_id uuid, p_category_id uuid, p_recency_months integer, p_general_recency_months integer, p_frequency_cap_days integer, p_max_recipients integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_customer_labels(p_customer_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_employee_at_timestamp(p_employee_id uuid, p_timestamp timestamp with time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_employee_changes_summary(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_follow_up_recipients(p_event_id uuid, p_touch_type text, p_min_gap_iso timestamp with time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_menu_outstanding_count() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_receipt_monthly_income_breakdown(limit_months integer, top_sources integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_receipt_monthly_summary(limit_months integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_receipt_vendor_monthly_totals(range_months integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_receipt_vendor_transactions(target_vendor_label text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_short_link_analytics(p_short_code character varying, p_days integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_permissions(p_user_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_roles(p_user_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_users_for_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.import_receipt_batch_transaction(p_batch_data jsonb, p_transactions jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(check_user_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_table_blocked_by_private_booking_v05(p_table_id uuid, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_exclude_private_booking_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.move_table_booking_time_v05(p_table_booking_id uuid, p_booking_time time without time zone, p_start_datetime timestamp with time zone, p_end_datetime timestamp with time zone) FROM anon;
REVOKE EXECUTE ON FUNCTION public.neutralise_under10_table_deposit_state_v01(p_table_booking_id uuid, p_reason text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_balance_payment(p_booking_id uuid, p_amount numeric, p_method text, p_recorded_by uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_invoice_payment_transaction(p_payment_data jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_table_cash_deposit_v05(p_table_booking_id uuid, p_amount numeric, p_currency text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.register_guest_transaction(p_event_id uuid, p_customer_data jsonb, p_staff_id uuid, p_labels jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reserve_refund_balance(p_source_type text, p_source_id uuid, p_original_amount numeric, p_amount numeric, p_refund_method text, p_reason text, p_initiated_by uuid, p_paypal_capture_id text, p_paypal_request_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_employee_version(p_employee_id uuid, p_version_number integer, p_user_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.table_booking_matches_service_window_v05(p_booking_date date, p_booking_time time without time zone, p_booking_purpose text, p_sunday_lunch boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_dish_transaction(p_dish_id uuid, p_dish_data jsonb, p_ingredients jsonb, p_recipes jsonb, p_assignments jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_event_booking_seats_staff_v05(p_booking_id uuid, p_new_seats integer, p_actor text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_event_transaction(p_event_id uuid, p_event_data jsonb, p_faqs jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_invoice_with_line_items(p_invoice_id uuid, p_invoice_data jsonb, p_line_items jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_menu_target_gp_transaction(p_new_target_gp numeric, p_user_id uuid, p_user_email text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_recipe_transaction(p_recipe_id uuid, p_recipe_data jsonb, p_ingredients jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_permission(p_user_id uuid, p_module_name text, p_action text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_booking_against_policy(p_booking_type table_booking_type, p_booking_date date, p_booking_time time without time zone, p_party_size integer) FROM anon;

-- Public-facing token-based RPCs intentionally LEFT anon-callable (customer self-service via emailed links):
--   accept_waitlist_offer_v05, apply_event_seat_increase_payment_v05, cancel_event_booking_v05,
--   complete_employee_onboarding, confirm_event_payment_v05, confirm_table_payment_v05,
--   decide_charge_request_v05, get_charge_request_approval_preview_v05,
--   get_event_booking_manage_preview_v05, get_event_capacity_snapshot_v05,
--   increment_short_link_clicks, link_employee_invite_account, update_event_booking_seats_v05,
--   create_event_booking_v05 (and v05_legacy), create_event_table_reservation_v05 (and legacy),
--   create_event_waitlist_entry_v05, create_sunday_lunch_booking,
--   create_table_booking_v05 (and core variants), create_table_booking_transaction
-- These all accept tokenized inputs or are stripe webhooks / public booking flows.