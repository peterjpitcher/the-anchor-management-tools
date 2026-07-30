# Voucher Generation and Redemption System - Full Specification

Date: 2026-07-30 (rev 4: all ten section 12 decisions confirmed by the owner; D6 reminder cadence and D7 quick-add consent changed on their instruction. Rev 3 resolved all 54 findings of `tasks/voucher-system-spec-review-2026-07-30.md`.)
Status: Built and delivered on branch `feat/voucher-system`. Every decision in section 12 is owner-approved.
Source: Design handoff vendored at `docs/design/voucher-system/` (README, print HTML with `TYPES`/`TERMS` seed arrays, logo + QR assets). F08 resolved: the repo is now the build input.
Complexity: L. Built in phases (section 10), delivered on branch `feat/voucher-system`, tested locally before any deploy.

---

## 1. Summary

Eight types of prize voucher, printed as folded A5 cards, handed to winners at events and redeemed at the bar. Three surfaces:

- **Management app, new `Vouchers` section** (manager-only): generation + print PDFs, ledger, voucher detail, Hand-out mode, types & terms reference, printable terms sheet.
- **FOH page** (staff, shared iPad): lookup, hand-out logging, one-tap redemption with 60-second undo. No generation.
- **The printed card**: the handoff artwork reproduced exactly. **One physical A4 sheet per voucher = two A4 PDF pages (sides), printed duplex, short-edge flip, folded to A5** (F01). "12 vouchers · 12 A4 sheets · 24 PDF pages."

### Owner decisions (2026-07-30, confirmed)

- Expiry is hand-written on the card at hand-out and entered into the app at the same moment. Nothing about expiry at generation; stock never expires.
- Age of every issued voucher is shown everywhere alongside expiry.
- Vouchers can be assigned to a customer for SMS reminders; assignment must be fast (one-tap event-booker chips, search, quick-add).
- Event won-at labelling with quick-picks; rapid back-office Hand-out mode.
- Card artwork unchanged; terms v2.0 as printed; separate terms sheet available (now in scope as a printable page, F47).
- No anti-fraud beyond the status check. Types/terms migration-only. Per-card hand-out. 60s undo. Staff picker (never the shared login). FOH page follows the Checklists-link pattern.

### Review decisions taken in the owner's absence (flagged for override, section 12)

- **Expiry is REQUIRED at hand-out** (F02). Every issued voucher must have a date; presets make it one tap. This matches the printed terms exactly and the owner's "I'll hand write the expiry date in".
- The terms/type definition **printed at generation** is the binding one (F03); old stock remains issuable after a terms bump under its printed version.
- Replacement uses an **existing generated stock card of the same type** (F09).
- Management section requires `vouchers.manage`; ordinary staff and `foh_staff` get FOH only (F30).
- One combined lifecycle cron for expiry + reminders (F20/F21).

---

## 2. Domain model

### 2.1 voucher_types (controlled list, seeded by migration from the vendored HTML)

Columns: `id text pk`, `display_title text`, `cover_title text`, `value_pence int null`, `requires_booking bool`, `alcohol bool`, `entitlement_html text`, `hero jsonb`, `copy jsonb`, `sort_order int`, `active bool default true`, timestamps. The eight rows and all copy fields are extracted **programmatically** from `docs/design/voucher-system/Voucher Set (Folded Card, B&W Print).html` (`TYPES` array), never retyped. Types are migration-only.

Every type carries a cash value (owner, 2026-07-30). The handoff left the five entitlement types valueless; the owner set values so outstanding liability covers the whole stock. Values are not printed on the cards, so no artwork changes.

| id | display_title | value_pence | requires_booking | alcohol |
|---|---|---|---|---|
| `free-drink` | FREE DRINK VOUCHER | 600 | false | true |
| `house-wine` | BOTTLE OF HOUSE WINE | 2000 | false | true |
| `food-10` | £10 FOOD VOUCHER | 1000 | false | false |
| `drinks-10` | £10 DRINKS VOUCHER | 1000 | false | true |
| `food-drink-25` | £25 FOOD & DRINK VOUCHER | 2500 | false | true |
| `roast-two` | SUNDAY ROAST FOR TWO | 4000 | true | false |
| `quiz-four` | FOUR QUIZ NIGHT TICKETS | 1200 | true | false |
| `bingo-four` | FOUR MUSIC BINGO TICKETS | 2000 | true | false |

