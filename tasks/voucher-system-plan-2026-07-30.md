# Voucher System - Implementation Plan

Date: 2026-07-30. Executes `tasks/voucher-system-spec-2026-07-30.md` (rev 3). Every task below cites the spec; the spec wins on any conflict.

## Ground rules for every task

- Branch: all work on `feat/voucher-system`. NEVER push to origin. NEVER touch files outside this feature's scope; a parallel session may be editing this repo, so stage explicit paths only, never `git add -A`, never stash/checkout.
- Node 20 (`nvm use`). Code style: single quotes, no semicolons, 2-space indent, no `console.log` (warn/error only), components from `@/ds`, static Tailwind classes, dates via `src/lib/dateUtils.ts`, no em dash (U+2014) anywhere.
- DB columns snake_case, TS camelCase, manual field mapping (no fromDb helper).
- Server actions: zod validate → `checkUserPermission` → mutation (admin client → RPC) → `logAuditEvent` → `revalidatePath`, returning `{ success?: boolean; error?: string; data?: T }`.
- Migrations: timestamps MUST sort after `20260801001300_lock_down_new_function_grants.sql` (use `202608020000NN_*`). Additive only. Verify live schema (`information_schema.columns`) for FK targets (`employees`, `customers`, `events`, `bookings`) before finalising SQL.
- New SQL functions: `SECURITY DEFINER`, then `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role` (repo precedent: 20260801001300).

## Phase 0 - Setup (orchestrator, sequential)

- [ ] `git status` snapshot; create branch `feat/voucher-system` from current HEAD without touching the working tree.
- [ ] Confirm live schema facts via Supabase MCP `execute_sql`: PK/columns of `employees`, `customers` (incl. `sms_opt_in`, `mobile_e164`), `events` (id, date, name/title), `bookings` (event_id, customer_id, seats, status values), `roles` (names incl. `foh_staff`), `permissions`/`role_permissions` shape. Record in `tasks/voucher-system-schema-notes.md`.

## Phase 1 - Seed extraction + foundation migration (sequential)

**T1.1 Seed extraction script** `scripts/vouchers/extract-voucher-seed.ts`
Reads `docs/design/voucher-system/Voucher Set (Folded Card, B&W Print).html`, parses `TYPES`, `TERMS`, `TERMS_VERSION` (21 `{heading, body}` pairs from 42 strings), writes `scripts/vouchers/seed-data.json` AND prints the SQL insert fragments with dollar-quoted literals. Run it; commit script + JSON.

**T1.2 Migration 1** `supabase/migrations/20260802000001_voucher_foundation.sql`
Spec 2.4 exactly: `voucher_types`, `terms_versions`, `voucher_batches`, `voucher_number_counters`, `vouchers`, `voucher_events`, `voucher_reminders` (creation order per F11), all constraints/indexes incl. partial uniques on replacement links, `updated_at` triggers, RLS enabled with NO policies on all seven tables, storage bucket `vouchers` (insert into `storage.buckets`, private), seeds (8 types + terms v2.0 from T1.1 output), RBAC: insert `vouchers` module permissions (`view`,`edit`,`create`,`manage`) and role grants (staff+foh_staff: view,edit; manager+super_admin: all four) following the `20260731000000_checklists_foundation.sql` pattern.
Verify: `npx supabase db push --dry-run` parses (do not apply yet).

**T1.3 Migration 2** `supabase/migrations/20260802000002_voucher_rpcs.sql`
Spec 7.1 functions, each one transaction (guarded UPDATE + `voucher_events` insert, zero-rows returns current status):
`voucher_generate_batch(items jsonb, note, created_by, created_by_name)` (counter via INSERT..ON CONFLICT..RETURNING, fail >9999, type_definitions snapshot), `voucher_issue`, `voucher_redeem` (expiry guard takes London date param), `voucher_undo_redeem(p_within_60s bool)`, `voucher_cancel`, `voucher_replace` (locks both rows, copies customer/event/expiry, unique-link safe), `voucher_edit_handout` (recompute status expired↔issued + reschedule reminders), `voucher_assign_customer`, `voucher_override_redeem` (reason required), `voucher_expire_due(p_london_date)`, `voucher_reminders_recompute(voucher_id)`, `voucher_reminders_claim_due(p_london_date)`. Idempotency: mutation RPCs accept `p_idempotency_key text`; if the voucher is already in the target state and an event carries the same key, return success. Grants lockdown block at the end.

