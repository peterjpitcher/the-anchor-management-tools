-- Tighten over-broad table grants on the short-link and analytics tables.
--
-- These tables were created before the project started revoking the Supabase
-- default `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`,
-- so both roles held INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES and
-- TRIGGER at the table level. RLS blocked most of that in practice, but the
-- grants are wrong in principle: they are the only thing standing between a
-- future policy mistake and a destructive write from an anon key.
--
-- This migration leaves RLS policy predicates alone (staff are meant to see
-- click analytics) and only removes privileges that no application code path
-- uses. Verified against the code before writing:
--
--   * short_link_clicks INSERT  - the public redirect handler
--     (src/app/api/redirect/[code]/route.ts) writes clicks with the
--     service-role admin client, which bypasses both RLS and these grants.
--     No anon or authenticated INSERT is needed. The existing INSERT policy
--     is retained but is now unreachable for those roles.
--   * short_link_clicks SELECT  - kept for `authenticated`; the analytics UI
--     reads clicks and the RLS policy already gates it on a signed-in user.
--   * short_links UPDATE        - KEPT for `authenticated`.
--     ShortLinkService.createUtmVariant stamps parent_link_id, name and
--     created_by on a freshly minted variant using the cookie-based client
--     (src/services/short-links.ts). Revoking UPDATE would break UTM
--     variant creation.
--   * short_links INSERT        - creation goes through the SECURITY DEFINER
--     `create_short_link` RPC, or the admin client. Not needed.
--   * short_links DELETE        - ShortLinkService.deleteShortLink uses the
--     admin client. Not needed.
--   * analytics_events          - every writer passes the service-role admin
--     client (recordAnalyticsEvent takes an injected client; the one server
--     action wrapper is typed to ReturnType<typeof createAdminClient>).
--     SELECT and INSERT are left in place so no write path can regress; the
--     destructive privileges go. This table had a permissive FOR ALL policy
--     for `authenticated`, so UPDATE and DELETE were genuinely reachable.
--   * voucher_events            - RLS is on with zero policies and all code
--     uses the admin client, so the grants were already unreachable.
--
-- service_role retains full privileges on every table below, so all
-- admin-client paths are unaffected.

BEGIN;

-- ---------------------------------------------------------------------------
-- short_link_clicks: anon needs nothing at all; authenticated reads only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.short_link_clicks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.short_link_clicks FROM authenticated;

-- ---------------------------------------------------------------------------
-- short_links: anon needs nothing; authenticated reads and updates.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.short_links FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.short_links FROM authenticated;

-- ---------------------------------------------------------------------------
-- analytics_events: anon needs nothing; authenticated keeps SELECT + INSERT
-- so no booking-analytics write path can regress, but loses the destructive
-- privileges that the permissive FOR ALL policy made reachable.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.analytics_events FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.analytics_events FROM authenticated;

-- ---------------------------------------------------------------------------
-- voucher_events: service-role only in code, and RLS has no policies.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.voucher_events FROM anon;
REVOKE ALL ON TABLE public.voucher_events FROM authenticated;

-- ---------------------------------------------------------------------------
-- Drop the duplicate SELECT policy on short_link_clicks.
--
-- "Authenticated users can view clicks" and "View click analytics" are the
-- same predicate, auth.uid() IS NOT NULL, applied to the same command for the
-- same roles. Two permissive SELECT policies are OR'd together, so dropping
-- one changes nothing about who can read. The surviving policy keeps the
-- naming used elsewhere on short_links.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "View click analytics" ON public.short_link_clicks;

COMMIT;
