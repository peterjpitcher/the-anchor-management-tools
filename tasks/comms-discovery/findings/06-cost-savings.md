# 06 — SMS Cost Model & Savings-Prioritisation Framework

**Goal:** Cut Twilio SMS spend by switching customers who have an email on file from SMS → email (Microsoft Graph / Outlook, which has no per-message fee).

**Method:** Code-first investigation of how SMS cost is recorded and which comms drive volume, plus a **live read-only Supabase probe** (project `tfcasgxopxegwrabvwat`, SELECT-only, no writes). Measured facts, code facts, and estimates are clearly separated.

> **MEASURED** = live DB query result this session. **CODE FACT** = verified in source. **ESTIMATE** = reasoned / derived. **⚠️ = load-bearing caveat.**

---

## 0. Headline (read this first)

1. **⚠️ The `cost_usd` column is NOT Twilio's real billed price — it is a hardcoded estimate of `$0.04 × segments`.** Proven in code *and* data (§1). Over 90 days, `price` is populated on **0** rows and every priced row equals `0.04 × segments` exactly (MEASURED: 938 priced rows, 0 deviating). **Do not present any `$` figure from this column as actual Twilio spend** — for UK A2P SMS the true price is typically *below* $0.04, so the recorded numbers likely **over-state** real spend. Use the column only as a **volume ranking proxy**.
2. **Email coverage is low overall (138/758 = 18.2% MEASURED), and the customers who actually receive SMS skew far lower.** Per-comm coverage is **bimodal** (§3): table-booking comms 43–60%, but event/marketing comms 0–10%. The single biggest-spend comm (`bulk_sms_campaign`) reaches recipients who are **only 6.3% emailable**.
3. **SMS volume is declining** (MEASURED: 1,060 outbound last 90d vs 2,201 prior 90d). Absolute spend is small. This is an optimisation-of-method exercise, not a major cost line.
4. **Every customer-facing SMS sender is SMS-only with no email branch (CODE FACT).** That is the opportunity — but it is gated hard by email coverage, which is near-zero for most automated sends.
5. **A bigger, cheaper win than channel-switching exists:** ~$6.8/90d (the 158 "untagged" rows) is **wasted SMS to bad/unreachable numbers** (all `status='failed'`, Twilio errors 21612/21211 — §2). Fixing number data quality recovers more than converting most comms to email, with no UX change.

**Bottom line:** the only conversion that meaningfully saves money is **table-booking confirmations + table review follow-ups** (decent volume × ~50% email coverage). Converting event reminders or marketing saves almost nothing because those recipients are phone-only. The highest-leverage action overall is an **email-capture drive**, which lifts the ceiling for everything.

---

## 1. How SMS cost is recorded (CODE FACT + MEASURED)

The `messages` table is the single source of truth. Messaging-cost columns (MEASURED via `information_schema`): `cost_usd numeric`, `price numeric`, `price_unit text`, `segments integer`, `message_type text`, `template_key text`, `direction text`, `status text`, `twilio_status text`, `sent_at`, `created_at`. (There is **no** `category` column on `messages` — the brief mentioned one, but it does not exist; attribution is via `template_key` only.)

**Capture flow:**

1. **At send — `src/lib/twilio.ts` `sendSMS` (CODE FACT):**
   - `const segments = Math.ceil(smsBody.length / 160)` (line ~470) — segments computed **locally**, GSM-7 160-char assumption. ⚠️ Ignores Unicode/emoji messages (which segment at 70 chars), so counts can be under-stated for non-GSM bodies.
   - log row written with `segments` and `costUsd: segments * 0.04` (lines ~528–530), explicitly commented *"Approximate cost if not provided by API immediately (usually it isn't)."*
   - `template_key` propagated from `options.metadata.template_key` (lines 289, 308, 669) — the per-comm attribution key.

