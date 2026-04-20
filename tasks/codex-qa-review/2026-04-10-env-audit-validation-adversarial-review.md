# Adversarial Review: Full Application Variable & Configuration Audit

**Date:** 2026-04-10
**Mode:** Adversarial Challenge (Mode A)
**Engines:** Claude Opus 4.6 + OpenAI Codex CLI 0.107.0
**Scope:** Entire application — environment variables, Supabase client usage, date handling, permissions, types
**Spec:** N/A

## Inspection Inventory

### Inspected
- `.env.example` — canonical env var definitions
- `src/lib/env.ts` — Zod validation schema
- `src/lib/google-calendar.ts` and `src/lib/google-calendar-rota.ts` — Google Calendar integration
- `src/app/actions/gdpr.ts` and `src/services/gdpr.ts` — GDPR data operations
- `src/app/actions/customer-labels.ts` — customer label mutations
- `src/app/actions/event-categories.ts` — event category mutations
- `src/app/actions/business-hours.ts` — business hours mutations
- `src/app/actions/import-messages.ts` — message import mutations
- `src/components/ui-v2/display/Stat.tsx` — Stat component currency formatter
- `src/lib/dateUtils.ts`, `src/lib/utils.ts`, `src/app/(authenticated)/receipts/utils.ts` — formatDate implementations
- `src/lib/supabase.ts` — legacy Supabase client
- `src/app/api/webhooks/twilio/route.ts` — Twilio webhook Supabase usage
- `src/app/(authenticated)/rota/page.tsx` and `RotaFeedButton.tsx` — rota feed token flow
- `src/app/api/rota/feed/route.ts` — rota feed API endpoint
- All `'use client'` files with `.toLocaleDateString()` calls (8 files)
- All `process.env.*` references across src/ (~150+ references)
- All Supabase client imports (~200+ files)
- ESLint config (`eslint.config.js`)
- RLS policies in squashed migration

### Not Inspected
- Individual RLS policies for every table (only spot-checked flagged tables)
- `temp/` and `scripts/` directories (standalone utilities, not production code)
- Third-party dependency source code
- Vercel deployment environment (actual env var values)

### Limited Visibility Warnings
- Cannot verify whether the actual deployed `.env` matches `.env.example` — mismatches may be silently working in production
- Cannot verify RLS policy coverage for all tables — only checked tables related to flagged findings

## Executive Summary

The original audit made 11 claims. Cross-engine validation (Claude + Codex, 5 independent reviewer passes) found **3 were false positives**, **4 were severity-inflated**, and **4 were confirmed as stated**. The audit also missed a **newly discovered HIGH severity issue**: a rota feed token derived from `SUPABASE_SERVICE_ROLE_KEY` is leaked to the client browser.

## What Appears Solid

- **Server secret isolation**: All 8 critical secrets (service role key, Twilio auth token, Stripe secret key, etc.) are correctly confined to server-side code. No `'use client'` file imports any secret.
- **Supabase client usage**: Across ~200+ files, every client type (server auth, admin, browser) is used appropriately for its context. No admin client in client components. Webhooks, crons, and public pages correctly use admin. Auth-scoped actions correctly use the server client for `getUser()`.
- **Permission checks in server actions**: All four flagged server actions (`customer-labels`, `event-categories`, `business-hours`, `import-messages`) have proper RBAC checks via `requireXPermission()` helpers that call `auth.getUser()` + `user_has_permission` RPC. The original audit was wrong on this point.
- **Twilio webhook inline client**: The bespoke anon-key client is intentional — webhooks have no cookie session, and using the admin client for pre-verification logging would be over-privileged. This is correct architecture.

## Critical Risks

### NEW-1: Rota Feed Token Leaks Service-Role-Derived Secret to Client

```
ID:          SEC-NEW-1
Type:        Confirmed defect
Severity:    HIGH
Confidence:  High
Evidence:    Direct observation (Codex Security Reviewer)
Engines:     Codex only (not in original audit)
File(s):     src/app/(authenticated)/rota/page.tsx:114
             src/app/(authenticated)/rota/RotaFeedButton.tsx:7,111
             src/app/api/rota/feed/route.ts:22,48
```

**Description:** The server rota page derives `feedToken` from `ROTA_FEED_SECRET` (falling back to `SUPABASE_SERVICE_ROLE_KEY`), builds a `feedUrl` containing this token, and passes it as a prop to the client `RotaFeedButton` component. Any authenticated user on the rota page can copy this URL and share it externally. The `/api/rota/feed` endpoint accepts this token as a bearer credential with no session validation.