Stored copy is **plain text, not HTML entities** (migration `20260802000004`): the handoff authors every string for direct HTML injection, so `&pound;`/`&amp;` were leaking into the app UI. The print template escapes text fields on the way back into HTML; `entitlement_html` remains genuine markup.

### 2.2 terms_versions

`version text pk`, `effective_from date`, `clauses jsonb` (ordered array of `{heading, body}` pairs; the HTML `TERMS` array is 42 strings = 21 pairs), `published_by text`, `created_at`. Seed **v2.0** programmatically from the HTML.

- **Binding moment (F03):** the terms version and type definition captured when the voucher is generated (printed) apply to that voucher for its whole life. A later terms version affects only newly generated cards; old stock remains valid and issuable under its printed version.
- **Clause references (F54):** clause numbers are derived from the seeded ordered array at render time, never hard-coded in prose or UI copy. (For orientation only: "Expiry" is the 3rd clause pair in v2.0.)

### 2.3 Snapshot of the printed definition (F04)

`voucher_batches.type_definitions jsonb` stores, at generation, the complete printed definition of every type used in that batch (all card-facing fields of 2.1). Reprints and FOH entitlement display read the voucher's batch snapshot; current `voucher_types` is only a fallback for display when no snapshot exists. A migration that edits type copy therefore never alters an existing card, its reprint, or its FOH display.

### 2.4 Tables (creation order per F11: types → terms → batches → counters → vouchers → events → reminders)

