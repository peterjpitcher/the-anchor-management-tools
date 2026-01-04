# Database Field Discovery Report

Generated: 2026-01-03 17:34:43

## Scope
- Schema source: `supabase/migrations/*.sql` (applied in filename order)
- Code usage: `src/`, `scripts/`, `tests/` (Supabase client usage + select/insert/update filters)
- SQL usage: functions/triggers/views in `supabase/migrations/*.sql` and SQL scripts under `supabase/sql-scripts/` + `scripts/**/*.sql`
- Note: wildcard selects (`select(*)`) limit confidence for column-level pruning.

## Summary
- Tables in schema: 136
- Columns in schema: 1526
- Tables referenced in app code: 100
- Tables referenced in SQL functions/triggers: 109
- Tables with wildcard selects: 88
- Tables with zero references: 12
- Tables with candidate-unused columns (no wildcard usage): 43
- Tables with candidate-unused columns but wildcard usage: 68

## Tables Referenced in Code but Missing from Migrations
- `_migrations` (sources: wildcard)
- `admin_users_view` (sources: app)
- `business_hours_special` (sources: app, wildcard)
- `cashup_weekly_view` (sources: app, wildcard)
- `customer_id` (sources: scripts)
- `customer_messaging_health` (sources: scripts, wildcard)
- `employee_onboarding_checklist` (sources: app, wildcard)
- `employee_right_to_work` (sources: app, wildcard)
- `hiring_application_overrides` (sources: scripts)
- `hiring_applications` (sources: scripts, wildcard)
- `hiring_candidates` (sources: scripts, wildcard)
- `hiring_jobs` (sources: scripts)
- `invoice_audit_logs` (sources: app)
- `line_item_catalog` (sources: app, wildcard)
- `loyalty_welcome_series` (sources: scripts, wildcard)
- `menu_dishes_with_costs` (sources: app, wildcard)
- `menu_ingredients_with_prices` (sources: app)
- `migrations` (sources: wildcard)
- `pg_policies` (sources: scripts, wildcard)
- `quote_line_items` (sources: app, wildcard)
- `rbac_permissions` (sources: scripts, wildcard)
- `rbac_role_permissions` (sources: scripts)
- `rbac_roles` (sources: scripts)
- `recurring_invoice_line_items` (sources: app)
- `schema_migrations` (sources: scripts, wildcard)
- `supabase_migrations` (sources: scripts, wildcard)
- `table_booking_policies` (sources: app)
- `user_role_assignments` (sources: scripts)