## Phase 2 - Shared lib + types (can start once T1.2 drafted; pure TS)

**T2.1** `src/types/vouchers.ts` (Row types + camelCase domain types + status/action unions + machine error codes).
**T2.2** `src/lib/vouchers/numbering.ts` (format, `normaliseVoucherNumberInput` per spec 2.7/F50), `src/lib/vouchers/age.ts` (completed London days, buckets 0-30/31-90/91-180/181+, humanise), `src/lib/vouchers/reminder-schedule.ts` (pure derivation per spec 5.2 table + rules), `src/lib/vouchers/constants.ts` (caps, presets, undo window).
**T2.3** Unit tests `src/lib/vouchers/__tests__/` covering spec 9 unit list (DST boundaries, scanner suffixes, hyphenless input, short-expiry schedules, late assignment skips, counter format edge 9999).

## Phase 3 - PDF pipeline (after T2; independent of Phase 4 UI)

**T3.1 Fonts**: `scripts/vouchers/fetch-fonts.ts` (plain node https) downloads DM Serif Display 400, Outfit 400/600, Clicker Script 400 WOFF2 from Google Fonts; emit `src/lib/vouchers/card-fonts.ts` (base64 data-URI `@font-face` CSS). If download fails, generate a CDN-links fallback module and note the deviation in the commit message (spec D8).
**T3.2 Assets**: `src/lib/vouchers/card-assets.ts` base64 modules from `docs/design/voucher-system/assets/` (logo, QR).
**T3.3 Template**: `src/lib/voucher-card-template.ts` reproducing the vendored HTML print path exactly (page box 296.6x209.6mm, A4 landscape margin 0, card-by-card page pairs, grouped by type, data-field merges from the batch `type_definitions` snapshot + voucher numbers + terms version; hand-fill blanks stay blank). Export `buildVoucherBatchHtml(batch, vouchers)` and `buildTermsSheetHtml(termsVersion)` (F47).
**T3.4 Render + download routes**: `src/app/api/vouchers/batches/[id]/render/route.ts` (POST, `vouchers.manage`, `maxDuration = 300`, sets rendering→ready/failed, bytes/pages/attempts, upload to `vouchers` bucket at `batches/{id}/render-{n}.pdf`) and `.../download/route.ts` (GET, signed URL 10 min). Manifest CSV route or action.
**T3.5 Template tests**: page count/order, unique numbers twice per card, terms version stamped, no unresolved `data-field`.
**T3.6 Benchmark** (after migrations applied, orchestrator): render 1/25/50/100 locally; record timings in `tasks/voucher-system-benchmark.md`; adjust cap if needed.

## Phase 4 - Management section (after T2; T3 only needed for generate wiring)

**T4.1 Actions** `src/app/actions/vouchers.ts`: createVoucherBatch (RPC), issueVoucher, redeemVoucher, undoRedeem, cancelVouchers (bulk), replaceVoucher, editHandout, assignCustomer, overrideRedeem, reprintVouchers (regenerate PDF for exact numbers via render pipeline; matrix rules F28), getLedger/getSummary/getDetail server reads (admin client, deny-all RLS).
**T4.2 Pages** under `src/app/(authenticated)/vouchers/`:
- `page.tsx` Overview (spec 3.1 incl. metric dictionary links, pdf_status gating of stock, age buckets, expiring-14d)
- `generate/page.tsx` (spec 3.2 two-step: action → poll render → download; print instructions verbatim; sheet/page terminology per F01)
- `handout/page.tsx` Hand-out mode (spec 3.3: context incl. required expiry preset, localStorage persistence, event chips incl. yesterday-until-06:00, staff picker from open timeclock sessions, fast customer attach, session counter)
- `all/page.tsx` Ledger (spec 3.4) and `[number]/page.tsx` Detail (spec 3.5, full transition actions incl. Replace stock-picker and Redeem-despite-expiry with reason)
- `types/page.tsx` Types & terms + Print terms sheet (spec 3.6)
All management pages gate `vouchers.manage`.
**T4.3 Nav + icon**: add `ticket` path to `src/ds/icons/paths.tsx` (+ IconName type), NAV_GROUPS entry `{ id: 'vouchers', label: 'Vouchers', icon: 'ticket', href: '/vouchers', permission: { module: 'vouchers', action: 'manage' } }` in the operations group.