```sql
create table voucher_batches (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  created_by        uuid,                          -- auth user
  created_by_name   text not null,
  note              text,
  terms_version     text not null references terms_versions(version),
  type_definitions  jsonb not null,                -- F04 snapshot
  total_count       integer not null,
  pdf_status        text not null default 'pending'
                      check (pdf_status in ('pending','rendering','ready','failed')),
  pdf_path          text,                          -- immutable path incl. render version (F42)
  pdf_bytes         bigint,
  pdf_pages         integer,
  render_attempts   integer not null default 0,
  render_error      text,
  updated_at        timestamptz not null default now()
);

create table voucher_number_counters (
  month_key text primary key,                      -- '2607'
  last_seq  integer not null default 0
);

create table vouchers (
  id                  uuid primary key default gen_random_uuid(),
  voucher_number      text not null unique,        -- canonical uppercase 'AN-YYMM-NNNN'
  type_id             text not null references voucher_types(id),
  batch_id            uuid not null references voucher_batches(id),   -- RESTRICT (default)
  status              text not null check (status in
                        ('generated','issued','redeemed','expired','cancelled','replaced')),
  value_pence         integer,
  terms_version       text not null references terms_versions(version),
  -- hand-out
  issued_at           timestamptz,
  issued_by           uuid references employees(employee_id) on delete set null,
  issued_by_name      text,
  issued_by_user_id   uuid,                        -- authenticated account that performed it (F29)
  event_id            uuid references events(id) on delete set null,
  won_at_label        text,
  expiry_date         date,                        -- REQUIRED at issue (F02), London calendar date
  customer_id         uuid references customers(id) on delete set null,
  -- redemption
  redeemed_at         timestamptz,
  redeemed_by         uuid references employees(employee_id) on delete set null,
  redeemed_by_name    text,
  redeemed_by_user_id uuid,
  transaction_ref     text,
  booking_ref         text,
  -- lifecycle admin
  cancelled_at        timestamptz,
  cancelled_reason    text,
  replaced_by_id      uuid references vouchers(id) on delete set null,
  replaces_id         uuid references vouchers(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- lifecycle invariants (F15)
  constraint vouchers_issued_fields check (
    status not in ('issued','redeemed','expired')
    or (issued_at is not null and issued_by_name is not null
        and won_at_label is not null and expiry_date is not null)),
  constraint vouchers_redeemed_fields check (
    status <> 'redeemed' or (redeemed_at is not null and redeemed_by_name is not null)),
  constraint vouchers_cancelled_fields check (
    status not in ('cancelled','replaced') or (cancelled_at is not null and cancelled_reason is not null)),
  constraint vouchers_replaced_link check (
    status <> 'replaced' or replaced_by_id is not null),
  constraint vouchers_no_self_replace check (
    id <> replaced_by_id and id <> replaces_id)
);
create index on vouchers (status);
create index on vouchers (type_id, status);
create index on vouchers (batch_id);
create index on vouchers (event_id) where event_id is not null;
create index on vouchers (customer_id) where customer_id is not null;
create index on vouchers (status, issued_at);
create index on vouchers (redeemed_at) where redeemed_at is not null;
create index on vouchers (expiry_date) where status = 'issued';
create unique index on vouchers (replaced_by_id) where replaced_by_id is not null;  -- F14
create unique index on vouchers (replaces_id) where replaces_id is not null;        -- F14

create table voucher_events (
  id                 uuid primary key default gen_random_uuid(),
  voucher_id         uuid not null references vouchers(id),
  action             text not null check (action in
                       ('generated','issued','redeemed','undo_redeem','expired','cancelled',
                        'replaced','reprinted','customer_assigned','customer_removed',
                        'reminder_sent','edited','override_redeemed','note')),
  actor_user_id      uuid,                          -- authenticated account (F43)
  actor_employee_id  uuid,                          -- selected staff member
  actor_name         text not null,                 -- snapshot
  source             text not null check (source in ('management','foh','cron','system')),
  at                 timestamptz not null default now(),
  detail             jsonb                          -- typed per action; customer_id only, never phone/name (F37)
);
create index on voucher_events (voucher_id, at desc);                                -- F38

create table voucher_reminders (                                                     -- F17 outbox
  id             uuid primary key default gen_random_uuid(),
  voucher_id     uuid not null references vouchers(id),
  customer_id    uuid references customers(id) on delete set null,
  reminder_kind  text not null check (reminder_kind in ('day30','day90','pre_expiry')),
  status         text not null default 'pending'
                   check (status in ('pending','sent','skipped','failed','cancelled')),
  scheduled_for  date not null,                     -- London date
  sent_at        timestamptz,
  message_sid    text,
  attempts       integer not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (voucher_id, reminder_kind)
);
create index on voucher_reminders (status, scheduled_for);
```

`updated_at` maintained by trigger on all mutable tables. Exact FK target column names verified against the live schema before the migration is finalised.

### 2.5 Status model and transition matrix (F13)

```
generated ──issue──▶ issued ──redeem──▶ redeemed
    │                   │                  │
    │                   ├─expiry passes─▶ expired ──manager override──▶ redeemed
    │                   │                  │
    │                   │                  └─undo (60s FOH / manager any time)─▶ issued
    └──cancel───────────┴──cancel──▶ cancelled
issued ──replace (stock card takes over)──▶ replaced   [terminal]
```

| From | Action | To | Who (permission) | Required fields | Notes |
|---|---|---|---|---|---|
| generated | issue | issued | vouchers.edit | employee id, won_at_label (or event_id), expiry_date | Batch must be pdf_status ready (F10) |
| generated | cancel | cancelled | vouchers.manage | reason | Misprints, damaged stock |
| generated | reprint | generated | vouchers.create | - | Event `reprinted` |
| issued | redeem | redeemed | vouchers.edit | employee id (booking_ref optional, never blocking) | Blocked when London today > expiry_date |
| issued | undo of a redeem | - | - | - | Not applicable (see redeemed) |
| issued | cancel | cancelled | vouchers.manage | reason | |
| issued | replace | replaced | vouchers.manage | reason + selected generated stock card of same type | Replacement copies customer, event, expiry; both rows locked; links written both ways (F09, F14) |
| issued | edit hand-out details | issued/expired | vouchers.manage | reason | Expiry edit recomputes status + reminder schedule atomically (F26) |
| issued | expiry passes | expired | cron/lookup | - | Nightly job + lookup-time guard |
| issued | reprint | issued | vouchers.manage | confirmation "original destroyed or unusable" | F28 |
| redeemed | undo (within 60s) | issued | vouchers.edit | - | FOH undo; clears redemption fields; events keep history |
| redeemed | undo (after 60s) | issued | vouchers.manage | reason | Management detail page |
| expired | override redeem | redeemed | vouchers.manage | reason, manager user, employee id | Event `override_redeemed` (F27) |
| expired | edit expiry to future date | issued | vouchers.manage | reason | F26 |
| cancelled / replaced | any | - | - | - | Absolutely terminal. No reinstatement, no reprint. |

