-- Remove the last direct write path to short_links for signed-in users.
--
-- Every short-link mutation in the app goes through a server action that calls
-- checkUserPermission('short_links', 'manage'). The table grant was a way round
-- that check: `authenticated` held UPDATE, and the "Users can update own short
-- links" policy admits `created_by = auth.uid() OR created_by IS NULL`. The
-- NULL arm covers 97.5% of the table (2303 of 2362 rows), because links minted
-- by crons and services through the admin client never set created_by.
--
-- So any signed-in staff member could PATCH /rest/v1/short_links with the anon
-- key and their own session and repoint almost any link, with no permission
-- check and no audit log. A repointed link keeps the l.the-anchor.pub and
-- vip-club.uk branding, which is what makes it worth closing.
--
-- The grant was load-bearing until now: ShortLinkService.createUtmVariant
-- stamped parent_link_id, name and created_by on a new variant with the cookie
-- client. That write was moved to the admin client, matching every other write
-- in the service, and the change is deployed to production (commit 8cfb1271,
-- confirmed live via /api/app-version) before this migration runs. An audit of
-- every `.from('short_links')` write site confirms none now uses the cookie
-- client.
--
-- DELETE was already revoked by 20260814100000. After this, `authenticated`
-- holds SELECT only, and short_links is writable solely by service_role.
--
-- The "Users can update own short links" and "Users can delete own short
-- links" policies are left in place. Both are now unreachable, and leaving
-- them means a future re-grant lands on a restrictive policy rather than on
-- no policy at all.

BEGIN;

REVOKE UPDATE ON TABLE public.short_links FROM authenticated;

COMMIT;
