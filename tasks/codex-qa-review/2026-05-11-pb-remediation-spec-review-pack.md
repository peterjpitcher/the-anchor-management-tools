# Review Pack: pb-remediation-spec

**Generated:** 2026-05-11
**Mode:** C (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.claude/worktrees/affectionate-shamir-3d2513`
**Base ref:** `main`
**HEAD:** `dfc7de08`
**Diff range:** `main...HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

_(none detected for this diff range)_

## User Concerns

This is a remediation spec for 24 defects found in the private-bookings section. The spec proposes code changes across mutations.ts, payments.ts, contract-template.ts, edit/page.tsx, cron routes, and queries.ts. Key risks: status transition validation in updateBooking, Date-TBD lifecycle changes, deposit amount enforcement, SMS cancellation on booking cancellation, contract legal text, and a migration to clamp negative line totals. Review the spec against the actual codebase to verify the proposed fixes are correct and complete.

## Spec

Source: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.claude/worktrees/affectionate-shamir-3d2513/tasks/private-bookings-review/remediation-spec.md`

```markdown
# Private Bookings — Remediation Specification

**Date:** 2026-05-11
**Source:** [defect-report.md](defect-report.md) (24 defects across 4 priority levels)
**Scope:** All code changes needed to resolve every defect. No database schema changes unless explicitly noted.

---

## Implementation Groups

Defects are grouped by logical area to minimise file touches. Within each group, fixes are ordered by dependency. Groups themselves are ordered so that foundational fixes (data model, status guards) land before downstream consumers (SMS, contract, revalidation).

| Group | Theme | Defects | Key Files |
|-------|-------|---------|-----------|
| A | Status guards & editing constraints | D4, D12, D13 | `mutations.ts`, `payments.ts`, `edit/page.tsx` |
| B | Date-TBD lifecycle | D1 | `mutations.ts`, `new/page.tsx`, `types.ts`, expire-holds cron |
| C | Deposit amount enforcement | D3 | `payments.ts`, `PrivateBookingDetailClient.tsx` |
| D | Revalidation & stale data | D2, D8 | `privateBookingActions.ts`, `payments.ts`, `scheduled-sms.ts` |
| E | Contract template | D5 | `contract-template.ts` |
| F | SMS & notifications | D6, D10, D11 | `mutations.ts`, cron, `sms.ts`, `messages/page.tsx` |
| G | Permission model | D7 | `permission.ts`, various pages |
| H | Discount bounds | D9 | `mutations.ts`, migration |
| I | Query/display | D14 | `queries.ts`, `CalendarView.tsx` |
| J | Transaction safety | D15, D16, D17 | `mutations.ts`, `payments.ts` |
| K | Structural cleanup | D18, D19, D20 | API routes, migration |
| L | Tech debt | D21, D22, D23, D24 | Various |

---

## Group A — Status Guards & Editing Constraints

### D4: Edit page bypasses status-transition validation

**Problem:** The edit page posts a free-choice status dropdown through `updateBooking()` (mutations.ts:390), which applies the status directly. The validated `updateBookingStatus()` (mutations.ts:891) with `ALLOWED_TRANSITIONS` is never called from the edit flow.

**Root cause:** `updateBooking()` at line 506 spreads `input` (including `status`) straight into the update payload with no transition check.

**Fix:**

1. **`mutations.ts` — `updateBooking()` (line ~505):** Before building `updatePayload`, if `input.status` is present and differs from `currentBooking.status`, validate against `ALLOWED_TRANSITIONS`:

```typescript
// After line 404 (currentBooking fetched)
if (input.status && input.status !== currentBooking.status) {
  const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
    draft:     ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    completed: [],
    cancelled: ['draft'],
  };
  const currentStatus = currentBooking.status as BookingStatus;
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(input.status as BookingStatus)) {
    throw new Error(
      `Cannot transition booking from '${currentStatus}' to '${input.status}'`
    );
  }
}
```

2. **`edit/page.tsx` (lines 301-311):** Filter the status dropdown to only show valid transitions from the current status. Pass `booking.status` to a helper that returns the allowed options:

```typescript
const STATUS_OPTIONS: Record<BookingStatus, { value: string; label: string }[]> = {
  draft:     [
    { value: 'draft', label: 'Draft' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  confirmed: [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  completed: [
    { value: 'completed', label: 'Completed' },
  ],
  cancelled: [
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'draft', label: 'Draft' },
  ],
};
```

Replace the hardcoded 4-option array with `STATUS_OPTIONS[booking.status]`.

3. **Remove the duplicate `ALLOWED_TRANSITIONS`** from `updateBookingStatus()` (line 901). Extract to a shared constant in `types.ts` and import in both functions.

**Acceptance criteria:**
- Edit form for a draft booking shows only Draft, Confirmed, Cancelled
- Edit form for a completed booking shows only Completed (no transitions out)
- Server rejects `{ status: 'completed' }` on a draft booking with a clear error message
- `updateBookingStatus()` continues to work identically (uses same constant)

---

### D12: Cancelled/completed bookings can be freely edited

**Problem:** No status guard in `edit/page.tsx` or `updateBooking()`. Staff can modify any field on a cancelled or completed booking.

**Fix:**

1. **`mutations.ts` — `updateBooking()` (after line 404):** Add a guard before any mutation logic:

```typescript
const immutableStatuses: BookingStatus[] = ['completed', 'cancelled'];
if (immutableStatuses.includes(currentBooking.status as BookingStatus)) {
  // Only allow status transitions (handled by ALLOWED_TRANSITIONS above)
  // and nothing else
  const nonStatusKeys = Object.keys(input).filter(k => k !== 'status');
  if (nonStatusKeys.length > 0) {
    throw new Error(
      `Cannot edit a ${currentBooking.status} booking. Only status changes are allowed.`
    );
  }
}
```

2. **`edit/page.tsx`:** At the top of the server component, after fetching the booking, redirect or show a read-only notice if status is `completed` or `cancelled`:

```typescript
if (booking.status === 'completed' || booking.status === 'cancelled') {
  redirect(`/private-bookings/${id}`);
}
```

**Acceptance criteria:**
- Navigating to `/private-bookings/{id}/edit` for a cancelled booking redirects to the detail page
- Server action rejects field edits on completed bookings with a clear error
- Status transitions on cancelled bookings (cancelled → draft) still work via the detail page's status action

---

### D13: Deposit can be recorded on completed bookings

**Problem:** `finalizeDepositPaymentWithClient()` (payments.ts:324) only blocks `cancelled`, not `completed`.

**Fix:** Change the status guard at line 324:

```typescript
if (booking.status === 'cancelled' || booking.status === 'completed') {
  throw new Error('Cannot record a deposit on a cancelled or completed booking');
}
```

**Acceptance criteria:**
- Manual deposit recording on a completed booking returns an error
- PayPal deposit capture on a completed booking returns an error
- Deposit on draft/confirmed bookings continues to work

---

## Group B — Date-TBD Lifecycle

### D1: Date-TBD bookings are not truly TBD

**Problem:** When `date_tbd=true`, the form omits the date field. `createBooking()` falls back to `toLocalIsoDate(new Date())` (line 217). Hold expiry is then calculated from this fake "today" date, SMS references it, and the expire-holds cron can cancel the booking immediately since the hold is already "past".

**Root cause:** The fallback `input.event_date || toLocalIsoDate(new Date())` at line 217 runs unconditionally, even for TBD bookings.

**Fix:**

1. **`mutations.ts` — `createBooking()` (lines 217-268):** When `input.date_tbd` is true:
   - Still store a date (required by DB constraints and downstream code) but set `hold_expiry` to `null` so the cron ignores it
   - Skip balance_due_date calculation

```typescript
const finalEventDate = input.event_date || toLocalIsoDate(new Date());
const finalStartTime = input.start_time || DEFAULT_TBD_TIME;

// For TBD bookings: no hold expiry, no balance due date
let balanceDueDate = input.balance_due_date;
let holdExpiryIso: string | null = null;

if (input.date_tbd) {
  // TBD: no hold expiry (cron will skip), no auto balance due date
  holdExpiryIso = null;
  balanceDueDate = balanceDueDate || null;
} else {
  // Normal booking: calculate balance due date and hold expiry
  if (!balanceDueDate && finalEventDate) {
    const d = new Date(finalEventDate);
    d.setDate(d.getDate() - 7);
    balanceDueDate = toLocalIsoDate(d);
  }
  // ... existing hold expiry calculation (lines 237-268) ...
}
```

2. **`mutations.ts` — `sendCreationSms()` (line 54):** When the booking has `date_tbd` or its internal_notes contain `DATE_TBD_NOTE`, use "Date to be confirmed" instead of formatting the fake event_date:

```typescript
const isTbd = booking.internal_notes?.includes(DATE_TBD_NOTE);
const eventDateReadable = isTbd
  ? 'Date to be confirmed'
  : new Date(booking.event_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
```


[spec truncated at line 200 — original has 953 lines]
```

## Diff (`main...HEAD`)

_(no diff output)_

## Changed File Contents

_(no files to include)_
## Related Files (grep hints)

_(no related files found by basename grep)_

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — Anchor Management Tools

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions (stack, TypeScript rules, Supabase patterns, etc.).

## Quick Profile

```yaml
framework: Next.js 15 App Router + React 19
test_runner: Vitest (config: vitest.config.ts)
database: Supabase (PostgreSQL + Auth + RLS)
integrations: Twilio (SMS), Microsoft Graph (email), Stripe, PayPal
styling: Tailwind CSS v4
hosting: Vercel
size: ~600 files, large multi-module management system
```

---

## Workflow Orchestration

### Plan Mode Default
Enter plan mode for any non-trivial task (3+ steps or architectural decisions). If something goes sideways, STOP and re-plan immediately — don't keep pushing. Use plan mode for verification steps, not just building. Write detailed specs upfront to reduce ambiguity.

### Subagent Strategy
Use subagents liberally to keep the main context window clean. Offload research, exploration, and parallel analysis to subagents. For complex problems, throw more compute at it via subagents. One task per subagent for focused execution. When exploring the codebase, use subagents to read multiple sections in parallel.

### Self-Improvement Loop
After ANY correction from the user, update `tasks/lessons.md` with the pattern. Write rules for yourself that prevent the same mistake. Review `tasks/lessons.md` at session start.

### Verification Before Done
Never mark a task complete without proving it works. Diff behaviour between main and your changes when relevant. Ask yourself: "Would a staff engineer approve this?" Run tests, check logs, demonstrate correctness.

### Demand Elegance (Balanced)
For non-trivial changes, pause and ask "is there a more elegant way?" Skip this for simple, obvious fixes — don't over-engineer. Challenge your own work before presenting it.

### Autonomous Bug Fixing
When given a bug report, just fix it. Don't ask for hand-holding. Check Supabase logs, Vercel deployment logs, and browser console. Point at errors, then resolve them. Zero context switching from the user.

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Test Against Reality**: Don't assume code is correct because it exists. Trace the actual logic.

---

## Domain Rules

- £10 deposit per person for groups of 7 or more (NOT credit card holds — that was old functionality)
- Events hosted by the venue itself are exceptions to deposit rules
- Contracts must be generated for private bookings
- Booking amendments, cancellations, and deletions must track payment state correctly
- All customer-facing language must reflect current policies, not legacy ones
- Legacy "credit card hold" language anywhere in code or templates is always a bug

---

## Prompting Conventions

- **Challenge as reviewer**: "Grill me on these changes and don't make a PR until I pass your test."
- **Demand proof**: "Prove to me this works" — diff behaviour between main and feature branch.
- **Force elegance**: "Knowing everything you know now, scrap this and implement the elegant solution."
- **Section review**: "Do a full review of the /[section-name] section" triggers the fix-function skill.
- **Autonomous mode**: Point at logs, Slack threads, or failing CI and just say "fix."

---

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # ESLint (zero warnings enforced)
npm test         # Run Vitest tests
npx supabase db push   # Apply pending migrations
```

**Node version:** Use Node 20 LTS (as pinned in `.nvmrc`). Run `nvm use` before development. The `engines` field in `package.json` enforces `>=20 <23`.

## Architecture

**Additional integrations**: Twilio (SMS), Microsoft Graph (email), Stripe, PayPal.

**Route groups**:
- `(authenticated)/` — all staff-facing pages, auth enforced at layout level
- `(staff-portal)/portal/` — employee-only views (shifts, pay)
- `(timeclock)/timeclock/` — public kiosk access (no auth)
- `(employee-onboarding)/` — onboarding flows
- `api/cron/` — Vercel cron endpoints (require `Authorization: Bearer CRON_SECRET`)
- `api/webhooks/` — Twilio, Stripe, PayPal webhooks

**Auth**: Supabase Auth with JWT + HTTP-only cookies. `src/middleware.ts` is currently **disabled** (renamed `.disabled` after a Vercel incident); auth is enforced in `(authenticated)/layout.tsx` via `supabase.auth.getUser()`. Public path prefixes: `/timeclock`, `/parking/guest`, `/table-booking`, `/g/`, `/m/`, `/r/`.

## Supabase Clients

- **`src/lib/supabase/server.ts`** — cookie-based auth, use in server actions and API routes
- **`src/lib/supabase/admin.ts`** — service role key, bypasses RLS; use for system/cron operations
- ESLint rule prevents importing the admin singleton in client components

## Permissions (RBAC)

```typescript
await checkUserPermission('module', 'action', userId)
```

Modules: `calendar`, `customers`, `employees`, `events`, `invoices`, `messages`, `parking`, `private-bookings`, `receipts`, `rota`, `leave`, `timeclock`, `payroll`, `settings`, `roles`, etc.
Actions: `view`, `create`, `edit`, `delete`, `publish`, `request`, `clock`, `manage`.
Roles: `super_admin`, `manager`, `staff`. Defined in `src/types/rbac.ts`.

## Key Libraries & Utilities

- **`src/lib/dateUtils.ts`** — `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()` etc. London timezone hardcoded.
- **`src/lib/email/emailService.ts`** — `sendEmail(to, subject, html, cc?, attachments?)` via Microsoft Graph
- **`src/lib/sms/`** — Twilio wrapper with safety guards (hourly/daily rate limits, idempotency)
- **`src/services/`** — business logic services (CustomerService, EmployeeService, PermissionService, etc.)

## UI Components

Migrating from legacy `PageWrapper`/`Page` pattern to `PageLayout` + `HeaderNav` from `src/components/ui-v2/`. New pages must use the `ui-v2` pattern. Navigation defined in `src/components/ui-v2/navigation/AppNavigation.tsx`.

## Data Conventions

- Server actions body size limit: 20 MB (for file uploads)
- Dashboard data cached via `loadDashboardSnapshot()` in `src/app/(authenticated)/dashboard/`
- Date/holiday pre-computation: `buildConfirmedUKDates()` in calendar-notes actions

## Scheduled Jobs (vercel.json crons)

| Route | Schedule |
|---|---|
| `/api/cron/parking-notifications` | 0 5 * * * |
| `/api/cron/rota-auto-close` | 0 5 * * * |
| `/api/cron/rota-manager-alert` | 0 18 * * 0 |
| `/api/cron/rota-staff-email` | 0 21 * * 0 |
| `/api/cron/private-bookings-weekly-summary` | 0 * * * * |

## Key Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID / MICROSOFT_USER_EMAIL
PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID / PAYPAL_ENVIRONMENT
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
OPENAI_API_KEY
CRON_SECRET
PAYROLL_ACCOUNTANT_EMAIL
```

See `.env.example` for the full list.
```

---

_End of pack._