Anything not in the matrix is refused by the RPC.

### 2.6 Age (alongside expiry)

- Age = completed London calendar days since `issued_at` (via `dateUtils`), humanised for display.
- Buckets (F39, mutually exclusive): **0-30, 31-90, 91-180, 181+** completed London days.

### 2.7 Voucher numbering (F49, F50)

- Format `AN-YYMM-NNNN`, monthly reset, canonical uppercase storage.
- Allocation: `insert into voucher_number_counters (month_key, last_seq) values ($1, $n) on conflict (month_key) do update set last_seq = voucher_number_counters.last_seq + $n returning last_seq` inside the batch RPC; hard failure with a clear error if the resulting sequence would exceed 9999 (generation stops; no five-digit fallback).
- Whole batch uses the month of the batch timestamp captured once.
- **Input normalisation (F50):** server-side canonicalisation for every lookup and mutation: uppercase, trim, collapse whitespace, strip scanner suffixes (`\n`, `\t`), hyphens optional on input (`an26070148` matches `AN-2607-0148`). The canonical number is always displayed before any mutation is confirmed.

---

## 3. Management app: the Vouchers section

Nav: **Vouchers**, operations group next to Table Bookings, new `ticket` icon added to `src/ds/icons/paths.tsx` (F53), gated on `vouchers.manage` (F30: manager-facing section).

### 3.1 Overview

**A. Stock by type**: | Voucher type | In stock | Out (issued) | Redeemed | Expired | Cancelled | with totals row; "in stock" is the headline; low-stock flag at ≤ 5. **In stock counts only `generated` vouchers whose batch is `pdf_status = 'ready'`** (F10); pending/failed batches are listed separately as "not yet printable".
**B. Summary tiles**: total in stock · total outstanding · redeemed this month · outstanding value (every type now has a value, so this is the whole live liability).
**C. Outstanding by age** buckets + count expiring within 14 days.

Metric dictionary (F40): every number on this page has one definition, and clicking it opens the ledger with exactly the filters that reproduce it.

| Metric | Definition |
|---|---|
| In stock | status=generated AND batch.pdf_status=ready |
| Outstanding | status=issued (lookup-expired ones excluded by the nightly job within 24h; the tile notes "as of last expiry run") |
| Redeemed this month | status=redeemed AND redeemed_at within current London month (includes override redemptions) |
| Outstanding value | sum(value_pence) over Outstanding (all eight types contribute) |
| Redemption rate (per type/batch) | redeemed ÷ issued (cohort = ever-issued vouchers of that type/batch) |
| Expiring soon | Outstanding AND expiry_date within next 14 London days |

### 3.2 Generate vouchers

Form (not wizard): per-type steppers (max 200/type), running total "12 vouchers · 12 A4 sheets · 24 PDF pages" (F01), batch note, overall cap 100 cards/batch (revisited after the render benchmark, F22). No expiry field.

**Two-step delivery (F23):**
1. Server action `createVoucherBatch`: one RPC creates batch (+type snapshot), allocates numbers, inserts `generated` vouchers + events. Returns batchId immediately.
2. UI calls `POST /api/vouchers/batches/[id]/render` (route handler, `maxDuration` 300): renders HTML → PDF (Puppeteer), uploads to storage at an immutable versioned path, records bytes/pages/attempts, sets `pdf_status`. UI polls batch status, then downloads via a permission-checked signed-URL route. Failed renders show **Retry render** (idempotent; bounded attempts with visible error, F51). A disconnected browser changes nothing: the batch exists, the render continues or can be retried, nothing is duplicated (F33).

