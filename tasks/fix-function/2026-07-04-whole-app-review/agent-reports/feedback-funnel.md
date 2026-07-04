# Review/Feedback Funnel — Deep Audit (commits 4e042fa5, 51b1e2b9, 994be916, 6a76f607 @ HEAD 76655f69)

## How the funnel works (context)

1. Every review ask (event/private-booking SMS, `/r/[token]` redirects) points at `https://l.the-anchor.pub/feedback` — a short link resolved by `vercel.json` host rewrite → `/api/redirect/feedback` → `short_links` row (created manually in prod) → the app's public `/feedback` landing page (`src/app/(feedback)/feedback/page.tsx`, made public via middleware prefix).
2. Landing page asks "How was your visit?": **Yes** → hardcoded Google review URL (`g.page/r/CXmhY3UO3834EBM/review`); **No** → `/feedback/tell-us`, a Google-lookalike private form (star rating, comments, optional consent-gated contact details, honeypot).
3. Submission POSTs to `/api/feedback` (`route.ts`): IP rate limit (10/h) → Idempotency-Key claim → Zod validation → consent-strip of PII → service-role insert into `review_feedback` (RLS on, zero anon policies) → best-effort email to `MANAGER_EMAIL` → redirect to `/feedback/thanks`.
4. Staff triage at `/feedback-inbox` (nav-gated on new `feedback/view` RBAC permission; `manage` needed for status changes + staff notes), backed by server actions in `src/app/actions/feedback.ts` using the admin client with server-side permission checks and audit logging.
5. Manager + super_admin roles got both permissions via migration `20260703090000_feedback_rbac_permissions.sql`; table created in `20260702120000_review_feedback.sql` with a DB CHECK that forbids contact PII without consent.

Overall: solid engineering for a 4-commit feature — honeypot, idempotency, consent double-enforcement (API strip + DB CHECK), RLS-deny-all, HTML-escaped email, audit logging, tests for the API route, and proper empty/error/loading states in the inbox. The findings below are mostly hardening and flow gaps, not fundamental flaws.

---

## Findings

### FB-01 · High — Contact details silently discarded when consent box unticked; thanks page still promises follow-up
**Evidence:** `src/app/api/feedback/route.ts:59-62` (consent strip), `src/app/(feedback)/feedback/tell-us/TellUsClient.tsx:25-79` (no validation that filled contact fields require consent), `src/app/(feedback)/feedback/thanks/page.tsx:13` ("if you left your details, we'll be in touch").
**Impact:** A guest expands "Add your contact details", fills in name/email/phone, misses the small consent checkbox, submits — the API silently nulls all three (correct for GDPR), the row and manager email say "Guest did not leave contact details", and the thanks page tells the guest they'll be contacted. The unhappy guest waits for a call that can never come — the exact failure the funnel exists to prevent.
**Recommendation:** In `TellUsClient.handleSubmit`, if any contact field is non-empty and `consent` is false, block submit with an inline message ("Tick the box so we can contact you, or clear your details"). Optionally have the API return a 400 for the same combination rather than silently stripping.

