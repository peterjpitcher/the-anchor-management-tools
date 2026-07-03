# Review Landing Page — Discovery & Spec

**Status:** Discovery COMPLETE + build-review incorporated. All pre-code gates resolved — READY TO BUILD.
**Date:** 2026-07-02
**Author:** Claude (discovery + build-review pass)

---

## 0.1 Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Private-page style / gating | **Full Google lookalike** + Yes/No gate (owner-accepted risk — §2) |
| 2 | Manager visibility | **Email `manager@the-anchor.pub` + in-app triage inbox** |
| 3 | Entry point | **`l.the-anchor.pub/<code>` short link + printable QR** (reuse short-link system) |
| 4 | Star rating | **Required** 1–5 on the private page |
| 5 | RBAC | New **`feedback`** module (`view`, `manage`), gated for `manager` + `super_admin` |
| 6 | Duplicate protection | Reuse existing **`@/lib/api/idempotency`** + PRG redirect |

## 0.2 Pre-code gate (must be settled before writing code)

| Item | Status |
|------|--------|
| **App URL + short-link allowlist** | ✅ RESOLVED — app domain is `management.orangejelly.co.uk`, already in `src/lib/short-links/destination-allowlist.ts`. Short link → `${NEXT_PUBLIC_APP_URL}/feedback`. No allowlist change. |
| **RBAC module** | ✅ RESOLVED — new `feedback` module (see §8). |
| **Google logo fidelity on private page** | ✅ RESOLVED — **Google-style layout, no Google marks**: same layout / gold stars / blue "Post" button / feel, but neutral avatar and no Google logo or wordmark. ~95% of the visual effect, materially lower trademark exposure. |

---

## 1. Goal

Public, no-auth, mobile-first, Anchor-branded page driven to via a `l.the-anchor.pub` short link / QR.
Asks **"Did you enjoy your visit with us?"** → **Yes** → Google review deep link
`https://g.page/r/CXmhY3UO3834EBM/review`; **No** → Google-lookalike private feedback page that stores
to DB + emails `manager@the-anchor.pub`, with optional consent-gated name/email/phone.

---

## 2. Risk register (acknowledged & accepted by owner)

Review gating + Google-lookalike private page. Recorded, not re-litigated:
- **Google policy:** review gating can lead Google to restrict The Anchor's review collection.
- **Trademark/impersonation:** a page indistinguishable from Google's — especially using Google's
  marks — carries exposure. Decision: proceed as requested; keep `noindex` (already global) as the
  one cheap mitigation; §0.2 decides how far the marks go.

---

## 3. User flows

**Screen 1 — Landing** `/feedback` (server component): logo, deep-green hero (`brand-700`),
"Did you enjoy your visit with us?", two full-width buttons. Yes → Google deep link (optionally
logged, §12). No → `/feedback/tell-us`.

**Screen 2 — Private feedback** `/feedback/tell-us` (`'use client'`): Google review dialog lookalike
— white card, identity row (**neutral avatar, no Google marks** — §0.2), **required** interactive
5-gold-star row, "Share details of your own experience" textarea, blue "Post" button. Optional/collapsible block: name, email, phone + consent
checkbox ("Leave your details only if you're happy for us to contact you about your feedback"),
blank/unchecked by default. Submit → POST `/api/feedback` → `/feedback/thanks` (PRG — a refresh of
`/thanks` cannot resubmit).

**Screen 3 — Thank you** `/feedback/thanks`: "Thanks — the team will look into this." No Google re-prompt.

---

## 4. Routes & pages

- Chromeless route group `src/app/(feedback)/feedback/` → `page.tsx`, `tell-us/page.tsx`, `thanks/page.tsx`.
- Reuse `GuestPageShell` / `public__hero` styling.
- Add `/feedback` to `PUBLIC_PATH_PREFIXES` in `src/middleware.ts:11`.
- Keep root-layout `robots noindex`.
- Do **not** use `/r`, `/g`, `/m`, `/l` (reserved). `/feedback` is free.

---

## 5. Data model — `public.review_feedback` (tightened)

