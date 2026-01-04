-- Cleanup unused tables and columns (generated from discovery scan)
-- Generated: 2026-01-03 17:35:13
-- WARNING: This migration was generated from static analysis. Review before applying.
-- WARNING: CASCADE will drop dependent objects (policies, views, constraints) that reference removed columns.

-- Drop tables with zero references
DROP TABLE IF EXISTS "public"."customer_achievements" CASCADE;
DROP TABLE IF EXISTS "public"."invoice_audit" CASCADE;
DROP TABLE IF EXISTS "public"."invoice_email_templates" CASCADE;
DROP TABLE IF EXISTS "public"."phone_standardization_issues" CASCADE;
DROP TABLE IF EXISTS "public"."reward_redemptions" CASCADE;
DROP TABLE IF EXISTS "public"."service_slot_overrides" CASCADE;
DROP TABLE IF EXISTS "public"."table_booking_reminder_history" CASCADE;
DROP TABLE IF EXISTS "public"."webhook_deliveries" CASCADE;

-- Drop unused columns (includes tables with wildcard selects)
ALTER TABLE IF EXISTS "public"."achievement_progress" DROP COLUMN IF EXISTS "achievement_id" CASCADE;
ALTER TABLE IF EXISTS "public"."achievement_progress" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."achievement_progress" DROP COLUMN IF EXISTS "member_id" CASCADE;
ALTER TABLE IF EXISTS "public"."achievement_progress" DROP COLUMN IF EXISTS "progress" CASCADE;
ALTER TABLE IF EXISTS "public"."achievement_progress" DROP COLUMN IF EXISTS "target_value" CASCADE;

ALTER TABLE IF EXISTS "public"."ai_usage_events" DROP COLUMN IF EXISTS "context" CASCADE;
ALTER TABLE IF EXISTS "public"."ai_usage_events" DROP COLUMN IF EXISTS "occurred_at" CASCADE;

ALTER TABLE IF EXISTS "public"."api_keys" DROP COLUMN IF EXISTS "expires_at" CASCADE;


ALTER TABLE IF EXISTS "public"."attachment_categories" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."attachment_categories" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."background_jobs" DROP COLUMN IF EXISTS "completed_at" CASCADE;
ALTER TABLE IF EXISTS "public"."background_jobs" DROP COLUMN IF EXISTS "error" CASCADE;
ALTER TABLE IF EXISTS "public"."background_jobs" DROP COLUMN IF EXISTS "max_attempts" CASCADE;
ALTER TABLE IF EXISTS "public"."background_jobs" DROP COLUMN IF EXISTS "processed_at" CASCADE;
ALTER TABLE IF EXISTS "public"."background_jobs" DROP COLUMN IF EXISTS "result" CASCADE;

ALTER TABLE IF EXISTS "public"."booking_audit" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."booking_audit" DROP COLUMN IF EXISTS "created_by" CASCADE;
ALTER TABLE IF EXISTS "public"."booking_audit" DROP COLUMN IF EXISTS "old_status" CASCADE;

ALTER TABLE IF EXISTS "public"."booking_policies" DROP COLUMN IF EXISTS "max_party_size" CASCADE;
ALTER TABLE IF EXISTS "public"."booking_policies" DROP COLUMN IF EXISTS "modification_allowed" CASCADE;

ALTER TABLE IF EXISTS "public"."booking_time_slots" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."bookings" DROP COLUMN IF EXISTS "qr_expires_at" CASCADE;
ALTER TABLE IF EXISTS "public"."bookings" DROP COLUMN IF EXISTS "qr_token" CASCADE;

ALTER TABLE IF EXISTS "public"."business_amenities" DROP COLUMN IF EXISTS "additional_info" CASCADE;
ALTER TABLE IF EXISTS "public"."business_amenities" DROP COLUMN IF EXISTS "available" CASCADE;
ALTER TABLE IF EXISTS "public"."business_amenities" DROP COLUMN IF EXISTS "capacity" CASCADE;
ALTER TABLE IF EXISTS "public"."business_amenities" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."business_amenities" DROP COLUMN IF EXISTS "details" CASCADE;
ALTER TABLE IF EXISTS "public"."business_amenities" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."business_hours" DROP COLUMN IF EXISTS "closes" CASCADE;
ALTER TABLE IF EXISTS "public"."business_hours" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."business_hours" DROP COLUMN IF EXISTS "opens" CASCADE;
ALTER TABLE IF EXISTS "public"."business_hours" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."cashup_sessions" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."cashup_targets" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."cashup_targets" DROP COLUMN IF EXISTS "etc" CASCADE;

