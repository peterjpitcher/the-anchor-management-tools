-- Staff training: RBAC (tasks/plan-2026-11-02-staff-training-build.md, section 2.3).
--
-- Apply this AFTER the code deploy. A grant that lands first puts a Training item in front of
-- managers pointing at a route that does not exist yet.
--
--   view     The training log, each person's records and results, reports and the export.
--   manage   Groups, assigning, due dates, waivers, pauses, unlocks, practical sign-offs and
--            external qualifications.
--   publish  Uploading, previewing, publishing and retiring courses, and the training emails and
--            automatic assignment switches.
--
-- view and manage are granted to super_admin and manager; publish to super_admin only (owner
-- decision, 3 November 2026). Every super_admin account holds publish (four on 3 November 2026,
-- and PermissionService allows super_admin before it reads any row), so any of them can publish
-- and change the two switches. Publish also gates adding external qualification types and the
-- course preview, so a manager-role user cannot do either.
-- Explicit rows throughout (the client checks need them even for super_admin). Deliberately NOT
-- granted to staff, foh_staff, portal_shift_manager or Deputy:
-- staff reach their own training through the staff portal, which needs no permission, and a
-- permission here would push portal-only staff into the management app.
--
-- Data only. Safe to run twice: each row is added only if it is missing.

BEGIN;

DO $$
DECLARE
  v_actions text[] := ARRAY['view', 'manage', 'publish'];
  v_action text;
  v_description text;
BEGIN
  FOREACH v_action IN ARRAY v_actions LOOP
    v_description := CASE v_action
      WHEN 'view' THEN 'View the staff training log, records, results and reports'
      WHEN 'manage' THEN 'Manage staff training: groups, assignments, due dates, waivers, pauses, unlocks, practical sign-offs and external qualifications'
      WHEN 'publish' THEN 'Upload, preview, publish and retire training courses, and switch training emails and automatic assignment on or off'
    END;

    IF NOT EXISTS (
      SELECT 1 FROM public.permissions WHERE module_name = 'training' AND action = v_action
    ) THEN
      INSERT INTO public.permissions (module_name, action, description)
      VALUES ('training', v_action, v_description);
    END IF;
  END LOOP;
END $$;

-- super_admin: everything.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin'
  AND p.module_name = 'training'
  AND p.action IN ('view', 'manage', 'publish')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- manager: view and manage, not publish (owner decision, 3 November 2026).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'manager'
  AND p.module_name = 'training'
  AND p.action IN ('view', 'manage')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

COMMIT;