**Why it matters:** If `ROTA_FEED_SECRET` is not set, the token is derived from the service role key. Even if it is set, any authenticated user gets a reusable, shareable URL that bypasses auth entirely.

**What would confirm it:** Check whether `ROTA_FEED_SECRET` is set in production. If not, the service role key derivative is exposed.

**Blocking or advisory:** BLOCKING — must fix before any security audit.

## Confirmed Findings (Validated by Both Engines)

### AUDIT-1: Google Calendar OAuth Env Var Name Mismatch

```
ID:          ENV-1
Type:        Confirmed defect
Severity:    LOW (adjusted from HIGH by Assumption Breaker)
Confidence:  High
Engines:     Both
File(s):     .env.example:61-65, src/lib/google-calendar.ts:104-149
```

**Description:** `.env.example` defines `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` but code reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL`. Additionally, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_IMPERSONATE_EMAIL`, `GOOGLE_CALENDAR_INTERVIEW_ID`, and `GOOGLE_CALENDAR_ROTA_ID` are used in code but missing from `.env.example`.

**Severity adjustment rationale:** The code's primary path uses service account auth (which works fine). The OAuth path with mismatched vars is a secondary flow. The mismatch means a fresh setup following `.env.example` would have broken OAuth — but production presumably has the correct vars set.

### AUDIT-3: `fromDb()` Documented But Never Implemented

```
ID:          DOC-1
Type:        Repo-convention conflict
Severity:    LOW (documentation drift, not a runtime defect)
Confidence:  High
Engines:     Both
File(s):     ../CLAUDE.md:159, .claude/rules/supabase.md
```

**Description:** The workspace CLAUDE.md documents a `fromDb<T>()` snake_case-to-camelCase converter that doesn't exist. The codebase uses snake_case properties directly from Supabase throughout. No conversion utility exists under any name.

**Why it may be acceptable:** The codebase has chosen to use snake_case consistently in TypeScript, matching the database. This is a valid architectural choice — the CLAUDE.md documentation is aspirational/outdated.

### AUDIT-5: 8 User-Facing Dates Without Locale/Timezone

```
ID:          UI-1
Type:        Plausible but low-impact
Severity:    LOW (adjusted from HIGH)
Confidence:  High
Engines:     Both
File(s):     RightToWorkTab.tsx:206,222 | HealthRecordsTab.tsx:45 | MessageThread.tsx:87,132 |
             OnboardingChecklistTab.tsx:164 | messages/bulk/page.tsx:501 | ingredients/page.tsx:1200
```

**Description:** Eight `.toLocaleDateString()` calls without locale or timezone arguments. All are in `'use client'` components rendered in the browser.

**Severity adjustment rationale:** All users are UK pub staff whose browsers will have `en-GB` locale. The dates are internal-facing (employee records, messages). The risk is theoretical — if a staff member accessed via a non-UK browser, dates might display differently. Per project standards they should use `dateUtils`, but this is consistency debt, not a bug.

### AUDIT-7: 1,193 `any` Types Across Source

```
ID:          TYPE-1
Type:        Strongly suspected defect (maintainability)
Severity:    MEDIUM
Confidence:  High
Engines:     Both
File(s):     Worst: oj-projects-billing/route.ts (133), menu.ts (29), receiptQueries.ts (14)
```

**Description:** The codebase has ~1,193 `any` tokens in `src/`. ESLint's `no-explicit-any` rule is explicitly disabled. The billing route alone has 133 instances, making it essentially untyped.

**Why it may be partially acceptable:** Many `any` types are in JSONB column type definitions, Supabase RPC result handling, and third-party API response typing where the types are genuinely unknown. However, business logic files with `any` in function signatures reduce type safety meaningfully.

### AUDIT-8: 4 Duplicate `formatDate` Functions

```
ID:          UTIL-1
Type:        Repo-convention conflict
Severity:    LOW (adjusted from MEDIUM)
Confidence:  High
Engines:     Both
```

**Description:** Four `formatDate` functions exist with different implementations:
1. `src/lib/dateUtils.ts` — `en-US`, London timezone, long format ("January 15, 2024")
2. `src/lib/utils.ts` — `en-GB`, no timezone, short format ("15 Jan 2024")
3. `src/app/(authenticated)/receipts/utils.ts` — `en-GB`, UTC, default format
4. `src/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient.tsx` — same as #3 but handles null differently

