-- Close anonymous access to the short-link SECURITY DEFINER functions.
--
-- Tightening the table grants (20260814100000) does not close this door.
-- These functions are SECURITY DEFINER, so they run with the owner's rights
-- and bypass RLS entirely. New functions in public get EXECUTE granted to
-- PUBLIC by default in this project, which is how each of these ended up
-- reachable by the anon role. 20260811100100 closed a batch of these but
-- missed the short-link analytics functions.
--
-- Revoking from `anon` alone does nothing, because the privilege is inherited
-- from the PUBLIC grant. This follows the pattern set by 20260811100100:
-- revoke from public and anon, then grant back only to the roles the app uses.
--
-- Confirmed exploitable before writing this migration: an unauthenticated
-- POST to /rest/v1/rpc/get_all_links_analytics carrying only the public anon
-- key (which ships in the browser bundle) returned 200 with every short code,
-- destination URL, click count and unique-visitor count on the estate.
--
-- Call sites checked, so nothing the application does is withdrawn:
--   * get_short_link_analytics / get_all_links_analytics /
--     get_all_links_analytics_v2 - called from src/services/short-links.ts
--     with the cookie-based client, so `authenticated` keeps EXECUTE.
--   * increment_short_link_clicks - one caller only, the public redirect
--     handler at src/app/api/redirect/[code]/route.ts:502, which uses the
--     service-role admin client. Neither anon nor authenticated needs it,
--     and leaving anon with EXECUTE let anyone inflate a link's click
--     counter given only its uuid.
--   * prevent_short_link_alias_code_reuse - a trigger function. Triggers are
--     invoked by the executor, not through the caller's EXECUTE privilege,
--     so revoking these grants does not affect trigger firing.
--
-- create_short_link was already handled by 20260811100100 and is left alone.

BEGIN;

-- ---------------------------------------------------------------------------
-- Estate-wide click analytics: every short code, destination URL, click count
-- and unique-visitor count. Staff read this on /short-links/insights.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_all_links_analytics(integer)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_all_links_analytics(integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_all_links_analytics_v2(
  timestamp with time zone, timestamp with time zone, text, boolean, text
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_all_links_analytics_v2(
  timestamp with time zone, timestamp with time zone, text, boolean, text
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Per-link analytics, read by the short-link detail view.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_short_link_analytics(character varying, integer)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_short_link_analytics(character varying, integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Click counter. Service-role only: the redirect handler is the sole caller.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.increment_short_link_clicks(uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_short_link_clicks(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Trigger function. Nothing should be able to call it over REST.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.prevent_short_link_alias_code_reuse()
  FROM public, anon, authenticated;

COMMIT;
