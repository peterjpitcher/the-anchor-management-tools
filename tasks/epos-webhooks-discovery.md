# EPOS (Tabology / rposcloud) Webhooks — Discovery

_Discovery only. No code written. Grounded in a 6-agent sweep of the AMS codebase (real tables, RPCs and file paths cited) reconciled against the **full** event list shown in the back office (13 events, not the 3 in the published docs)._

---

## TL;DR

Your till can now push 13 real-time signals to a single signed webhook URL we host: the full **member** lifecycle, the full **booking** lifecycle (request → confirm → arrive → depart, plus no-show and walk-in), and the daily **cash-up**. AMS already has a mature home for every one of these — the `customers`/`loyalty_members` tables, `table_bookings`, and the finished **Cashing Up** module — plus a battle-tested inbound-webhook pattern (Twilio/Stripe/PayPal) we copy almost line-for-line.

Two things changed once I saw the real event list:

1. **The "data goes stale" risk is largely gone.** The docs implied only `*.created`/`*.ran` events. In reality you get `member.updated`/`deactivated` and `booking.updated`/`declined`/`no_show`/`cancelled`-style events, so we can keep ingested records current instead of letting them drift.
2. **Bookings becomes the most valuable group, not the riskiest** — `arrived`/`departed` give real attendance and dwell time, `no_show` gives an automatic no-show register against customer profiles, `walk_in` captures walk-in covers.

**Single best first build:** a **log-only, signature-verified `/api/webhooks/tabology` endpoint** that writes nothing to live tables yet — it just verifies the HMAC, dedupes on the event id, and records every real delivery to `webhook_logs`. It's zero-risk, and it captures the real payloads we need before we map a single field (the docs explicitly say the payloads are examples). **Then** the first business build is **cash-up auto-prefill**, because `cashup.ran` carries no customer PII and lands in a finished module.

---

## Full event catalogue (what the till can actually send)

### Members (4)
| Event | Meaning |
|---|---|
| `member.created` | Someone joined loyalty at the till |
| `member.updated` | Their details changed |
| `member.activated` | Membership (re)activated |
| `member.deactivated` | Membership deactivated |

### Bookings (8 — full lifecycle)
| Event | Meaning | Why it's useful |
|---|---|---|
| `booking.requested` | Booking requested | Inbound demand, pre-confirmation |
| `booking.confirmed` | Booking confirmed | The reservation is real |
| `booking.updated` | Booking changed | Keeps our copy current (kills drift) |
| `booking.declined` | Venue/staff declined it | Close the loop, don't chase |
| `booking.no_show` | Guest didn't turn up | **Auto no-show register on the customer profile** |
| `booking.walk_in` | Walk-in seated | Captures covers that never booked |
| `booking.arrived` | Guest arrived | **Real attendance** (not just intent) |
| `booking.departed` | Guest left | **Dwell time** = arrived → departed |

### Cash Up (1, but a rich payload)
`cashup.ran` — a Z-read / cash-up was run. The **real** payload (from your back office, not the docs) includes more than the docs showed:
- `gross_sales`
- `payments.{cash,card,…}.{expected,actual}`
- `closing_cash.{expected, actual, variance}` ← float reconciliation
- `plan.meta.{date, venue_name}`, `plan.invoice.lines[]`
- `journals[]`, `warnings[]` ← surface EPOS-side warnings to staff

---

## What we can build (opportunities, ranked, grounded in real AMS code)

### A. Cash Up — best first business build (finished module, no PII)