```sql
CREATE TABLE IF NOT EXISTS public.review_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),   -- stars required
  comments text,
  customer_name text,
  customer_email text,
  customer_phone text,                                       -- E.164 via formatPhoneForStorage()
  contact_consent boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'review-funnel',
  submitted_ip text,
  user_agent text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_progress','resolved','dismissed')),
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  staff_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- if no consent, no contact details may be stored (defence-in-depth alongside API stripping)
  CONSTRAINT review_feedback_consent_contact_check CHECK (
    contact_consent = true
    OR (customer_name IS NULL AND customer_email IS NULL AND customer_phone IS NULL)
  )
);
CREATE INDEX review_feedback_created_at_idx ON public.review_feedback (created_at DESC);
CREATE INDEX review_feedback_status_idx ON public.review_feedback (status);

-- updated_at maintenance (reuse existing convention)
CREATE TRIGGER review_feedback_set_updated_at
  BEFORE UPDATE ON public.review_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.review_feedback ENABLE ROW LEVEL SECURITY;   -- no anon policies
```

**RLS:** enabled, no anon policies (holds PII) → public can't read/write directly; service-role client
does all writes; staff reads via permission-gated server actions using the admin client. Deliberate
deviation from the RLS-disabled `feedback` table (which holds no PII).
**Apply:** write `.sql` locally; apply to prod via Supabase MCP `apply_migration`; regenerate
`src/types/database.generated.ts`.

---

## 6. Submission endpoint `src/app/api/feedback/route.ts` (model: `performer-interest`)

1. **Zod** validate: `rating` 1–5 **required**; `comments` optional; contact fields optional;
   `contact_consent` boolean. Normalise phone via `formatPhoneForStorage()`.
2. **Honeypot** hidden field → reject if filled.
3. **Consent stripping (server-side):** if `contact_consent !== true`, force
   `customer_name/email/phone = null` before insert — never rely on the client. (DB CHECK backs this up.)
4. **Rate limit** per IP — `checkGuestTokenThrottle()` (DB-backed) or count-based (~10/hr/IP), IP via
   `getClientIp(request)`.
5. **Idempotency** — reuse `@/lib/api/idempotency`: `getIdempotencyKey(request)` /
   `computeIdempotencyRequestHash` / `claimIdempotencyKey` → insert → `persistIdempotencyResponse`;
   `releaseIdempotencyClaim` on failure. Client generates a per-form-instance key (UUID) sent as the
   `Idempotency-Key` header, so a double-tap/retry is deduped and emails don't double-send. (Refresh
   is separately covered by the PRG redirect to `/thanks`.)
6. **Insert** via `createAdminClient()`; persist `submitted_ip`, `user_agent`.
7. **Manager email** (§7) — **best-effort**: a send failure must NOT fail the submission (store first,
   email after; log on failure). The `performer-interest` route's "created but idempotency-persist
   failed → don't re-send emails" nuance applies.
8. Return success → client redirects to `/feedback/thanks`.

No `logAuditEvent()` (no authenticated user; the row is its own record).

---

## 7. Manager notification email

`sendEmail({ to, subject, html })` from `src/lib/email/emailService.ts` (dual transport Graph/Resend).
To `process.env.MANAGER_EMAIL || 'manager@the-anchor.pub'`. `escapeHtml()` every guest value. Include
rating, comments, timestamp, and — only if `contact_consent` — name/email/phone. Subject e.g.
"New guest feedback — The Anchor".

---

## 8. In-app triage inbox + RBAC (correct files)

- **RBAC module:** add `'feedback'` to the `ModuleName` union in `src/types/rbac.ts:31`. Actions:
  `view`, `manage` (both already in `ActionType`). Seed migration must insert the `feedback` `view` +
  `manage` rows into `permissions` and grant them to `manager` + `super_admin` in `role_permissions`
  (follow the existing permission-seeding pattern — this is required plumbing, not optional).
- **Nav:** add a `NavItem` to `NAV_GROUPS` in `src/ds/shell/SidebarNav.tsx:26`
  (**not** `AppNavigation.tsx` — that reference in CLAUDE.md is stale). Place near Messages:
  `{ id: 'feedback', label: 'Feedback', icon: 'message', href: '/feedback-inbox',
     permission: { module: 'feedback', action: 'view' } }`.
  Note: use a distinct authenticated path (e.g. `/feedback-inbox` or `/reviews`) so it does **not**
  collide with the public `/feedback` route group.