ALTER TABLE IF EXISTS "public"."catering_packages" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."catering_packages" DROP COLUMN IF EXISTS "maximum_guests" CASCADE;
ALTER TABLE IF EXISTS "public"."catering_packages" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."customer_category_stats" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."customer_category_stats" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."customer_challenges" DROP COLUMN IF EXISTS "challenge_id" CASCADE;
ALTER TABLE IF EXISTS "public"."customer_challenges" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."customer_challenges" DROP COLUMN IF EXISTS "last_completed_at" CASCADE;
ALTER TABLE IF EXISTS "public"."customer_challenges" DROP COLUMN IF EXISTS "member_id" CASCADE;
ALTER TABLE IF EXISTS "public"."customer_challenges" DROP COLUMN IF EXISTS "progress" CASCADE;

ALTER TABLE IF EXISTS "public"."customer_label_assignments" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."customer_labels" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."customer_labels" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."employee_emergency_contacts" DROP COLUMN IF EXISTS "address" CASCADE;
ALTER TABLE IF EXISTS "public"."employee_emergency_contacts" DROP COLUMN IF EXISTS "name" CASCADE;
ALTER TABLE IF EXISTS "public"."employee_emergency_contacts" DROP COLUMN IF EXISTS "phone_number" CASCADE;
ALTER TABLE IF EXISTS "public"."employee_emergency_contacts" DROP COLUMN IF EXISTS "relationship" CASCADE;

ALTER TABLE IF EXISTS "public"."employee_financial_details" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."employee_health_records" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."employee_health_records" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."employee_notes" DROP COLUMN IF EXISTS "created_by_user_id" CASCADE;
ALTER TABLE IF EXISTS "public"."employee_notes" DROP COLUMN IF EXISTS "note_id" CASCADE;
ALTER TABLE IF EXISTS "public"."employee_notes" DROP COLUMN IF EXISTS "note_text" CASCADE;

ALTER TABLE IF EXISTS "public"."employees" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."event_check_ins" DROP COLUMN IF EXISTS "achievements_earned" CASCADE;
ALTER TABLE IF EXISTS "public"."event_check_ins" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."event_checklist_statuses" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."event_faqs" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."event_faqs" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."event_images" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."event_message_templates" DROP COLUMN IF EXISTS "character_count" CASCADE;
ALTER TABLE IF EXISTS "public"."event_message_templates" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."event_message_templates" DROP COLUMN IF EXISTS "estimated_segments" CASCADE;

ALTER TABLE IF EXISTS "public"."idempotency_keys" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."invoice_email_logs" DROP COLUMN IF EXISTS "error_message" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_email_logs" DROP COLUMN IF EXISTS "message_id" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_email_logs" DROP COLUMN IF EXISTS "quote_id" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_email_logs" DROP COLUMN IF EXISTS "sent_at" CASCADE;

ALTER TABLE IF EXISTS "public"."invoice_line_items" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_line_items" DROP COLUMN IF EXISTS "discount_amount" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_line_items" DROP COLUMN IF EXISTS "subtotal_amount" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_line_items" DROP COLUMN IF EXISTS "total_amount" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_line_items" DROP COLUMN IF EXISTS "vat_amount" CASCADE;

ALTER TABLE IF EXISTS "public"."invoice_payments" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."invoice_reminder_settings" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_reminder_settings" DROP COLUMN IF EXISTS "days_after_due" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_reminder_settings" DROP COLUMN IF EXISTS "days_before_due" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_reminder_settings" DROP COLUMN IF EXISTS "enabled" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_reminder_settings" DROP COLUMN IF EXISTS "reminder_email" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_reminder_settings" DROP COLUMN IF EXISTS "reminder_time" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_reminder_settings" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."invoice_series" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."invoice_vendors" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_vendors" DROP COLUMN IF EXISTS "notes" CASCADE;
ALTER TABLE IF EXISTS "public"."invoice_vendors" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."job_queue" DROP COLUMN IF EXISTS "completed_at" CASCADE;
ALTER TABLE IF EXISTS "public"."job_queue" DROP COLUMN IF EXISTS "created_by" CASCADE;
ALTER TABLE IF EXISTS "public"."job_queue" DROP COLUMN IF EXISTS "error" CASCADE;
ALTER TABLE IF EXISTS "public"."job_queue" DROP COLUMN IF EXISTS "payload" CASCADE;
ALTER TABLE IF EXISTS "public"."job_queue" DROP COLUMN IF EXISTS "result" CASCADE;

ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "active" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "category" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "criteria" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "description" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "icon" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "name" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "points_value" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "program_id" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_achievements" DROP COLUMN IF EXISTS "sort_order" CASCADE;

