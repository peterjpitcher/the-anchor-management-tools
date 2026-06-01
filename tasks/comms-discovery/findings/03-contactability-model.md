# 03 — Contactability & Channel-Preference Model

**Audit goal:** Map the data + logic that governs "how can/should we contact a customer," and identify the gaps that block a "prefer email when an email is on file, fall back to SMS" engine.

**Method:** Live Supabase schema queried via `information_schema`; code read in `src/lib/twilio.ts`, `src/lib/email/emailService.ts`, `src/app/actions/customers.ts`, `src/lib/validation.ts`, and `src/services/customers.ts`. Read-only. `.env*` not read.

**Headline:** The SMS channel has a mature consent + health model. The **email channel has essentially none** — no deliverability signal, no bounce/complaint suppression, no marketing opt-in field, and no unsubscribe mechanism. There is **no** `email_opt_in` column in the current customer schema. A channel-preference engine cannot safely "prefer email" today because there is no way to know an email is deliverable or suppressed.

---

## 1. `customers` table — contact & consent fields (live schema)

| Column | Type | Default | Meaning | Who sets it | Used in code? |
|---|---|---|---|---|---|
| `email` | text | `null` | Customer email address | `createCustomer`/edit form, booking flows | Staff create/edit is `.email()`-validated by `customerSchema` and lowercased in `CustomerService`; some import/bulk paths still need auditing |
| `mobile_number` | text | `null` (NOT NULL per schema) | Primary mobile number | Customer create/edit, booking flows; normalised via `formatPhoneForStorage` | Yes — primary phone field used for sending |
| `mobile_e164` | varchar | `null` | E.164-normalised copy of the mobile | Capture/normalisation path; selected in `twilio.ts`/`bulk.ts` | Yes — used by send eligibility (`twilio.ts` L121) and bulk recipients |
| `sms_opt_in` | boolean | `true` | Customer consent to receive SMS | Capture form (`createCustomer`), STOP webhook, reconcile cron | **Yes — hard gate** (`twilio.ts` `checkSmsAllowed` + `bulk.ts`) |
| `marketing_sms_opt_in` | boolean | `false` | Marketing-vs-transactional SMS consent | `bookings_v05_foundations` backfill; STOP webhook; `import-messages` | **Gated only in `bulk.ts` (marketing)** — not in transactional send |
| `messaging_status` | text | `'active'` | Customer messaging health/state — CHECK in (`active`,`suspended`,…) | DB auto-deactivation function (squashed migration L1512) | Indexed; used in analytics; auto-deactivation flips it |
| `sms_status` | text | `'active'` | SMS channel state (`active`/`opted_out`/`sms_deactivated`) | Twilio webhook + reconcile cron + FOH routes | **Yes — gate** (`twilio.ts` L121; waitlist route L98 requires `'active'`) |
| `sms_delivery_failures` | integer | `0` | Cumulative SMS delivery failures | Twilio status webhook + `reconcile-sms` cron | Health metric / deactivation trigger |
| `consecutive_failures` | integer | `0` | Consecutive failures | Delivery-status updates | Health metric |
| `last_sms_failure_reason` | text | `null` | Last failure reason string | Delivery-status updates | Diagnostics (selected in `messages.ts` L143) |
| `sms_deactivated_at` | timestamptz | `null` | When SMS was auto/manually deactivated | Twilio webhook L273, reconcile cron L102, `services/customers.ts` | Diagnostics + UI display |
| `sms_deactivation_reason` | text | `null` | Why SMS deactivated | `services/customers.ts` opt-out path | Diagnostics |
| `last_successful_sms_at` | timestamptz | `null` | Last successful SMS timestamp | Delivery-status updates | Health metric |
| **`email_opt_in`** | **DOES NOT EXIST** | — | (would-be email consent flag) | — | **0 hits across schema, types, and all `src` code** |

**Correction to the brief's field list:** `mobile_e164` (varchar) **DOES exist** and is used by the SMS eligibility path. `mobile_number_raw` does NOT exist. `email_opt_in` does **NOT** exist either — it appears in zero schema columns, zero TS types, and zero code references (the brief implied it might be a dead column; in fact it is entirely absent). Phone-format variants are also computed on the fly via `generatePhoneVariants()` for search matching.

---

## 2. Email-side equivalents — PRESENT / ABSENT matrix