2. **On Twilio status callback — `src/app/api/webhooks/twilio/route.ts` (CODE FACT):** the existing-message update writes only `status` (mapped), `twilio_status`, `error_code`/`error_message`, `delivered_at`/`failed_at`. **It does NOT write `cost_usd`, `price`, or `segments` from the callback `Price`/`NumSegments`.** Inbound messages are inserted with `cost_usd: 0` hardcoded. The `reconcile-sms` cron updates status/error fields but **does not** backfill real price either.

3. **Net effect:** `cost_usd` is always the `$0.04 × segments` estimate; Twilio's authoritative price is never stored. **MEASURED confirmation (90d):** `price_populated = 0`, `distinct_price_units = 0`, `cost_not_eq_(0.04×segments) = 0`. Distinct (segments, cost) pairs all at exactly $0.04/segment: 1-seg→$0.04 (721 rows), 2-seg→$0.08 (181), 3-seg→$0.12 (33), 4-seg→$0.16 (3). 938 priced rows, 122 null-cost rows.

**Per-comm linkage:** via **`template_key`**. **Gap:** some sends leave it null → an untagged bucket (§2).

**Billing reality:** Twilio bills `undelivered`/`failed` carrier rejections too; the recorded estimate counts these.

---

## 2. SMS comm types + volume ranking (MEASURED, last 90 days)

Outbound, `created_at >= now() - 90d`. **`est $` below is the app's $0.04/segment estimate — a volume-weighted ranking proxy, NOT real Twilio spend.**

| Rank | template_key | msgs | segments | est $ (proxy) | nature |
|---:|---|---:|---:|---:|---|
| 1 | `bulk_sms_campaign` | 143 | 286 | $11.44 | Marketing blast |
| 2 | `event_cross_promo_14d` | 89 | 178 | $7.12 | Marketing (cross-promo) |
| 3 | **(untagged)** | 158 | 169 | $6.76 | ⚠️ ALL `status='failed'` — wasted sends to bad numbers |
| 4 | `table_booking_confirmed` | 115 | 115 | $4.60 | Transactional |
| 5 | `table_review_followup` | 114 | 114 | $4.56 | Review request (table) |
| 6 | `event_general_promo_14d` | 55 | 110 | $4.40 | Marketing |
| 7 | `event_booking_confirmed` | 52 | 52 | $2.08 | Transactional |
| 8 | `event_reminder_1d` | 37 | 37 | $1.48 | Reminder (24h) |
| 9 | `private_booking_created` | 23 | 33 | $1.32 | Transactional (private) |
| 10–11 | `event_reminder_promo_3d` / `_7d` | 32 / 32 | 32 / 32 | $1.28 / $1.28 | Reminder + promo |
| 12 | `message_thread_reply` | 19 | 23 | $0.92 | Manual two-way reply |
| 13 | `event_review_followup` | 17 | 19 | $0.76 | Review request (event) |
| … | parking / sunday_preorder / private_booking_* lifecycle | 1–14 each | — | ≤$0.72 each | Low-volume transactional |
| — | `event_manual_promo_3d` / `_correction` | 32 / 32 | 32 / 32 | $0.00 (cost null) | Manual promo, cost not recorded |

**Totals (MEASURED):** 1,060 outbound msgs, 1,399 segments, $53.40 estimated, avg 1.32 seg/msg, 64 null-cost rows (the 64 null + 996 priced = 1,060). **Prior 90d: 2,201 msgs / $117.64 — volume roughly halved.**

**Grouped by purpose (est $, 90d):**
- **Marketing / promo** (`bulk_sms_campaign` + both `*_cross/general_promo_14d` + `event_reminder_promo_3d/7d` + manual promos): **≈ $26 — the single largest category (~half of all volume).**
- **Transactional confirmations** (table + event + private created): ≈ $8.
- **Review requests** (table + event followups): ≈ $5.3.
- **Untagged** (⚠️ all *failed* sends — see below): ≈ $6.8.
- **Reminders** (`event_reminder_1d`): ≈ $1.5.
- **Parking / sunday / misc lifecycle:** ≈ $4.

