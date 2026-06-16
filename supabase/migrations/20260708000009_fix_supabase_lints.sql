BEGIN;

-- Keep extension objects out of the exposed public schema.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;
END $$;

-- Pin search_path on functions reported by the Supabase security linter.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'set_receipt_vendors_updated_at',
        'normalize_receipt_vendor_key',
        'menu_resolve_dietary_claims',
        'set_receipt_invoice_matches_updated_at',
        'is_active_event_booking_for_capacity_v01',
        'normalize_event_pricing_v01',
        'import_receipt_batch_transaction',
        'menu_refresh_dish_calculations',
        'recruitment_application_transition_allowed',
        'get_receipt_detail_groups',
        'menu_refresh_recipe_calculations'
      ])
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, extensions, pg_temp',
      r.nspname,
      r.proname,
      r.args
    );
  END LOOP;
END $$;

-- Enable RLS on the communal allocation table and keep direct writes service-only.
DO $$
BEGIN
  IF to_regclass('public.event_communal_seat_allocations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.event_communal_seat_allocations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.event_communal_seat_allocations FROM PUBLIC, anon';
    EXECUTE 'GRANT SELECT ON TABLE public.event_communal_seat_allocations TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.event_communal_seat_allocations TO service_role';

    EXECUTE 'DROP POLICY IF EXISTS "event_communal_seat_allocations_authenticated_select" ON public.event_communal_seat_allocations';
    EXECUTE 'CREATE POLICY "event_communal_seat_allocations_authenticated_select" ON public.event_communal_seat_allocations FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)';

    EXECUTE 'DROP POLICY IF EXISTS "service_role_manage_event_communal_seat_allocations" ON public.event_communal_seat_allocations';
    EXECUTE 'CREATE POLICY "service_role_manage_event_communal_seat_allocations" ON public.event_communal_seat_allocations FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- Add service-role policies to internal RLS tables that intentionally have no anon/auth policies.
DO $$
DECLARE
  table_name text;
  policy_name text;
  internal_tables text[] := ARRAY[
    'api_usage',
    'promo_sequence',
    'rate_limits',
    'short_link_aliases',
    'sms_promo_context',
    'webhook_deliveries',
    'webhooks'
  ];
BEGIN
  FOREACH table_name IN ARRAY internal_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      policy_name := 'service_role_manage_' || table_name;

      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        policy_name,
        table_name
      );
    END IF;
  END LOOP;
END $$;

-- Replace unrestricted authenticated/public policies with an explicit signed-in check.
DO $$
DECLARE
  r record;
  sql text;
  linted_tables text[] := ARRAY[
    'analytics_events',
    'booking_holds',
    'booking_table_assignments',
    'cashup_target_overrides',
    'cashup_targets',
    'charge_requests',
    'credit_notes',
    'customer_scores',
    'department_budgets',
    'departments',
    'employee_attachments',
    'employee_emergency_contacts',
    'employee_financial_details',
    'employee_health_records',
    'employee_notes',
    'employee_pay_settings',
    'employee_rate_overrides',
    'employees',
    'event_interest_manual_recipients',
    'feedback',
    'guest_tokens',
    'leave_days',
    'leave_requests',
    'message_delivery_status',
    'message_template_history',
    'messages',
    'pay_age_bands',
    'pay_band_rates',
    'payments',
    'payroll_month_approvals',
    'payroll_periods',
    'private_booking_sms_queue',
    'reconciliation_notes',
    'rota_email_log',
    'rota_google_calendar_events',
    'rota_open_shift_requests',
    'rota_shift_templates',
    'rota_shifts',
    'rota_weeks',
    'short_link_clicks',
    'table_areas',
    'table_booking_reminder_history',
    'table_join_group_members',
    'table_join_groups',
    'table_join_links',
    'timeclock_sessions',
    'venue_space_table_areas',
    'waitlist_entries',
    'waitlist_offers',
    'webhook_logs'
  ];
BEGIN
  FOR r IN
    SELECT *
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (linted_tables)
      AND roles && ARRAY['authenticated'::name, 'public'::name]
      AND (
        COALESCE(btrim(qual), '') IN ('true', '(true)')
        OR COALESCE(btrim(with_check), '') IN ('true', '(true)')
      )
  LOOP
    sql := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);

    IF COALESCE(btrim(r.qual), '') IN ('true', '(true)') THEN
      sql := sql || ' USING (auth.uid() IS NOT NULL)';
    END IF;

    IF COALESCE(btrim(r.with_check), '') IN ('true', '(true)') THEN
      sql := sql || ' WITH CHECK (auth.uid() IS NOT NULL)';
    END IF;

    EXECUTE sql;
  END LOOP;
END $$;

-- Public buckets do not need broad SELECT policies for public object URLs.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Public read access for event images" ON storage.objects';
  END IF;
END $$;

COMMIT;
