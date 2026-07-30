# Voucher build - live schema facts (verified 2026-07-30 via prod Supabase)

Project ref: tfcasgxopxegwrabvwat (the-anchor-management-tools, Postgres 15).

## FK targets (verified in information_schema)

- `employees`: PK **`employee_id`**; columns include `first_name`, `last_name`, `status`, `email_address`. No `is_active`; active check is `status = 'Active'` (verify exact casing against data before use).
- `customers`: PK `id`; has `first_name`, `last_name`, `mobile_number`, **`mobile_e164`**, **`sms_opt_in`**, `sms_status`, `email`.
- `events`: PK `id`; has **`name`** (no `title`), `date`, `time`, `event_status`.
- `bookings`: PK `id`; has `event_id`, `customer_id`, **`seats`**, `status` (event bookings; used for the one-tap booker chips; check live status values before filtering).
- `permissions`: `id`, `module_name`, `action`, `description`, `created_at`. `role_permissions`: `role_id`, `permission_id`, `created_at`.
- Roles present: `super_admin`, `manager`, `Deputy`, `staff`, `foh_staff`, `portal_shift_manager`.

## Migration numbering

- Remote history head: **20260801001400** (`add_jacob_williams_receipt_payroll_rule`). NOTE: this file may not exist locally (parallel session); check before `db push` and repair history rather than recreating it.
- New voucher migrations MUST use versions `20260802000001` and `20260802000002`.

## Precedents to mirror

- Table foundation + RLS deny-all + RBAC grants: `supabase/migrations/20260731000000_checklists_foundation.sql` and `20260731000200_checklists_foh_staff_grant.sql` (mirror its role mapping approach, including whether Deputy/portal_shift_manager receive grants).
- Function grants lockdown: `20260801001300_lock_down_new_function_grants.sql` (revoke from PUBLIC, anon AND authenticated by name; grant to service_role).
- Cron London run-key: `src/app/api/cron/private-booking-monitor/route.ts` (`getLondonRunKey`), cron auth via `@/lib/cron-auth` `authorizeCronRequest`.
- FOH API auth: `src/lib/foh/api-auth.ts` (`requireModulePermission('table_bookings', action)` pattern; add a vouchers variant, do not modify the existing one).
- Kiosk gates: `src/app/(authenticated)/AuthenticatedLayout.tsx` (`isFohPath`, line ~39) AND `src/lib/foh/user-mode.ts` - both must change together.
- No `voucher%` tables exist in prod; legacy 2024 `loyalty_*` migrations exist in history but do not collide.