## Phase 5 - FOH (after T2; one coupled commit for kiosk wiring, F07)

**T5.1 API routes** `src/app/api/foh/vouchers/{summary,lookup,issue,redeem,undo-redeem}/route.ts` using new `requireFohVoucherPermission(action)` in `src/lib/foh/api-auth.ts` (= `requireModulePermission('vouchers', action)`); zod, normalisation, ≥4-char lookup capped at 10, rate limit via existing `src/lib/rate-limit-server.ts` pattern, employee UUID→server-derived name (active check), idempotency keys, machine codes per spec 4.
**T5.2 Page** `src/app/(authenticated)/vouchers/foh/page.tsx` + components (redeem flow with 60s undo timer, hand-out flow, counts strip, blocked-state cards, a11y per F46, hit targets ≥44px, primary buttons ≥56px).
**T5.3 Kiosk wiring (single commit)**: `AuthenticatedLayout.tsx` `isFohPath` adds `/vouchers/foh`; `src/lib/foh/user-mode.ts` updated so `vouchers` module permissions keep `isFohOnlyUser` true (read the function first, adjust its module set); FOH header link to `/vouchers/foh` next to the Checklists link. Manual check: kiosk account still lands on `/table-bookings/foh` and can reach checklists + vouchers.

## Phase 6 - Customers + reminders + cron (after Phases 1-2)

**T6.1 Quick-add resolver** `src/app/api/foh/vouchers/customer/route.ts` (POST): `vouchers.edit` check, find-or-create by E.164 (race-safe on conflict), name+mobile+consent tick semantics per spec 5.1/F16. Event-booker chips endpoint (or fold into lookup/summary): confirmed positive-seat bookings for the event, deduped, using live bookings schema facts from Phase 0.
**T6.2 Reminders**: sender in `src/lib/vouchers/reminders.ts` using canonical sendSMS path with `voucher_id`+`reminder_kind` metadata, message-timeline logging, attempts/outcome updates on the outbox rows.
**T6.3 Cron** `src/app/api/cron/vouchers-lifecycle/route.ts`: `authorizeCronRequest`, London run-key claims (repo pattern), expiry pass at London hour 2, reminder pass at London hour 11 (one-per-customer-per-day deferral), id-ordered cursors. `vercel.json`: add `{ "path": "/api/cron/vouchers-lifecycle", "schedule": "0 1,2,10,11 * * *" }`.
**T6.4 GDPR**: add voucher tables to `src/app/actions/gdpr.ts` export; anonymisation nulls `customer_id` + cancels pending reminders.

## Phase 7 - Verification + delivery (orchestrator, sequential)

- [ ] `npm run lint` (zero warnings), `npx tsc --noEmit`, `npm test`, `npm run build` on Node 20 (cold build; catches cache-masked type errors).
- [ ] Migrations: `npx supabase migration list`; if every non-voucher migration is already applied remotely, `npx supabase db push`. If OTHER unapplied migrations exist (parallel session), DO NOT push them: apply only the two voucher files via psql/execute_sql in order, then `npx supabase migration repair --status applied <version>` for each. Verify tables + seeds + grants with a follow-up query (8 types, 21 term pairs, permissions rows, RLS enabled).
- [ ] Local smoke via dev server: overview loads, generate 2-card batch end-to-end (PDF downloads, correct page order), hand-out + redeem + undo on FOH page, blocked states, cron route dry-hit with CRON_SECRET.
- [ ] Commits: small, conventional, staged by explicit path. Final summary in `tasks/todo.md` review section with anything deviating from spec.

## Explicitly out of scope for agents

Do not push to origin. Do not run `vercel`. Do not modify migrations other than the two new files. Do not edit unrelated sections. Do not apply Supabase changes except in Phase 7 (orchestrator-controlled).

## Parallelisation map for orchestration

- Sequential spine: Phase 0 → T1.1 → T1.2 → T1.3.
- After T1.3 drafted: Phase 2 (agent A). After Phase 2: T3.1-T3.5 (agent B) in parallel with T4.1-T4.2 (agent C), then T4.3. Phase 5 (agent D) after Phase 2, parallel with Phase 3/4 (disjoint files; FOH page dir is separate). Phase 6 (agent E) after Phase 2 (touches distinct files).
- After every parallel wave: `git diff --stat` review of every modified file (scope-stray check) before commit.