- **Page** under `(authenticated)`: list rows (date, rating, comments preview, contact if consented,
  status); actions to change status, add `staff_notes`, set `handled_by`/`handled_at` — via
  permission-gated server actions using the admin client. Loading/empty/error states per `ui-patterns.md`.

---

## 9. Branding & mobile UX

Logo `/logo.png`; `--color-brand-700 #064e3b` hero, `--color-primary #006A4E`, `--color-success #16a34a`.
Mobile-first: single column, `min-h-screen`, ≥48px targets, no horizontal scroll. Screen 2 = faithful
Google review dialog per §0.2.

---

## 10. Security & privacy

- PII optional + consent-gated; stripped server-side without consent (§6.3) and blocked by DB CHECK (§5).
- RLS enabled, service-role writes only.
- `noindex` kept.
- Escape all user content in email + staff UI.
- **Privacy copy is PR1 scope** (not later): update `/privacy` to cover "if you leave contact details
  we may contact you about your feedback."

---

## 11. Entry point — short link + QR (reuse; confirmed viable)

`createShortLink()` (`src/app/actions/short-links.ts`) with `custom_code: 'feedback'`,
`link_type: 'custom'`, `destination_url: \`${NEXT_PUBLIC_APP_URL}/feedback\`` → allowed by the
allowlist (§0.2). URL via `buildShortLinkUrl()` (base `https://l.the-anchor.pub`). QR via
`downloadQrPng()` / `safeQrFilename()` in `src/app/(authenticated)/short-links/_components/qr-download.ts`,
or the existing `/short-links` admin UI. Minting can be done in that admin UI with **no new code**.

---

## 12. Reuse vs new

**Reuse:** `GuestPageShell`/`public__*`/`/logo.png`/tokens, `sendEmail`, `escapeHtml`,
`createAdminClient`, `checkGuestTokenThrottle`, `verifyTurnstileToken`/`getClientIp`,
`formatPhoneForStorage`, `@/lib/api/idempotency`, `update_updated_at_column`, middleware allowlist,
`MANAGER_EMAIL`, whole short-link + QR system, `SidebarNav`/`rbac.ts`.
**New:** `review_feedback` table + trigger + RBAC-seed migration; `(feedback)` route group (3 pages);
`/api/feedback`; manager-email template; triage inbox page + `feedback` module + nav item; type regen.
**Optional:** log Yes/No funnel choice (mirrors `/r/[token]` analytics).

---

## 13. Testing (Vitest; mock Supabase + email)

Required cases:
1. **Validation** — missing/invalid `rating` rejected; valid payload accepted.
2. **Honeypot** — filled honeypot → rejected, no insert, no email.
3. **Rate limit** — over-limit IP → 429, no insert.
4. **Consent stripping** — `contact_consent=false` with contact fields → row stored with contact
   fields null; email omits them.
5. **Email failure still saves** — `sendEmail` rejects → submission still persisted, returns success.
6. **Idempotency** — same key + payload twice → single row, single email.
7. **RBAC access** — inbox/server actions deny without `feedback:view`/`manage`; allow with.

Targets per `.claude/rules/testing.md`: business logic/actions ≥90%, API route ≥80%.

---

## 14. Phasing (honest re-scope — PR1 is L, not M)

- **PR0 — Schema (optional, de-risk), XS/S:** `review_feedback` table + trigger only. Deployable alone
  (no behaviour change); isolates the migration.
- **PR1 — Public funnel, L(4):** `(feedback)` pages (landing, Google-lookalike form, thanks) +
  `/api/feedback` (validation, honeypot, rate-limit, consent-strip, idempotency, insert, email) +
  middleware allowlist + **privacy copy** + tests 1–6. (Includes schema if PR0 skipped.) Cohesive and
  independently deployable, but genuinely larger than a typical PR — acknowledged.
- **PR2 — Staff triage, M(3):** `feedback` RBAC module + seed migration + nav item + inbox page +
  server actions + test 7.
- **PR3 — Entry + polish, S(2):** mint short link + QR (mostly config) + optional funnel analytics.

---

## 15. Out of scope

Editing/replying to real Google reviews; importing Google reviews; the outbound campaign that sends
the link.