ALTER TABLE IF EXISTS "public"."loyalty_campaigns" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_campaigns" DROP COLUMN IF EXISTS "criteria" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_campaigns" DROP COLUMN IF EXISTS "description" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_campaigns" DROP COLUMN IF EXISTS "name" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_campaigns" DROP COLUMN IF EXISTS "program_id" CASCADE;

ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "active" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "category" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "criteria" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "description" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "end_date" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "icon" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "max_completions" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "name" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "points_value" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_challenges" DROP COLUMN IF EXISTS "program_id" CASCADE;

ALTER TABLE IF EXISTS "public"."loyalty_members" DROP COLUMN IF EXISTS "last_reward_notification" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_members" DROP COLUMN IF EXISTS "last_visit_date" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_members" DROP COLUMN IF EXISTS "notification_preferences" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_members" DROP COLUMN IF EXISTS "welcome_sent" CASCADE;

ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "channel" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "content" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "delivered" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "error_message" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "failed" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "job_id" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "member_id" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "metadata" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_notifications" DROP COLUMN IF EXISTS "notification_type" CASCADE;

ALTER TABLE IF EXISTS "public"."loyalty_point_transactions" DROP COLUMN IF EXISTS "achievement" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_point_transactions" DROP COLUMN IF EXISTS "challenge" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_point_transactions" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_point_transactions" DROP COLUMN IF EXISTS "etc" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_point_transactions" DROP COLUMN IF EXISTS "negative" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_point_transactions" DROP COLUMN IF EXISTS "redemption" CASCADE;

ALTER TABLE IF EXISTS "public"."loyalty_rewards" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_rewards" DROP COLUMN IF EXISTS "daily_limit" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_rewards" DROP COLUMN IF EXISTS "inventory" CASCADE;
ALTER TABLE IF EXISTS "public"."loyalty_rewards" DROP COLUMN IF EXISTS "tier_required" CASCADE;

ALTER TABLE IF EXISTS "public"."loyalty_tiers" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."menu_categories" DROP COLUMN IF EXISTS "created_at" CASCADE;


ALTER TABLE IF EXISTS "public"."menu_dish_ingredients" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."menu_dish_menu_assignments" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."menu_dish_recipes" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."menu_dishes" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."menu_ingredients" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "allergens" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "available_from" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "available_until" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "calories" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "description" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "dietary_info" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "is_available" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "is_special" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "name" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "price" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "section_id" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "sort_order" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_items" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."menu_recipe_ingredients" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."menu_sections" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_sections" DROP COLUMN IF EXISTS "description" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_sections" DROP COLUMN IF EXISTS "is_active" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_sections" DROP COLUMN IF EXISTS "name" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_sections" DROP COLUMN IF EXISTS "sort_order" CASCADE;
ALTER TABLE IF EXISTS "public"."menu_sections" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."message_delivery_status" DROP COLUMN IF EXISTS "error_code" CASCADE;
ALTER TABLE IF EXISTS "public"."message_delivery_status" DROP COLUMN IF EXISTS "error_message" CASCADE;
ALTER TABLE IF EXISTS "public"."message_delivery_status" DROP COLUMN IF EXISTS "raw_webhook_data" CASCADE;

ALTER TABLE IF EXISTS "public"."message_template_history" DROP COLUMN IF EXISTS "change_reason" CASCADE;
ALTER TABLE IF EXISTS "public"."message_template_history" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."message_templates" DROP COLUMN IF EXISTS "character_count" CASCADE;
ALTER TABLE IF EXISTS "public"."message_templates" DROP COLUMN IF EXISTS "created_by" CASCADE;
ALTER TABLE IF EXISTS "public"."message_templates" DROP COLUMN IF EXISTS "estimated_segments" CASCADE;