Success panel: batch ref, counts by type, number range, Download PDF, Download manifest CSV (`number,type,status,generatedAt`). Print instructions verbatim per handoff (duplex, short-edge flip, 100% scale). Re-downloading an old batch PDF warns when the batch contains vouchers no longer `generated` ("this file contains N cards that have since been issued/cancelled", F28).

### 3.3 Hand-out mode

1. Context set once: event (chips: today's events, **including yesterday's until 06:00 London**, F35; plus free text), issued-by staff picker (clocked-in first), **expiry preset (+30/+60/+90/custom) applied to each card, editable per card, required** (F02). Screen shows "Write this date on every card: 28 October 2026."
2. Loop per card: number entry (normalised, partial ≥4 chars, explicit pick) → type/status shown → optional fast customer attach (5.1) → confirm. Running session counter. Context and counter persist in localStorage across refresh/sleep (F33).
3. Confirm executes the issue RPC with a client idempotency key; on network loss the client re-fetches the voucher and shows its confirmed server state instead of a scary error (F33).

### 3.4 All vouchers (ledger)

Filters: status/type multi, batch, event, customer, date ranges, expiring-within, number search (normalised contains; fine at this scale, trigram index later if needed, F38). Columns: number (mono), type, status pill, issued (date+by), age, expiry, won at, customer, redeemed (date+by), value. Bulk: cancel with reason, CSV export, reprint (rules per matrix). Pagination.

### 3.5 Voucher detail

Header (number, type, status, value, age, expiry, customer) · event timeline · hand-out block (manage-only edits with reason; expiry edits recompute status + reminders atomically, F26) · customer block (assign/change/remove; reminder history from the outbox) · redemption block · actions per the transition matrix, including **Replace** (pick from available generated stock of the same type; copies customer/event/expiry; prints nothing new) and **Redeem despite expiry** (reason required, F27) · terms version with link.

### 3.6 Types & terms + printable terms sheet (F47)

Read-only reference of all types and the terms versions. **"Print terms sheet"** renders the voucher's/current terms version as a clean A4 print-CSS page, so staff can hand out full-size terms alongside the fine-print card. Clause numbers derived from the array (F54).

---

## 4. FOH page

Route `(authenticated)/vouchers/foh`. Wiring (F06/F07, one coupled change): new `requireFohVoucherPermission(action)` = `requireModulePermission('vouchers', action)`; RBAC migration grants `vouchers.view` + `vouchers.edit` to `foh_staff` and `staff`; **both** kiosk gates updated together: the `isFohPath` list in `AuthenticatedLayout.tsx` (adds `/vouchers/foh`) and `src/lib/foh/user-mode.ts` (so the vouchers module does not break the FOH-only classification); FOH header gets the link (Checklists pattern). Regression: `/table-bookings/foh`, `/checklists`, `/vouchers/foh` all reachable for the kiosk account.

Counts strip: in stock · out · redeemed today (London).

