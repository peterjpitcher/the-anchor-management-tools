-- Grant checklists:view to the foh_staff role (the FOH iPad).
-- MUST ship in the same deploy as the FOH_MODULES widening in src/lib/foh/user-mode.ts:
-- widening FOH_MODULES lets a table_bookings + checklists user stay chromeless (FOH-only),
-- and this grant is what gives the single foh_staff user the checklists:view it needs to
-- open the /checklists screen from the FOH button. Applying one without the other either
-- hides the screen (grant missing) or un-kiosks the iPad (widening missing).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'foh_staff'
  AND p.module_name = 'checklists'
  AND p.action = 'view'
ON CONFLICT DO NOTHING;
