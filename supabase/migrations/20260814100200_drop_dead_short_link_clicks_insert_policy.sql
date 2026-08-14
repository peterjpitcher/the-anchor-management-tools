-- Drop the dead "Anyone can track clicks" INSERT policy on short_link_clicks.
--
-- The name has always been wrong. Its WITH CHECK was `auth.uid() IS NOT NULL`,
-- so anonymous callers could never insert through it, which is the opposite of
-- what the name says. It cost us time during a security review: the policy name
-- was read as an open door and the actual open door (anon EXECUTE on the
-- SECURITY DEFINER analytics functions, fixed in 20260814100100) was missed.
--
-- As of 20260814100000 neither anon nor authenticated holds INSERT on the
-- table, so no role can reach this policy at all. Clicks are written by the
-- redirect handler at src/app/api/redirect/[code]/route.ts using the
-- service-role admin client, which bypasses RLS and does not consult policies.
--
-- Dropping it leaves short_link_clicks with exactly one policy: the SELECT
-- policy the analytics UI relies on. Nothing else changes.

BEGIN;

DROP POLICY IF EXISTS "Anyone can track clicks" ON public.short_link_clicks;

COMMIT;