ALTER TABLE IF EXISTS "public"."messages" DROP COLUMN IF EXISTS "price_unit" CASCADE;
ALTER TABLE IF EXISTS "public"."messages" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."parking_booking_notifications" DROP COLUMN IF EXISTS "email_message_id" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_booking_notifications" DROP COLUMN IF EXISTS "error" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_booking_notifications" DROP COLUMN IF EXISTS "retries" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_booking_notifications" DROP COLUMN IF EXISTS "sent_at" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_booking_notifications" DROP COLUMN IF EXISTS "status" CASCADE;

ALTER TABLE IF EXISTS "public"."parking_booking_payments" DROP COLUMN IF EXISTS "amount" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_booking_payments" DROP COLUMN IF EXISTS "expires_at" CASCADE;

ALTER TABLE IF EXISTS "public"."parking_bookings" DROP COLUMN IF EXISTS "calculated_price" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_bookings" DROP COLUMN IF EXISTS "cancelled_at" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_bookings" DROP COLUMN IF EXISTS "completed_at" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_bookings" DROP COLUMN IF EXISTS "customer_email" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_bookings" DROP COLUMN IF EXISTS "expires_at" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_bookings" DROP COLUMN IF EXISTS "pricing_breakdown" CASCADE;
ALTER TABLE IF EXISTS "public"."parking_bookings" DROP COLUMN IF EXISTS "updated_by" CASCADE;

ALTER TABLE IF EXISTS "public"."parking_rates" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."pending_bookings" DROP COLUMN IF EXISTS "seats" CASCADE;

ALTER TABLE IF EXISTS "public"."pl_manual_actuals" DROP COLUMN IF EXISTS "updated_at" CASCADE;
ALTER TABLE IF EXISTS "public"."pl_manual_actuals" DROP COLUMN IF EXISTS "value" CASCADE;

ALTER TABLE IF EXISTS "public"."pl_targets" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "document_type" CASCADE;
ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "file_name" CASCADE;
ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "file_size_bytes" CASCADE;
ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "generated_at" CASCADE;
ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "generated_by" CASCADE;
ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "metadata" CASCADE;
ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "mime_type" CASCADE;
ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "storage_path" CASCADE;
ALTER TABLE IF EXISTS "public"."private_booking_documents" DROP COLUMN IF EXISTS "version" CASCADE;

ALTER TABLE IF EXISTS "public"."private_booking_items" DROP COLUMN IF EXISTS "discount_reason" CASCADE;

ALTER TABLE IF EXISTS "public"."profiles" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."profiles" DROP COLUMN IF EXISTS "first_name" CASCADE;
ALTER TABLE IF EXISTS "public"."profiles" DROP COLUMN IF EXISTS "last_name" CASCADE;

ALTER TABLE IF EXISTS "public"."quotes" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."receipt_batches" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."receipt_files" DROP COLUMN IF EXISTS "uploaded_at" CASCADE;

ALTER TABLE IF EXISTS "public"."receipt_rules" DROP COLUMN IF EXISTS "auto_status" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_rules" DROP COLUMN IF EXISTS "description" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_rules" DROP COLUMN IF EXISTS "match_description" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_rules" DROP COLUMN IF EXISTS "match_direction" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_rules" DROP COLUMN IF EXISTS "match_max_amount" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_rules" DROP COLUMN IF EXISTS "match_min_amount" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_rules" DROP COLUMN IF EXISTS "match_transaction_type" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_rules" DROP COLUMN IF EXISTS "set_vendor_name" CASCADE;


ALTER TABLE IF EXISTS "public"."receipt_transactions" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_transactions" DROP COLUMN IF EXISTS "expense_rule_id" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_transactions" DROP COLUMN IF EXISTS "expense_updated_at" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_transactions" DROP COLUMN IF EXISTS "vendor_rule_id" CASCADE;
ALTER TABLE IF EXISTS "public"."receipt_transactions" DROP COLUMN IF EXISTS "vendor_updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "days_before_due" CASCADE;
ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "end_date" CASCADE;
ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "frequency" CASCADE;
ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "internal_notes" CASCADE;
ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "invoice_discount_percentage" CASCADE;
ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "notes" CASCADE;
ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "reference" CASCADE;
ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "start_date" CASCADE;
ALTER TABLE IF EXISTS "public"."recurring_invoices" DROP COLUMN IF EXISTS "vendor_id" CASCADE;

