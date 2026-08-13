-- B2B marketing email: RBAC.
--
-- Apply this AFTER the code deploy. A grant that lands first puts a Marketing item in the
-- sidebar pointing at a route that does not exist yet.
--
-- The split matters: editing a draft and authorising a send to the whole list are different
-- risks, so 'send' is its own action and managers do not get it. messages.send_marketing
-- stays what it already is (bulk SMS) and is deliberately not reused here.

BEGIN;

DO $$
DECLARE
  v_actions text[] := ARRAY['view', 'create', 'edit', 'delete', 'send', 'export', 'manage'];
  v_action text;
  v_description text;
BEGIN
  FOREACH v_action IN ARRAY v_actions LOOP
    v_description := CASE v_action
      WHEN 'view' THEN 'View marketing contacts, campaigns and results'
      WHEN 'create' THEN 'Create marketing contacts and campaigns, and import contact lists'
      WHEN 'edit' THEN 'Edit marketing contacts and draft campaigns, and set contact eligibility'
      WHEN 'delete' THEN 'Delete marketing contacts and draft campaigns'
      WHEN 'send' THEN 'Schedule, send, resume and retry marketing campaigns, including test sends'
      WHEN 'export' THEN 'Export marketing contacts and campaign recipient lists'
      WHEN 'manage' THEN 'Change marketing settings, including the global send switch'
    END;

    IF NOT EXISTS (
      SELECT 1 FROM public.permissions WHERE module_name = 'marketing' AND action = v_action
    ) THEN
      INSERT INTO public.permissions (module_name, action, description)
      VALUES ('marketing', v_action, v_description);
    END IF;
  END LOOP;
END $$;

-- super_admin: everything.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin'
  AND p.module_name = 'marketing'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- manager: prepare campaigns and manage the list, but not authorise a send, delete records,
-- or flip the global switch.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'manager'
  AND p.module_name = 'marketing'
  AND p.action IN ('view', 'create', 'edit', 'export')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

COMMIT;
