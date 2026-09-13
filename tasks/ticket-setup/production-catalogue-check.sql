-- Read-only catalogue audit after both approved migrations.
WITH expected(table_name,column_name,data_type,is_nullable,column_default) AS (VALUES
 ('events','online_discount_ends_at','timestamp with time zone','YES',NULL::text),
 ('events','booking_questions','jsonb','NO','''[]''::jsonb'),
 ('bookings','attendees','jsonb','NO','''[]''::jsonb'),
 ('bookings','ticket_price_locked','boolean','NO','false')
)
SELECT e.*,c.data_type AS actual_type,c.is_nullable AS actual_nullable,c.column_default AS actual_default,
 c.column_name IS NOT NULL AND c.data_type=e.data_type AND c.is_nullable=e.is_nullable AND c.column_default IS NOT DISTINCT FROM e.column_default AS passed
FROM expected e LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name;

WITH expected(signature,security_definer) AS (VALUES
 ('public.sync_booking_default_item_v01(uuid)',true),
 ('public.create_event_booking_v07(uuid,uuid,text,text,integer,jsonb)',true),
 ('public.sync_event_ticket_price_v01()',true),
 ('public.initialise_event_ticket_v01()',true),
 ('public.create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)',true),
 ('public.sync_event_legacy_price_v01()',true),
 ('public.sync_booking_attendee_names_v01()',true),
 ('public.mark_booking_ticket_price_locked_v01()',false),
 ('public.guard_event_last_ticket_v01()',true),
 ('public.guard_booking_attendee_count_v01()',false),
 ('public.create_event_booking_with_attendees_and_requests_v01(uuid,uuid,integer,text,text,integer,jsonb,text,boolean,jsonb,numeric)',false)
)
SELECT e.signature,p.prosecdef,p.proconfig,p.pronargdefaults,
 p.oid IS NOT NULL AND p.prosecdef=e.security_definer
 AND CASE WHEN p.proname='create_event_booking_with_attendees_and_requests_v01'
   THEN p.proconfig=ARRAY['search_path=""']::text[]
   ELSE p.proconfig=ARRAY['search_path=public']::text[] END
 AND has_function_privilege('service_role',p.oid,'EXECUTE')
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS passed,
 pg_get_functiondef(p.oid) AS definition
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature);

WITH expected(table_name,trigger_name,function_name) AS (VALUES
 ('event_ticket_types','sync_event_ticket_price','sync_event_ticket_price_v01'),
 ('events','initialise_event_ticket','initialise_event_ticket_v01'),
 ('events','sync_event_legacy_price','sync_event_legacy_price_v01'),
 ('bookings','sync_booking_attendee_names','sync_booking_attendee_names_v01'),
 ('bookings','mark_booking_ticket_price_locked','mark_booking_ticket_price_locked_v01'),
 ('event_ticket_types','guard_event_last_ticket','guard_event_last_ticket_v01'),
 ('bookings','guard_booking_attendee_count','guard_booking_attendee_count_v01')
)
SELECT e.*,t.tgenabled,pg_get_triggerdef(t.oid) AS definition,
 t.oid IS NOT NULL AND t.tgenabled='O' AND p.proname=e.function_name AS passed
FROM expected e LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.'||e.table_name) AND t.tgname=e.trigger_name
LEFT JOIN pg_proc p ON p.oid=t.tgfoid;

WITH expected(table_name,constraint_name) AS (VALUES
 ('events','events_booking_questions_array'),('bookings','bookings_attendees_array')
)
SELECT e.*,pg_get_constraintdef(c.oid) AS definition,c.oid IS NOT NULL AND c.contype='c' AND c.convalidated AS passed
FROM expected e LEFT JOIN pg_constraint c ON c.conrelid=to_regclass('public.'||e.table_name) AND c.conname=e.constraint_name;

-- Compare hashes with the pre-apply capture; these views must remain unchanged.
SELECT schemaname,viewname,md5(definition) AS definition_hash,definition
FROM pg_views WHERE schemaname='public' AND viewname IN ('customer_communications','recent_reminder_activity','reminder_timing_debug') ORDER BY viewname;