1. **Auto-prefill a draft cash-up from `cashup.ran`** — _M / high._ On receipt, upsert a **draft** `cashup_sessions` row via the existing `upsert_cashup_session_atomic` RPC (`src/services/cashing-up.service.ts`), filling the **expected** cash/card figures from the payload. Staff still count the physical drawer and submit. Removes the most error-prone manual step (retyping the Z-read).
2. **Turn variance into real EPOS-vs-till reconciliation** — _S / high._ Pre-fill `expected_amount` per method from EPOS; keep `counted_amount` manual. The existing variance UI/dashboard (already flags > £50) does the rest. Now your variance compares **counted cash** against the **till's own expectation**, not a hand-typed number.
3. **Capture `closing_cash.variance` + `warnings`** — _S / med._ Surface the float variance and any EPOS warnings directly on the cash-up so staff see discrepancies the till already detected.
4. **Same-day variance alert to a manager** — _S / med._ If `|counted − expected|` exceeds a threshold, email via Microsoft Graph. Recipient/threshold could live in `cashup_config`.
5. **Feed the sales-mix charts from `gross_sales`** — _M / med._ Only if Tabology emits a department split; populate `cashup_sales_breakdowns` / `pnl_sales_imports`. **Blocked on** confirming `gross_sales` granularity + tax basis (currently a single number, unknown if ex-VAT).

> ⚠️ `cashup_payment_breakdowns` supports arbitrary payment codes, but the UI + aggregation **hardcode CASH / CARD / STRIPE**. Any other method in the EPOS `payments` object is silently dropped unless we generalise that code.
> ⚠️ Physical denomination counts (`cashup_cash_counts`) have **no source** in the payload — they stay manual (EPOS can only prefill the expected side).

### B. Bookings — most strategic, now low-drift thanks to lifecycle events

1. **Mirror the booking lifecycle into `table_bookings` tagged `source='epos'`** — _M / high._ On `booking.confirmed`, find-or-create the customer via `ensureCustomerForPhone`, then INSERT directly (the `create_table_booking_v05` RPC assigns tables / enforces deposits and would reject EPOS-shaped data). Apply `booking.updated`/`declined`/`cancelled` to the same row keyed on the EPOS booking id. **Needs** a new external-id column on `table_bookings` (today only an internal `correlation_id` exists).
2. **No-show register** — _S / high._ `booking.no_show` flags the booking and stamps the customer profile. Genuinely valuable for a venue taking reservations.
3. **Real attendance + dwell time** — _M / med._ `arrived`/`departed` give true turn-up rate and average dwell — feeds reporting and capacity planning.
4. **Walk-in capture** — _S / med._ `booking.walk_in` records covers that never pre-booked, for fuller trade data.
5. **Unified FOH/BOH booking list** — _S / med._ EPOS + AMS bookings in one view with a `source` badge/filter.
6. **Soft double-booking flag** — _M / high._ EPOS bookings carry no table assignment, so they bypass the `booking_table_assignments` exclusion-constraint guard; flag clashes for staff review rather than rejecting.
7. **AMS-branded confirmation (optional, off by default)** — _M / med._ Reuse `notifyCustomer`, but only if Tabology isn't already confirming the guest, and consent allows (new customers default `sms_opt_in=false`).

> ⚠️ **The decision that gates this group:** is Tabology now the **source of truth** for restaurant bookings, or AMS? The presence of `booking.requested`/`confirmed`/`walk_in` suggests Tabology runs a full booking workflow. If both systems create bookings with no shared key, we get duplicates. We need an external-id column **and** a "which system wins" rule.

### C. Members — live CRM sync (no longer one-shot)

1. **Sync `member.created` into `customers` with phone/email dedupe** — _M / high._ Reuse `CustomerService.findExistingCustomerByPhone` + `generatePhoneVariants` and the `mobile_e164`/email unique indexes to find-or-create. **Needs** a name-split rule (EPOS sends one `name`; `customers.first_name`/`last_name` are NOT NULL).
2. **Store the EPOS `card_id`/member id for stable linkage** — _S / high._ Add a nullable `customers.epos_member_id` + unique index (one additive, non-destructive migration) so we upsert instead of re-creating, and dedupe replays.
3. **Keep records current via `member.updated`/`activated`/`deactivated`** — _S / high._ This is the upgrade the real event list unlocks: reflect changes and deactivations instead of letting the synced record rot.
4. **Surface "EPOS member" on the customer profile** — _M / med._ Badge + card id + active status next to the existing VIP Club status on `customers/[id]/page.tsx`.
5. **Optional welcome SMS/email** — _M / med._ Through the existing safety-guarded sender, gated strictly on consent and only for genuinely new customers.