## Tables with Wildcard Selects
- `api_keys` (sources: app, scripts)
- `api_usage` (sources: app)
- `attachment_categories` (sources: app)
- `audit_logs` (sources: app, scripts)
- `background_jobs` (sources: scripts)
- `booking_policies` (sources: app)
- `booking_reminders` (sources: scripts)
- `booking_time_slots` (sources: app)
- `bookings` (sources: app, scripts)
- `business_amenities` (sources: app)
- `business_hours` (sources: app, scripts)
- `cashup_cash_counts` (sources: app)
- `cashup_payment_breakdowns` (sources: app)
- `cashup_sessions` (sources: app)
- `cashup_targets` (sources: app)
- `catering_packages` (sources: app)
- `customer_category_stats` (sources: app, scripts)
- `customer_label_assignments` (sources: app, scripts)
- `customer_labels` (sources: app, scripts)
- `customers` (sources: app, scripts)
- `employee_attachments` (sources: app)
- `employee_emergency_contacts` (sources: app)
- `employee_financial_details` (sources: app, scripts)
- `employee_health_records` (sources: app, scripts)
- `employee_notes` (sources: app)
- `employees` (sources: app, scripts)
- `event_categories` (sources: app, scripts)
- `event_faqs` (sources: app)
- `event_images` (sources: app)
- `event_message_templates` (sources: app)
- `events` (sources: app, scripts)
- `invoice_email_logs` (sources: app)
- `invoice_line_items` (sources: app, scripts)
- `invoice_payments` (sources: app, scripts)
- `invoice_series` (sources: scripts)
- `invoice_vendor_contacts` (sources: app)
- `invoice_vendors` (sources: app, scripts)
- `invoices` (sources: app, scripts)
- `job_queue` (sources: scripts)
- `jobs` (sources: app, scripts)
- `loyalty_members` (sources: scripts)
- `loyalty_notifications` (sources: scripts)
- `loyalty_programs` (sources: scripts)
- `loyalty_tiers` (sources: scripts)
- `menu_dishes` (sources: app)
- `menu_ingredients` (sources: app)
- `menu_recipes` (sources: app)
- `message_templates` (sources: app, scripts)
- `messages` (sources: app, scripts)
- `parking_booking_notifications` (sources: app)
- `parking_booking_payments` (sources: app, scripts)
- `parking_bookings` (sources: app, scripts)
- `parking_rates` (sources: app)
- `pending_bookings` (sources: app, scripts)
- `permissions` (sources: app, scripts)
- `pl_manual_actuals` (sources: app)
- `pl_targets` (sources: app)
- `private_booking_documents` (sources: app)
- `private_booking_items` (sources: app, scripts)
- `private_booking_sms_queue` (sources: app)
- `private_bookings` (sources: app, scripts)
- `profiles` (sources: app)
- `quotes` (sources: app, scripts)
- `rate_limits` (sources: app)
- `receipt_batches` (sources: app)
- `receipt_files` (sources: app)
- `receipt_rules` (sources: app)
- `receipt_transactions` (sources: app)
- `recurring_invoices` (sources: app, scripts)
- `role_permissions` (sources: app, scripts)
- `roles` (sources: app)
- `service_slots` (sources: scripts)
- `service_status_overrides` (sources: app)
- `service_statuses` (sources: app)
- `short_link_clicks` (sources: scripts)
- `short_links` (sources: app, scripts)
- `special_hours` (sources: app, scripts)
- `sunday_lunch_menu_items` (sources: scripts)
- `table_booking_items` (sources: app, scripts)
- `table_booking_modifications` (sources: app, scripts)
- `table_booking_payments` (sources: app, scripts)
- `table_booking_sms_templates` (sources: app, scripts)
- `table_bookings` (sources: app, scripts)
- `table_combinations` (sources: app)
- `table_configuration` (sources: app)
- `vendors` (sources: app)
- `venue_spaces` (sources: app, scripts)
- `webhook_logs` (sources: app, scripts)

## Tables with Zero References
- `customer_achievements`
- `invoice_audit`
- `invoice_email_templates`
- `invoice_emails`
- `loyalty_bulk_notifications`
- `loyalty_otp_verifications`
- `loyalty_portal_sessions`
- `phone_standardization_issues`
- `reward_redemptions`
- `service_slot_overrides`
- `table_booking_reminder_history`
- `webhook_deliveries`

## Candidate Unused Columns (No Wildcard Usage)
### `achievement_progress`
- Unused columns: achievement_id, created_at, id, member_id, progress, target_value

### `ai_usage_events`
- Unused columns: context, id, occurred_at

### `booking_audit`
- Unused columns: created_at, created_by, id, old_status

### `customer_achievements`
- Unused columns: achievement_id, created_at, earned_date, id, member_id, points_awarded

### `customer_challenges`
- Unused columns: challenge_id, created_at, id, last_completed_at, member_id, progress

### `event_check_ins`
- Unused columns: achievements_earned, created_at

### `event_checklist_statuses`
- Unused columns: created_at, id

### `idempotency_keys`
- Unused columns: created_at

### `invoice_audit`
- Unused columns: action, created_at, details, id, invoice_id, ip_address, new_values, old_values, performed_by, performed_by_email, user_agent

### `invoice_email_templates`
- Unused columns: body_template, created_at, description, id, is_active, subject_template, template_type, updated_at

### `invoice_emails`
- Unused columns: attachments, bcc_emails, body, cc_emails, created_at, created_by, email_type, error_message, id, invoice_id, message_id, recipient_email, sent_at, status, subject

### `invoice_reminder_settings`
- Unused columns: created_at, days_after_due, days_before_due, enabled, id, reminder_email, reminder_time, updated_at

### `loyalty_achievements`
- Unused columns: active, category, created_at, criteria, description, icon, name, points_value, program_id, sort_order

### `loyalty_bulk_notifications`
- Unused columns: completed_at, created_at, created_by, failed_count, filter_criteria, id, job_id, message, notification_type, recipient_count, scheduled_for, sent_count, status

