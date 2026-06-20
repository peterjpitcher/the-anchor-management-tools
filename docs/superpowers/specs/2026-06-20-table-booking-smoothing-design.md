# Table-Booking Smoothing — Design Spec

- **Date:** 2026-06-20
- **Author:** Peter Pitcher (with Claude)
- **Status:** Draft for review
- **Repos affected:** `OJ-AnchorManagementTools` (management app — owns the data + settings) and `OJ-The-Anchor.pub` (customer-facing website — owns the booking UI)
- **Complexity:** L (7+ files across two repos, one new public endpoint, new settings; no schema-table, auth-model, or payment changes)

---

## 1. Problem

Table bookings pile onto a handful of "headline" times and leave the rest of the service nearly empty. This overloads the kitchen and the door at one moment, then goes dead.

**Evidence (live data):**

Tomorrow, Sunday 21 Jun 2026:

| Time | Bookings | Covers |
|------|----------|--------|
| 12:00 | 1 | 2 |
| **13:00** | **5** | **25** |
| 13:30 | 1 | 3 |
| 15:00 | 1 | 8 |
| 16:00 | 1 | 6 |

**25 of 44 covers (57%) land in the single 1pm slot**, then it falls away. This is a recurring pattern — historic peaks cluster on the same round times (Sunday lunch 1pm; evenings 6:45/7:45pm) and top out at 25–29 covers in one slot.

**Root cause in code:** the website offers every in-hours 30-minute slot as equally free. Each slot carries a *static* capacity that defaults to `50` and is **never reduced by real bookings** (`OJ-The-Anchor.pub/lib/table-booking-service-windows.ts`, `buildSlotsFromRanges` L148–202; the `50` default appears in three places). The website's "availability" route (`app/api/table-bookings/availability/route.ts`) is named misleadingly — its `meta.source` is literally `schedule_fallback`; it does **no** real availability check. So nothing tells a customer that 1pm is already busy, and nothing nudges them elsewhere.

---

## 2. Goal & non-goals

**Goal:** spread bookings across the service **without reducing total capacity**, by making each time's real busyness visible and transparently nudging customers toward quieter times.

**Non-goals (explicitly out of scope):**
- **No hard pacing block.** We never refuse a booking we can physically seat. The only hard stop stays *physical table availability* — the existing `create_table_booking_v05` behaviour, **unchanged**.
- No change to the booking RPC, auth model, payments, deposits, or card-capture flow.
- No change to the slot interval (stays 30 minutes) or the booking funnel's step structure.
- No retroactive change to existing bookings.

---

## 3. Agreed product decisions (locked with the venue)

1. **Soft nudge only** — show busyness + an honest warning; never block. Fairness and transparency over a wall.
2. **Threshold:** **30 covers per rolling 60-minute window**, global, staff-tunable without a deploy.
3. **Window:** centred ±30 minutes around the chosen time (arrival density, not occupancy).
4. **Keep 30-minute slots.**
5. **Full physical capacity** is the only thing that ever makes a time unbookable (existing behaviour).
6. **Presentation:** busy times stay bookable; when selected they show a calm warning and quieter alternatives, with a clear "Book anyway" path. No big bold warning blocks (house tone).

---

## 4. How it works (plain English)

A customer picks a date and party size. Next to each time we show how busy it already is, based on **real bookings**:

- **1:00pm — Busy**
- 12:30pm — Plenty of space
- 1:30pm — Plenty of space

Tap a **Busy** time and, instead of booking straight away, they see:

> *"1pm is one of our busiest times, so food and service may take a little longer. 12:30 and 1:30 are quieter if you'd like more space."*

…with **Book 1pm anyway** or pick a quieter time. Nothing is hidden, nothing is blocked. The only thing that ever stops a booking is genuinely running out of tables (unchanged).

Over time, people who don't mind a buzz still take 1pm; people who'd rather relax drift to 12:30. Same total bookings, spread across the service.

---

## 5. Architecture

The management app owns the two facts only it knows — **real booking counts** and the **tunable thresholds**. The website owns presentation. We use a **thin data endpoint**: the management app returns aggregated covers-per-time for a date plus the thresholds; the website overlays that onto the slot list it already builds (which already respects opening/special hours) and decides the label client-side.