| SMS capability | SMS field/mechanism | Email equivalent | Status |
|---|---|---|---|
| Consent flag (transactional) | `sms_opt_in` (gated) | none — `email_opt_in` **does not exist** (0 refs) | **ABSENT** |
| Marketing consent (separate) | `marketing_sms_opt_in` (selected, not gated) | none | **ABSENT** |
| Channel health / status | `messaging_status`, `sms_status` | none | **ABSENT** |
| Delivery-failure tracking | `sms_delivery_failures`, `consecutive_failures` | none | **ABSENT** |
| Last failure reason | `last_sms_failure_reason` | none | **ABSENT** |
| Deactivation state | `sms_deactivated_at`, `sms_deactivation_reason` | none | **ABSENT** |
| Last successful send | `last_successful_sms_at` | none | **ABSENT** |
| Bounce / complaint capture | Twilio status callback → delivery-status updates | none (no Graph bounce/NDR ingestion) | **ABSENT** |
| Opt-out / unsubscribe mechanism | (see §3 — STOP/opt-out path) | **no unsubscribe link, route, or handler anywhere** | **ABSENT** |
| Suppression list | health columns act as suppression | none | **ABSENT** |
| Format validation on capture | phone normalised via `formatPhoneForStorage` | present on staff create/edit and public booking APIs; import/bulk paths still need audit | **PARTIAL** |

**No email-suppression infrastructure tables exist** (searched `information_schema.tables` for `%email%`, `%bounce%`, `%complaint%`, `%suppress%`, `%unsubscribe%`, `%opt%` — none). There is a `message_delivery_status` table, but it is SMS/Twilio-oriented.

**Bottom line: there is no way today to know whether a given email address is deliverable, has bounced, or has opted out.**

---

## 3. Current "can we SMS this customer?" decision