### `loyalty_campaigns`
- Unused columns: created_at, criteria, description, id, name, program_id

### `loyalty_challenges`
- Unused columns: active, category, created_at, criteria, description, end_date, icon, max_completions, name, points_value, program_id

### `loyalty_otp_verifications`
- Unused columns: attempts, created_at, customer_id, expires_at, id, member_id, otp_code, phone_number, verified, verified_at

### `loyalty_point_transactions`
- Unused columns: achievement, challenge, created_at, etc, id, negative, redemption

### `loyalty_portal_sessions`
- Unused columns: active, created_at, customer_id, ended_at, expires_at, id, last_activity_at, member_id, session_token

### `loyalty_rewards`
- Unused columns: created_at, daily_limit, inventory, tier_required

### `menu_categories`
- Unused columns: created_at

### `menu_category_menus`
- Unused columns: id

### `menu_dish_ingredients`
- Unused columns: created_at

### `menu_dish_menu_assignments`
- Unused columns: created_at

### `menu_dish_recipes`
- Unused columns: created_at

### `menu_items`
- Unused columns: allergens, available_from, available_until, calories, created_at, description, dietary_info, id, is_available, is_special, name, price, section_id, sort_order, updated_at

### `menu_recipe_ingredients`
- Unused columns: created_at

### `menu_sections`
- Unused columns: created_at, description, is_active, name, sort_order, updated_at

### `message_delivery_status`
- Unused columns: error_code, error_message, id, raw_webhook_data

### `message_template_history`
- Unused columns: change_reason, created_at, id

### `phone_standardization_issues`
- Unused columns: created_at, id, original_phone, record_id, table_name

### `receipt_transaction_logs`
- Unused columns: id

### `reminder_processing_logs`
- Unused columns: created_at, id

### `reward_redemptions`
- Unused columns: code, created_at, expires_at, fulfilled_at, fulfilled_by, generated_at, id, member_id, metadata, notes, points_spent, redeemed_at, redeemed_by, redemption_code, reward_id, status

### `service_slot_config`
- Unused columns: created_at, id

### `service_slot_overrides`
- Unused columns: created_at, custom_capacity, custom_hours, id, is_closed, override_date, reason, updated_at

### `sites`
- Unused columns: created_at

### `system_settings`
- Unused columns: created_at

### `table_booking_reminder_history`
- Unused columns: booking_id, created_at, id, metadata, reminder_type, status

### `table_combination_tables`
- Unused columns: created_at, id

### `tables`
- Unused columns: is_active

### `webhook_deliveries`
- Unused columns: attempt_count, created_at, delivered_at, event_type, id, payload, response_body, response_status, webhook_id

### `webhooks`
- Unused columns: created_at, events, failure_count, is_active, last_triggered_at, secret, updated_at, url

## Candidate Unused Columns (Wildcard Usage Present)
### `api_keys`
- Wildcard sources: app, scripts
- Unused columns (static scan): expires_at

### `api_usage`
- Wildcard sources: app
- Unused columns (static scan): id

### `attachment_categories`
- Wildcard sources: app
- Unused columns (static scan): created_at, updated_at

### `background_jobs`
- Wildcard sources: scripts
- Unused columns (static scan): completed_at, error, max_attempts, processed_at, result

### `booking_policies`
- Wildcard sources: app
- Unused columns (static scan): cancellation_fee, id, max_party_size, modification_allowed

### `booking_time_slots`
- Wildcard sources: app
- Unused columns (static scan): created_at, duration_minutes, id

### `bookings`
- Wildcard sources: app, scripts
- Unused columns (static scan): qr_expires_at, qr_token

### `business_amenities`
- Wildcard sources: app
- Unused columns (static scan): additional_info, available, capacity, created_at, details, id, updated_at

### `business_hours`
- Wildcard sources: app, scripts
- Unused columns (static scan): closes, created_at, id, opens, updated_at

### `cashup_sessions`
- Wildcard sources: app
- Unused columns (static scan): created_at

### `cashup_targets`
- Wildcard sources: app
- Unused columns (static scan): created_at, etc, id

### `catering_packages`
- Wildcard sources: app
- Unused columns (static scan): created_at, dietary_notes, maximum_guests, updated_at

