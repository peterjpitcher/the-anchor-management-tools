# Claude Hand-Off Brief: Full Application Variable & Configuration Audit

**Generated:** 2026-04-10
**Review mode:** Adversarial Challenge (Mode A)
**Overall risk assessment:** HIGH (due to SEC-NEW-1 rota feed token leak)

## DO NOT REWRITE

These areas are sound and must be preserved:

- **All server action permission checks** in `customer-labels.ts`, `event-categories.ts`, `business-hours.ts`, `import-messages.ts` — the `requireXPermission()` pattern is correct and well-implemented
- **Twilio webhook inline Supabase client** (`src/app/api/webhooks/twilio/route.ts:17-41`) — the anon-key client for pre-verification logging is the correct minimum-privilege approach
- **GDPR action auth checks** (`src/app/actions/gdpr.ts`) — the manual `super_admin` role check is adequate for the current placeholder implementation
- **Supabase client architecture** across the entire codebase — server/admin/browser client usage is correct everywhere
- **Server secret isolation** — no secrets leak to client components (except SEC-NEW-1 below)
- **Stat component currency** (`src/components/ui-v2/display/Stat.tsx`) — the `$` formatter is in an unused sub-component; real GBP formatting uses `src/components/ui-v2/utils/format.ts`

## SPEC REVISION REQUIRED

- [ ] **SPEC-1**: Update workspace `CLAUDE.md` (at `../CLAUDE.md:159`) to remove `fromDb<T>()` references. Document that this codebase intentionally uses snake_case in TypeScript matching the database. Remove from `.claude/rules/supabase.md` as well.
- [ ] **SPEC-2**: Update `dateUtils.ts` `formatDate` function locale from `'en-US'` to `'en-GB'` — a UK pub app should not use US date formatting as the canonical format.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1 (HIGH)**: `src/app/(authenticated)/rota/page.tsx` — Stop passing `feedToken` derived from `ROTA_FEED_SECRET`/`SUPABASE_SERVICE_ROLE_KEY` to client component. Replace with per-user scoped feed tokens stored in the database. Update `src/app/api/rota/feed/route.ts` to validate per-user tokens instead of a global bearer token. After fixing, rotate `ROTA_FEED_SECRET` in production.
- [ ] **IMPL-2 (LOW)**: `.env.example` — Rename Google Calendar OAuth vars to match code: `GOOGLE_CALENDAR_CLIENT_ID` → `GOOGLE_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` → `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` → `GOOGLE_REDIRECT_URL`. Add missing vars: `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_IMPERSONATE_EMAIL`, `GOOGLE_CALENDAR_INTERVIEW_ID`, `GOOGLE_CALENDAR_ROTA_ID`.
- [ ] **IMPL-3 (LOW)**: `.env.example` — Remove dead vars: `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `TWILIO_WEBHOOK_AUTH_TOKEN`. Remove or document `SUSPEND_EVENT_SMS` and `SUSPEND_ALL_SMS` (validated in `env.ts` but never consumed — the active system uses `SMS_SAFETY_*` vars).
- [ ] **IMPL-4 (LOW)**: `src/lib/env.ts` — Remove `SUSPEND_EVENT_SMS` and `SUSPEND_ALL_SMS` from the Zod schema if the SMS safety system uses different vars.
- [ ] **IMPL-5 (LOW)**: Delete `src/lib/supabase.ts` — dead legacy file with zero imports.
- [ ] **IMPL-6 (LOW)**: Fix 8 date formatting calls to use `dateUtils` with explicit locale/timezone:
  - `src/components/features/employees/RightToWorkTab.tsx:206,222`
  - `src/components/features/employees/HealthRecordsTab.tsx:45`
  - `src/components/features/messages/MessageThread.tsx:87,132`
  - `src/components/features/employees/OnboardingChecklistTab.tsx:164`
  - `src/app/(authenticated)/messages/bulk/page.tsx:501`
  - `src/app/(authenticated)/menu-management/ingredients/page.tsx:1200`
- [ ] **IMPL-7 (LOW)**: `src/lib/utils.ts:56` — Add `timeZone: 'Europe/London'` to the `formatDate` function to prevent midnight date drift.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASSUMPTION-1**: Is `ROTA_FEED_SECRET` set in production, or does it fall back to `SUPABASE_SERVICE_ROLE_KEY`? → Ask: Check Vercel env vars. If not set, the service role key derivative is exposed to every rota page user.
- [ ] **ASSUMPTION-2**: Is the Google Calendar OAuth flow actually used in production, or only the service account path? → Ask: If OAuth is unused, the `.env.example` mismatch is documentation-only. If used, the vars need aligning.
- [ ] **ASSUMPTION-3**: Should the `fromDb()` convention be implemented or abandoned? → Ask: Is there appetite to add snake_case→camelCase conversion, or should CLAUDE.md be updated to reflect the current intentional snake_case approach?
- [ ] **ASSUMPTION-4**: Should `no-explicit-any` be re-enabled in ESLint? → Ask: The rule is explicitly disabled in `eslint.config.js:13`. Re-enabling would surface ~1,193 issues. This is a large cleanup but would meaningfully improve type safety.

## REPO CONVENTIONS TO PRESERVE

- Supabase client pattern: server auth client for `getUser()`, admin client for data operations in server actions
- Permission pattern: `requireXPermission()` helpers that call `auth.getUser()` + `admin.rpc('user_has_permission')`
- Twilio webhook: anon client for logging, admin client for mutations (intentional architecture)
- GDPR: manual `super_admin` check (acceptable for placeholder implementation)
- `ComparisonStat` currency formatter: unused — don't fix what isn't called

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **SEC-NEW-1**: Re-review rota feed token flow after implementing per-user tokens — verify no secret material reaches the client
- [ ] **ENV-1**: After `.env.example` update, verify production env vars match new documentation
- [ ] **IMPL-6**: After date formatting fixes, verify no SSR hydration mismatches

## REVISION PROMPT

```
You are fixing issues identified by an adversarial review of the application.

Apply these changes in order:

1. CRITICAL — Fix rota feed token leak:
   - In src/app/(authenticated)/rota/page.tsx: stop deriving feedToken from ROTA_FEED_SECRET/SUPABASE_SERVICE_ROLE_KEY
   - Create a per-user feed token system (store tokens in DB, generate per authenticated user)
   - Update src/app/api/rota/feed/route.ts to validate per-user tokens
   - Update src/app/(authenticated)/rota/RotaFeedButton.tsx to use the new per-user URL

2. Documentation fixes:
   - Update .env.example: rename Google Calendar vars to match code, remove dead vars
   - Update src/lib/env.ts: remove SUSPEND_EVENT_SMS and SUSPEND_ALL_SMS from Zod schema
   - Update workspace CLAUDE.md: remove fromDb() references

3. Dead code cleanup:
   - Delete src/lib/supabase.ts

4. Date formatting consistency:
   - Fix 8 .toLocaleDateString() calls to use dateUtils with locale/timezone
   - Add timeZone: 'Europe/London' to src/lib/utils.ts formatDate
   - Change en-US to en-GB in src/lib/dateUtils.ts formatDate

Preserve these decisions (do NOT change):
- All requireXPermission() patterns in server actions
- Twilio webhook inline anon client
- GDPR manual super_admin check
- ComparisonStat dollar formatter (unused, not worth fixing)

Verify these assumptions before proceeding:
- Is ROTA_FEED_SECRET set in production?
- Is Google Calendar OAuth actually used?
```