```
Customer ── books date ──► the-anchor.pub booking wizard
                                  │
   availability route ───────────┼──────────────► GET /business/hours        (existing, public)
   (builds 30-min slots,         │
    already honours special      └──────────────► GET /api/table-bookings/load (NEW, API-key)
    hours / closed days)                                   │  returns aggregated covers per
                                                           │  booking_time for the date +
                                                           │  the threshold settings
                                  ▼
            website stamps each slot with busyness = covers in [T-30, T+30)
            vs thresholds ► renders Quiet / Filling up / Busy + warning + quieter alternatives
```

**Why thin-data, not a "fat" endpoint that returns finished labels:**
- The website already builds the slot list and already honours `special_hours`/closed days. A fat endpoint would duplicate that and risk drift (and the closed-day mislabel bug). The thin endpoint can't mislabel a closed slot because the website only labels slots it already deemed bookable.
- The two facts that must be central (counts, thresholds) stay central; only presentation lives on the website.

**Deployable in two independent increments:**
- **PR1 (management):** settings keys + `/api/table-bookings/load` endpoint + API-key scope. No user-visible change; safe to ship first.
- **PR2 (website):** consume the endpoint, render labels + warning, fail open. Depends on PR1 being live.

---

## 6. The canonical "covers in window" definition (single source of truth)