### `customer_category_stats`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at, updated_at

### `customer_label_assignments`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at

### `customer_labels`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at, updated_at

### `employee_emergency_contacts`
- Wildcard sources: app
- Unused columns (static scan): address, id, name, phone_number, relationship

### `employee_financial_details`
- Wildcard sources: app, scripts
- Unused columns (static scan): updated_at

### `employee_health_records`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at, updated_at

### `employee_notes`
- Wildcard sources: app
- Unused columns (static scan): created_by_user_id, note_id, note_text

### `employees`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at

### `event_faqs`
- Wildcard sources: app
- Unused columns (static scan): created_at, updated_at

### `event_images`
- Wildcard sources: app
- Unused columns (static scan): created_at

### `event_message_templates`
- Wildcard sources: app
- Unused columns (static scan): character_count, created_at, estimated_segments

### `invoice_email_logs`
- Wildcard sources: app
- Unused columns (static scan): error_message, message_id, quote_id, sent_at

### `invoice_line_items`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at, discount_amount, id, subtotal_amount, total_amount, vat_amount

### `invoice_payments`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at

### `invoice_series`
- Wildcard sources: scripts
- Unused columns (static scan): created_at

### `invoice_vendors`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at, notes, updated_at

### `job_queue`
- Wildcard sources: scripts
- Unused columns (static scan): completed_at, created_by, error, payload, result

### `loyalty_members`
- Wildcard sources: scripts
- Unused columns (static scan): last_reward_notification, last_visit_date, notification_preferences, welcome_sent

### `loyalty_notifications`
- Wildcard sources: scripts
- Unused columns (static scan): channel, content, delivered, error_message, failed, id, job_id, member_id, metadata, notification_type

### `loyalty_tiers`
- Wildcard sources: scripts
- Unused columns (static scan): created_at

### `menu_dishes`
- Wildcard sources: app
- Unused columns (static scan): created_at

### `menu_ingredients`
- Wildcard sources: app
- Unused columns (static scan): created_at

### `message_templates`
- Wildcard sources: app, scripts
- Unused columns (static scan): character_count, created_by, estimated_segments

### `messages`
- Wildcard sources: app, scripts
- Unused columns (static scan): price_unit, updated_at

### `parking_booking_notifications`
- Wildcard sources: app
- Unused columns (static scan): email_message_id, error, retries, sent_at, status

### `parking_booking_payments`
- Wildcard sources: app, scripts
- Unused columns (static scan): amount, expires_at

### `parking_bookings`
- Wildcard sources: app, scripts
- Unused columns (static scan): calculated_price, cancelled_at, completed_at, customer_email, duration_minutes, expires_at, pricing_breakdown, updated_by

### `parking_rates`
- Wildcard sources: app
- Unused columns (static scan): created_at, id

### `pending_bookings`
- Wildcard sources: app, scripts
- Unused columns (static scan): seats

### `pl_manual_actuals`
- Wildcard sources: app
- Unused columns (static scan): updated_at, value

### `pl_targets`
- Wildcard sources: app
- Unused columns (static scan): target_value, updated_at

### `private_booking_documents`
- Wildcard sources: app
- Unused columns (static scan): document_type, file_name, file_size_bytes, generated_at, generated_by, id, metadata, mime_type, storage_path, version

### `private_booking_items`
- Wildcard sources: app, scripts
- Unused columns (static scan): discount_reason

### `profiles`
- Wildcard sources: app
- Unused columns (static scan): created_at, first_name, last_name

### `quotes`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at

### `receipt_batches`
- Wildcard sources: app
- Unused columns (static scan): created_at

### `receipt_files`
- Wildcard sources: app
- Unused columns (static scan): uploaded_at

### `receipt_rules`
- Wildcard sources: app
- Unused columns (static scan): auto_status, description, match_description, match_direction, match_max_amount, match_min_amount, match_transaction_type, set_vendor_name

### `receipt_transactions`
- Wildcard sources: app
- Unused columns (static scan): created_at, expense_rule_id, expense_updated_at, notes, vendor_rule_id, vendor_updated_at

### `recurring_invoices`
- Wildcard sources: app, scripts
- Unused columns (static scan): days_before_due, end_date, frequency, internal_notes, invoice_discount_percentage, notes, reference, start_date, vendor_id

