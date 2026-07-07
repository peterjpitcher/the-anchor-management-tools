# Lessons Learned

<!-- After every correction, Claude adds a rule here to prevent repeating the mistake. -->
<!-- Format: date, mistake pattern, rule to follow going forward. -->
<!-- Review this file at the start of every session. -->

## 2026-04-20: Always verify day-of-week before sending customer-facing messages

**Mistake:** Sent 32 SMS saying "Music Bingo is this Thursday" when April 24 2026 is a Friday. Required a correction message to all recipients.

**Rule:** When composing any customer-facing message that references a day of the week, ALWAYS compute and verify the day programmatically (e.g. `new Date('2026-04-24').toLocaleDateString('en-GB', { weekday: 'long' })`) before sending. Never assume or calculate mentally.

## 2026-05-28: Serialize operational errors explicitly

**Mistake:** Logged provider/client error objects directly, which hid important diagnostic fields in production logs.

**Rule:** Never `JSON.stringify(error)` directly. Always destructure `code`, `message`, `details`, and `hint` for Supabase errors, or the relevant enumerable fields for provider errors such as PayPal and Twilio.

## 2026-05-28: Keep audit-log writers aligned with schema

**Mistake:** Audit-log writers used legacy column names such as `entity_type`, `entity_id`, `operation_details`, and `metadata` against the canonical `audit_logs` table.

**Rule:** Before adding or renaming columns referenced by an audit-log writer, grep every `from('audit_logs').insert(` callsite and update all writers in the same migration/change.

## 2026-06-10: When deleting a module, grep `tests/` too — not just `src/`

**Mistake:** Deleted `src/app/actions/fix-phone-numbers.ts` (audit F5) after a "zero importers" check scoped to `src/` and `scripts/`. A test in `tests/actions/fixPhoneNumbersActions.test.ts` still imported it, so the Vitest suite broke (suite failed to load). The deletion's verification ran lint + tsc but skipped `npm test` on the "no importers" assumption — and tsc didn't flag it because test files weren't in the type-check include.

**Rule:** Before deleting any module, grep the WHOLE repo for references — `src/`, `scripts/`, AND `tests/` (plus any co-located `__tests__/`). A test file is an importer. If the only remaining reference is a test that exists solely to exercise the deleted code, remove it in the same change. Never skip `npm test` for a deletion just because production code has no importers — run the suite, since tsc may not type-check test files.

## 2026-06-12: A push is not a deploy — always verify the deployment landed

**Mistake:** Pushed the recruitment fix to both apps' `main` and reported the work shipped. The management app auto-deployed (Ready), but the-anchor.pub does NOT auto-deploy `main`, so the website fix sat undeployed and not live. A redesign branch I had published also produced a failing preview build I never checked. The user had to tell me "always verify deployments".

**Rule:** After any push expected to deploy, verify before claiming done. For Vercel: `vercel ls <project> --scope <team>` then `vercel inspect <url>` — confirm a NEW deployment exists, state is Ready (not Error/Building/Canceled), and the production / `git-main` alias points to the new commit (not an older one). Learn each project's deploy model: `anchor-management-tools` auto-deploys `main`; `the-anchor-pub` (website) is a manual production deploy by the user. Never equate `git push` with "live".

## 2026-07-03 — Multi-ticket prod incident (first live booking failed)
- **PL/pgSQL `RETURN QUERY` needs explicit casts**: `sum()` returns bigint; a declared
  `integer` column raises 42804 on EVERY call at runtime, not at migration time. Always
  cast computed columns (`::integer`, `::text`) in RETURNS TABLE functions, and SMOKE-TEST
  each new function with a real `select *` after applying — "migration applied" ≠ "function runs".
- **Gate RPC wrappers on `state`, never on payload presence**: v05's blocked
  `customer_conflict` response CARRIES the existing booking_id. v07 null-checked booking_id
  and mutated a live booking. Wrappers around multi-state RPCs must whitelist success states.
- **Test the retry/conflict path before shipping a booking flow**: happy-path E2E passed;
  the crash only appeared on "customer already holds an active booking" — the single most
  common real-world retry scenario.
- **Browser screenshots are downscaled**: click coordinates read from a 1512px screenshot
  need rescaling to the real 1800px viewport (×1/0.84) or use in-viewport ref clicks.

## 2026-07-07 — Cached local builds masked a type error that failed Vercel

**Mistake:** Reported the AMS branch "green (tsc 0, lint 0, build 0)" and pushed to
`main`; the Vercel build ERRORED on a real TS2367 at `manage-booking.ts:703`
(`preview.is_outside_seating === true` where the value was narrowed to
`false | undefined` inside a `!== true` guard). A Wave-2 subagent had flagged this exact
line; I dismissed it as a "parallel-execution timing artifact" because my later
`npx tsc --noEmit` and `npm run build` both passed — they reused the worktree's `.next`
cache and `.tsbuildinfo`, which skip re-checking unchanged/cached files.

**Rule:** (1) Never dismiss a subagent-flagged type error without reproducing it from a
CLEAN state. (2) Before claiming a build is green ahead of a deploy, run an
UNCACHED build: `rm -rf .next && npm run build` (and delete `*.tsbuildinfo` before a
definitive `tsc --noEmit`). Incremental caches make "works locally" unreliable; the
authoritative gate is what Vercel runs — a cold build. This is doubly true in a fresh
git worktree, where a stale cache can carry a pre-edit clean result forward.