**Severity adjustment rationale:** The Assumption Breaker argues these serve intentionally different domains (display vs export vs receipts). However, the `en-US` locale in `dateUtils.ts` is likely wrong for a UK app, and the version in `utils.ts` lacking a timezone is a real defect risk around midnight.

### AUDIT-9: 4 Dead Env Vars

```
ID:          ENV-2
Type:        Confirmed defect (dead code)
Severity:    LOW
Confidence:  High
Engines:     Both
```

- `NEXT_PUBLIC_PAYPAL_CLIENT_ID` — defined in `.env.example`, zero references in source
- `TWILIO_WEBHOOK_AUTH_TOKEN` — defined in `.env.example`, zero references in source
- `SUSPEND_EVENT_SMS` / `SUSPEND_ALL_SMS` — defined in `.env.example` and validated in `env.ts` Zod schema, but never actually consumed by any runtime code. The active SMS safety system uses `SMS_SAFETY_*` vars instead.

### AUDIT-10: Dead Legacy Supabase Client

```
ID:          DEAD-1
Type:        Confirmed defect (dead code)
Severity:    LOW
Confidence:  High
Engines:     Both
File(s):     src/lib/supabase.ts
```

Zero imports found across the entire repository (src, scripts, tests, config). Safe to delete.

## Overturned Findings (False Positives)

### AUDIT-2: GDPR Action Permission Check — OVERTURNED

**Original claim:** GDPR action deletes data without permission checks.
**Reality:** Both functions authenticate via `supabase.auth.getUser()` and manually check `system_role === 'super_admin'`. Additionally, the `deleteUserData` service method is a **placeholder that doesn't actually delete anything** — it logs a warning and returns a message. The claim that this is "CRITICAL" is completely wrong. The only real issue is that the GDPR settings page at `/settings/gdpr` is not route-level gated (navigation hides it, but direct URL access works), and the UI copy implies deletion works when it doesn't.

### AUDIT-4: 4 Server Actions Missing Permission Checks — OVERTURNED

**Original claim:** `customer-labels.ts`, `event-categories.ts`, `business-hours.ts`, `import-messages.ts` perform mutations without `checkUserPermission`.
**Reality:** All four files use `requireXPermission()` helpers that call `auth.getUser()` + `admin.rpc('user_has_permission', ...)`. The audit searched for `checkUserPermission` specifically and missed that these files use equivalent but differently-named helpers. This is a **false positive** confirmed by all three engines (Claude, Codex RRM, Codex Assumption Breaker).

### AUDIT-6: Stat Component Uses `$` — OVERTURNED

**Original claim:** Currency formatter in Stat.tsx uses dollar sign instead of pound.
**Reality:** The `$` formatter exists only in the `ComparisonStat` sub-component, which is **never used for actual currency display**. All real GBP stat cards pass pre-formatted values using the GBP formatter in `src/components/ui-v2/utils/format.ts`. The hardcoded `$` is dead code within an unused formatter option.

### AUDIT-11: Twilio Webhook Inline Client — OVERTURNED

**Original claim:** Twilio webhook creates a bespoke Supabase client bypassing established patterns.
**Reality:** This is intentional and correct. The server auth client requires cookies (no cookie in webhook calls from Twilio). The admin client would be over-privileged for pre-verification logging. The inline anon client is the minimum-privilege approach for webhook log writing before signature verification, after which the admin client is used for real mutations.

## Recommended Fix Order

1. **SEC-NEW-1** (HIGH): Fix rota feed token to not derive from service role key. Implement per-user scoped tokens. Rotate `ROTA_FEED_SECRET` after fix.
2. **ENV-1** (LOW): Align `.env.example` with actual code variable names for Google Calendar OAuth.
3. **ENV-2** (LOW): Remove dead env vars from `.env.example` and `env.ts` schema.
4. **DEAD-1** (LOW): Delete `src/lib/supabase.ts`.
5. **DOC-1** (LOW): Update workspace CLAUDE.md to remove `fromDb()` references, or document the intentional snake_case-in-TypeScript pattern.
6. **TYPE-1** (MEDIUM): Re-enable `no-explicit-any` in ESLint and fix progressively, starting with business logic files.
7. **UI-1** (LOW): Standardise date formatting to use `dateUtils` across client components.
8. **UTIL-1** (LOW): Consolidate `formatDate` functions — fix the `en-US` locale in `dateUtils.ts` to `en-GB`, add timezone to `utils.ts` version.

## Follow-Up Review Required

- **SEC-NEW-1**: Must be re-reviewed after fix to confirm token no longer leaks to client
- **ENV-1**: After `.env.example` update, verify production env vars match the new documentation