> ⚠️ The codebase already contains **two** different covers/overlap models: `check_table_availability` (counts `SUM(party_size)` for `status IN ('confirmed','pending_payment')` with per-booking *duration* overlap) and `create_table_booking_v05` (excludes only `('cancelled','no_show')`, `left_at IS NULL`). To avoid creating a divergent third model, the busyness signal uses **one** explicit definition, documented here, and deliberately **separate** from physical-availability checking (that stays the RPC's job).

For a candidate slot time `T` on date `D`, **busyness covers** =

```
SUM( COALESCE(committed_party_size, party_size) )
FROM table_bookings
WHERE booking_date = D
  AND status NOT IN ('cancelled', 'no_show')
  AND left_at IS NULL
  AND NOT (status IN ('pending_payment', 'pending_card_capture')
           AND hold_expires_at IS NOT NULL
           AND hold_expires_at < now()
           AND COALESCE(payment_status::text, '') <> 'completed')
  AND booking_time >= (T - 30 min)        -- local London minute space
  AND booking_time <  (T + 30 min)
```

Decisions baked into this definition:
- **Status set:** mirror the create RPC — everything **except** `cancelled` and `no_show`, and only rows still seated/active (`left_at IS NULL`). This includes held/pending states (`pending_payment`, `pending_card_capture`) because a held group genuinely occupies the kitchen wave — **except** abandoned unpaid holds whose `hold_expires_at` has passed (so a never-paid 20-top doesn't suppress a slot forever). (Note: there is no `expired` value in the `table_bookings` status enum — that enum lives on a different holds table. `booking-states.ts` TS union is stale and must be reconciled when touched.)
- **Party size:** `COALESCE(committed_party_size, party_size)` so a reconciled actual size wins.
- **Window:** fixed rolling 60 minutes centred on `T` (±30 min). **Not** per-booking duration — busyness is about *arrivals clustering*, which is what the venue described, and matches the agreed "30 per rolling 60 min". This is intentionally different from the duration-based physical overlap used by `check_table_availability`.
- **The customer's own prospective party is NOT included** in the displayed count. The label tells them how busy the time *already* is ("1pm is already busy"), which is the honest framing and avoids a slot flipping state mid-funnel.
- **Timezone (HIGH-risk):** `booking_time`/`booking_date` are local Europe/London (time-without-tz + date). The count **must** be computed purely in local-minute space — `EXTRACT(HOUR FROM booking_time)*60 + EXTRACT(MINUTE FROM booking_time)` server-side or equivalent `HH:mm -> minutes` client-side, never by constructing UTC `Date`s. Explicit BST-boundary and near-midnight test cases required. V1 does not support overnight online slot windows.

---

## 7. Detailed design — Management app (`OJ-AnchorManagementTools`)

### 7.1 Settings (tunable, no deploy)

Three new `system_settings` keys, stored as `{ "value": N }` JSONB (the **rota-settings convention** — pick this one; `foh/bookings` reads some keys unwrapped, so the new reader must be tolerant and fall back to a default rather than parse `NaN`):

| Key | Default | Meaning |
|-----|---------|---------|
| `pacing_busy_threshold_covers` | `30` | Covers in the window at/above which a slot is **Busy** |
| `pacing_filling_threshold_covers` | `20` | Covers in the window at/above which a slot is **Filling up** (below this = **Quiet**) |
| `pacing_window_minutes` | `60` | Rolling window width (centred, so ±`window/2`) |

A **second explicit "filling" threshold** is used rather than a hidden ratio, so both boundaries are visible and tunable (no invisible magic number drifting from the setting).

- **Reader:** a small tolerant helper (e.g. `getPacingSettings()`) that reads the three keys, unwraps `{value}`, coerces to number, and falls back to defaults on missing/invalid.
- **Seed:** an idempotent settings upsert (`onConflict: 'key'`) so the defaults exist on first deploy.
- **UI:** add the three numeric fields to the existing table-booking settings page (`src/app/(authenticated)/settings/table-bookings/…`), using the existing local API-route pattern gated by `requireSettingsManagePermission()`. Audit-log the change.

### 7.2 New endpoint: `GET /api/table-bookings/load`

- **File:** new `src/app/api/table-bookings/load/route.ts` (sibling of the existing public `route.ts` in the same folder).
- **Auth:** wrap with `withApiAuth(async () => {…}, ['read:table_bookings'], request)` from `src/lib/api/auth.ts` (the canonical helper — x-api-key → SHA-256 vs `api_keys`, `permissions[]` with `*` wildcard, per-key hourly rate-limit via `api_usage`). Use `createApiResponse` / `createErrorResponse` for the envelope.
  - **⚠️ Scope trap (MEDIUM):** the live website API key must hold `read:table_bookings` (or `*`) or it will 403 in production. **Deploy step:** add the scope to the website's `api_keys` row *before/with* the website deploy, and **log a warning when this endpoint returns 403** so a permanent silent fail-open isn't mistaken for "feature off".
- **Input:** `?date=YYYY-MM-DD` (validate; reject malformed). Optionally `window` (defaults to the setting).
- **Query:** **one** per-date query (not N RPC calls). Read only non-PII fields with the admin client (`createAdminClient()` / `src/lib/supabase/admin.ts`) and aggregate in TypeScript: `booking_time`, `party_size`, `committed_party_size`, `status`, `left_at`, `hold_expires_at`, `payment_status`. This avoids relying on raw SQL aggregation through Supabase JS.
  Confirm an index exists on `table_bookings(booking_date)` (there is — plus `(booking_date, booking_time)`); add a partial/filtered index only if `EXPLAIN` shows a need.
- **Response shape** (aggregated, **no PII** — only times and counts):
  ```json
  {
    "success": true,
    "data": {
      "date": "2026-06-21",
      "window_minutes": 60,
      "busy_threshold_covers": 30,
      "filling_threshold_covers": 20,
      "bookings": [
        { "time": "13:00", "covers": 25 },
        { "time": "13:30", "covers": 3 },
        { "time": "15:00", "covers": 8 }
      ]
    }
  }
  ```
- **Caching/perf:** short cache via `createApiResponse` `max-age` of **30s** (soft signal; mild staleness acceptable). Target **p95 < 300ms**. This runs in the booking funnel, so it must be cheap and never block.
- **Private/venue-hosted events:** these block *tables* via a separate mechanism (not `table_bookings` covers), so they don't enter this count — correct, and noted so we don't accidentally add them.

### 7.3 Live-data note

The location for the query helper is `src/lib/table-bookings/` (new small module, e.g. `load.ts`) rather than overloading `src/lib/foh/bookings.ts`. Keep it one focused function: `getBookingLoadForDate(date): Promise<{ time: string; covers: number }[]>`.

---

## 8. Detailed design — Website (`OJ-The-Anchor.pub`)

### 8.1 Fetch the load data

- Add `getTableBookingLoad(date: string)` to the `AnchorAPI` class (`lib/api/client.ts`), reusing the private `request()` wrapper so it inherits the `X-API-Key` header and base URL (`ANCHOR_API_BASE_URL` via `lib/management-api-base.ts`). Calls `GET /table-bookings/load?date=…`.
- **Fail-open (HIGH-risk, mandatory):** fetch the load **in parallel** with `getBusinessHours()` in `buildCombinedAvailability` (`app/api/table-bookings/availability/route.ts`) with a **tight timeout (≈1.5s)**. On timeout / error / non-200: render slots with **no busyness label** (treat as unknown/bookable), **never** surface an error, **never** 503, **never** block booking. The booking funnel must degrade to today's behaviour. (`getBusinessHours` is uncached and excluded from offline fallback; the load fetch must not inherit any fail-closed behaviour.)

### 8.2 Stamp busyness onto slots (one shared helper)

- The covers-per-window calculation and label derivation go in **one** exported helper in `lib/table-booking-service-windows.ts`, e.g.:
  ```ts
  export function busynessForSlot(
    time: string,
    load: { time: string; covers: number }[],
    thresholds: { windowMinutes: number; filling: number; busy: number }
  ): 'quiet' | 'filling' | 'busy'
  ```
  It sums covers where `|slotMinutes − bookingMinutes| < windowMinutes/2` (local-minute space, consistent with the server), then: `covers >= busy → 'busy'`; `covers >= filling → 'filling'`; else `'quiet'`.
- **Both slot-builders must use it** (MEDIUM-risk — they already carry a "keep in sync" comment): `buildSlotsFromRanges` / `buildSlotsWithKitchenState` (the primary path) **and** `buildTableAvailabilityFromBusinessHours` in `lib/api/client.ts` L418–480 (the fallback used by `checkTableAvailability` when the internal route call fails). A test must exercise the fallback path and assert busyness consistency.
- **Do not** change the `available_capacity`/`available` semantics — physical bookability is unchanged. Busyness is an **additional, independent** field.

### 8.3 Types

- Add an optional field to the slot types so it flows end-to-end:
  - `lib/api/bookings.ts` → `TableAvailabilitySlot`: `busyness?: 'quiet' | 'filling' | 'busy'`.
  - `ManagementTableBookingForm.tsx` → `AvailabilitySlot` (L95–101) + parse it in `normalizeAvailabilityResponse` so every rendered slot carries the label.

### 8.4 UI (the "choose" step)

The wizard is **four** steps (`find → choose → details → review`, `STEP_ORDER` L137). The slot grid is only in **choose** (`ManagementTableBookingForm.tsx` L1917–1985).

- **Per-slot badge** (L1953–1960, inside each slot `<button>`): mirror the existing caption pattern at L1957 (`<span className="mt-1 block text-xs …">`). Show a small, calm label: **Quiet → "Plenty of space"** (or nothing, to reduce noise), **Filling up → "Filling up"**, **Busy → "Busy"**. Colour must not be the only signal (accessibility) — include text. Quiet slots may be left unlabelled to keep the grid clean; **Filling up** and **Busy** always labelled.
- **Warning banner** (after L1964): when the selected slot's `busyness === 'busy'`, render a calm, **generic** message (covers food *and* drinks windows — copy is intentionally **not** food-specific):
  > *"{time} is one of our busiest times, so service may take a little longer. {nearestQuieterTimes} are quieter if you'd like more space."*
  with the existing primary action relabelled in context to make "Book {time} anyway" explicit, and the quieter times as quick-select chips. No bold/red alarm styling — match the house calm tone.
- **Quieter-alternative selection (LOW-risk):** compute from the **full** `availableSlots` set, **not** the 7-item `visibleSlots` window — pick the nearest-in-time slots below the **filling** threshold. Interpolate the real times into the copy.
- **Threshold tunable, copy fixed:** the numbers are staff-editable (management settings); the warning copy stays fixed-but-generic for v1 (can become a setting later if needed).

### 8.5 Tests

`tests/unit/ManagementTableBookingForm.test.tsx`: busy/filling/quiet labels render per slot; selecting a Busy slot shows the calm warning with real quieter alternatives; "Book anyway" advances to **details**; **load-endpoint failure → no labels, booking still works** (fail-open). Plus a `table-booking-service-windows` unit test for `busynessForSlot` incl. BST/near-midnight windows and the shared-helper/fallback parity.

---

## 9. Edge cases & risk mitigations (from adversarial review)

| Risk | Severity | Mitigation (in spec) |
|------|----------|----------------------|
| Window count mis-buckets around BST / midnight if done in UTC | HIGH | Compute purely in local-minute space both server and client; explicit BST + near-midnight tests (§6) |
| A third divergent covers/overlap/status model | HIGH | One canonical definition (§6), explicitly separate from `check_table_availability`; documented |
| Website blocks/503s if load endpoint slow/fails | HIGH | Mandatory fail-open: parallel fetch, ~1.5s timeout, no label on error, never block (§8.1) |
| API-key scope 403 in prod | MEDIUM | Define scope `read:table_bookings`; add to live key as a deploy step; log on 403 (§7.2) |
| Two duplicated slot-builders drift | MEDIUM | Single shared `busynessForSlot`; both paths call it; fallback-path test (§8.2) |
| "Filling up" boundary undefined / hidden ratio | MEDIUM | Explicit second tunable `pacing_filling_threshold_covers` (§7.1) |
| Abandoned unpaid hold suppresses a slot | MEDIUM | Exclude expired unpaid `pending_payment` and `pending_card_capture` holds; `left_at IS NULL` (§6) |
| Single large party (18–20) alone trips Busy | MEDIUM | **Counted fully on purpose** — one big group *is* a real kitchen/door wave at that minute, so flagging the time Busy is honest; documented as intended, revisit if it proves misleading |
| Closed/special-hours days mislabelled "Quiet" | MEDIUM | Thin-data design: website only labels slots it already built from hours/special-hours, so closed slots get no label (§5) |
| Per-date query cost / staleness | LOW | Single aggregate query, existing `booking_date` index, 30s cache, p95<300ms (§7.2) |
| Drinks-only window warned about *food* delays | LOW | Generic copy ("service may take a little longer"), not food-specific (§8.4) |
| Settings `{value}` vs raw convention mismatch | LOW | Standardise on `{value:N}`; tolerant reader with default; test that updating the setting changes the state (§7.1) |

---

## 10. Configuration summary

| Setting | Default | Where |
|---------|---------|-------|
| `pacing_busy_threshold_covers` | 30 | management `system_settings`, editable in table-booking settings UI |
| `pacing_filling_threshold_covers` | 20 | management `system_settings`, editable |
| `pacing_window_minutes` | 60 | management `system_settings`, editable |
| Load endpoint cache TTL | 30s | management route (`createApiResponse` max-age) |
| Website load-fetch timeout | ~1.5s | website availability route |
| API-key scope | `read:table_bookings` | management `api_keys` row for the website key |

---

## 11. Testing strategy

- **Management:** unit-test `getBookingLoadForDate` (status set, party-size coalesce, hold-expiry exclusion, local-minute correctness, BST/midnight). Route test: auth required, scope enforced, response shape, 30s cache header, malformed-date rejected. Settings route: permission gate, persists `{value}`, audit-logged.
- **Website:** `busynessForSlot` unit tests (boundaries at filling/busy, window math, BST); form tests (labels, warning, alternatives from full list, Book-anyway, **fail-open**); fallback-builder parity test.
- **Manual:** against tomorrow's real data — 1pm shows **Busy**, 12:30/1:30 **Quiet**; pick 1pm → warning with 12:30/1:30; "Book anyway" completes; kill the endpoint → slots render unlabelled and booking still works.

---

## 12. Rollout

1. **PR1 (management):** settings keys + seed + reader + settings UI + `/api/table-bookings/load` + `read:table_bookings` scope on the website's API key. Deployable with zero user-visible change. Verify the endpoint live with the website's key.
2. **PR2 (website):** `getTableBookingLoad` + parallel fail-open fetch + shared `busynessForSlot` + both builders + slot types + choose-step UI + tests. Deploy after PR1 is confirmed live.
3. **Watch:** after a few weekends, check whether 1pm-type peaks flatten. Tune the three numbers from the settings UI — no deploy.

**Rollback:** PR2 is the only customer-visible change; reverting it (or the load fetch failing) cleanly returns to today's behaviour. PR1 is inert without PR2.

---

## 13. Phase 2 (only if soft nudging isn't enough)

Soft nudging only smooths as far as customers cooperate — some will still book 1pm, by design. If after a few weekends peaks haven't flattened enough, escalate *without* redoing this work:
- Default-select the nearest quieter time (still overridable), or
- Add a genuine hard backstop (a pacing cap in the create RPC with a `slot_full_paced` reason) — the original "close the slot" option, now as a deliberate, data-informed step.

---

## 14. Open questions resolved

All twelve adversarial open questions were resolved into the decisions above (canonical covers definition §6; fixed 60-min window not per-duration; own party excluded; explicit filling threshold; large parties count fully; expired unpaid holds excluded; fail-open confirmed; scope `read:table_bookings` + deploy step; 30s cache / p95<300ms; copy generic + fixed, thresholds tunable; shared helper for both builders; closed-days handled by thin-data design). Anything you'd like changed, flag it on review.