ALTER TABLE IF EXISTS "public"."reminder_processing_logs" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."roles" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."roles" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."service_slot_config" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."service_slots" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."service_status_overrides" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."service_statuses" DROP COLUMN IF EXISTS "metadata" CASCADE;
ALTER TABLE IF EXISTS "public"."service_statuses" DROP COLUMN IF EXISTS "updated_by" CASCADE;

ALTER TABLE IF EXISTS "public"."short_link_clicks" DROP COLUMN IF EXISTS "metadata" CASCADE;

ALTER TABLE IF EXISTS "public"."sites" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."special_hours" DROP COLUMN IF EXISTS "closes" CASCADE;
ALTER TABLE IF EXISTS "public"."special_hours" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."special_hours" DROP COLUMN IF EXISTS "opens" CASCADE;
ALTER TABLE IF EXISTS "public"."special_hours" DROP COLUMN IF EXISTS "updated_at" CASCADE;

ALTER TABLE IF EXISTS "public"."sunday_lunch_menu_items" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."system_settings" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."table_booking_items" DROP COLUMN IF EXISTS "menu_item_id" CASCADE;
ALTER TABLE IF EXISTS "public"."table_booking_items" DROP COLUMN IF EXISTS "otherwise" CASCADE;

ALTER TABLE IF EXISTS "public"."table_booking_modifications" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."table_booking_sms_templates" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."table_bookings" DROP COLUMN IF EXISTS "email_verification_token" CASCADE;
ALTER TABLE IF EXISTS "public"."table_bookings" DROP COLUMN IF EXISTS "email_verified_at" CASCADE;
ALTER TABLE IF EXISTS "public"."table_bookings" DROP COLUMN IF EXISTS "internal_notes" CASCADE;
ALTER TABLE IF EXISTS "public"."table_bookings" DROP COLUMN IF EXISTS "modification_count" CASCADE;
ALTER TABLE IF EXISTS "public"."table_bookings" DROP COLUMN IF EXISTS "phone" CASCADE;
ALTER TABLE IF EXISTS "public"."table_bookings" DROP COLUMN IF EXISTS "walk" CASCADE;

ALTER TABLE IF EXISTS "public"."table_combination_tables" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."table_combinations" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."table_configuration" DROP COLUMN IF EXISTS "created_at" CASCADE;

ALTER TABLE IF EXISTS "public"."tables" DROP COLUMN IF EXISTS "is_active" CASCADE;

ALTER TABLE IF EXISTS "public"."vendors" DROP COLUMN IF EXISTS "company_name" CASCADE;
ALTER TABLE IF EXISTS "public"."vendors" DROP COLUMN IF EXISTS "contact_phone" CASCADE;
ALTER TABLE IF EXISTS "public"."vendors" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."vendors" DROP COLUMN IF EXISTS "notes" CASCADE;
ALTER TABLE IF EXISTS "public"."vendors" DROP COLUMN IF EXISTS "updated_at" CASCADE;
ALTER TABLE IF EXISTS "public"."vendors" DROP COLUMN IF EXISTS "website" CASCADE;

ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "active" CASCADE;
ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "capacity_seated" CASCADE;
ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "capacity_standing" CASCADE;
ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "description" CASCADE;
ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "minimum_hours" CASCADE;
ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "rate_per_hour" CASCADE;
ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "setup_fee" CASCADE;
ALTER TABLE IF EXISTS "public"."venue_spaces" DROP COLUMN IF EXISTS "updated_at" CASCADE;


ALTER TABLE IF EXISTS "public"."webhooks" DROP COLUMN IF EXISTS "created_at" CASCADE;
ALTER TABLE IF EXISTS "public"."webhooks" DROP COLUMN IF EXISTS "events" CASCADE;
ALTER TABLE IF EXISTS "public"."webhooks" DROP COLUMN IF EXISTS "failure_count" CASCADE;
ALTER TABLE IF EXISTS "public"."webhooks" DROP COLUMN IF EXISTS "is_active" CASCADE;
ALTER TABLE IF EXISTS "public"."webhooks" DROP COLUMN IF EXISTS "last_triggered_at" CASCADE;
ALTER TABLE IF EXISTS "public"."webhooks" DROP COLUMN IF EXISTS "secret" CASCADE;
ALTER TABLE IF EXISTS "public"."webhooks" DROP COLUMN IF EXISTS "updated_at" CASCADE;
ALTER TABLE IF EXISTS "public"."webhooks" DROP COLUMN IF EXISTS "url" CASCADE;
