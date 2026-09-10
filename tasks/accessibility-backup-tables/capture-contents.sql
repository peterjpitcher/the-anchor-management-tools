-- Capture the contents of the two accessibility backup tables before dropping
-- them. Read only. This capture IS the rollback: run it, store the output, and
-- only then apply
-- supabase/migrations/20260910133000_drop_accessibility_backup_tables.sql.
--
-- Run against production (project ref tfcasgxopxegwrabvwat) through the
-- Supabase MCP execute_sql tool. Save the output of each query into
-- tasks/accessibility-backup-tables/captured-2026MMDD/ and commit it, alongside
-- the column listing from preflight.sql query 4. Both tables are expected to be
-- small page copy, so committing the JSON is reasonable; if either turns out to
-- hold personal data, store it outside the repository instead and note where in
-- the packet.

-- 1. Every row of the copy table, as JSON.
select coalesce(jsonb_pretty(jsonb_agg(t order by t::text)), '[]')
from public.backup_accessibility_copy_20260906 t;

-- 2. Every row of the FAQ table, as JSON.
select coalesce(jsonb_pretty(jsonb_agg(t order by t::text)), '[]')
from public.backup_accessibility_faq_20260906 t;

-- 3. A CREATE TABLE shape for each, so a restore does not have to be guessed
--    from the JSON. Paste the result into the captured folder as schema.sql.
select 'create table public.' || c.relname || ' (' || string_agg(
         quote_ident(a.attname) || ' ' ||
         format_type(a.atttypid, a.atttypmod) ||
         case when a.attnotnull then ' not null' else '' end ||
         coalesce(' default ' || pg_get_expr(ad.adbin, ad.adrelid), ''),
         ', ' order by a.attnum
       ) || ');' as create_statement
from pg_class c
join pg_namespace n  on n.oid = c.relnamespace
join pg_attribute a  on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
where n.nspname = 'public'
  and c.relname in ('backup_accessibility_copy_20260906',
                    'backup_accessibility_faq_20260906')
group by c.relname
order by c.relname;

-- 4. Indexes and constraints, for completeness of the restore shape.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('backup_accessibility_copy_20260906',
                    'backup_accessibility_faq_20260906')
order by tablename, indexname;
