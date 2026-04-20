-- Drop the original 5-param overload of get_cross_promo_audience.
-- Migration 20260612000000 added a 6-param version (with general_recent pool)
-- but did NOT drop the 5-param, causing PostgREST PGRST203 ambiguity when
-- the caller passes only 2 named params (both signatures match via defaults).
--
-- The 6-param version is the canonical implementation.
-- Caller at src/lib/sms/cross-promo.ts now passes all 6 params explicitly.

DROP FUNCTION IF EXISTS public.get_cross_promo_audience(UUID, UUID, INT, INT, INT);

-- Re-affirm privileges on the remaining 6-param version
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) TO service_role;