There is **no `src/lib/sms/service.ts`** (the brief's assumed path). SMS eligibility is decided in two real places:

**(a) Transactional / single send — `src/lib/twilio.ts` → `checkSmsAllowed()` (~L121–175):**
```ts
.select('sms_status, sms_opt_in, mobile_e164, mobile_number')   // L121
// ...
if ((customer as any).sms_opt_in === false) {
  return { allowed: false, reason: 'sms_opt_in_blocked' }       // L173–174
}
```
Gate ≈ **`sms_opt_in !== false`** plus presence of a number (`mobile_e164`/`mobile_number`). `sms_status` is selected here and enforced strictly elsewhere (e.g. `src/app/g/[token]/waitlist-offer/confirm/route.ts` L98 requires `sms_status === 'active'`).

**(b) Bulk send — `src/lib/sms/bulk.ts` (L180, L255–266):** selects `sms_opt_in, sms_status, marketing_sms_opt_in` and skips a recipient when:
- `sms_opt_in !== true` (L255), **and**
- `marketing_sms_opt_in !== true` (L259) — the marketing gate, **only present in the bulk path**, and
- `sms_status` is a blocked value (L264–266).

**(c) DB-side health / auto-deactivation:** the squashed migration (`20251123120000_squashed.sql` L1512–1528) flips `messaging_status`/`sms_opt_in` to deactivated when failures accumulate. The **Twilio status webhook** (`src/app/api/webhooks/twilio/route.ts` L264–273) and **`reconcile-sms` cron** (L93–102) set `sms_status='sms_deactivated'`, `sms_opt_in=false`, `sms_deactivated_at` after >3 failures, and the **inbound STOP handler** (L617–654, keywords `STOP/UNSUBSCRIBE/QUIT/CANCEL/END/STOPALL`) sets `sms_status='opted_out'`, `sms_opt_in=false`, `marketing_sms_opt_in=false` (fail-closed).

**Gaps in the SMS gate itself:**
- The transactional path (`twilio.ts`) gates on `sms_opt_in` but **does not require `marketing_sms_opt_in`** — the transactional/marketing split exists only in `bulk.ts`. So "transactional vs marketing" is inconsistent even for SMS.
- There is no single shared "can we contact?" resolver — eligibility logic is duplicated across `twilio.ts`, `bulk.ts`, `parking/sms-safety.ts`, and per-route checks.

---

## 4. Current "do we have a usable email?" decision

**There is no such decision.** Email is treated as a free-text string end-to-end:

- **Staff capture (`src/app/actions/customers.ts` → `customerSchema` in `src/lib/validation.ts`):** customer `email` is `.email()`-validated via `optionalEmailSchema`; `CustomerService.sanitizeEmail()` trims and lowercases before insert/update. The *public/API* booking routes also validate email — `z.string().trim().email().max(320)` appears in `api/table-bookings/route.ts` L45, `api/event-bookings/route.ts` L30, `api/event-waitlist/route.ts` L29, `api/external/create-booking/route.ts` L22, `api/public/private-booking/route.ts` L38, `api/parking/bookings/route.ts` L21. Import/bulk paths and any new capture surfaces still need the same audit.
- **Send (`src/lib/email/emailService.ts`, `sendEmail`):** the wrapper passes `options.to` straight into Graph `toRecipients`, then posts to Microsoft Graph `sendMail`. **No format validation, no consent check, no suppression check, no bounce handling.** The only failure mode surfaced is a Graph API error at send time.
- **"Usable email" today = "the string is present and usually format-valid."** That is still too weak to drive channel preference because there is no delivery-health or suppression signal.

**Email capture surfaces:** staff customer create/edit (`actions/customers.ts` — **has `.email()`**); public table-booking (`src/app/table-booking/_components/PublicBookingClient.tsx` → `api/table-bookings` — **has `.email()`**); parking guest (`src/app/parking/guest/[id]/_components/PublicParkingClient.tsx` → `api/parking/bookings` — **has `.email()`**); event bookings/waitlist and private-booking enquiry (**have `.email()`**). Net: format validation is mostly present, but **no surface** records deliverability, bounce/complaint suppression, or marketing email consent.

---

## 5. Employees

- `employees.email_address` (text, nullable) and `employees.phone_number` (text, nullable) only.
- **No** employee-level contact-channel preference, opt-in, or suppression fields. (Staff comms — rota emails, payroll — assume email is present and valid.)

---

## 6. Legal / consent (UK PECR + GDPR)

- **Transactional vs marketing:** The schema *intends* the SMS split (`sms_opt_in` + `marketing_sms_opt_in`). **In practice the split is not enforced for all SMS** (`marketing_sms_opt_in` is bulk-only) and **does not exist at all for email.**
- **PECR risk for email marketing:** Under PECR, marketing email to individuals generally requires consent or the "soft opt-in" (existing-customer, similar products, opt-out offered at collection **and in every message**). Today there is **no opt-out link in any email** and **no unsubscribe route/handler** (`grep` for `unsubscribe|optout|opt-out` across `src` returns nothing). Sending marketing email in the current state would not satisfy the soft opt-in's "easy opt-out in every message" requirement.
- **Transactional email** (booking confirmations, receipts, contracts) is permissible without marketing consent — but a **bounce/complaint suppression** mechanism is still operationally required to protect sender reputation on the shared Microsoft Graph mailbox.
- **SMS opt-out:** Robustly handled — inbound STOP keywords (`twilio/route.ts` L617–654) and failure-driven auto-deactivation both flip `sms_opt_in=false`/`sms_status`, and sends honour it, fail-closed. **No equivalent path exists for email** (no inbound parsing, no unsubscribe link, no bounce ingestion).
- **GDPR:** Since there is no `marketing_email_opt_in` column at all, email-marketing consent state is **not recorded anywhere** — there is no field to store a customer's email-marketing preference even if it were captured.

---

## 7. Phone presence vs email presence — reliability

- **Phone:** Normalised to E.164 on capture (`formatPhoneForStorage`), and SMS delivery health is actively tracked, so a present `mobile_number` on a non-suspended customer is a **reasonably trustworthy** "reachable" signal.
- **Email:** Mostly format-validated, normalised text with **zero** deliverability feedback loop. A present `email` value is **NOT** a trustworthy "reachable" signal — it may be a typo, placeholder, long-dead, or previously bounced/complained, and the system has no way to know.
- **Implication for "prefer email":** Preferring email purely on `email IS NOT NULL` would route messages to addresses of unknown validity with no suppression safety net — risking silent non-delivery of transactional comms (booking confirmations, deposits) and reputation damage. **This is the core blocker.**

---

## 8. Required schema / logic additions for a channel-preference engine

**(a) Know an email is deliverable**
1. Keep format validation + normalisation on staff/public capture paths and audit imports/bulk-edit paths for the same `trim().email().lowercase()` behaviour — mirror what phone already does.
2. Add `customers.email_status` (text, e.g. `unknown` / `valid` / `invalid` / `bounced` / `complained`) plus `email_delivery_failures` (int), `last_email_failure_reason` (text), `last_successful_email_at` (timestamptz), `email_deactivated_at` (timestamptz).
3. Ingest Resend bounce/complaint/delivery webhook signals to populate the above (the missing email equivalent of the Twilio status-callback → `message_delivery_status` loop).

**(b) Email opt-out / bounce suppression**
4. Add `email_suppressions` and pre-send suppression checks; for this transactional programme, no global transactional `email_opt_in` gate is proposed.
5. Add an **unsubscribe mechanism** before any marketing email work: a tokenised opt-out route (mirror the short-link pattern, e.g. `/u/<token>`) + an unsubscribe link in marketing email templates; flipping it sets `marketing_email_opt_in = false`.
6. Add a suppression check in `sendEmail`/`selectChannel` (skip if `email_deactivated_at` set, `email_status IN ('invalid','bounced','complained')`, or the address exists in `email_suppressions`).

**(c) Marketing vs transactional consent, per channel**
7. Add `marketing_email_opt_in` (boolean) to mirror `marketing_sms_opt_in`.
8. Introduce an explicit **message category** (`transactional` | `marketing`) passed into `sendSMS`/`sendEmail`, and gate: transactional → channel-health only; marketing → also require the channel's marketing opt-in. (This also closes the existing SMS gap where `marketing_sms_opt_in` is ignored.)

**(d) Per-customer / per-comm channel decision**
9. Add a single resolver, e.g. `resolvePreferredChannel(customer, { category })`, returning `'email' | 'sms' | 'none'`. Suggested logic:
   - If `category === 'marketing'` apply marketing opt-in per channel; else apply consent/health only.
   - Prefer **email** when: `email` present AND `email_status NOT IN (invalid/bounced/complained)` AND not `email_deactivated_at` AND not suppressed (and `marketing_email_opt_in` if marketing).
   - Else fall back to **SMS** when the existing SMS gate passes (`messaging_status != 'suspended'`, `sms_opt_in`, `mobile_number` present).
   - Else `'none'`.
10. (Optional, explicit override) `customers.preferred_channel` (`auto` | `email` | `sms`), default `auto`, so staff/customers can pin a channel; the resolver respects it before falling back to the auto rule.
11. Route all customer comms through the resolver instead of calling `sendSMS`/`sendEmail` directly, so the preference + suppression rules are enforced in one place.

**Migration ordering:** add `email_status` health columns, `marketing_email_opt_in`, and `email_suppressions`; audit capture-time validation; then Resend bounce/complaint ingestion; then the resolver + category-aware gating; then flip default routing to "prefer email." All additive — no destructive changes.

---

## Evidence index
- Schema source: `.claude/session-context.md` (customers = 26 cols, employees) — live `customers` list incl. `mobile_e164`, `sms_opt_in` (true), `marketing_sms_opt_in` (false), `sms_status`/`messaging_status` (active), failure-tracking columns; **no `email_opt_in`**. `message_delivery_status` table exists (SMS); no email-suppression tables.
- SMS gate: `src/lib/twilio.ts` L121/L173–174 (`checkSmsAllowed`); `src/lib/sms/bulk.ts` L180/L255–266 (bulk + marketing gate); `src/app/g/[token]/waitlist-offer/confirm/route.ts` L98 (`sms_status==='active'`); `src/lib/parking/sms-safety.ts` L41.
- SMS opt-out / health writers: `src/app/api/webhooks/twilio/route.ts` L264–273 (auto-deactivate), L617–654 (STOP keywords); `src/app/api/cron/reconcile-sms/route.ts` L93–102; `src/services/customers.ts` L485–540; migration `20251123120000_squashed.sql` L1512–1528.
- Email: `src/lib/email/emailService.ts` — `sendEmail` (no consent/suppression/deliverability check before send).
- Email capture: `.email()` validators in `src/lib/validation.ts` `customerSchema` and in `api/table-bookings|event-bookings|event-waitlist|external/create-booking|public/private-booking|parking/bookings` routes; `src/services/customers.ts` lowercases staff-created/edited customer emails.
- Searches across `src`: `email_opt_in`/`emailOptIn` = **0 hits**; `marketing_sms_opt_in` written/gated only in bulk + webhook + service; no email unsubscribe route/handler.
