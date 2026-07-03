# Review Landing Page — Implementation Plan

**Companion to:** `tasks/review-landing-page-spec.md` (the "what/why"). This is the "how".
**Status:** Ready to execute. All helper signatures verified against the codebase.
**Date:** 2026-07-02

> Execution note: this project enforces the GSD workflow — kick each PR off via a GSD command
> (`/gsd:quick` for PR0/PR3, `/gsd:execute-phase` or `/gsd:plan-phase` for PR1/PR2) rather than
> editing files directly.

---

## Verified building blocks (all confirmed to exist)

| Need | Use | Location |
|------|-----|----------|
| Public branded shell | `GuestPageShell` `{children, maxWidthClassName?, className?}` | `src/components/features/shared/GuestPageShell.tsx` |
| Admin (service-role) client | `createAdminClient()` | `src/lib/supabase/admin.ts` |
| IP rate limit (no token) | `applyDistributedRateLimit(request, {prefix, window, max, message?})` → `NextResponse|null` | `src/lib/distributed-rate-limit.ts` |
| Idempotency | `getIdempotencyKey` / `computeIdempotencyRequestHash` / `claimIdempotencyKey` / `persistIdempotencyResponse` / `releaseIdempotencyClaim` | `src/lib/api/idempotency.ts` |
| Client IP | `getClientIp(request)` | `src/lib/turnstile.ts` |
| API responses (+CORS) | `createApiResponse(data,status)` / `createErrorResponse(msg,code,status)` | `src/lib/api/auth.ts` |
| Email | `sendEmail({to,subject,html})` | `src/lib/email/emailService.ts` |
| Phone → E.164 (throws on invalid) | `formatPhoneForStorage(phone)` | `src/lib/utils.ts` |
| Permission check (returns bool) | `checkUserPermission(module, action)` | `src/app/actions/rbac.ts` |
| Audit (authenticated only) | `logAuditEvent({...})` | `src/app/actions/audit.ts` |
| updated_at trigger fn | `public.update_updated_at_column()` | existing prod fn |
| RBAC module list | `ModuleName` union | `src/types/rbac.ts:31` |
| Nav | `NAV_GROUPS` | `src/ds/shell/SidebarNav.tsx:26` |
| Short link + QR | `createShortLink()` / `buildShortLinkUrl()` / `downloadQrPng()` | `src/app/actions/short-links.ts`, `.../short-links/_components/qr-download.ts` |
| Form primitives | `Button, Input, Textarea, Field, Checkbox, Card, CardBody, Icon` | `@/ds` |

**Gaps to build (no reusable version exists):** a `StarRating` client component (no star icon in `@/ds`),
and an `escapeHtml` helper (it's only defined inline in `bookings.ts`, not exported — inline a copy in
the email builder, matching convention).

**No new required env vars.** `MANAGER_EMAIL` already defaults to `manager@the-anchor.pub`; Turnstile
and Upstash are optional and already wired where present.

---

## Design decisions baked into this plan

- **Transport:** the `tell-us` form is a client component that POSTs **JSON** to `/api/feedback` with a
  client-generated `Idempotency-Key` header (`crypto.randomUUID()` created once per form mount). Same-origin
  (short link → `${NEXT_PUBLIC_APP_URL}/feedback`), so no cross-origin concerns.
- **PRG:** on success the client `router.push('/feedback/thanks')` — refresh can't resubmit; the idempotency
  key covers double-tap/retry.
- **Screen 2 does NOT use `GuestPageShell`** (that renders a big Anchor logo on `bg-sidebar`, which breaks the
  Google illusion). Screen 2 is a custom white/light "Google review card" with a neutral avatar (no Google
  marks — per spec §0.2). Screens 1 (landing) and 3 (thanks) use Anchor branding (`GuestPageShell` or an
  event-kiosk-style green hero).
- **Invalid optional phone:** `formatPhoneForStorage` throws → the API catches it and returns a 400 field
  error (phone is optional, but if supplied it must be valid).
- **Turnstile:** wired as optional/env-gated in PR1 (skips cleanly when unconfigured); not a blocker.

---

## PR0 — Schema (optional, de-risk). Score XS/S

Isolates the migration so it can deploy with zero behaviour change. Fold into PR1 if you prefer.

- [ ] **Pre-check live schema** (MCP): confirm no existing `public.review_feedback`
      (`list_tables` / `execute_sql SELECT ... information_schema`).
- [ ] Write `supabase/migrations/<ts>_review_feedback.sql` — the tightened DDL from spec §5
      (rating `NOT NULL`, `updated_at` + `update_updated_at_column()` trigger, `handled_by` FK to
      `auth.users(id) ON DELETE SET NULL`, consent CHECK, RLS enabled, no anon policies, two indexes).
