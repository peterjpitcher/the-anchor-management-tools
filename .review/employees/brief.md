# Review Brief — /employees Section

## Target
The employees section of the Anchor Management Tools — a hospitality venue management system for The Anchor pub (Orange Jelly Limited).

## Scope
All files under:
- `src/app/(authenticated)/employees/` — staff-facing list, detail, edit, new, birthdays pages
- `src/app/(employee-onboarding)/` — token-based onboarding flow (public, no auth)
- `src/app/actions/employeeActions.ts` — main employee CRUD, documents, right to work, notes, attachments
- `src/app/actions/employeeInvite.ts` — invite lifecycle, onboarding submission, status transitions
- `src/app/actions/employeeDetails.ts` — read queries for detail page
- `src/app/actions/employeeQueries.ts` — list/filter queries
- `src/app/actions/employeeExport.ts` — CSV/JSON export
- `src/app/actions/employee-birthdays.ts` — birthday tracking
- `src/app/actions/employee-history.ts` — history log
- `src/app/api/employees/[employee_id]/employment-contract/route.ts` — contract generation/email
- `src/app/api/employees/[employee_id]/starter-pack/route.ts` — starter pack generation/email
- `src/app/api/cron/employee-invite-chase/route.ts` — automated invite chase emails
- `src/components/features/employees/` — all employee UI components
- `src/services/employees.ts` — EmployeeService, schemas, onboarding checklist config
- `src/lib/email/employee-invite-emails.ts` — email templates
- `src/lib/employee-starter-template.ts` — starter pack content
- `src/lib/employeeUtils.ts` — shared utilities

## Known Business Rules
- Employee statuses: Onboarding → Active → Started Separation → Former
- Invites are token-based, expire (check expires_at), one-time use (completed_at)
- Onboarding flow: personal → emergency contacts → financial → health → review → submit
- Submit transitions employee from Onboarding to Active
- Revoking access transitions to Former and deletes user_roles and clears shift template assignments
- Right to work: requires document (PDF/JPG/PNG), has expiry dates
- Employment documents sent via Microsoft Graph email
- Invite chase cron auto-sends reminders for incomplete onboarding
- Birthdays tracked and reminder emails sent

## Key External Dependencies
- Supabase Auth (admin client for user creation)
- Microsoft Graph (email)
- Supabase Storage (employee-attachments bucket)
- Google Calendar (birthday sync — noted in services/employees.ts import)

## Multi-Step Operations to Analyse Carefully
1. `inviteEmployee`: RPC → set invited_at → send email → audit log
2. `createEmployeeAccount`: validate token → create auth user → link to employee record
3. `saveOnboardingSection` (emergency_contacts): delete existing contacts → insert primary → insert secondary
4. `submitOnboardingProfile`: validate → update status → mark token → update profiles → send email → audit log
5. `revokeEmployeeAccess`: update status → clear shift templates → delete user_roles → audit log
6. Document send (API routes): generate PDF → send email
7. `sendPortalInvite`: insert token → send email