**⚠️ Untagged bucket decomposition (MEASURED — important):** all 158 rows have `status='failed'`, with Twilio error codes **21612 (97 rows — "not reachable / unable to receive")**, **21211 (55 — "invalid To number")**, 21408 (5), 21610 (1). These are **wasted SMS to bad/unreachable mobile numbers** — Twilio still bills them, est $6.76/90d of pure waste. Only ~32% of these customers have an email. **This is NOT a hidden comm to convert — it is a data-quality problem.** Two cheaper wins than channel-switching: (a) clean/validate mobile numbers (the app already has `sms_delivery_failures`/`sms_deactivated_at` tracking — tighten the auto-deactivation threshold), and (b) for the ~32% with an email, fall back to email after an SMS hard-fail. Tag these sends with a `template_key` so the waste stops being invisible.

**Key structural finding (CODE FACT):** Every customer-facing SMS sender reads `customer.mobile_number` and calls `sendSMS` **unconditionally** — none branch on `customer.email`. So **100% of these comms go by SMS even when an email exists.** A `notification_preferences jsonb default '{"sms":true,"email":true}'` migration reference exists for `loyalty_members`, not `customers`, so there is no customer-level preference override to honour today. This is the opportunity — bounded hard by §3.

---

## 3. Email-availability leverage (the savings ceiling) — MEASURED

`customers.email` exists (`character varying`; unique index `idx_customers_email_unique on customers(lower(email))` added late "for event check-in", consistent with sparse population).

**Overall coverage (MEASURED, `customers`):**

| Metric | Count | % of total |
|---|---:|---:|
| Total customers | 758 | 100% |
| **Have email (non-empty)** | **138** | **18.2%** |
| Have mobile | 758 | 100% |
| Have both mobile + email | 138 | 18.2% |
| **Mobile-only (no email)** | **620** | **81.8%** |
| sms_opt_in = true | 531 | 70.1% |
| marketing_sms_opt_in = true | 362 | 47.8% |

**⚠️ Only ~18% of all customers can be converted; ~82% are phone-only.** But the binding number is per-comm coverage of *actual recipients*, which is far worse for most sends:

**Per-comm email coverage of actual recent recipients (MEASURED — the real per-comm `share_with_email`; bimodal and mostly LOW):**

| Comm | sends | recipients w/ email | % with email |
|---|---:|---:|---:|
| **`table_booking_confirmed`** | 115 | 69 | **60.0%** |
| `table_review_followup` | 114 | 49 | **43.0%** |
| `private_booking_created` | 23 | 9 | 39.1% |
| `event_booking_confirmed` | 52 | 5 | 9.6% |
| `event_reminder_promo_3d` | 32 | 3 | 9.4% |
| `event_cross_promo_14d` | 89 | 7 | 7.9% |
| `bulk_sms_campaign` | 143 | 9 | **6.3%** |
| `event_reminder_promo_7d` / `event_manual_promo_3d` / `_correction` | 32 ea | 2 ea | 6.3% |
| `message_thread_reply` | 19 | 1 | 5.3% |
| `event_general_promo_14d` | 55 | 2 | 3.6% |
| `event_reminder_1d` | 37 | 0 | **0.0%** |
| `event_review_followup` | 17 | 0 | **0.0%** |

**Critical insight (this reshapes the whole roadmap):** coverage is **bimodal**.
- **Table-booking customers have real email coverage (43–60%)** — the *only* sizeable comms worth converting.
- **Event customers and marketing/promo recipients have almost NO email (0–10%)** — converting them saves essentially nothing because the recipients are phone-only. The biggest-spend comm (`bulk_sms_campaign`, 6.3%) is the *worst* conversion target.

This **inverts** the naive "convert the biggest spender first" instinct → prioritise by **email coverage × volume**, which points squarely at **table bookings**.

**Why the gap?** Table bookings capture an email at booking time; event bookings and promo audiences are seeded mostly from phone-only walk-ins/imports. The fix for the low-coverage comms is **email capture**, not channel switching.

**Email cost (CODE FACT):** email via `src/lib/email/emailService.ts` → Microsoft Graph (Outlook), no per-message fee. Converted messages are effectively **free** (`email_cost ≈ 0`).