- [ ] Apply to prod via **Supabase MCP `apply_migration`** (additive/non-destructive — safe; still confirm).
- [ ] Regenerate `src/types/database.generated.ts` (MCP `generate_typescript_types` or supabase gen).
- **Done when:** table exists in prod, types regenerated, `npm run build` green. No user-visible change.

---

## PR1 — Public funnel (MVP). Score L(4)

Order = DB → domain types → API → email → pages → wiring → tests (3-change increments, commit per group).

### 1. Data + types (if PR0 skipped, do its steps first)
- [ ] Domain type + mapper: add `ReviewFeedback` (camelCase) + `mapReviewFeedbackRow()` in a types module
      (project uses manual snake→camel mapping; no `fromDb`).
- [ ] Shared **Zod** schema `feedbackSubmissionSchema` (rating 1–5 required int; comments optional trimmed;
      name/email/phone optional; `contactConsent` boolean; `honeypot` optional). Put in a lib module
      importable by both the route and the tests.

### 2. Email builder
- [ ] `src/lib/feedback/manager-email.ts` → `buildManagerFeedbackEmail(input): { subject, html }` with an
      inline `escapeHtml` (copy the `bookings.ts` impl). Include rating, comments, timestamp
      (`formatDateInLondon`), and contact fields **only if** `contactConsent`. Subject: "New guest feedback — The Anchor".

