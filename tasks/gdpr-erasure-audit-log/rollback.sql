-- Rollback for 20261026193741_gdpr_erasure_audit_log.sql: restores prevent_audit_log_update exactly
-- as production held it on 26 October 2026 (md5(prosrc) f6de7f9de4f2184d4cb0f45777356bca, SECURITY
-- INVOKER, search_path public, pg_catalog; CREATE OR REPLACE keeps its grants) and drops the scrub
-- function. Audit rows already scrubbed by an erasure stay scrubbed: that was the point of it.

CREATE OR REPLACE FUNCTION public.prevent_audit_log_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be modified';
END;
$function$;

DROP FUNCTION IF EXISTS public.gdpr_scrub_audit_logs_v01(uuid[], uuid[]);