---

## 4. Savings formula

For comm type *c*:

```
SMS_spend(c)    = volume(c) × avg_segments(c) × cost_per_segment
convertible(c)  = volume(c) × share_recipients_with_email(c)        [MEASURED per comm — §3 table]
gross_saving(c) = SMS_spend(c) × share_recipients_with_email(c)
net_saving(c)   ≈ SMS_spend(c) × share_recipients_with_email(c)     [email_cost ≈ 0]
```
Portfolio:
```
annual_saving ≈ (Σ_c SMS_spend_90d(c) × share_with_email(c)) × (365 / 90)
```

**Inputs / caveats:**
- **`cost_per_segment` ⚠️:** do **not** use recorded `cost_usd` as money — it is the synthetic $0.04 estimate. For a real figure, take the actual Twilio invoice ÷ Twilio segment count. Use segment **counts** (MEASURED) as the volume basis.
- **`share_with_email(c)`:** use the **MEASURED per-comm percentages in §3** (0%–60%), never a blended rate — they dominate the result.

**Worked saving (MEASURED shares × $0.04-estimate spend; expressed as proxy $, NOT real money):**

| Comm group | est $ 90d | email coverage | convertible est $ 90d |
|---|---:|---:|---:|
| **Table booking confirmed** | $4.60 | 60% | **$2.76** |
| **Table review follow-up** | $4.56 | 43% | **$1.96** |
| Private booking created | $1.32 | 39% | $0.51 |
| Event confirmations | $2.08 | 10% | $0.21 |
| Event reminders (1d + promo) | $4.04 | 0–9% | ~$0.20 |
| Marketing / promo (bulk + cross + general) | $22.96 | 4–8% | ~$1.4 |
| **Total addressable (excl. manual)** | | | **≈ $7/90d** |

**≈ $7/90d of $0.04-estimate spend is realistically convertible** (≈ $28/yr of *estimate*; the real-£ figure is smaller still as $0.04 over-states UK SMS). **Over half of it comes from the two table-booking comms.** Marketing — despite being ~half the bill — yields only ~$1.4 because coverage is ~6%. **The absolute saving is small; the story is "table bookings are the only worthwhile switch; everything else needs email capture first."**

---

## 5. Prioritised conversion roadmap

Ordered by **convertible volume (= volume × MEASURED email coverage) ÷ risk**. Most switches are a `if (customer.email) sendEmail(...) else sendSMS(...)` branch (customer record already loaded), ideally routed through the new `selectChannel()` engine rather than an ad hoc per-call preference.

### Phase 1 — Quick wins (the only comms with real coverage)
1. **`table_booking_confirmed`** (60% email, $4.60 est, 115 sends) — **highest convertible value of any comm.** Email confirmation is standard and richer (booking ref, time, map, modify link). Email-primary; SMS for the phone-only 40%.
2. **`table_review_followup`** (43% email, $4.56 est, 114 sends) — post-visit, zero time pressure, email is arguably **better** (clickable review link). Second-best switch.
3. **`private_booking_created`** + private-booking lifecycle (39% email) — low volume but decent coverage and trivially convertible.

These three are non-urgent and have the coverage to actually save money.

### Phase 2 — Convert the email-holding slice only; SMS stays primary
4. **Event confirmations / reminders** (`event_booking_confirmed` 10%, `event_reminder_1d` 0%) — coverage is so low that a blanket switch saves nothing. Implement the email branch (so the few with email get email, and coverage rises as capture improves) but **keep SMS as the default**. Never email same-day reminders.
5. **Marketing / bulk** (`bulk_sms_campaign` 6%, cross/general promo 4–8%) — biggest bill, lowest coverage. Make marketing **email-first for the ~6% who have an email** and for `marketing_sms_opt_in` segments, but the saving is marginal until coverage rises. Also fixes the manual-promo rows that currently record null cost.