### 3. API route `src/app/api/feedback/route.ts`
- [ ] `POST(request)`:
  1. `applyDistributedRateLimit(request, { prefix: 'feedback-form', window: '1 h', max: 10 })` → return if 429.
  2. `getIdempotencyKey(request)`; if missing → `createErrorResponse('Missing Idempotency-Key','IDEMPOTENCY_KEY_REQUIRED',400)`.
  3. `await request.json()` (catch → 400 `VALIDATION_ERROR`).
  4. Zod parse → 400 with first issue on failure.
  5. **Honeypot:** non-empty → return a fake-success (or 400) with no insert/email.
  6. **Consent strip:** if `contactConsent !== true` → force name/email/phone = null.
  7. **Phone:** if present, `formatPhoneForStorage()` in try/catch → 400 on throw.
  8. `createAdminClient()`; `computeIdempotencyRequestHash(body)`; `claimIdempotencyKey(...)` →
     handle `conflict`(400) / `in_progress`(409) / `replay`(return cached).
  9. Insert into `review_feedback` (rating, comments, contact*, contact_consent, source, submitted_ip=`getClientIp`, user_agent).
  10. **Email best-effort:** `sendEmail(buildManagerFeedbackEmail(...))` in try/catch — failure logged, does NOT fail the request.
  11. `persistIdempotencyResponse(...)`; on any post-insert failure use `releaseIdempotencyClaim` per the
      `performer-interest` nuance (don't re-send emails on retry). Return `createApiResponse({ ok: true }, 201)`.
- [ ] `OPTIONS()` → `createApiResponse({}, 200)`.
- [ ] **No** `logAuditEvent` (public, unauthenticated).

### 4. Public pages — new group `src/app/(feedback)/feedback/`
- [ ] `page.tsx` (Screen 1, server): `GuestPageShell` or green hero; H1 "Did you enjoy your visit with us?";
      **Yes** = `<a href="https://g.page/r/CXmhY3UO3834EBM/review">`; **No** = `<Link href="/feedback/tell-us">`.
      Full-width ≥48px buttons.
- [ ] `tell-us/page.tsx` → renders `TellUsClient` (`'use client'`): Google-style white card, `StarRating`
      (required), comments `Textarea`, collapsible optional name/email/phone + consent `Checkbox`, blue
      "Post" button (disabled while submitting / until a rating is chosen). On submit: `fetch('/api/feedback',
      { method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key': key}, body })` →
      on ok `router.push('/feedback/thanks')`; on error show inline message. Client-side required-field checks
      mirror the Zod schema.
- [ ] `StarRating` client component (5 buttons, gold fill on hover/selected, `aria-label` per star, keyboard
      accessible; inline SVG star since `@/ds` has none).
- [ ] `thanks/page.tsx` (Screen 3, server): confirmation, Anchor branding, no Google re-prompt.
- [ ] Route group needs **no `layout.tsx`** (inherits root, incl. `robots noindex` — desired).

### 5. Wiring + privacy
- [ ] Add `'/feedback'` to `PUBLIC_PATH_PREFIXES` in `src/middleware.ts:11`.
- [ ] Update `/privacy` copy: "If you leave contact details with feedback, we may contact you about it."

### 6. Tests (Vitest; mock Supabase admin client + `sendEmail`)
- [ ] validation (bad/missing rating rejected; good accepted)
- [ ] honeypot (filled → no insert, no email)
- [ ] rate limit (over limit → 429)
- [ ] consent stripping (consent=false + contact fields → stored null; email omits them)
- [ ] email failure still saves (sendEmail rejects → 201, row persisted)
- [ ] idempotency (same key+payload twice → one row, one email)

### 7. Verify (per `verification-pipeline.md`)
- [ ] `npm run lint` (0 warnings) · `npx tsc --noEmit` · `npm test` · `npm run build`
- [ ] Preview: landing → Yes goes to Google; No → form → submit → thanks; confirm row in DB + manager email;
      mobile viewport check (≥48px targets, no h-scroll).

**Independently deployable:** yes — public funnel works end-to-end without PR2/PR3.

---

## PR2 — Staff triage inbox + RBAC. Score M(3)

- [ ] **RBAC seed migration** `supabase/migrations/<ts>_feedback_permissions.sql` — copy the exact pattern from
      `20260302000001_short_links_rbac_permissions.sql`: insert `feedback` `view`+`manage` into `permissions`,
      grant to `super_admin` + `manager` in `role_permissions` (idempotent `NOT EXISTS` guards). Apply via MCP.
- [ ] Add `'feedback'` to the `ModuleName` union in `src/types/rbac.ts:31`.
- [ ] Nav: add to `NAV_GROUPS` in `src/ds/shell/SidebarNav.tsx:26` (near Messages):
      `{ id:'feedback', label:'Feedback', icon:'message', href:'/feedback-inbox',
        permission:{ module:'feedback', action:'view' } }` — **distinct path** so it never collides with the
      public `/feedback`.
- [ ] Server actions `src/app/actions/feedback.ts`:
      `getFeedbackList(page,pageSize)` (checks `feedback:view`, admin-client fetch, ordered by `created_at desc`)
      and `updateFeedbackStatus(id, {status, staffNotes})` (checks `feedback:manage`, sets `handled_by=user.id`
      + `handled_at`, `logAuditEvent`, `revalidatePath('/feedback-inbox')`). Return `{ success?; error?; data? }`.
- [ ] Page `src/app/(authenticated)/feedback-inbox/page.tsx` (server): `checkUserPermission('feedback','view')`
      → redirect if false; fetch initial list; pass `canManage` to client.
- [ ] `FeedbackInboxClient` (`'use client'`): DS `Table`; row = date, rating, comments preview, contact (if
      consented), status badge; status control + notes when `canManage`; loading/empty/error states.
- [ ] Test 7: RBAC — actions deny without permission, allow with; inbox redirects unauthorised.
- [ ] Verify pipeline (lint/type/test/build) + preview as manager and as staff (nav item hidden without perm).

**Independently deployable:** yes — additive; public funnel already stores rows this reads.

---

## PR3 — Entry point (short link + QR) + polish. Score S(2)

- [ ] Mint the short link: via the existing `/short-links` admin UI (or a one-off `createShortLink` call) with
      `custom_code: 'feedback'`, `link_type: 'custom'`, `destination_url: \`${NEXT_PUBLIC_APP_URL}/feedback\``
      → `l.the-anchor.pub/feedback` (destination already allowlisted — spec §0.2). **May need zero new code.**
- [ ] Download the printable QR from the `/short-links` UI (`downloadQrPng`) for receipts/table talkers.
- [ ] (Optional) funnel analytics: log Yes/No choice on the landing page (mirror `/r/[token]` analytics).
- [ ] (Optional) surface a "Get feedback QR" shortcut inside the inbox.

---

## Cross-cutting

- **Migrations to prod:** Supabase MCP `apply_migration` (apply-time versioning; repo filenames ≠ prod
  versions). Regenerate `database.generated.ts` after each schema change. Both PR migrations are additive
  (no DROP) — safe, but confirm before applying.
- **Rollback:** PR1 — remove `/feedback` from middleware + delete the route group + `/api/feedback` (table can
  stay, it's inert). PR2 — hide the nav item / revoke the `feedback` permissions. Schema rollback only if truly
  needed (drop table — requires explicit approval).
- **Env:** none new required. Optionally document `TURNSTILE_*` reuse in `.env.example` if Turnstile is enabled.

---

## Definition of Done (per PR — from `.claude/rules/definition-of-done.md`)

Build 0-error · lint 0-warning · `tsc` clean · tests (happy + ≥1 edge) pass · no `any` unjustified ·
no hardcoded secrets/hex · auth+RBAC re-checked server-side (PR2) · public input validated (Zod) ·
PII consent-gated + stripped (PR1) · RLS verified · a11y baseline (focus styles, ≥48px targets, star input
keyboard-navigable, labelled inputs) · privacy copy updated (PR1) · no stray `console.log`.

## Assumptions

- Prod app domain is `management.orangejelly.co.uk` (`NEXT_PUBLIC_APP_URL`); short-link destination uses it.
- `Idempotency-Key` is always sent by our own client (React form → JS guaranteed).
- Upstash is configured in prod for `applyDistributedRateLimit`; the in-memory fallback is an acceptable floor.
