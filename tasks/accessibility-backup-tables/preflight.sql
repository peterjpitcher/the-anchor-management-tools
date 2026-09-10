-- Preflight for dropping the accessibility backup tables. Read only.
--
-- The session that drafted the migration had no database access, so every
-- database-side claim in the approval packet is still unconfirmed. Run these
-- ten queries against production (project ref tfcasgxopxegwrabvwat) through
-- the Supabase MCP execute_sql tool and paste the results into the packet
-- before asking for approval. Nothing here writes.

-- 1. The tables exist, and RLS really is off.
--    Expect relrowsecurity = false and relforcerowsecurity = false for both.
select c.relname,
       c.relrowsecurity,
       c.relforcerowsecurity,
       c.reltuples::bigint as estimated_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
       obj_description(c.oid, 'pg_class') as table_comment
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('backup_accessibility_copy_20260906',
                    'backup_accessibility_faq_20260906')
order by c.relname;

-- 2. Who holds what. Expect authenticated with SELECT, INSERT, UPDATE, DELETE
--    and no row at all for anon. The table owner (postgres or supabase_admin)
--    also appears with the full set; that is ordinary ownership, not the
--    finding.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('backup_accessibility_copy_20260906',
                     'backup_accessibility_faq_20260906')
order by table_name, grantee, privilege_type;

-- 3. Policies. Expect none, since RLS is off.
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('backup_accessibility_copy_20260906',
                    'backup_accessibility_faq_20260906')
order by tablename, policyname;

-- 4. Columns, so the capture and any restore have a shape to match.
select table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('backup_accessibility_copy_20260906',
                     'backup_accessibility_faq_20260906')
order by table_name, ordinal_position;

-- 5. Exact row counts. The estimate in query 1 is not good enough for a record
--    of what was destroyed.
select 'backup_accessibility_copy_20260906' as table_name, count(*) as exact_rows
from public.backup_accessibility_copy_20260906
union all
select 'backup_accessibility_faq_20260906', count(*)
from public.backup_accessibility_faq_20260906;

-- 6. Every catalogue dependency on either table, described in plain text.
--    Rows with deptype 'n' from an object that is NOT one of these two tables
--    are what would block the drop. Expect only the tables' own internals:
--    their columns, toast tables, indexes and default expressions, plus the
--    'public' schema itself. A view, a materialised view, a foreign key or a
--    function signature in this list stops the drop: investigate before going
--    further, and do not reach for CASCADE.
select pg_describe_object(d.classid, d.objid, d.objsubid)          as dependent_object,
       pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) as depends_on,
       d.deptype
from pg_depend d
where d.refobjid in (
        'public.backup_accessibility_copy_20260906'::regclass,
        'public.backup_accessibility_faq_20260906'::regclass)
order by 1, 2;

-- 7. The sharper view check: any view or materialised view whose rewrite rule
--    reads either table. Expect zero rows.
select distinct
       dependent_ns.nspname as view_schema,
       dependent.relname    as view_name,
       dependent.relkind    as kind,
       source.relname       as reads_table
from pg_depend d
join pg_rewrite r          on r.oid = d.objid
join pg_class dependent    on dependent.oid = r.ev_class
join pg_namespace dependent_ns on dependent_ns.oid = dependent.relnamespace
join pg_class source       on source.oid = d.refobjid
join pg_namespace n        on n.oid = source.relnamespace
where n.nspname = 'public'
  and source.relname in ('backup_accessibility_copy_20260906',
                         'backup_accessibility_faq_20260906')
  and dependent.oid <> source.oid
order by 1, 2;

-- 8. Any function or procedure whose body names either table. Expect none.
--    This query is load-bearing, not belt and braces. A classic SQL or PL/pgSQL
--    function with a quoted string body creates NO catalogue dependency, so
--    queries 6 and 7 will not see it and DROP TABLE will not refuse. The table
--    goes, and the function breaks at its next call. Verified on PostgreSQL 16:
--    a function selecting from one of these tables let the drop succeed. If this
--    query returns anything, stop, whatever queries 6 and 7 say.
select n.nspname as schema, p.proname, p.prokind
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosrc ilike '%backup_accessibility%'
order by n.nspname, p.proname;

-- 9. Any view definition, in any schema, that names either table by text.
--    Belt and braces alongside query 7, and it catches a view that names them
--    only inside a string or a comment. Expect none.
select schemaname, viewname
from pg_views
where definition ilike '%backup_accessibility%'
union all
select schemaname, matviewname
from pg_matviews
where definition ilike '%backup_accessibility%'
order by 1, 2;

-- 10. Any trigger on either table. Expect none.
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('backup_accessibility_copy_20260906',
                             'backup_accessibility_faq_20260906');