### Phase 3 — Instrument, then convert the tail
6. **Two engineering fixes that make the model trustworthy:** (a) ensure every automated sender sets `metadata.template_key` (kills the untagged bucket); (b) **store Twilio's real `Price`/`NumSegments` from the status callback into `price`/`cost_usd`** (currently dropped — §1). Without (b), no future £ figure is real.
7. **Parking / sunday-preorder / low-volume lifecycle** — convert the email-holding share after tagging; SMS fallback for phone-only and same-day.

### Do NOT convert
- **Manual two-way staff replies** (`message_thread_reply` + untagged) — conversational, inbound-triggered; 5% coverage anyway.
- **Same-day / <2h reminders** and **OTP** — SMS only.
- **FOH/BOH internal ops alerts** (`foh_food_order_alert`, `boh_manual_booking_sms`) — operational.
- **The ~82% phone-only customers** — no email; unchanged.

### Cross-cutting (the actual highest-leverage action)
- **Email-capture drive.** Most automated sends sit at 0–10% coverage, so channel-switching is capped almost everywhere except table bookings. Capturing email at event booking and parking, plus a one-off backfill prompt, raises the convertible share across *every* comm and is worth more than all the individual switches combined. **Recommend prioritising email capture ahead of Phase 2.**

---

## 6. Data provenance & caveats

- **Live numbers are MEASURED** via read-only SELECTs against project `tfcasgxopxegwrabvwat` (confirmed: 758 customers; `messages`/`customers` schemas as expected). No writes. (The MCP `execute_sql` tool requires an explicit `project_id` arg — initial calls without it failed validation; all data here is from successful re-runs.)
- **⚠️ Biggest caveat:** `cost_usd` is a synthetic `$0.04 × segments` estimate, never Twilio's real price (CODE FACT + MEASURED). All `$` figures are ranking proxies and likely over-state real UK SMS spend. Substitute the actual Twilio invoice for budgeting.
- **Volume is declining** (1,060 vs 2,201 prior 90d) and absolute spend is small — set expectations accordingly.
- **Per-comm email coverage (§3) is MEASURED** from actual recipients and must drive prioritisation — it ranges 0%–60% and is bimodal (table bookings high, events/marketing near-zero).
- Segment counts may under-count Unicode/emoji messages (local `ceil(len/160)` assumption, CODE FACT).

---

## 7. Reusable read-only SQL (audit / re-run)

```sql
-- A. Email coverage (ceiling)
SELECT count(*) total,
       count(*) FILTER (WHERE email IS NOT NULL AND btrim(email)<>'') with_email,
       count(*) FILTER (WHERE email IS NULL OR btrim(email)='') mobile_only,
       count(*) FILTER (WHERE marketing_sms_opt_in) marketing_opt_in
FROM customers;

-- B. 90-day volume/spend by comm (ranking). est_cost = $0.04/seg estimate, NOT real
SELECT COALESCE(template_key,'(untagged)') template_key,
       count(*) msgs, COALESCE(sum(segments),0) segments,
       ROUND(COALESCE(sum(cost_usd),0)::numeric,2) est_cost
FROM messages
WHERE direction='outbound' AND created_at >= now()-interval '90 days'
GROUP BY 1 ORDER BY msgs DESC;

-- C. Prove cost is the $0.04 estimate (all rows: cost = 0.04*segments; price NULL)
SELECT segments, round(cost_usd::numeric,4) cost_usd, count(*)
FROM messages WHERE direction='outbound' AND created_at>=now()-interval '90 days'
  AND cost_usd IS NOT NULL GROUP BY 1,2 ORDER BY count(*) DESC;

-- D. Per-comm email coverage of real recipients (DRIVES prioritisation)
SELECT m.template_key, count(*) sends,
       round(100.0*count(*) FILTER (WHERE c.email IS NOT NULL AND btrim(c.email)<>'')/count(*),1) pct_with_email
FROM messages m LEFT JOIN customers c ON c.id=m.customer_id
WHERE m.direction='outbound' AND m.created_at>=now()-interval '90 days' AND m.template_key IS NOT NULL
GROUP BY 1 HAVING count(*)>=15 ORDER BY sends DESC;
```