### FB-02 · Medium — Funnel integrity rests entirely on unprotected prod data; three silent-bypass paths
**Evidence:** `src/lib/events/review-link.ts:30-41` (`system_settings.google_review_link` overrides the funnel fallback); commit 994be916 message confirms the `feedback` short link and repointed `google_review_link` are **manual prod data changes with no seed migration**; `src/app/actions/short-links.ts:142-176` (`deleteShortLink` has no guard for the `feedback` slug); `src/app/api/redirect/[code]/route.ts:15` (missing code → silent redirect to `https://www.the-anchor.pub` homepage); `src/lib/short-links/routing.ts:1-40` (`feedback` not in `RESERVED_TOP_LEVEL_ROUTES`, so it stays editable like any code). Divergence: `src/services/private-bookings/scheduled-sms.ts:327` hardcodes `FEEDBACK_FUNNEL_URL` for the SMS *preview*, while the actual send in `src/app/api/cron/private-booking-monitor/route.ts:1038` uses `getGoogleReviewLink()` (the DB setting).
**Impact:** Any staff member with short-links access can delete/edit the `feedback` short link — every review SMS then lands on the pub homepage with no error anywhere. Anyone who "corrects" `system_settings.google_review_link` back to a real Google URL silently disables the funnel for all SMS consumers (the setting's name actively invites this). Preview shown to staff and the SMS actually sent can differ.
**Recommendation:** (a) Guard the `feedback` slug in `deleteShortLink`/update (reserved-slug list). (b) Make `getGoogleReviewLink` the single source in `scheduled-sms.ts` too, or rename the setting key (e.g. `review_ask_url`) with a comment. (c) Add a seed migration or startup assertion for the short link row.

### FB-03 · Medium — Rate limiting is only as real as the Upstash env vars; fallback is per-instance memory
**Evidence:** `src/lib/distributed-rate-limit.ts:25-31` (returns `null` when `UPSTASH_REDIS_REST_URL/TOKEN` unset) and `:57-65` (falls back to `createRateLimiter` — an in-memory `Map`, `src/lib/rate-limit.ts:4`); `UPSTASH_*` is **not documented in `.env.example`** (grep confirms). IP identity comes from `x-forwarded-for` first entry (`distributed-rate-limit.ts:16-23`), spoofable outside Vercel's header normalisation.
**Impact:** If Upstash isn't configured in Vercel, the "10/h" limit resets on every cold start and is per-lambda — a spammer can insert unlimited `review_feedback` rows and trigger unlimited manager emails (each submission = one email to `manager@the-anchor.pub`). Honeypot only stops dumb bots.
**Recommendation:** Verify `UPSTASH_REDIS_REST_URL/TOKEN` are set in Vercel prod; add them to `.env.example`. Consider Turnstile on the form (the project already ships `src/lib/turnstile.ts`) and/or a daily cap on manager emails.

### FB-04 · Medium — Inbox hard-capped at 200 rows, no pagination, no status filter
**Evidence:** `src/app/actions/feedback.ts:81-82` (`.order(created_at desc).limit(200)`); `FeedbackInboxClient.tsx` renders the flat list with no filter/tabs/pagination.
**Impact:** Resolved/dismissed items permanently clutter the list; once volume passes 200, older items (including unresolved ones pushed out by spam) silently disappear with no indication. Triage of "what still needs action" degrades over time.
**Recommendation:** Default the query to `status IN ('new','in_progress')` with a toggle for resolved/dismissed, and add simple pagination or "load more". Also surface a count badge.

### FB-05 · Low — `/feedback` public prefix also whitelists `/feedback-inbox` in middleware
**Evidence:** `src/middleware.ts:42` (`pathname.startsWith(prefix)`) + the `'/feedback'` entry added in 4e042fa5.
**Impact:** The triage inbox skips the middleware auth redirect. No data exposure — `(authenticated)/layout.tsx:50-52` redirects unauthenticated users and both the page (`feedback-inbox/page.tsx:8-9`) and every action re-check permissions — but one of three defence layers is unintentionally off, and future routes under `/feedback…` inherit the hole.
**Recommendation:** Match public prefixes on segment boundary (`/feedback` exact or `/feedback/`), mirroring the existing file-extension carefulness in the same function.

### FB-06 · Low — "Save notes" stamps `handled_by`/`handled_at` even when nothing was handled; notes are last-write-wins
**Evidence:** `src/app/actions/feedback.ts:121-134` — every update (including a notes-only save on a `new` item, since the client always sends the current status: `FeedbackInboxClient.tsx:192` `persist(status, notes, 'notes')`) sets `handled_by` + `handled_at`. `staff_notes` is a single overwritten text field with no author/history; two staff editing concurrently clobber each other.
**Impact:** `handled_at` becomes meaningless as a "when was this actioned" metric; note collisions lose information (audit log retains it, but nobody will look there).
**Recommendation:** Only set `handled_by/handled_at` when status transitions away from `new`; treat notes as append-with-attribution (even just prefixing initials + timestamp), or accept and document last-write-wins.

### FB-07 · Low — Update action reports success for non-existent ids; `staffNotes` unbounded
**Evidence:** `src/app/actions/feedback.ts:44-48` (`staffNotes: z.string().optional()` — no `.max()`), `:137-142` (0-row `.update().eq('id',…)` yields no error → `{ success: true }` and an audit event for a phantom update).
**Impact:** Stale UI rows (deleted elsewhere) show "Status updated" toasts that did nothing; a manage-permission user can store megabytes in `staff_notes`.
**Recommendation:** `.select('id').single()` after update and error on no row; add `.max(4000)` to `staffNotes` to match the public `comments` cap.

### FB-08 · Low — Manager email is fire-and-forget with no retry or alerting; env doc stale
**Evidence:** `src/app/api/feedback/route.ts:120-142` (failure only `console.error`, request still 201 — correct priority, but nothing re-attempts); `MANAGER_EMAIL` fallback hardcoded at `route.ts:18`; `.env.example:143` still describes `MANAGER_EMAIL` as "Recipient for birthday reminders and onboarding complete emails" only.
**Impact:** If Graph/Resend has an outage, negative feedback lands silently in the inbox with no push notification — acceptable only because the inbox exists, but nobody checks an inbox they don't know has items. `.env.example` misleads the next developer about blast radius of changing `MANAGER_EMAIL`.
**Recommendation:** Update the `.env.example` comment. Consider routing through the existing retry wrapper (`src/lib/retry.ts`) or a queued send; longer-term, a nav badge for `status='new'` count reduces dependence on email.

### FB-09 · Low — Yes/No split and feedback provenance are untracked
**Evidence:** `src/app/(feedback)/feedback/page.tsx:22-34` — plain `<a>`/`<Link>`, no click tracking; `route.ts:106` stores a constant `source: 'review-funnel'`; the funnel pages ignore query params, so nothing links a submission back to the booking/event/SMS that prompted it (the short-link redirect at `/api/redirect` records the *arrival* only).
**Impact:** You can't measure the funnel's core KPI (what fraction of guests were diverted from Google) or tell which event/booking generated a complaint — staff must cross-reference contact details manually.
**Recommendation:** Append a `?src=` param in `reviewRequestMessage`/`getGoogleReviewLink` consumers, carry it through the landing page into the POST payload, and store it in `source`/a new column. A lightweight beacon (or per-button short links) covers the Yes-click count.

### FB-10 · Low — PII: `submitted_ip` + `user_agent` stored indefinitely without retention policy or privacy-page mention
**Evidence:** `route.ts:107-108`, table columns in `20260702120000_review_feedback.sql:17-18`; privacy page addition (4e042fa5) covers only name/email/phone. Storage itself is well-protected (RLS deny-all, permission-gated reads) and consented PII handling is exemplary (server strip `route.ts:59-62` + DB CHECK `migration:27-30`).
**Impact:** Minor GDPR-hygiene gap: IP+UA of identifiable individuals kept forever with no purge path; the workspace rule flags new PII storage locations for approval.
**Recommendation:** Add a retention note (e.g. cron-null IP/UA after 90 days, matching the anti-abuse purpose) and one line on the privacy page.

### FB-11 · Info — The funnel is textbook "review gating", which Google's policy prohibits
**Evidence:** Design intent documented in `src/lib/events/review-link.ts:3-5` ("routes happy guests to Google and unhappy guests to a private feedback form").
**Impact:** Google Business Profile policy forbids "discouraging or prohibiting negative reviews, or selectively soliciting positive reviews". Detection is rare for a single venue, but the penalty is review removal or listing suspension. Business decision — flagging so it's a known trade-off, not a surprise.
**Recommendation:** None required technically; keeping the "It could have been better" path visibly able to reach Google too (a small "or review us on Google" link on the tell-us page) would soften the gating.

### FB-12 · Info — Minor mechanical nits
- POST 201 response carries `Cache-Control: public, max-age=60` because `createApiResponse` is called without `method` (`route.ts:154` → `src/lib/api/auth.ts:189-192`). Harmless in practice; pass `method: 'POST'` for `no-store`.
- Duplicate `getClientIp` implementations with different header precedence (`src/lib/turnstile.ts:76-84` prefers `cf-connecting-ip`; `distributed-rate-limit.ts:16-23` prefers `x-forwarded-for`) — the stored IP and the rate-limit identity can differ for the same request.
- The tell-us form hardcodes hex-adjacent Tailwind palette classes (`blue-600` etc.) rather than `@/ds` tokens — consistent with the other guest pages, but noted against the workspace design-token rule.
- No tests for the triage server actions (`src/app/actions/feedback.ts`); the public route has good coverage (`src/app/api/feedback/__tests__/route.test.ts`, 9 cases).

## What's demonstrably right (verified, not assumed)
- **RLS:** table has RLS enabled with zero policies (`20260702120000:43`) — anon key fully denied; all reads/writes go through service role behind permission checks. No PII reachable from any public surface.
- **XSS:** manager email HTML-escapes every user field (`manager-email.ts:3-10`); inbox renders via React text nodes.
- **Copy:** no legacy "credit card hold" or stale policy wording anywhere in the new pages; tone matches the "subtle and calm" customer-facing preference.
- **Inbox states:** empty state (`FeedbackInboxClient.tsx:254-265`), load-error alert (`:236-240`), per-control loading/disabled states, optimistic status change with rollback (`:138-144`), a11y labels on stars and selects.
- **Google URL:** `g.page/r/CXmhY3UO3834EBM/review` is the correct write-a-review deep-link format for the Yes path.

**Priority order:** FB-01 (broken guest expectation) → FB-02 (funnel can silently die) → FB-03 (verify Upstash env today — one Vercel dashboard check) → FB-04; the rest are opportunistic.