### `roles`
- Wildcard sources: app
- Unused columns (static scan): created_at, updated_at

### `service_slots`
- Wildcard sources: scripts
- Unused columns (static scan): created_at, id

### `service_status_overrides`
- Wildcard sources: app
- Unused columns (static scan): created_at

### `service_statuses`
- Wildcard sources: app
- Unused columns (static scan): metadata, updated_by

### `short_link_clicks`
- Wildcard sources: scripts
- Unused columns (static scan): id, metadata

### `special_hours`
- Wildcard sources: app, scripts
- Unused columns (static scan): closes, created_at, opens, updated_at

### `sunday_lunch_menu_items`
- Wildcard sources: scripts
- Unused columns (static scan): created_at

### `table_booking_items`
- Wildcard sources: app, scripts
- Unused columns (static scan): menu_item_id, otherwise

### `table_booking_modifications`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at, id

### `table_booking_sms_templates`
- Wildcard sources: app, scripts
- Unused columns (static scan): created_at

### `table_bookings`
- Wildcard sources: app, scripts
- Unused columns (static scan): email_verification_token, email_verified_at, internal_notes, modification_count, phone, walk

### `table_combinations`
- Wildcard sources: app
- Unused columns (static scan): created_at

### `table_configuration`
- Wildcard sources: app
- Unused columns (static scan): created_at

### `vendors`
- Wildcard sources: app
- Unused columns (static scan): company_name, contact_phone, created_at, notes, updated_at, website

### `venue_spaces`
- Wildcard sources: app, scripts
- Unused columns (static scan): active, capacity_seated, capacity_standing, created_at, description, minimum_hours, rate_per_hour, setup_fee, updated_at

### `webhook_logs`
- Wildcard sources: app, scripts
- Unused columns (static scan): id

## Columns Used Only by SQL (No App/Scripts/Tests References)
### `achievement_progress`
- Columns: updated_at

### `api_keys`
- Columns: 'create:bookings', 'read:business', 'read:customers', 'read:menu', 'read:table_bookings', 'write:customers'          ), 'write:table_bookings', create:bookings"]'::jsonb, read:business, read:menu

### `audit_logs`
- Columns: error_message, ip_address, new_values, user_agent

### `background_jobs`
- Columns: duration_ms, priority, scheduled_for

### `booking_policies`
- Columns: full_refund_hours, min_advance_hours, partial_refund_hours, partial_refund_percentage, updated_at

### `booking_reminders`
- Columns: ''), created_at

### `booking_time_slots`
- Columns: updated_at

### `bookings`
- Columns: 0)

### `business_hours`
- Columns: booking_type": "sunday_lunch, capacity": 50, ends_at": "17:00:00, schedule_config, slot_type": "sunday_lunch"
    }
  ]'::jsonb

### `cashup_sessions`
- Columns: click_date, countries

### `catering_packages`
- Columns: active, category, chicken and vegetarian burgers, cost_per_head, description, house wine or bottled beer.\nServed: On arrival.\nGood to know: Non-alcoholic alternatives available on request (minimum 10 guests).', ideal for sunny days.\nIncludes: 1 jar of Pimm’s.\nServed: Ready to share.\nGood to know: Priced per jar.', kid-sized pizza meal that always goes down well.\nIncludes: Mini pizza and chips.\nServed: Plated per child.\nGood to know: Great for parties and family events.', minimum_guests, name, perfectly portioned for parties.\nIncludes: Beef burger and chips.\nServed: Plated per child.\nGood to know: Great for children’s parties and family events.', pricing_model, serving_style, toppings and fries.\nServed: Buffet-style.\nGood to know: Dietary requirements can be catered for with advance notice (minimum 10 guests).'

### `cron_job_runs`
- Columns: updated_at

### `customer_category_stats`
- Columns: first_attended_date

### `customer_challenges`
- Columns: updated_at

### `customer_label_assignments`
- Columns: notes

### `customer_labels`
- Columns: auto_apply_rules, description, icon

