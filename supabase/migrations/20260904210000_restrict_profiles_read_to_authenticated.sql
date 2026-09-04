-- Restrict public.profiles reads to signed-in users.
--
-- NOT YET APPLIED. Drafted 4 September 2026, awaiting the owner's approval
-- before `supabase db push`.
--
-- Why: the policy "Allow public read access to profiles" grants SELECT where
-- auth.role() = 'authenticated' OR auth.role() = 'anon'. The anon branch means
-- anyone holding the publishable key, which ships in the browser bundle of a
-- public website, can read all 23 rows of public.profiles, including full_name,
-- first_name, last_name and email. That is staff personal data.
--
-- Verified before writing this migration:
--   - anon has SELECT on public.profiles, confirmed against production.
--   - Every application read of profiles goes through a service-role or
--     signed-in server client: rota, payroll, profile actions, employee invite,
--     the starter-pack route, receipt mutations, the employees service and the
--     GDPR service. None uses the browser client.
--   - The paired website repository (OJ-The-Anchor.pub) does not reference
--     profiles at all.
-- So no known caller depends on the anon branch.
--
-- Rollback: recreate the old policy with the anon branch restored.
--   DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.profiles;
--   CREATE POLICY "Allow public read access to profiles" ON public.profiles
--     FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

BEGIN;

DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;

CREATE POLICY "Authenticated users can read profiles"
  ON public.profiles
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Table-level SELECT is what makes the policy reachable at all. The anon role
-- has no legitimate read here, so remove the grant as well as the policy branch.
REVOKE SELECT ON public.profiles FROM anon;

COMMIT;
