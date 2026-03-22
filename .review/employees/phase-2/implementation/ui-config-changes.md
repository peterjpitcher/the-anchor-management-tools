# UI + Config Changes Log

## Fix 1 — DEF-012: ReviewStep copy

- File: `src/app/(employee-onboarding)/onboarding/[token]/steps/ReviewStep.tsx`
- Lines modified: 74
- Old text: `Please complete all sections before submitting. Personal details and emergency contacts are required.`
- New text: `Please complete all sections before submitting. Personal details (first and last name) must be completed before submitting.`

The warning message shown when not all sections are complete previously claimed emergency contacts were required server-side, which was false. The server-side `submitOnboardingProfile` only validates `first_name` and `last_name`. The copy now accurately reflects the actual server-side requirement.

---

## Fix 2 — DEF-017: Hardcoded env values

- Files modified:
  - `src/lib/email/employee-invite-emails.ts`
  - `src/app/actions/employeeActions.ts`

- Changes:
  - `employee-invite-emails.ts` line 3: `MANAGER_EMAIL` changed from `'manager@the-anchor.pub'` (hardcoded string literal) to `process.env.MANAGER_EMAIL || 'manager@the-anchor.pub'`
  - `employeeActions.ts` line 43: `EMPLOYEE_DOCUMENT_EMAIL_COMPANY` changed from `'Orange Jelly Limited'` to `process.env.COMPANY_LEGAL_NAME || 'Orange Jelly Limited'`
  - `employeeActions.ts` line 44: `EMPLOYEE_DOCUMENT_EMAIL_SENDER` changed from `'Peter Pitcher'` to `process.env.DOCUMENT_EMAIL_SENDER || 'Peter Pitcher'`

Existing behaviour is fully preserved via fallback defaults. No env vars added to config files.

---

## Fix 3 — DEF-018: Dead Google Calendar import

- Finding: unused
- Action taken: Removed the import line from `src/app/actions/employee-birthdays.ts`

Verified by reading the entire file (371 lines). Neither `syncBirthdayCalendarEvent` nor `deleteBirthdayCalendarEvent` appears anywhere in the file body — only in the now-removed import statement on line 10. The import was removed cleanly; no other changes were made.

---

## New Issues Discovered

- `employee-birthdays.ts` line 109 also contains a hardcoded `'manager@the-anchor.pub'` string (the birthday reminder cron sends to this address directly, outside the `MANAGER_EMAIL` constant defined in `employee-invite-emails.ts`). This was not in scope for DEF-017 but is the same class of issue. Flagging for a follow-up fix.