### `customers`
- Columns: '21217', '21217') THEN 'Invalid phone number'
        WHEN NEW.error_code IN ('21610', '21217') THEN NOW()
        WHEN NEW.error_code IN ('21610', '21217') THEN false
                 WHEN NEW.error_code IN ('21610', '21219', '21408', '21610', '21611', '21612', '21612') AND sms_delivery_failures >, '21614', '21614') THEN 'invalid_number'
                 WHEN consecutive_failures >, '30004', '30005', '30006', '30007', '30008') THEN 'suspended'
                 WHEN consecutive_failures >, 'Unknown error'), cnt, code, config, consecutive_failures, day_of_week, email), last_clicked_at, last_failure_type, last_successful_delivery, last_table_booking_date, short_link_id, sort_order, total_failures_30d

### `employee_financial_details`
- Columns: bank_name, branch_address, ni_number, payee_name

### `employee_health_records`
- Columns: allergies, disability_details, disability_reg_expiry_date, disability_reg_number, doctor_address, doctor_name, has_bowel_problems, has_depressive_illness, has_diabetes, has_ear_problems, has_epilepsy, has_skin_condition, illness_history, is_registered_disabled, recent_treatment

### `employees`
- Columns: '')::boolean ELSE keyholder_status END, '')::date ELSE date_of_birth END, '')::date ELSE employment_end_date END, '')::date ELSE employment_start_date END, '')::date ELSE first_shift_date END, address, email, emergency_contact_name, emergency_contact_phone, employment_end_date, employment_status, first_shift_date, hire_date, keyholder_status, mobile_number, national_insurance_number, phone, phone_number, post_code, uniform_preference, updated_at

### `event_categories`
- Columns: Name That Tune, Play Your Cards Right, and more. Interactive entertainment with prizes and laughs. Wednesdays 7-10pm.', created_at, default_booking_url, default_capacity, default_doors_time, default_duration_minutes, default_end_time, default_last_entry_time, default_reminder_hours, default_start_time, gallery_image_urls, highlight_video_urls, highlights, is_active, is_default, keywords, long_description, meta_description, meta_title, poster_image_url, promo_video_url, short_description, thumbnail_image_url, updated_at

### `event_check_ins`
- Columns: member_id, notes, points_earned, staff_id

### `event_checklist_statuses`
- Columns: updated_at

### `event_message_templates`
- Columns: custom_timing_hours, send_timing, updated_at

### `events`
- Columns: date), doors_time, duration_minutes, employee_id, end_time, event_status), g, gallery_image_urls), highlight_video_urls, highlight_video_urls), highlights, highlights), is_free), keywords, keywords), last_entry_time, meta_description, meta_title, name), price), promo_video_url, slug), time), to_jsonb(gallery_image_urls))::TEXT[], to_jsonb(highlight_video_urls))::TEXT[], to_jsonb(highlights))::TEXT[], to_jsonb(keywords))::TEXT[]

### `invoice_line_items`
- Columns: catalog_item_id, description, discount_percentage, quantity, unit_price, vat_rate

### `invoice_payments`
- Columns: amount, id, invoice_id, notes, payment_date, payment_method, reference

### `invoice_reminder_settings`
- Columns: booking_type, exclude_vendors, is_active, service_date, starts_at

### `invoice_series`
- Columns: current_sequence, series_code

### `invoices`
- Columns: ''), '')
      else existing_invoice.internal_notes
    end, '')
      else existing_invoice.notes
    end, existing_invoice.discount_amount), existing_invoice.due_date), existing_invoice.invoice_date), existing_invoice.invoice_discount_percentage
    ), existing_invoice.subtotal_amount), existing_invoice.total_amount), existing_invoice.vat_amount), existing_invoice.vendor_id), now()), paid_amount

### `job_queue`
- Columns: id, started_at

### `loyalty_achievements`
- Columns: id, updated_at

### `loyalty_campaigns`
- Columns: active, bonus_type, bonus_value, end_date, start_date, updated_at

### `loyalty_challenges`
- Columns: id, updated_at

### `loyalty_members`
- Columns: '{last_sms_sent}', '{}'), access_token, last_activity_date, lifetime_events, metadata, to_jsonb(NEW.sent_at)
    ), updated_at

### `loyalty_point_transactions`
- Columns: created_by