**Redeem:** number entry → result card (type title, entitlement wording **from the batch snapshot**, status, age + customer, expiry, value) → warnings (18+ for alcohol types; booking-required note for booking types, with an **optional** reference field that never blocks the redemption per the owner's decision of 2026-07-30, migration `20260802000005`; expiring within 7 days) → optional transaction ref, optional customer attach → Mark as used (≥56px) with one confirm → 60s Undo. Blocked states show reason + who/when, no button: redeemed, expired (hard block; manager override is management-side only), cancelled, replaced (shows replacement number), generated (prompts hand-out). Lookup treats past expiry as expired regardless of cron (2.5).

**Hand out:** as 3.3 but single-card, expiry presets required, staff picker, optional customer attach.

**API family** (`/api/foh/vouchers/*`): summary, lookup (≥4 chars, ≤10 results, rate-limited via existing rate-limit lib, F32), issue, redeem, undo-redeem. All inputs zod-validated; employee referenced by UUID only, name derived server-side from an active employee row (F29); machine codes `ALREADY_REDEEMED | EXPIRED | NOT_ISSUED | CANCELLED | REPLACED | NOT_FOUND | UNDO_WINDOW_CLOSED | VALIDATION_ERROR | FORBIDDEN` (F32). Client idempotency keys accepted and echoed in event detail (F33).

Accessibility (F46): every input labelled, lookup/mutation results announced via `aria-live`, status conveyed by text + colour, visible focus, accessible confirm dialogs, no information carried by colour alone.

---

## 5. Customers: fast assignment and reminders

### 5.1 Fast assignment

1. **One-tap chips**: customers with confirmed, positive-seat bookings on the in-context event (source table/statuses verified against the live bookings schema during build; deduped by customer; labelled "booked, N seats", F34). The tap selects; the person is confirmed as part of the hand-out confirm.
2. **Search-as-you-type**: existing FOH customer search.
3. **Quick-add (F16)**: dedicated voucher endpoint (not the `customers.manage` path): after a `vouchers.edit` check it atomically finds-or-creates by canonical E.164 (race-safe: on conflict returns the existing customer). Fields: name, mobile, **optional email** (needed for the email-first reminder channel). **Owner decision 2026-07-30: adding someone this way signs them up for all communications** - newly created customers get `sms_opt_in`, `marketing_sms_opt_in` and `marketing_email_opt_in` set true with timestamps and `sms_opt_in_source = 'voucher_handout'`; the form carries a line of copy so staff can say so out loud. WhatsApp opt-in is untouched (that channel has its own controlled opt-in). Customers who already exist never have their consent changed; a missing email is filled in if one is supplied. Reminders still respect consent and contactability at send time.

Optional at every step; assignable later from detail. Reassignment retargets pending reminders to the new customer; sent milestones are never repeated for the voucher (F36).

### 5.2 Reminder schedule (deterministic, F17/F18; expiry-led per owner decision 2026-07-30)

Vouchers are normally valid one month from hand-out, so reminders are counted back from the **expiry date**, not from issue. Outbox rows are (re)computed on issue, on expiry edit, and on customer assign/remove:

| Kind | Scheduled for |
|---|---|
| `pre_expiry_7` | expiry date - 7 London days |
| `pre_expiry_3` | expiry date - 3 London days |

Rules: two reminders maximum per voucher; a date already in the past when the row is computed is recorded `skipped` and never sent late (so a short-dated or late-assigned voucher simply gets fewer reminders); one voucher reminder per customer per London day (extras defer to the next day); redeem/expire/cancel/replace/unassign cancels pending rows; the outbox unique key `(voucher_id, reminder_kind)` is the idempotency guard; max 3 attempts then `failed` with the error stored (F51).

**Channel: email first, SMS only as fallback.** A customer with a usable email address is emailed (canonical `sendEmail`, options object); a customer with no email falls back to SMS (canonical `sendSMS`, metadata `voucher_id` + `reminder_kind`, GSM-7 safe, one segment). Neither contactable means the row is `skipped` with a reason. The channel used is stored on the reminder row. Both channels name the prize, where it was won and the expiry date; the 3-day message is more urgent than the 7-day one. All sends are logged to the customer's communications timeline by the canonical senders.

---

## 6. Print / PDF generation

- Template `src/lib/voucher-card-template.ts` modelled on the existing HTML-to-PDF templates, rendered via `generatePDFFromHTML` (`src/lib/pdf-generator.ts`), driven by the vendored handoff HTML's structure and `data-field` slots.
- **Fonts (F24): self-host.** DM Serif Display 400, Outfit 400/600, Clicker Script 400 WOFF2s (all SIL OFL, redistribution permitted) embedded as data-URI `@font-face` in the template so rendering never depends on a CDN. If the font files cannot be obtained during the build, fall back to the Google Fonts links used by the existing contract templates and record that as an accepted deviation in the PR.
- Assets embedded as base64 TS modules from `docs/design/voucher-system/assets/`.
- Layout: page box `296.6mm × 209.6mm`, `@page` A4 landscape margin 0, page order card-by-card (outside, inside), grouped by type, black ink only, no fold line. Terminology everywhere: 1 sheet = 2 PDF pages (F01).
- Storage (F42): private bucket `vouchers`, immutable object path `batches/{batchId}/render-{n}.pdf`, bytes + page count + attempts + last error recorded on the batch, signed URLs valid 10 minutes, PDFs retained 24 months (then deletable; voucher rows are kept indefinitely as dispute records).
- **Benchmark gate (F22):** before the cap is final, render 1/25/50/100-card batches through the production-like path and record timings; adjust the 100 cap and `maxDuration` from evidence.
- **Print acceptance gate (F45):** a real duplex test print must fold correctly and be signed off by the owner before the feature is released (not before local testing).

## 7. Architecture

### 7.1 Atomic transitions via RPCs (F05)

Every lifecycle change is one PostgreSQL function executing the guarded update **and** the `voucher_events` insert in a single transaction: `voucher_generate_batch`, `voucher_issue`, `voucher_redeem`, `voucher_undo_redeem`, `voucher_cancel`, `voucher_replace` (locks both rows), `voucher_edit_handout` (recomputes status + reminders), `voucher_assign_customer`, `voucher_override_redeem`, `voucher_expire_due`, `voucher_reminders_due`. All `SECURITY DEFINER` with `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role` (per the repo's function-grants lockdown precedent), called through the admin client after app-level `checkUserPermission`. Zero-row guards return the current status for exact error messages. `logAuditEvent` remains an app-level best-effort second log; `voucher_events` is the authoritative trail (documented resolution of F05).

### 7.2 RLS (F31)

All five voucher tables: RLS enabled, **no policies** (deny-all for anon and authenticated; the checklists-foundation pattern). Every read and write goes through server code (server actions / route handlers) using the admin client after permission checks. No browser ever queries these tables directly.

### 7.3 Permissions (F06, F30)

Module `vouchers` added to `ModuleName` and the permissions table: `view`, `edit` → staff, foh_staff, manager, super_admin (FOH surfaces). `create`, `manage` → manager, super_admin (generation, ledger, detail, overrides). Nav and all management pages gate on `manage`; the FOH page gates on `view` and its mutations on `edit`.

### 7.4 Scheduled work (F20/F21)

One cron entry: `/api/cron/vouchers-lifecycle`, schedule `0 1,2,10,11 * * *` (UTC). The route claims work by London run key (existing `getLondonRunKey` pattern): the expiry pass runs in the London-02:00 firing, the reminder pass in the London-11:00 firing, each at most once per London date, resumable mid-batch via id-ordered cursors (F51). Adds exactly one `vercel.json` entry (capacity confirmed: 43 crons already run on this plan).

### 7.5 GDPR (F37)

`voucher_events.detail` stores customer_id only, never names or phone numbers. Customer anonymisation/erasure: null `vouchers.customer_id`, cancel pending reminders, and the vouchers tables are added to the GDPR export in `src/app/actions/gdpr.ts`. Voucher rows and events are retained as business/dispute records; batch PDFs 24 months.

### 7.6 Monitoring (F44)

Render failures are visible on the batch (status, error, retry). Cron passes write the standard cron audit/log entries used by existing jobs, so the last-success time is inspectable; reminder outcomes (sent/skipped/failed + error) are on the voucher detail. Impossible states are prevented by constraints rather than monitored for.

## 8. Rollout (F48)

- Branch `feat/voucher-system`; no push to origin until the owner has tested locally (deploys track main).
- Migrations are additive-only and safe to apply ahead of code (tables invisible, RPCs service-role only, permissions granted but no UI deployed). This is expand-only; **forward-fix, not rollback**: to disable, remove role grants (hides all UI) and pause the cron entry. No claim that applied migrations, sent SMS or stored PDFs can be reverted.
- Order within release: migrations → code. FOH kiosk changes ship as one commit (F07).

## 9. Test plan (F45)

- **Unit (vitest)**: number formatting/normalisation (F50 cases incl. scanner suffixes, hyphenless input), counter exhaustion refusal, age bucket boundaries (London dates, DST both ways), reminder schedule derivation for all F18 cases (short expiry, late assignment, reassignment, expiry edits), zod schemas, clause-number derivation from the seeded array.
- **Template**: generated batch HTML has the right page count/order (card-by-card, grouped by type), unique numbers appearing twice per card, terms version stamped, no missing merge fields.
- **API/action level**: every transition matrix row (allowed and refused), idempotency-key retries, machine codes, permission refusals per role (staff vs foh_staff vs manager), FOH kiosk path regressions.
- **Manual gates for the owner**: duplex print folds correctly (before release, not before local test); FOH iPad walk-through (issue, redeem, undo, blocked states); reminder SMS to a test number.

## 10. Build order

1. Vendored handoff + seed extraction script (done/in build) → **Migration 1**: tables, constraints, indexes, counters, RLS deny-all, seeds (types, terms v2.0), RBAC module + grants.
2. **Migration 2**: transition RPCs + grants lockdown.
3. Shared lib: types, normalisation, numbering, schedule computation + unit tests.
4. PDF template + render route + storage + benchmark; manifest CSV.
5. Management section: Overview, Generate (two-step), Ledger, Detail, Types & terms + terms sheet, Hand-out mode. Nav + `ticket` icon.
6. FOH: APIs + page + kiosk wiring (one commit) + FOH header link.
7. Customer quick-add endpoint + reminders + lifecycle cron + `vercel.json`.
8. GDPR export addition; full pipeline (lint, typecheck, tests, build); migrations pushed to Supabase; branch ready for local testing.

## 11. Out of scope (v1)

Digital vouchers; per-voucher QR / public routes; EPOS integration (one-voucher-per-transaction remains an operational control, F41); UI editing of types/terms; hard booking-table links (booking_ref is free text; booking-required types redeem at booking confirmation, later cancellations handled by manager undo, F25); email reminders; staff PIN verification of attribution (F29 accepted risk: kiosk user + selected employee are both recorded).

## 12. Decision log (ALL OWNER-CONFIRMED 2026-07-30)

| # | Decision | Why |
|---|---|---|
| D1 | Expiry **required** at every hand-out (no "none") | Matches printed terms and your "I'll hand-write the expiry date in"; removes the F02 legal mismatch |
| D2 | Terms/type definition binds at **generation**; old stock stays issuable after a terms bump | Only physically coherent rule (F03) |
| D3 | Replacement = issue an existing stock card of the same type, copying customer/event/expiry | Matches the physical world (F09) |
| D4 | Management section is manager-only (`vouchers.manage`); staff + foh_staff get the FOH page only | Least privilege (F30) |
| D5 | Reprint of an issued card needs manager + "original destroyed" confirmation | Fraud control (F28) |
| D6 | Reminders: 7 days then 3 days before expiry, email first and SMS only without an email; max 2 per voucher; past dates skipped not sent late; one per customer per day | OWNER CONFIRMED 2026-07-30 (replaced the original day30/day90 cadence because vouchers are normally valid one month) |
| D7 | Quick-add takes an optional email and signs new customers up for all communications (no tick box); existing customers unchanged | OWNER CONFIRMED 2026-07-30 |
| D8 | Fonts self-hosted (OFL) with CDN fallback recorded if unobtainable | Print fidelity (F24) |
| D9 | Staff attribution unverified (no PIN) but kiosk account + selected employee both recorded | v1 pragmatism (F29) |
| D10 | One combined lifecycle cron with London run keys | Cron capacity + DST correctness (F20/F21) |
| D11 | Booking reference is optional and never blocks a redemption | OWNER 2026-07-30 (migration `20260802000005`) |
| D12 | Every type has a cash value (£6 to £40); outstanding value covers all stock | OWNER 2026-07-30 (migration `20260802000006`) |
| D13 | Seed values stored as plain text, escaped by the print template | Fixes entities leaking into the UI (migration `20260802000004`) |