> ⚠️ Two parallel "membership" concepts will collide: your existing **VIP Club** (`loyalty_members`, currently **dormant** — schema exists, zero app code) vs **Tabology EPOS loyalty**. We need a decision: unify them on the customer, or keep distinct.

### D. Cross-cutting

1. **One signed `/api/webhooks/tabology` route + idempotency + delivery log** — _M / high._ The prerequisite for everything; reuses `idempotency_keys` and `webhook_logs` (`webhook_type='tabology'`) unchanged.
2. **EPOS events on the unified customer timeline** — _M / high._ The `customer_communications` view already carries `channel` + `context` jsonb; add a `channel='epos'` branch ("Joined loyalty", "Booked", "Visited", "No-show"). Depends on events persisted with a `customer_id`.

---

## How it would technically work

- **One inbound `POST /api/webhooks/tabology`** route, Node runtime, modelled almost line-for-line on `src/app/api/webhooks/paypal/route.ts` (verify → parse → claim idempotency → fan-out `switch(type)` → write → audit → log → 200).
- **Read the raw body** via `request.text()` _before_ anything else (HMAC must run over exact bytes; the Twilio/Resend routes already do raw-body reads).
- **Verify the HMAC-SHA256 `Signature` header** by reusing `verifyStripeWebhookSignature` / `secureHexEquals` in `src/lib/payments/stripe.ts` (`crypto.createHmac` + `crypto.timingSafeEqual`). Support both hex and base64 until we confirm Tabology's encoding.
- **401 on bad signature, persist nothing.** Return **200 for handled _and_ unknown event types** so Tabology stops retrying.
- **Idempotency on the event `id`:** `claimIdempotencyKey('webhook:tabology:<type>:<id>')` via `src/lib/api/idempotency.ts` — free replay protection (important: the lifecycle events will arrive in sequence and possibly out of order).
- **Log every delivery** to `webhook_logs` (`webhook_type='tabology'`) to mirror Tabology's own Delivery Log inside AMS; write an `audit_logs` row per handled event.
- **New env var** `TABOLOGY_WEBHOOK_SECRET` in `.env.example` + Vercel. No middleware change needed — `/api` is already public-allowlisted in `src/middleware.ts`.
- **All DB writes go through existing services/RPCs** (`CustomerService`, `ensureCustomerForPhone`, `upsert_cashup_session_atomic`) — never raw inserts — so dedupe, totals and audit stay consistent.
- **Hardening to decide:** the endpoint is HMAC-only with no rate limiting today (`applyDistributedRateLimit` exists but Upstash isn't provisioned); `webhook_logs` has no retention/cleanup job.

---

## Key risks & limitations (updated for the real event list)

- ✅ **Drift risk largely resolved.** Member and booking **update/lifecycle** events exist, so synced records can stay current — a big improvement over the docs' impression of create-only.
- ⚠️ **Still no explicit hard-delete event.** A record removed (not just deactivated/declined) in the EPOS won't notify us. Likely rare; handle with a periodic reconcile if Tabology offers a pull API.
- ⚠️ **Booking source-of-truth / duplication.** AMS already owns table bookings (table assignment, deposits, conflict guards). With both systems creating bookings we risk doubles without a shared external id + a "who wins" rule. **This is the single biggest decision.**
- ⚠️ **Payloads are examples, not a contract.** The docs say the field set may differ — and the real `cashup.ran` already proved richer (`closing_cash`, `warnings`, `plan`). We map nothing to live tables until we've captured real deliveries (hence log-only first).
- ⚠️ **Phone/email dedupe is imperfect.** A member with a mistyped/missing phone creates a duplicate or an unmatchable record.
- ⚠️ **GDPR / PII.** `member.*` and `booking.*` bring name/email/phone into AMS. We must **not** default new members to `sms_opt_in`/marketing consent without a lawful basis — the payload shows `active`, not consent. `cashup.ran.ran_by` is a staff email (minor PII to log).
- ⚠️ **Business-date / timezone.** A late-night Z-read crossing midnight could map to the wrong trading day unless we apply the Europe/London "business date" rule the codebase already standardises on.
- ⚠️ **Payment-method coverage.** Cash-up UI hardcodes CASH/CARD/STRIPE; other EPOS methods get dropped unless generalised.

---

## What I need from you (decisions before any build)

1. **Real sample payloads** — one captured delivery for each event you care about (at minimum `cashup.ran`, `member.created`, `booking.confirmed`/`updated`/`no_show`). The log-only endpoint can capture these for us if that's easier than copying from the Delivery Log.
2. **Signing scheme** — confirm the `Signature` header encoding (hex or base64) and whether the HMAC covers the **raw body only** or **body + timestamp**. Where is the secret issued in the back office?
3. **Single venue?** — confirm there's exactly one `venue_id` mapping to the one AMS site (The Anchor), with no second venue planned. Makes cash-up mapping trivial.
4. **Cash-up authority** — should an incoming `cashup.ran` be the authoritative "expected" figure and prefill a draft? What if a session for that day already exists as draft / submitted / approved / locked? (Staff still count the physical drawer regardless — agreed?)
5. **Booking source-of-truth** — do EPOS bookings flow **into** the AMS calendar (recommended) or stay separate? Does Tabology already send the guest its own confirmation (if so, AMS stays silent)? Are EPOS bookings exempt from the £10pp deposit rule (groups of 7+)?
6. **Member consent** — does any event carry an opt-in flag? Policy for SMS/email marketing consent on EPOS-sourced members? When an existing AMS customer matches by phone/email, do we **update** them from EPOS or only fill gaps?
7. **Loyalty model** — surface the `card_id` on profiles? Map EPOS members onto the dormant `loyalty_members` (VIP Club) table or a new dedicated one (they're different programmes)?
8. **`cashup.ran` granularity** — is `gross_sales` a single number or split by department (drinks/food/other)? Tax-inclusive or ex-VAT? Decides whether we can auto-populate the sales-mix charts.
9. **Comms behaviour** — should new members / bookings trigger any automatic message, or is this silent CRM enrichment for now?
10. **Scope & order** — which events first? My recommendation below.

---

## Recommended phased plan

**Phase 0 — Log-only endpoint (ship first, ~0.5–1 day).**
Stand up `/api/webhooks/tabology` with HMAC verification, idempotency and `webhook_logs` capture. Writes nothing to `customers`/`table_bookings`/`cashup_sessions`. Point Tabology at it, enable all events. Zero production risk; immediately captures the real payloads (answers Q1) and proves the signing scheme (Q2). Mirrors Tabology's Delivery Log inside AMS.

**Phase 1 — Cash-up auto-prefill (highest ROI, no PII).**
Map `cashup.ran` → draft `cashup_sessions` via `upsert_cashup_session_atomic`; turn variance into real reconciliation; surface `closing_cash.variance` + `warnings`. Optional manager variance alert.

**Phase 2 — Member sync + customer enrichment.**
`member.*` → find-or-create/update `customers` with `epos_member_id`; surface on the profile. Consent-gated, no auto-comms unless you ask for them.

**Phase 3 — Booking mirror + attendance.**
Once source-of-truth is decided: mirror `booking.*` into `table_bookings` (`source='epos'`, external id), no-show register, arrived/departed dwell time, unified FOH/BOH list, soft conflict flag.

**Phase 4 — Unified timeline.**
Surface EPOS member/booking/visit/no-show events on the customer timeline (`channel='epos'`).