### `loyalty_programs`
- Columns: '{
    "welcome_enabled": true, '{automated_notifications}', '{}'), achievement_enabled": true, challenge_update_enabled": true, min_points_for_notification": 10, points_earned_enabled": true, quiet_hours_end": "09:00"
  }'::jsonb
), quiet_hours_start": "21:00, reward_available_enabled": true, tier_upgrade_enabled": true, updated_at

### `loyalty_rewards`
- Columns: active, category, description, icon, id, metadata, name, points_cost, program_id, updated_at

### `loyalty_tiers`
- Columns: benefits, color, icon, min_events, point_multiplier, sort_order, updated_at

### `menu_categories`
- Columns: sort_order, updated_at

### `menu_category_menus`
- Columns: category_id

### `menu_dish_ingredients`
- Columns: updated_at

### `menu_dish_menu_assignments`
- Columns: id, updated_at

### `menu_dish_recipes`
- Columns: updated_at

### `menu_dishes`
- Columns: '{}'::TEXT[]), 0)::NUMERIC, 4), updated_at

### `menu_ingredients`
- Columns: ingredient_id

### `menu_menus`
- Columns: cost_usd, created_at, customer_id, description, direction, status, tier_id, twilio_status, updated_at

### `menu_recipe_ingredients`
- Columns: updated_at

### `menu_recipes`
- Columns: '{}'::TEXT[]), 0
      )::NUMERIC, 0), 4
    ), end_date, next_invoice_date, reference, role_name, v_total_cost, vendor_id

### `menu_sections`
- Columns: id

### `message_template_history`
- Columns: changed_by, content, template_id

### `message_templates`
- Columns: variables

### `messages`
- Columns: metadata

### `parking_booking_payments`
- Columns: updated_at

### `parking_bookings`
- Columns: balance_due_date, calendar_event_id, capacity_override, capacity_override_reason, contact_email, contact_phone, contract_version, created_at, created_by, customer_full_name, customer_name, customer_requests, deposit_amount, deposit_paid_date, deposit_payment_method, discount_amount, discount_reason, discount_type, end_time, end_time_next_day, event_date, event_type, final_payment_date, final_payment_method, guest_count, internal_notes, notes, override_price, override_reason, setup_date, setup_time, start_time, total_amount, total_price, updated_at, vehicle_colour, vehicle_make, vehicle_model

### `parking_rates`
- Columns: capacity_override, daily_rate, hourly_rate, monthly_rate, notes, weekly_rate

### `pending_bookings`
- Columns: updated_at

### `permissions`
- Columns: created_at, module

### `private_booking_documents`
- Columns: booking_id

### `private_booking_items`
- Columns: item_name, line_total, total_price

### `private_booking_sms_queue`
- Columns: skip_conditions

### `private_bookings`
- Columns: (CURRENT_TIMESTAMP + INTERVAL '14 days')), created_by, customer_full_name, customer_requests, setup_date, setup_time

### `rate_limits`
- Columns: id

### `receipt_batches`
- Columns: id, notes

### `receipt_rules`
- Columns: Promotional & Advertising' THEN 'Marketing/Promotion/Advertising'
  WHEN 'Print / Post & Stationery' THEN 'Print/Post Stationary'
  WHEN 'Travel & Car' THEN 'Travel/Car'
  WHEN 'Cleaning Materials & Waste Disposal' THEN 'Waste Disposal/Cleaning/Hygiene'
  WHEN 'Accountant / Stock taker / Prof fees' THEN 'Accountant/StockTaker/Professional Fees'
  WHEN 'Bank Charges' THEN 'Bank Charges/Credit Card Commission'
  WHEN 'Sundries & Consumables' THEN 'Sundries/Consumables'
  ELSE set_expense_category
END, set_expense_category, updated_at

### `receipt_transactions`
- Columns: Promotional & Advertising' THEN 'Marketing/Promotion/Advertising'
  WHEN 'Print / Post & Stationery' THEN 'Print/Post Stationary'
  WHEN 'Travel & Car' THEN 'Travel/Car'
  WHEN 'Cleaning Materials & Waste Disposal' THEN 'Waste Disposal/Cleaning/Hygiene'
  WHEN 'Accountant / Stock taker / Prof fees' THEN 'Accountant/StockTaker/Professional Fees'
  WHEN 'Bank Charges' THEN 'Bank Charges/Credit Card Commission'
  WHEN 'Sundries & Consumables' THEN 'Sundries/Consumables'
  ELSE expense_category
END, balance, batch_id, dedupe_hash, expense_category_source, updated_at, vendor_source

### `reminder_processing_logs`
- Columns: booking_id, customer_id, error_details, event_id, message, metadata, processing_type, reminder_type, template_type

### `role_permissions`
- Columns: created_at

### `roles`
- Columns: is_system, role_id

### `service_slot_config`
- Columns: booking_type, capacity, day_of_week, ends_at, is_active, slot_type, starts_at, updated_at

### `service_slots`
- Columns: capacity, ends_at

### `short_links`
- Columns: 0) + 1, now())

### `special_hours`
- Columns: schedule_config

### `sunday_lunch_menu_items`
- Columns: allergens, baked until golden and bubbling', description, dietary_info, updated_at

### `system_settings`
- Columns: description, updated_at

### `table_booking_items`
- Columns: updated_at

### `table_booking_payments`
- Columns: updated_at

### `table_booking_sms_templates`
- Columns: 'contact_phone'], 'date', 'deadline', 'deposit_amount', 'outstanding_amount', 'party_size', 'payment_link'], 'reference', 'reference'], 'roast_summary', 'time', 'total_amount', a £{{deposit_amount}} deposit is required for your Sunday Lunch booking {{reference}}. Total: £{{total_amount}}. Pay by {{deadline}}: {{payment_link}}. The Anchor', booking_type, reminder of your Sunday Lunch tomorrow at {{time}} for {{party_size}}. Roasts: {{roast_summary}}. Balance due: £{{outstanding_amount}}. Reference: {{reference}}. The Anchor', updated_at, your Sunday Lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed. £{{deposit_amount}} deposit paid. £{{outstanding_amount}} due on arrival. Reference: {{reference}}. Call {{contact_phone}} for any changes. The Anchor'

### `table_bookings`
- Columns: payment_method, payment_status, updated_at

### `table_combination_tables`
- Columns: combination_id, table_id

### `table_combinations`
- Columns: updated_at

### `table_configuration`
- Columns: is_active, notes, updated_at

### `tables`
- Columns: capacity, created_at, id, notes, table_number, updated_at

### `user_roles`
- Columns: assigned_at, assigned_by

### `vendors`
- Columns: contact_email, contact_name

### `webhook_logs`
- Columns: body, customer_id, error_details, from_number, headers, message_body, message_id, params, to_number

### `webhooks`
- Columns: id

## Columns Used Only by Scripts (No App/SQL/Tests References)
### `audit_logs`
- Columns: details

### `background_jobs`
- Columns: created_at, id, payload->message

### `booking_reminders`
- Columns: booking.event.date, count

### `bookings`
- Columns: events.category_id, events.date, status

### `cashup_cash_counts`
- Columns: id

### `cashup_payment_breakdowns`
- Columns: id

### `cashup_sessions`
- Columns: Variance noted.

### `customer_label_assignments`
- Columns: id

### `customers`
- Columns: phone_number, sms_opt_out

### `employee_financial_details`
- Columns: created_at, id

### `event_categories`
- Columns: image_url

### `events`
- Columns: count, event_category_id, event_date, image_url, image_urls

### `invoices`
- Columns: created_at

### `loyalty_members`
- Columns: created_at, customer_id, join_date, program_id, status

### `loyalty_notifications`
- Columns: created_at

### `loyalty_programs`
- Columns: created_at

### `menu_items`
- Columns: image_url

### `parking_booking_notifications`
- Columns: channel, event_type, id, message_sid, payload

### `parking_bookings`
- Columns: customer_mobile

### `pending_bookings`
- Columns: created_at

### `private_bookings`
- Columns: created_at, guest_badge, venue

### `role_permissions`
- Columns: permissions.module_name

### `short_link_clicks`
- Columns: os

### `short_links`
- Columns: clicked_at

### `sunday_lunch_menu_items`
- Columns: count, id

### `table_booking_items`
- Columns: created_at, id

### `table_bookings`
- Columns: customer_name, customer_phone, date, reference, time

### `tables`
- Columns: table_name, table_schema

### `venue_spaces`
- Columns: is_active, name

### `webhook_logs`
- Columns: created_at
