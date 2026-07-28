# Recruitment Module — Timezone Audit Spec

**Repo:** `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`
**Scope:** the recruitment module only (`src/app/recruitment/**`, `src/app/(authenticated)/recruitment/**`, `src/app/api/recruitment/**`, `src/app/actions/recruitment.ts`, `src/services/recruitment.ts`, `src/lib/recruitment/**`, plus recruitment migrations)
**Date:** 2026-07-16 (British Summer Time — UTC+1)
**Purpose:** a standalone, independently verifiable record of every timezone defect found, every claim refuted, and how a second developer can reproduce each one.

---

## 1. Summary

**No — but it is close, and the remaining defects are narrow.**

The recruitment module is *mostly* correct on timezones. The instant-handling layer is sound: every relevant column is `timestamptz`, the ICS/calendar producer is provably zone-invariant, the email/SMS formatters are explicitly London-pinned, and the erasure cron compares absolute instants. The two genuinely damaging defects — manager alerts printing UTC to a human — were found and fixed earlier today.

What remains is a cluster of **rendering** defects (formatters that omit `timeZone` and therefore inherit the ambient zone) and **date-only derivation** defects (a calendar date taken from a UTC instant instead of a London one). One of these — the public candidate booking page — is the only remaining place where a real human can durably be told the wrong hour.

After de-duplicating overlapping reports, there are **9 distinct confirmed defects**:

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 2 | TZ-01, TZ-02 |
| Medium | 5 | TZ-03, TZ-04, TZ-05, TZ-06, TZ-07 |
| Low | 2 | TZ-08, TZ-09 |

Nothing is critical. No staff member and no candidate is currently, durably being told the wrong time on a UK device — with the single exception of TZ-01's pre-hydration first paint and its non-UK-device case.

**Honest caveats a reviewer should hold onto:**

- **Three of the nine are not ambient-zone bugs at all.** TZ-02, TZ-05 and TZ-06 use `toISOString()`, which is unconditionally UTC. They are *equally wrong on a London dev laptop and on Vercel*. `TZ=UTC` reproduction is a no-op for them. Do not describe them as "invisible locally" — they are visible everywhere, they were simply never looked at.
- **The `retention_until` column has no reader.** TZ-05/TZ-06 write a date that nothing in the codebase, database, or UI ever consumes. It is a latent landmine, not a live GDPR breach. Erasure keys off `created_at` and is correct.
- **Several client-side findings are gated behind a click** and are therefore never server-rendered, which caps their blast radius considerably. This is stated per finding.
- Severity was actively argued *down* in review on several items. The original reports contained 3 "critical" and 5 "high" labels; after adversarial verification, 0 critical and 2 high survived. That downgrade is the honest result, not diplomacy.

---

## 2. Why this class of bug hides

The Anchor is one pub. Everything is Europe/London. So why does anything ever render in UTC?

- **Vercel runs the server process at `TZ=UTC`.** Developers' laptops run `TZ=Europe/London`.
- Any code that reads the *ambient* zone — `new Date().toLocaleString()`, `toLocaleDateString()`, `toLocaleTimeString()`, `.getHours()`, `.getDate()`, `date.getTimezoneOffset()`, `Intl.DateTimeFormat` with no `timeZone`, or `new Date('2026-07-21T14:00')` on a naive string — is **correct on a dev machine and wrong in production during BST** (late March to late October, UTC+1).
- Every local test passes. Every code review looks fine. The bug only appears on Vercel, and only for half the year.

**The reproduction technique:** run the code under `TZ=UTC`.

```bash
TZ=UTC node -e "console.log(new Date('2026-07-21T14:00:00Z').toLocaleString('en-GB'))"
# 21/07/2026, 14:00   <-- production
TZ=Europe/London node -e "console.log(new Date('2026-07-21T14:00:00Z').toLocaleString('en-GB'))"
# 21/07/2026, 15:00   <-- your laptop
```

Same code. Different answer. That gap is this whole audit.

**Important nuance, and the thing most reviewers get wrong:** there is a *second*, distinct class here that is **not** ambient-dependent. `toISOString()` always returns UTC regardless of `TZ`. Code doing `someDate.toISOString().slice(0, 10)` to get "today's date" is wrong on **every** machine, dev and prod alike — it silently means "the UTC calendar date". `TZ=UTC` reproduction will not distinguish it from correct code, because it produces the same wrong answer everywhere. TZ-02, TZ-05 and TZ-06 are all this second class. Reproduce those by comparing the value against the London-pinned helper, not by changing `TZ`.

---

## 3. The rules

What "correct" means for this codebase:

1. **One location, one zone.** The Anchor is a single pub in Stanwell Moor, TW19 6AQ. Every time a human sees — staff or candidate — is Europe/London. There are no other timezones and no plans for any.
2. **Store instants as `timestamptz`.** All the recruitment timestamp columns already do this (`starts_at`, `ends_at`, `scheduled_start`, `scheduled_end`, `created_at`, …). Postgres then hands back an unambiguous instant and `new Date(value)` parses it correctly. **The instant is almost never the problem in this module — the rendering is.**
3. **Render with an explicit `timeZone`, always.** Every `Intl.DateTimeFormat` that a human will read must carry `timeZone: 'Europe/London'` (or `record.timezone || 'Europe/London'`). The known-good reference is `formatRecruitmentAppointmentTime` at `src/services/recruitment.ts:2721`.
4. **Never trust the ambient zone server-side.** Vercel is UTC. `toLocaleString()`, `.getHours()`, `.getDate()`, `getTimezoneOffset()` and bare `Intl.DateTimeFormat` are all forbidden in any path a human reads.
5. **Never derive a date-only value from an instant via `toISOString()`.** Use `getTodayIsoDate()` / `toLocalIsoDate()` from `src/lib/dateUtils.ts`, or the in-file `londonDateString()` in `src/services/recruitment.ts:211`. `.toISOString().slice(0, 10)` means "the UTC calendar date" and is a bug in a London-only app.
6. **Round-trips must be symmetric.** If the server parses a `datetime-local` string as London (`parseLondonDateTimeLocalToIso`), the client must *seed* that input as London too (`toLondonDateTimeLocalValue`). An ambient read against a London write silently walks the stored value.
7. **The candidate-facing surface must be explicit AND labelled.** Candidates may read the booking page on a device set to any zone. Pin the zone, and say "(UK time)" so the number is interpretable.
8. **`hourCycle: 'h12'`, never `hour12: true`.** On Node 20's V8, `en-GB` + `hour12: true` renders noon as "0pm" and midnight as "0am". This was already fixed in `communications.ts` (commit `9588c19c`) and no occurrence remains anywhere in the module — but the rule stands so it cannot return.
9. **Guard with tests executed under `TZ=UTC`.** A dev-machine test run cannot catch class-1 bugs. `src/lib/recruitment/__tests__/manager-alert.test.ts` is the existing pattern.

---

## 4. Confirmed findings

Ordered by severity. Each has a stable ID.

> **Note on de-duplication:** the raw review produced 22 confirmed reports, but several were independent verifications of the same lines of code (the booking-page formatter was reported four times; `retention_until` five times; the dashboard formatter and `isPastClosingDate` twice each). They are merged below, with dissenting severity noted where reviewers disagreed. The merged count is 9.

---

### TZ-01 — Candidate booking page renders every time in the ambient zone (HIGH)

**File:** `src/app/recruitment/book/[token]/RecruitmentBookingClient.tsx:29-37`
**Side:** both (SSR on Vercel *and* client)
**Class:** ambient-zone (reproduce with `TZ=UTC`)

**What's wrong:** the only formatter on the public booking page omits `timeZone`, so it resolves to whatever zone the rendering process is in.

```ts
// src/app/recruitment/book/[token]/RecruitmentBookingClient.tsx:29-37
function formatDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date)
}
```

Called at **line 184** (the candidate's current booking) and **line 211** (every slot option in the picker). `page.tsx` is a server component with `export const dynamic = 'force-dynamic'` and imports this client component directly — no `next/dynamic`, no `ssr: false`, no mount gate — so Next.js **does** server-render it on Vercel at `TZ=UTC`.

The `timezone` column is available and ignored. `previewRecruitmentBookingToken` (`src/services/recruitment.ts:2264`) does `select('*')`, so `slot.timezone` and `currentAppointment.timezone` are both present; the refresh route explicitly ships `timezone: slot.timezone` (`src/app/api/recruitment/booking/[token]/route.ts:51`). `grep -n "timezone" ` on the client file returns **zero** matches.

**Worked example — interview stored at `2026-07-21T14:00:00Z` (= 15:00 BST, the time the candidate was actually offered):**

| Who / where | What they see |
|---|---|
| Vercel SSR (`TZ=UTC`) — the HTML on the wire | `Tuesday, 21 July 2026 at 14:00` — **wrong** |
| UK candidate, London phone | `14:00` on first paint, then React re-renders on the hydration text mismatch and it flips to `15:00` — correct, after a flash |
| Candidate on a phone set to `Europe/Warsaw` | `16:00`, permanently, with no zone label anywhere on the page |
| Candidate on a phone set to `America/New_York` | `10:00`, permanently |
| Dev laptop (`TZ=Europe/London`) | `15:00` — **passes every local test** |

Near midnight it is worse, because `dateStyle: 'full'` prints the weekday: `2026-07-21T23:30:00Z` renders `Tuesday, 21 July 2026 at 23:30` under UTC instead of `Wednesday, 22 July 2026 at 00:30`. Wrong hour, wrong day, wrong weekday.

**Why HIGH and not CRITICAL (this was argued down from three separate "critical" reports):** the booking POST sends `slot_id`, not a formatted string, so the *stored* appointment is always correct — the harm is purely informational. And React patches the hydration mismatch, so the dominant user (a UK applicant on a UK phone) ends up reading the correct 15:00 after a sub-second flash. The two bugs fixed earlier today were manager alert **emails** — frozen wrong forever, in a message the human keeps, with no correction path. This one self-heals for the primary user and is durably wrong only at a boundary: a non-London device, a crawler, or a no-JS client. That is the rubric's "wrong in an edge case" = high.

**Fix:**

```ts
function formatDateTime(value: string | null | undefined, timeZone?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: timeZone || 'Europe/London',
  }).format(date)
}
```

Pass it at both call sites: line 184 `formatDateTime(currentAppointment.scheduled_start, currentAppointment.timezone)`, line 211 `formatDateTime(slot.starts_at, slot.timezone)`. Both tables declare `timezone text NOT NULL DEFAULT 'Europe/London'` (`supabase/migrations/20260707000000_recruitment_foundation.sql:334, :354`), so the fallback rarely fires.

Pinning also **eliminates the hydration mismatch**, because server and client then agree by construction.

Do **not** add `hour12: true` — `timeStyle: 'short'` already yields h23 for en-GB, which is correct. Best long-term: reuse `formatRecruitmentAppointmentTime` (`src/services/recruitment.ts:2721`) so there is one formatter to get wrong, not two.

**See also TZ-09** — once the zone is pinned, a non-UK candidate sees a correct London time with nothing telling them it *is* London. Fix both together or you trade one confusion for another.

---

### TZ-02 — `isPastClosingDate` compares a London date against the UTC date (HIGH)

**File:** `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:1096-1099`
**Side:** both
**Class:** hardcoded-UTC — **not** ambient. Reproduces identically on a London laptop.

**What's wrong:**

```ts
// src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:1096-1099
function isPastClosingDate(value: string | null | undefined) {
  if (!value) return false
  return value.slice(0, 10) < new Date().toISOString().slice(0, 10)
}
```

`application_closing_date` is a `DATE` — a London calendar date by intent (`src/types/recruitment.ts:68`, `z.string().date()`). It is being compared against the **UTC** calendar date. Feeds `postingVisibilityText` (line 1102), which renders the Public/Expired badge at lines 2965 and 2990.

**Worked example — posting with `application_closing_date = 2026-07-15`, viewed at 00:30 London on 16 July (= `2026-07-15T23:30:00Z`, BST):**

- `value.slice(0,10)` = `"2026-07-15"`; `new Date().toISOString().slice(0,10)` = `"2026-07-15"`. `"2026-07-15" < "2026-07-15"` is **false** → badge reads **"Public"**.
- Meanwhile `londonDateString()` returns `"2026-07-16"`, so **two** server gates have already closed it:
  - `listPublicRecruitmentPostings` (`src/services/recruitment.ts:336`) excludes it from the public job board;
  - the application POST gate (`src/app/api/recruitment/applications/route.ts:81`) rejects with *"This job posting is no longer accepting applications."*
- So staff see "Public" while candidates cannot see or apply. The badge self-corrects at 01:00 London.
- Control runs: 22:30Z same day (23:30 London) — agree. 01:30Z next day — agree. `2025-12-15T23:30:00Z` (GMT) — agree. **BST only, ~1 hour per night, only when the closing date equals the UTC date.**

**Severity dispute, resolved to HIGH.** Two reviewers filed this: one at medium, one at high. Medium's definition is *"fragile/ambient-dependent but currently harmless"* — and this is neither. It never reads the ambient zone, so it is deterministically wrong on a London staff laptop, in dev, and on Vercel alike. It actively misinforms staff about the state of a live posting at a midnight boundary. That is the rubric's "high". **Mitigating, and worth a reviewer's attention:** it is a read-only badge, it gates nothing, no candidate is misled (the real gates are correct and fail *closed*), and it is one hour a night for half the year. A reviewer who wants to call this medium has a defensible case; the argument for high is that "deterministically wrong" excludes it from the medium band by definition.

**Fix:**

```ts
import { getTodayIsoDate } from '@/lib/dateUtils'
// ...
function isPastClosingDate(value: string | null | undefined) {
  if (!value) return false
  return value.slice(0, 10) < getTodayIsoDate()
}
```

`getTodayIsoDate()` (`src/lib/dateUtils.ts:68`) delegates to `toLocalIsoDate()`, which is Europe/London-pinned via Intl. This makes the staff badge agree with the already-correct server gates.

**Note for the reviewer:** `londonDateString()` is duplicated verbatim in **three** places — `src/services/recruitment.ts:211`, `src/app/api/recruitment/applications/route.ts:40`, and `src/lib/private-bookings/financial.ts:118` — all reimplementing `getTodayIsoDate()`. That duplication is *precisely why* the dashboard drifted out of step with the gate. Consolidating onto `dateUtils` would prevent a fourth divergence. Out of scope for this fix, but see §7.

---

### TZ-03 — Staff dashboard `formatDateTime` omits `timeZone` while its two siblings pin it (MEDIUM)

**File:** `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:201-209`
**Side:** both
**Class:** ambient-zone (reproduce with `TZ=UTC`)

**What's wrong:**

```ts
// src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:201-209
function formatDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
```

Two functions in the **same file** do it correctly: `formatSlotDateTime` (line 211/222, `timeZone: 'Europe/London'`) and `formatTimeOnly` (line 233). `formatSlotOptionLabel` (line 239) even carries the comment *"London-pinned start"*. This is an inconsistency someone half-fixed, not a deliberate choice.

**Worked example — interview stored at `2026-07-21T14:00:00Z`:**

- `formatDateTime` → `TZ=UTC`: `"21 Jul 2026, 14:00"`. `TZ=Europe/London`: `"21 Jul 2026, 15:00"`.
- `formatSlotDateTime` (pinned) → `"Tue, 21 Jul 2026, 15:00"` under **both**.
- On Vercel's server HTML, the same page can therefore show one slot as 14:00 and another as 15:00.

**Which call sites actually matter — this is where reviewers disagreed and the honest answer is narrow:**

- Sites at **3312** (schedule-tab appointments "When"), **3347** (slot drawer "When"), **3443** (appointment drawer), **3557** (reschedule picker options) are **client-only**. `activeTab` defaults to `'pipeline'` (line 1322) and the drawers are gated on `selectedSlotId` / `selectedAppointmentId`, which initialise to `null` (lines 1340, 1342). They never reach the SSR pass. In a London staff browser they are **correct today**.
- The **only** SSR-reachable site is **line 1984** — `formatDateTime(application.created_at)` in the default pipeline tab, with `dynamic = 'force-dynamic'` on the page. Vercel emits `14:00` into the HTML and hydration flips it to `15:00`. That is real, but it is an application-received audit stamp, not a time a human is told to attend, and it self-corrects.
- One reviewer claimed a manager "can be shown, and select, a slot labelled an hour early". **That is false and should not be repeated:** the `<option value>` at 3557 is `slot.id`, so a mislabelled option still books the correct row.

**Why MEDIUM (argued down from two "high" reports):** for a single UK pub whose managers are on London browsers, every one of the ~20 call sites renders correctly today. Durable wrongness requires a manager abroad, on a VPN, or with a mis-set clock. That is the rubric's "fragile/ambient-dependent but currently harmless".

**Fix — one line:**

```ts
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(date)
```

Corrects all ~20 call sites at once and removes the hydration mismatch at 1984. Zero risk. Worth doing despite medium severity.

Optional, separate: switch line 3557 from `formatDateTime(slot.starts_at)` to `formatSlotOptionLabel(slot)` so the reschedule picker matches the booking pickers at 2570/2606 (shows end time and location). That is a usability tidy, not a timezone fix.

---

### TZ-04 — Datetime-local inputs seed from the ambient zone while the server parses as London (MEDIUM)

**File:** `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:1053-1058`
**Side:** client only
**Class:** ambient-zone (reproduce with `TZ=UTC`)

**What's wrong — an asymmetric round-trip.** The read side is ambient:

```ts
// src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:1053-1058
function todayLocalDateTime(value?: string) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}
```

The write side is London-pinned: the hidden field posts to `parseDateTimeLocal` (`src/app/actions/recruitment.ts:204`) → `parseLondonDateTimeLocalToIso` → `fromZonedTime(..., 'Europe/London')`.

Ambient read + London write = the two only agree when the device is on Europe/London.

**Worked example — slot stored at `2026-07-21T14:00:00Z` (15:00 BST):**

| Browser zone | Input shows | Re-saves as | Effect |
|---|---|---|---|
| `Europe/London` | 15:00 | `14:00:00Z` | no-op, correct |
| `UTC` | 14:00 | `13:00:00Z` | **walks back 1h on every save** |
| `America/New_York` | 10:00 | `09:00:00Z` | walks back 5h |

`utcIsoToLondonLocalInput` returns 15:00 in all three.

**This is a WRITE, not just a display.** `src/app/actions/recruitment.ts:609` writes `right_to_work_checked_at` unconditionally on every profile save — so a manager on a non-London browser who merely opens a drawer and clicks Save silently shifts a stored timestamp without touching the field. Each open-and-save loses another hour.

**Affected call sites (all three must be fixed together):**
- line 1061 `dateTimeLocalToParts` → the interview **slot** picker (lines 1129, 3272) — candidate-facing times, the highest-stakes path;
- line 2780 and line 3829 → `right_to_work_checked_at` inputs.

**Why MEDIUM, and why the SSR escalation fails.** One reviewer argued this is server-rendered on Vercel and therefore worse. It is not: both drawers are gated on `useState<string|null>(null)` (lines 1337/1340, 1346) set only by click handlers (1761, 1803), and the slot drawer is additionally gated on `open={slotDrawerOpen && Boolean(selectedSlot)}` (line 3336) with body `{selectedSlot && (...)}` (3342). The expression short-circuits on the server; the form is never emitted in SSR HTML. `todayLocalDateTime` **only ever runs in the browser**. With all staff at one pub on London browsers, it is currently harmless — the textbook definition of medium.

**Correction to one report:** `createRecruitmentSlotAction` is **not** affected. The create form (line 3266) passes no `initialValue` and is controlled from `emptySlotDateTime`, so it never seeds from a stored instant. Only the **edit** drawer (`updateRecruitmentSlotAction`, lines 3363-3364) round-trips.

**Fix:** replace the body of `todayLocalDateTime` with the existing London-pinned helper — it is the declared inverse of the server's parse, so open-and-re-save becomes a true no-op from any browser:

```ts
import { toLondonDateTimeLocalValue } from '@/lib/dateUtils'   // src/lib/dateUtils.ts:26
// (equivalently utcIsoToLondonLocalInput, dateUtils.ts:34)
```

It is null-safe and a drop-in for this signature. One change fixes the slot picker and both RTW inputs.

**Known limitation, stated so nobody is surprised:** this does **not** solve the autumn DST ambiguous hour (01:00–02:00 on changeover, where one wall clock maps to two instants). That is inherent to `datetime-local` and affects the "correct" helper equally. It is not a reason to withhold the fix. See TZ-08 and the cleared item on `addDurationToDateTimeParts`.

---

### TZ-05 — `retention_until` derived from the UTC calendar date, not the London one (MEDIUM)

**File:** `src/services/recruitment.ts:1523` (intake path — the **primary** write) and `src/services/recruitment.ts:649` (terminal-status path)
**Side:** server
**Class:** hardcoded-UTC — **not** ambient. Identical output on a London laptop and on Vercel.

**What's wrong:**

```ts
// src/services/recruitment.ts:1523  — fires for EVERY new candidate
retention_until: addMonths(new Date(consentAt), retentionMonths()).toISOString().slice(0, 10),

// src/services/recruitment.ts:649   — terminal-status path
const retentionUntil = addMonths(new Date(), retentionMonths()).toISOString().slice(0, 10)
```

`retention_until` is a `date` column (`supabase/migrations/20260707000000_recruitment_foundation.sql:216`), so a **calendar date** is being derived from an instant using `.toISOString()` — i.e. the UTC calendar date, in a London-only app.

Note `addMonths` is **not** date-fns — it is a local helper at line 169 using ambient `getMonth()/setMonth()`. That makes the arithmetic ambient too, but at the default 12-month retention the result lands in the same month with the same DST state, so the two ambient effects cancel and the output is byte-identical in both zones. **This is why `TZ=UTC` reproduction is a no-op here.** `londonDateString()` already exists **in the same file at line 211** and is used correctly at line 330 — this is an inconsistency within one file, not a missing utility.

**Worked example — consent at `2026-07-15T23:30:00Z` (= 00:30 London, 16 July, BST):**

- Stored: `2027-07-15`. London-correct: `2027-07-16`. **One day early.**
- Identical under `TZ=UTC` **and** `TZ=Europe/London` — verified by execution.
- Control: consent at 12:00 BST the same day → `2027-07-16`, correct. January (GMT) → correct. **Window is 00:00–01:00 London, BST only.**

**Two corrections to the original reports, both important:**

1. Several reports gave the window as *"23:00–00:00 London"*. **That is backwards.** London is UTC+1 in BST, so 23:30 London = 22:30Z — same UTC day, no divergence. The correct window is 00:00–01:00 London. (Reports that cited a 00:30 example alongside a "23:00–00:00" window contradicted themselves.)
2. **Line 1523 is the primary write, not 649.** Line 1523 sets `retention_until` on every new candidate at creation, so the `!candidate.retention_until` guard at 648 means 649 fires only for candidates that somehow lack it — effectively never on the normal path. Reports that filed 649 as the headline and 1523 as a footnote had it inverted.

**Impact is currently NIL, and this is why it is medium and not high.** Independently verified by grepping `src/`, `src/app/`, `src/components/` and `supabase/`: `retention_until` is **write-only**. It is written (649, 1523), null-checked as a "has the clock started?" guard (648), typed (`database.recruitment.ts:62`), and asserted in one test. **Nothing reads its value.** Zero `.tsx` hits — no human ever sees it. No SQL function, trigger, view, policy or cron references it. The actual GDPR purge, `runRecruitmentRetentionCleanup` (line 2574, the `recruitment-retention` cron), filters `recruitment_applications.created_at .lt(cutoffIso)` — an instant-vs-`timestamptz` comparison Postgres handles correctly. The dashboard `retentionDue` count (~line 727) uses the same sound filter. **Nobody's data is deleted early.** Claims of "the candidate's data becomes eligible for erasure a day before it should" are false as the code stands.

Fix it because it is a latent landmine — it becomes a real early-erasure bug the moment anyone wires `retention_until` into the erasure path — not because anything is broken today.

**Fix — use the helper already 438 lines above in the same file, at both sites:**

```ts
// line 1523
retention_until: londonDateString(addMonths(new Date(consentAt), retentionMonths())),

// line 649
const retentionUntil = londonDateString(addMonths(new Date(), retentionMonths()))
```

Verified to return `2027-07-16` for the boundary case under both `TZ=UTC` and `TZ=Europe/London`.

**Caveat the reviewer must know: this fix is correct for the default but incomplete in general.** `RECRUITMENT_RETENTION_MONTHS` is unset everywhere (`.env.example`, `.env.local`), so `retentionMonths()` = 12 and the ambient `addMonths` cancels out. With a **DST-crossing** offset it does not. Proven with `months=6` (July BST → January GMT), same consent instant:

- `TZ=UTC` → `2027-01-15` (London-correct is `2027-01-16` — **still wrong even with the fix**)
- `TZ=Europe/London` → `2027-01-16`

A fully robust fix derives the London calendar date **first**, then adds months to that date:

```ts
const [y, m, d] = toLocalIsoDate(new Date(consentAt)).split('-').map(Number)
const until = new Date(Date.UTC(y, m - 1 + retentionMonths(), d))
```

Extract a shared `addRetentionMonthsAsLondonDate()` used by both call sites so they cannot drift again.

**Out of scope but flagged:** the fact that 649 is effectively dead code raises a separate question — should the retention clock start at *consent* (1523) or at *terminal status* (649)? That is a GDPR-logic question, not a timezone one. See §8.

---

### TZ-06 — Anon RLS policy on job postings uses `CURRENT_DATE` (UTC session zone) (MEDIUM)

**File:** `supabase/migrations/20260708000007_recruitment_posting_closing_dates.sql:19`
**Side:** server (database)
**Class:** ambient — but the ambient is the **database session zone**, which is UTC.

**What's wrong:**

```sql
-- supabase/migrations/20260708000007_recruitment_posting_closing_dates.sql:19
OR application_closing_date >= CURRENT_DATE
```

Verified live (read-only): `pg_policies.qual` confirms it is deployed verbatim; `current_setting('TimeZone')` = `'UTC'`; `pg_roles.rolconfig` for `anon` holds only `statement_timeout=3s`, no TimeZone override. Crucially `application_closing_date` is a `date`, not a `timestamptz`, so the "Postgres handles it" escape hatch does **not** apply — there is no instant to convert, and the ambient session zone alone decides which calendar day `CURRENT_DATE` lands on.

**Worked example — posting with `application_closing_date = 2026-07-15`, read at 00:30 London on 16 July (BST):**

- Policy evaluates `CURRENT_DATE` = `2026-07-15` → `2026-07-15 >= 2026-07-15` is **TRUE** → the closed posting stays anon-visible.
- The app layer computes `londonDateString()` = `2026-07-16` → `2026-07-15 >= 2026-07-16` is **FALSE** → hides it and rejects the application.
- Divergence: 00:00–01:00 London, BST only. Verified live at 12:00 BST, 23:30 BST and 00:30 GMT — all agree.

**Why MEDIUM (downgraded from high), with the evidence:** every read of `recruitment_job_postings` in the repo uses `createAdminClient()` (service role), which **bypasses RLS entirely** — including `/api/recruitment/postings`, the dedicated public route a website would consume. No client component and no browser-client read touches this table, so **no anon-key consumer is demonstrated anywhere in this codebase**. RLS *is* enabled (`relrowsecurity = true`) and `anon` *does* hold a SELECT grant, so the policy is not dead — but it has no proven caller. Two further caps: no human is told a wrong time (this is not the rendering class), and the apply path is correctly gated by `londonDateString()` (`src/app/api/recruitment/applications/route.ts:81`), so the worst case **fails closed** — an anon reader at 00:30 BST sees a closed posting and is then correctly rejected on submit. Nobody applies to a closed role and believes they succeeded.

**Fix — a new migration:**

```sql
DROP POLICY IF EXISTS "Public can view open recruitment postings" ON public.recruitment_job_postings;
CREATE POLICY "Public can view open recruitment postings"
  ON public.recruitment_job_postings
  FOR SELECT
  TO anon
  USING (
    status = 'open'
    AND is_public = true
    AND (
      application_closing_date IS NULL
      OR application_closing_date >= (now() AT TIME ZONE 'Europe/London')::date
    )
  );
```

Verified live (read-only, nothing modified): the replacement yields `2026-07-16` at 00:30 BST where `CURRENT_DATE` yields `2026-07-15`, and is identical at 12:00 BST, 23:30 BST and 00:30 GMT — **a no-op outside the broken hour**.

**Do NOT** fix this by setting the database TimeZone to `Europe/London`: that would silently change `now()`-rendering and `CURRENT_DATE` semantics for **every other module in the app**.

The index at lines 6-7 (`status, is_public, application_closing_date, opened_at DESC`) still serves the rewritten predicate — no index change needed.

---

### TZ-07 — Retention cron's `addMonths()` does calendar arithmetic in the ambient zone (MEDIUM)

**File:** `src/services/recruitment.ts:169-173`, consumed at `:2574` (`runRecruitmentRetentionCleanup`) and `:665` (dashboard `retentionDue`)
**Side:** server
**Class:** ambient-zone (reproduce with `TZ=UTC` vs `TZ=Europe/London`)

**What's wrong:**

```ts
// src/services/recruitment.ts:169-173
function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}
```

`setMonth`/`getMonth` read and write wall-clock fields **in the ambient process zone**, so the resulting instant differs between prod (UTC) and dev (London) across a DST boundary.

**Worked example — cron run at `2026-03-29T02:30:00Z` (the real `30 2 * * *` slot, on the day BST begins):**

- `TZ=UTC` → cutoff `2025-03-29T02:30:00.000Z`
- `TZ=Europe/London` → cutoff `2025-03-29T03:30:00.000Z`
- One hour apart.

Mirror case at the autumn transition (`2026-10-25T01:30:00Z`): UTC → `2025-10-25T01:30:00Z`, London → `2025-10-25T00:30:00Z`. Non-DST-straddling runs (Jan, Jul) are identical in both zones.

**Why MEDIUM, argued carefully:**

- **The cutoff is never rendered, formatted, emailed or shown.** No human is ever told this value. It only feeds `.lt('created_at', cutoffIso)` against a `timestamptz` column, where both sides are absolute instants and Postgres compares them correctly. *The comparison is not broken; only the derivation is ambient.*
- **Production is always `TZ=UTC`, so production is self-consistent.** There is no scenario where prod disagrees with itself. The divergence is prod-vs-dev only, and this is a Vercel cron that does not run on a laptop in normal operation.
- **The error direction is the safe one.** The UTC cutoff (02:30Z) is *earlier* than the London cutoff (03:30Z), and `.lt()` sweeps rows *older* than the cutoff — so prod retains a one-hour band for one extra run rather than deleting early. **Under-deletion, not over-deletion**, which is the benign direction for a GDPR sweep. The next nightly run collects it.
- The dashboard use at 665 skews a "retention due" count by at most the same one-hour band, once a year.

It fails "critical" (no human told a time; the cron still fires at 02:30 UTC). It fails "high" too: high requires being wrong in the DST edge case, and *production is not wrong there* — it is self-consistent, errs safe, and self-corrects. It lands exactly on "fragile/ambient-dependent but currently harmless".

**Fix:** replace the ambient helper with zone-explicit arithmetic. Since the threshold only needs to be a stable absolute instant, compute it in epoch milliseconds, or use date-fns `subMonths` anchored explicitly to Europe/London via date-fns-tz (`toZonedTime`/`fromZonedTime`). Add a regression test asserting an identical cutoff under `TZ=UTC` and `TZ=Europe/London` for a 29 March run instant.

Treat as hygiene, not an incident. Note this is the same `addMonths` that TZ-05 depends on — fixing it properly resolves the DST-crossing caveat in TZ-05's fix too.

---

### TZ-08 — Non-existent spring-forward wall-clock times are silently stored an hour early (LOW)

**File:** `src/lib/dateUtils.ts:17` (`parseLondonDateTimeLocalToIso`), reached from `src/app/actions/recruitment.ts:822-823, 865-866`
**Side:** server
**Class:** neither — **TZ-environment-independent.** The zone *is* explicitly pinned. This is a date-fns-tz DST-gap resolution defect.

**What's wrong:** `fromZonedTime(trimmed, 'Europe/London')` silently resolves a wall-clock time that **does not exist** (the 01:00–01:59 gap on spring-forward night) to the hour before, rather than erroring. `assertRecruitmentSlotTimes` (`src/services/recruitment.ts:73`) only validates NaN, ordering and quarter-hour alignment — nothing rejects an impossible time.

**Worked example (identical under `TZ=UTC` and `TZ=Europe/London` — verified):**

- Manager enters `2026-03-29T01:30` → stored `2026-03-29T00:30:00.000Z` → redisplays as `29 Mar 2026, 00:30`. An hour earlier than typed, no error.
- **Bonus collision, missed by the original report:** `2026-03-29T00:30` *also* stores `00:30:00.000Z`. Two distinct slots silently collapse to the same instant.
- Boundaries behave: `2026-03-29T02:00` → `01:00Z` → redisplays `02:00` (correct). The autumn ambiguous hour `2026-10-25T01:30` → `01:30Z` round-trips consistently (harmless).
- Control: `2026-07-21T14:00` → `2026-07-21T13:00:00.000Z` → renders `21 Jul 2026, 14:00` on Vercel under UTC. **The normal path is correct** — a human sees exactly what was typed.

**Why LOW:** it needs a manager to create an interview or trial slot in the 01:00–01:59 window on the one changeover night per year. For pub interviews that is effectively never.

**Fix — optional, and not recommended now.** If ever tightened: in `assertRecruitmentSlotTimes`, round-trip the parsed instant back with `formatInTimeZone(startsAt, 'Europe/London', "yyyy-MM-dd'T'HH:mm")` and reject with *"That time does not exist on this date (clocks go forward)."* when it differs from the submitted naive string (requires threading the original string through). Better placed inside `parseLondonDateTimeLocal` itself so every caller benefits (parking, rota, private bookings) — but the same reachability argument makes it low-value everywhere.

Recorded so it is known, not because it should be fixed.

---

### TZ-09 — CSV export emits `applied_at` as a raw UTC ISO timestamp (LOW)

**File:** `src/app/actions/recruitment.ts:261` (in `applicationsToCsv`, line 251; header `applied_at` at line 252)
**Side:** server
**Class:** neither — a raw string passthrough. Deterministic, no `Date` parsing, no `Intl`.

**What's wrong:** `application.created_at` goes straight into a CSV column headed `applied_at` with no formatting. `getRecruitmentApplicationsForCsv` (`src/services/recruitment.ts:1856`) selects `*` and returns rows untouched; `RecruitmentDashboardClient.tsx:1820` blobs the string straight to download. A manager really is handed a UTC instant under a human-facing header.

**Worked example:** an application created at 00:30 London on Tue 21 Jul 2026 is stored as `2026-07-20T23:30:00+00:00`. The CSV cell renders `2026-07-20T23:30:00+00:00` — a manager scanning the column reads **20 July, 23:30**: the wrong day. During BST every row reads an hour behind.

**Two corrections to the original report:**

1. It is **not** ambient-dependent. Verified by execution: byte-identical output under `TZ=Europe/London` and `TZ=UTC`. It is not a sibling of the two bugs fixed today, is not invisible locally, and `TZ=UTC` reproduction is a no-op.
2. The report's evidence string was wrong. `created_at` is `timestamptz NOT NULL DEFAULT now()` (`supabase/migrations/20260707000000_recruitment_foundation.sql:280`), and PostgREST serialises `timestamptz` with an explicit offset — so the real cell is `2026-07-20T23:30:00+00:00`, not `...000Z`.

**Why LOW (downgraded from medium):** medium is defined as *"fragile/ambient-dependent but currently harmless"* — this is the opposite: fully deterministic. The value is correct, complete and self-describing; an ISO-8601 timestamp carrying an explicit `+00:00` is a standard export representation, not wrong data. Nothing is computed, stored or compared in the wrong zone. What remains is a real but narrow presentation gap — and the report's own cross-reference checks out: `src/lib/recruitment/interview-kit-template.ts:61` pins `timeZone: 'Europe/London'`, so the export genuinely is inconsistent with the rest of the module.

**Related — the candidate-facing label gap.** The booking page (TZ-01) has no zone label anywhere: `grep -n "timezone|Europe/|UK time|timeZone"` across the whole `book/` route returns nothing. Today that is *harmless* because the ambient formatter renders the candidate's own local time — a Warsaw candidate sees 16:00, which is correct **for them**. But **the moment TZ-01 is fixed and the zone is pinned to London, that Warsaw candidate sees 15:00 with nothing telling them it is UK time** — and *then* they can arrive an hour late. This is a regression the TZ-01 fix would introduce if shipped alone.

**Fix:**

- CSV (tidy when convenient): format with the module's London-pinned pattern — `new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(application.created_at))`, matching `interview-kit-template.ts:61`. **Note this makes the cell London-but-not-machine-parseable**, so if any downstream consumer parses this CSV mechanically, keep the ISO value in a separate explicitly-named column (`applied_at_iso`) rather than dropping it. Do not use `hour12: true` with en-GB.
- Booking page: append `" (UK time)"` to the rendered label, **in the same changeset as TZ-01**.

---

## 5. Checked and cleared

This is the coverage evidence. Everything below was investigated and found correct, or was reported as a defect and refuted.

### 5a. Refuted claims

| Claim | File:line | Why it is not a bug |
|---|---|---|
| `hour12: true` + en-GB renders noon as "0pm" in invite emails | `src/lib/recruitment/communications.ts:139` | **STALE — already fixed.** Line 139 reads `hourCycle: 'h12'`. Fixed 15 Jul 2026, commit `9588c19c` "fix(recruitment): format noon consistently" — a one-line diff doing exactly what the claim proposed. Working tree clean, so HEAD == disk; the claimant read a pre-fix blob. Proven on the pinned runtime (node v20.19.5, `TZ=UTC`, formatter copied verbatim): current → `12pm` / `12:30pm` / `12am` / `12pm` (GMT). Pre-fix variant → `0pm` / `0:30pm` / `0am`. The V8 quirk analysis was sound; the fix had landed. **Sibling sweep: `grep -rn "hour12"` across the entire recruitment module returns ZERO hits.** Residual: no test covers `formatSlotClock`, so the regression could silently return — a test gap, not a live defect. |
| Reminder email says "tomorrow" for appointments up to 25 hours away | `src/lib/recruitment/communications.ts:1060` | **Not a timezone bug, and the proof case is false.** Zero ambient dependence: window uses `Date.now()`/`toISOString()` against `timestamptz`, and `formatRecruitmentAppointmentTime` pins London — byte-identical output under `TZ=UTC` and `TZ=Europe/London`. The claimed case (00:30 Wed appointment → reminder at 23:30 Mon saying "tomorrow"=Tuesday) cannot occur: Vercel cron is `"0 * * * *"` (`vercel.json:238`), on-the-hour only, so the first tick satisfying T+23h ≤ S ≤ T+25h for a 00:30 appointment is 00:00 Tue (24.5h ahead) and "tomorrow" correctly means Wednesday. A full-year sweep of 17,566 appointment instants found 368 wrong-"tomorrow" cases — **all** at exactly 00:00 sharp (365) plus 3 on 30 Mar 2026, the 23-hour clocks-forward day. Every other hour of every day is correct. The claim's DST analysis was backwards (it said DST does not widen this; spring-forward is exactly what pulls 00:30/01:00 in). Harm nil: The Anchor books interviews in daylight, and `{{appointment_time}}` carries the London-correct full date in the same sentence. Sibling SMS reminder (line 1098) has no "tomorrow" wording and is London-pinned. |
| ICS `DTSTART`/`DTEND` uses a UTC instant rather than `TZID=Europe/London` | `src/lib/recruitment/calendar.ts:139` | **Provably zone-invariant — not a bug at all.** `formatIcsUtc` (40-52) uses only `getUTC*` accessors, which are defined against the absolute instant and cannot read `process.env.TZ`. Input is `new Date(appointment.scheduled_start)`, a `timestamptz` (`...foundation.sql:352`), so PostgREST returns an offset-bearing string parsing to an unambiguous instant. Proven by execution: for a 15:00 BST interview the emitted line is byte-identical under `TZ=UTC`, `TZ=Europe/London` and `TZ=America/New_York` — `DTSTART:20260721T140000Z` in all three, which every calendar client renders as 15:00 London. Winter control equally correct. `DTSTAMP` in UTC (138) is RFC 5545-mandated. Sibling Google path (`buildRecruitmentCalendarEvent`, 87-94) independently passes explicit `timeZone`. **The claim was self-refuting** — its own text said "No wrong time today", "neither is floating", and "No action recommended". Sole residual: a UK DST *rule change* legislated inside a days-to-weeks booking horizon. Requires an Act of Parliament. Changing a live invite flow to chase that is net-negative risk. |
| `addDurationToDateTimeParts` does slot-duration arithmetic through ambient `new Date(...)` | `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:1074` | **Both worked outcomes are FALSE** — the claim assumed `DEFAULT_SLOT_DURATION_MS` is 1h when it is **2h** (line 135). Executed proof (London browser): 25 Oct 2026 01:30 → closes 02:30, **not** the claimed zero-length slot; 29 Mar 2026 00:30 → closes 03:30, storing a correct 2h, **not** the claimed 1h-labelled-2h. Normal control (21 Jul 14:00 → 16:00, 13:00Z→15:00Z) identical under London, UTC and New_York — the two ambient legs cancel. **Client-only**: reached solely from the `onChange` at line 3272, an event handler that never runs on Vercel. Server path independently pinned via `parseDateTimeLocal`. The only real defect constructible is a *different* one: at 25 Oct 01:30 (the ambiguous repeated hour) the browser resolves to BST (00:30Z) while the server's `fromZonedTime` resolves to GMT (01:30Z), storing 1 real hour instead of 2. Ambiguity-resolution mismatch, one night a year, at an hour the pub is shut, and **nothing is mis-displayed** — the manager sees the autofilled 02:30 before submitting. The fix rides along free with TZ-04. |
| Offered slot times are not labelled "UK time", so an overseas candidate misreads them | `src/app/recruitment/book/[token]/RecruitmentBookingClient.tsx:211` | **Premise false and predicted harm runs backwards — as filed.** The claim assumed `formatDateTime` is zone-pinned; it is not (that is TZ-01, still open). Proven by execution (slot `2026-07-21T14:00:00Z`): a Warsaw browser renders `16:00`, which is that candidate's **correct** local time for a 15:00 London interview. They arrive on time. The ambient formatter *actively prevents* the harm described. The claim describes a **future regression** introduced by fixing TZ-01 without adding a label — not current behaviour. It is therefore **retained as part of TZ-09's fix**, not as an independent finding. Also confirmed: `slot.timezone` is in the payload and unused (`select('*')` at `services/recruitment.ts:2295-2300`); `grep` for `timezone|Europe/|UK time|timeZone` across the whole `book/` route returns zero. |

### 5b. Surfaces checked and found correct

| Surface | Evidence |
|---|---|
| `formatRecruitmentAppointmentTime` | `src/services/recruitment.ts:2721` — `Intl.DateTimeFormat('en-GB', { dateStyle:'medium', timeStyle:'short', timeZone: appointment.timezone \|\| 'Europe/London' })`. **The reference pattern.** |
| Manager alert — booking route | `src/app/api/recruitment/booking/[token]/route.ts` — fixed today; now uses `formatRecruitmentAppointmentTime`. |
| Manager alert — reschedule route | `src/app/api/recruitment/booking/[token]/reschedule/route.ts` — fixed today; same. |
| Invite/reminder email + SMS formatters | `src/lib/recruitment/communications.ts` — `timeZone` threaded through every Intl call (`slotDateKey:117`, `formatSlotDate:131`, `formatSlotClock:140`); `parseSlotTime:157` defaults to `'Europe/London'`. `TZ=UTC` run byte-identical to a London run. `hourCycle:'h12'` correct since `9588c19c`. |
| ICS producer | `src/lib/recruitment/calendar.ts:40-52, 139` — `getUTC*` only; byte-identical across three zones. `DTSTAMP` UTC is RFC-mandated. |
| Google Calendar event builder | `src/lib/recruitment/calendar.ts:87-94` — explicit `timeZone: appointment.timezone \|\| 'Europe/London'`. |
| Calendar-retry cron comparison | `src/lib/recruitment/calendar.ts:285` — instant-vs-`timestamptz`, no human-facing render. Correct. |
| Retention erasure cron | `src/services/recruitment.ts:2571-2581` — `.lt('created_at', cutoffIso)`, instant-vs-`timestamptz`. Correct. (Its *cutoff derivation* is TZ-07; the comparison itself is sound.) |
| Dashboard `retentionDue` count | `src/services/recruitment.ts:~727` — same sound `created_at` filter. |
| `formatSlotDateTime` / `formatTimeOnly` / `formatSlotOptionLabel` | `RecruitmentDashboardClient.tsx:211/222, 233, 239` — all `timeZone`-pinned. The correct siblings TZ-03 diverged from. |
| `formatDateOnly` | `RecruitmentDashboardClient.tsx:1086` — parses at `T12:00:00Z`, `timeZone: 'Europe/London'`. Correct. TZ-02 is an isolated slip beside it, not a pattern. |
| Public posting listing gate | `src/services/recruitment.ts:336` — `londonDateString()`. Correct. |
| Application POST gate | `src/app/api/recruitment/applications/route.ts:81` — `londonDateString()`. Correct; **fails closed**. |
| `application_closing_date` write | `src/services/recruitment.ts:336` — `londonDateString()`. Correct. |
| Interview-kit template | `src/lib/recruitment/interview-kit-template.ts:61` — `timeZone: 'Europe/London'`. Correct. |
| `appointmentStarted` | `RecruitmentBookingClient.tsx:40` — `new Date(scheduled_start) <= new Date()`, instant-vs-instant, zone-independent. Correct. |
| Booking submission payload | `RecruitmentBookingClient.tsx:104, 142` — posts `slot_id`, never a formatted string. A mislabelled option cannot store a wrong time. |
| Slot picker `<option value>` | `RecruitmentDashboardClient.tsx:3557` — `value={slot.id}`. Same protection. |
| Schema | All recruitment timestamp columns are `timestamptz`; `timezone text NOT NULL DEFAULT 'Europe/London'` on both `recruitment_appointment_slots` (`:334`) and `recruitment_candidate_appointments` (`:354`). `retention_until` and `application_closing_date` are `date` (correctly — they are calendar dates; the bugs are in how they are *derived*). |
| `hour12` sweep | `grep -rn "hour12"` across `src/lib/recruitment/`, `src/services/recruitment.ts`, `src/app/api/recruitment/`, `src/app/(authenticated)/recruitment/`, `src/app/recruitment/` → **zero hits**. The Node 20 "0pm" quirk does not exist anywhere in the module. |
| Ambient `toLocale*` sweep | `grep -rn "toLocaleString\|toLocaleDateString\|toLocaleTimeString"` across the recruitment module → **zero hits**. The two routes fixed today were the last of that class. |
| `TZ` env overrides | No `TZ` in `next.config.mjs`, `vercel.json`, `package.json`, `.env.example`; no `process.env.TZ` assignment and no Intl prototype shim anywhere in `src/`. Confirms production really is UTC and nothing is silently compensating. |
| Dead-duplicate check | `recruitment/page.tsx:2` is the **sole** importer of `RecruitmentDashboardClient.tsx`. No dead duplicate exists. All findings land on the live file. |

---

## 6. How to validate these findings yourself

Everything below is read-only. Run from the repo root.

### 6.0 Set up

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
nvm use            # Node 20 LTS per .nvmrc — the V8 quirks are version-specific
node -v            # expect v20.19.x
git status         # expect clean-ish; confirm you are reading HEAD, not a stale blob
```

**Read this first:** one refuted claim was reported against code that had been fixed the previous day. Always confirm the line you are reading is on disk at HEAD.

### 6.1 Prove the environment asymmetry

```bash
TZ=UTC            node -e "console.log(new Date('2026-07-21T14:00:00Z').toLocaleString('en-GB'))"
TZ=Europe/London  node -e "console.log(new Date('2026-07-21T14:00:00Z').toLocaleString('en-GB'))"
# 14:00 vs 15:00 — same code, different answer. That is production vs your laptop.
```

### 6.2 TZ-01 — booking page formatter

```bash
sed -n '29,37p;184p;211p' src/app/recruitment/book/[token]/RecruitmentBookingClient.tsx
grep -n "timezone\|timeZone\|Europe/\|UK time" src/app/recruitment/book/\[token\]/RecruitmentBookingClient.tsx
# expect: zero matches -> the zone is never pinned and never labelled
```

```bash
for Z in UTC Europe/London Europe/Warsaw America/New_York; do
  TZ=$Z node -e "
    const f = new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeStyle:'short'});
    const p = new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeStyle:'short',timeZone:'Europe/London'});
    const d = new Date('2026-07-21T14:00:00Z');
    console.log('$Z'.padEnd(18), 'ambient:', f.format(d), '| pinned:', p.format(d));
  "
done
```

Expect ambient to vary (14:00 / 15:00 / 16:00 / 10:00) and pinned to read 15:00 in all four.

Confirm it really is server-rendered:

```bash
grep -n "dynamic\|RecruitmentBookingClient" src/app/recruitment/book/\[token\]/page.tsx
# expect: export const dynamic = 'force-dynamic' + a direct static import (no next/dynamic, no ssr:false)
```

Midnight-boundary case:

```bash
TZ=UTC node -e "console.log(new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeStyle:'short'}).format(new Date('2026-07-21T23:30:00Z')))"
# 'Tuesday, 21 July 2026 at 23:30' — should be 'Wednesday, 22 July 2026 at 00:30'
```

### 6.3 TZ-02 — `isPastClosingDate`

```bash
sed -n '1086p;1096,1103p' "src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx"
```

```bash
for Z in UTC Europe/London; do
  TZ=$Z node -e "
    const closing='2026-07-15';
    const now=new Date('2026-07-15T23:30:00Z');            // 00:30 London, 16 Jul, BST
    const buggy   = closing < now.toISOString().slice(0,10);
    const london  = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(now);
    const correct = closing < london;
    console.log('$Z'.padEnd(16),'buggy expired?',buggy,'| london today:',london,'| correct expired?',correct);
  "
done
```

Expect **identical** output in both zones: `buggy expired? false | correct expired? true`. **That identity is the point** — it proves this is not an ambient bug and a London laptop will not save you.

Controls (all should agree): swap the instant for `2026-07-15T22:30:00Z`, `2026-07-16T01:30:00Z`, and `2025-12-15T23:30:00Z`.

Confirm the gates are already correct:

```bash
sed -n '81p' src/app/api/recruitment/applications/route.ts
sed -n '336p' src/services/recruitment.ts
grep -rn "londonDateString" src/ --include="*.ts" --include="*.tsx"
# expect 3 duplicate definitions: services/recruitment.ts:211, api/recruitment/applications/route.ts:40,
# lib/private-bookings/financial.ts:118 — all reimplementing getTodayIsoDate
```

### 6.4 TZ-03 — dashboard formatter

```bash
sed -n '201,245p' "src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx"
```

```bash
for Z in UTC Europe/London; do
  TZ=$Z node -e "
    const d=new Date('2026-07-21T14:00:00Z');
    const ambient=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'});
    const pinned =new Intl.DateTimeFormat('en-GB',{weekday:'short',dateStyle:undefined,timeStyle:undefined,
                    day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'});
    console.log('$Z'.padEnd(16),'formatDateTime:',ambient.format(d),'| formatSlotDateTime-style:',pinned.format(d));
  "
done
```

Verify the SSR-reachability claims yourself rather than trusting them:

```bash
grep -n "activeTab\b" "src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx" | head -5   # default 'pipeline' ~1322
sed -n '1340,1346p' "src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx"               # selected* init null
sed -n '1984p;2086p;3312p;3336,3342p;3347p;3443p;3557p' "src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx"
grep -n "dynamic" "src/app/(authenticated)/recruitment/page.tsx"                                                   # force-dynamic
grep -rn "RecruitmentDashboardClient" src/ --include="*.tsx"                                                       # sole importer -> no dead duplicate
```

### 6.5 TZ-04 — asymmetric datetime-local round-trip

```bash
sed -n '135p;1053,1080p;1129p;2780p;3272p;3829p' "src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx"
sed -n '204p;609p' src/app/actions/recruitment.ts
sed -n '10,45p' src/lib/dateUtils.ts
```

```bash
for Z in Europe/London UTC America/New_York; do
  TZ=$Z npx tsx -e "
    import { parseLondonDateTimeLocalToIso, toLondonDateTimeLocalValue } from './src/lib/dateUtils'
    const todayLocalDateTime = (v?: string) => {
      const d = v ? new Date(v) : new Date()
      return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16)
    }
    const stored = '2026-07-21T14:00:00Z'
    const seeded = todayLocalDateTime(stored)
    console.log('$Z'.padEnd(18),'seeds:',seeded,'-> re-saves:',parseLondonDateTimeLocalToIso(seeded),
                '| london helper seeds:',toLondonDateTimeLocalValue(stored))
  "
done
```

Expect London → seeds 15:00, re-saves `14:00:00Z` (no-op). UTC → seeds 14:00, re-saves `13:00:00Z` (**1h drift**). New_York → `09:00:00Z`. The London helper should read 15:00 in all three.

Confirm the drawers are click-gated (i.e. never SSR'd), which is what caps this at medium:

```bash
sed -n '1337p;1346p;1761p;1803p;3336p;3342p' "src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx"
```

### 6.6 TZ-05 — `retention_until`

```bash
sed -n '169,173p;211,223p;330p;645,650p;1523p' src/services/recruitment.ts
grep -n "retention_until" supabase/migrations/20260707000000_recruitment_foundation.sql
```

```bash
for Z in UTC Europe/London; do
  TZ=$Z node -e "
    const addMonths=(d,m)=>{const n=new Date(d);n.setMonth(n.getMonth()+m);return n};
    const london=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(d);
    const consent='2026-07-15T23:30:00Z';            // 00:30 London, 16 Jul, BST
    const cur=addMonths(new Date(consent),12).toISOString().slice(0,10);
    const fix=london(addMonths(new Date(consent),12));
    console.log('$Z'.padEnd(16),'stored:',cur,'| london-correct:',fix);
  "
done
```

Expect `stored: 2027-07-15 | london-correct: 2027-07-16` in **both** zones. Controls at 12:00 BST and in January should show `stored == london-correct`.

Prove the DST-crossing caveat (why the one-line fix is incomplete in general):

```bash
for Z in UTC Europe/London; do
  TZ=$Z node -e "
    const addMonths=(d,m)=>{const n=new Date(d);n.setMonth(n.getMonth()+m);return n};
    const london=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(d);
    console.log('$Z'.padEnd(16),'months=6 FIXED:',london(addMonths(new Date('2026-07-15T23:30:00Z'),6)));
  "
done
# UTC -> 2027-01-15, London -> 2027-01-16. The 'fix' still diverges when the offset crosses DST.
```

Prove the column has no reader — **do this yourself, it is the whole severity argument:**

```bash
grep -rn "retention_until\|retentionUntil" src/ supabase/ --include="*.ts" --include="*.tsx" --include="*.sql"
# expect only: the two writes (649, 1523), the null-guard (648), the type (database.recruitment.ts:62),
# one test, and the column definition. Zero .tsx renders. Zero SQL consumers.
sed -n '2571,2581p' src/services/recruitment.ts     # erasure keys off created_at, not retention_until
```

### 6.7 TZ-06 — anon RLS policy

```bash
sed -n '1,25p' supabase/migrations/20260708000007_recruitment_posting_closing_dates.sql
```

Read-only SQL against production (via Supabase MCP or the SQL editor):

```sql
SELECT current_setting('TimeZone');                                  -- expect 'UTC'
SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'anon';      -- expect only statement_timeout, no TimeZone
SELECT polname, qual FROM pg_policies WHERE tablename = 'recruitment_job_postings';
SELECT relrowsecurity FROM pg_class WHERE relname = 'recruitment_job_postings';  -- expect true

-- the divergence, at 00:30 BST:
SET LOCAL TimeZone = 'UTC';
SELECT ('2026-07-15 23:30:00+00'::timestamptz AT TIME ZONE 'UTC')::date          AS utc_current_date,
       ('2026-07-15 23:30:00+00'::timestamptz AT TIME ZONE 'Europe/London')::date AS london_date;
-- 2026-07-15 vs 2026-07-16
```

Prove there is no anon consumer — this is what downgraded it to medium:

```bash
grep -rn "recruitment_job_postings" src/ --include="*.ts" --include="*.tsx"
# every hit should be behind createAdminClient() / service role, which bypasses RLS
```

### 6.8 TZ-07 — retention cron cutoff

```bash
for Z in UTC Europe/London; do
  TZ=$Z node -e "
    const addMonths=(d,m)=>{const n=new Date(d);n.setMonth(n.getMonth()+m);return n};
    for (const t of ['2026-03-29T02:30:00Z','2026-10-25T01:30:00Z','2026-01-15T02:30:00Z','2026-07-15T02:30:00Z'])
      console.log('$Z'.padEnd(16), t, '->', addMonths(new Date(t), -12).toISOString());
  "
done
grep -n "recruitment-retention" vercel.json     # expect '30 2 * * *'
```

Expect divergence **only** on the two changeover instants; Jan and Jul identical.

### 6.9 TZ-08 — spring-forward gap

```bash
for Z in UTC Europe/London; do
  TZ=$Z npx tsx -e "
    import { parseLondonDateTimeLocalToIso } from './src/lib/dateUtils'
    import { formatInTimeZone } from 'date-fns-tz'
    for (const s of ['2026-03-29T00:30','2026-03-29T01:00','2026-03-29T01:30','2026-03-29T02:00','2026-10-25T01:30','2026-07-21T14:00']) {
      const iso = parseLondonDateTimeLocalToIso(s)
      console.log('$Z'.padEnd(16), s, '->', iso, '-> redisplays', formatInTimeZone(new Date(iso!),'Europe/London','dd MMM yyyy, HH:mm'))
    }
  "
done
```

Expect identical output in both zones. Note `00:30` and `01:30` both produce `00:30:00.000Z` — the collision.

### 6.10 TZ-09 — CSV

```bash
sed -n '251,262p' src/app/actions/recruitment.ts
sed -n '1856p' src/services/recruitment.ts
sed -n '1820p' "src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx"
sed -n '61p' src/lib/recruitment/interview-kit-template.ts
grep -n "created_at" supabase/migrations/20260707000000_recruitment_foundation.sql | head
```

### 6.11 Verify the cleared items

```bash
# hour12 sweep — expect ZERO hits
grep -rn "hour12" src/lib/recruitment/ src/services/recruitment.ts src/app/api/recruitment/ \
  "src/app/(authenticated)/recruitment/" src/app/recruitment/

# ambient toLocale* sweep — expect ZERO hits
grep -rn "toLocaleString\|toLocaleDateString\|toLocaleTimeString" \
  src/lib/recruitment/ src/services/recruitment.ts src/app/api/recruitment/ \
  "src/app/(authenticated)/recruitment/" src/app/recruitment/

# the communications.ts fix really landed
sed -n '135,146p' src/lib/recruitment/communications.ts     # expect hourCycle: 'h12'
git log --oneline -1 -L139,139:src/lib/recruitment/communications.ts    # expect 9588c19c

# no TZ compensation anywhere
grep -rn "process.env.TZ\|\"TZ\"\|'TZ'" src/ next.config.mjs vercel.json package.json .env.example

# ICS is zone-invariant
for Z in UTC Europe/London America/New_York; do
  TZ=$Z npx tsx -e "
    const d=new Date('2026-07-21T14:00:00Z');
    const p=n=>String(n).padStart(2,'0');
    console.log('$Z'.padEnd(18),'DTSTART:'+d.getUTCFullYear()+p(d.getUTCMonth()+1)+p(d.getUTCDate())+'T'+p(d.getUTCHours())+p(d.getUTCMinutes())+'00Z');
  "
done
# identical in all three
```

### 6.12 Run the tests

```bash
npm test
npx vitest run src/lib/recruitment/__tests__/                       # answers, calendar, email-signature, manager-alert
TZ=UTC npx vitest run src/lib/recruitment/__tests__/                # the run that actually matters
TZ=UTC npx vitest run src/lib/__tests__/dateUtils.test.ts
```

`src/lib/recruitment/__tests__/manager-alert.test.ts` is the pattern for a `TZ=UTC`-executed guard test. **A dev-machine test run cannot catch the ambient class of bug — always run recruitment tests under `TZ=UTC` too.**

---

## 7. Recommended fixes, ordered

| # | ID | Change | Risk | Effort | Notes |
|---|---|---|---|---|---|
| 1 | **TZ-01 + TZ-09(label)** | Pin `timeZone` in `RecruitmentBookingClient.tsx:33` (pass `record.timezone \|\| 'Europe/London'` at lines 184 and 211) **and add "(UK time)" to the label in the same commit** | Low | S | The only remaining place a human is durably told the wrong hour. Also kills a live hydration mismatch. **Must ship together** — pinning alone regresses the non-UK candidate from "correct local time" to "unlabelled London time". |
| 2 | **TZ-03** | Add `timeZone: 'Europe/London'` to `RecruitmentDashboardClient.tsx:205` | Very low | XS | One line; fixes ~20 call sites and the SSR flip at 1984. Zero-risk hygiene — do it with #1. |
| 3 | **TZ-02** | `isPastClosingDate` → `getTodayIsoDate()` from `@/lib/dateUtils` | Very low | XS | Makes the staff badge agree with the already-correct server gates. |
| 4 | **TZ-04** | `todayLocalDateTime` → `toLondonDateTimeLocalValue` / `utcIsoToLondonLocalInput`; covers lines 1061, 2780, 3829 | Low | S | Stops a *silent write drift*. Also fixes the `addDurationToDateTimeParts` ambiguous-hour mismatch for free. Does not solve the autumn ambiguous hour — known, accepted. |
| 5 | **TZ-06** | New migration re-creating the anon RLS policy with `(now() AT TIME ZONE 'Europe/London')::date` | Low | S | Verified no-op outside the broken hour. **Never** fix by setting the DB TimeZone — that changes semantics app-wide. Follow the prod-migration workflow. |
| 6 | **TZ-05 + TZ-07** | Fix `addMonths` to be zone-explicit; wrap both `retention_until` writes (649, 1523) in `londonDateString()` — ideally extract `addRetentionMonthsAsLondonDate()` | Low | S | Bundle them: fixing `addMonths` properly resolves TZ-05's DST-crossing caveat. Zero live impact (`retention_until` has no reader; the cron errs safe) — this is hardening, not an incident. Do not prioritise over #1–#4. |
| 7 | — | **Consolidate the three duplicate `londonDateString()` copies** onto `getTodayIsoDate()` in `src/lib/dateUtils.ts` | Low | S | `services/recruitment.ts:211`, `api/recruitment/applications/route.ts:40`, `lib/private-bookings/financial.ts:118`. This duplication is *why* TZ-02 drifted. Prevents a fourth divergence. Touches outside recruitment — its own changeset. |
| 8 | — | **Add a `TZ=UTC` test covering `formatSlotClock`** | Very low | XS | The `hour12`→`hourCycle` fix (`9588c19c`) has no test. The regression could silently return. Closes the one real gap the refuted claim exposed. |
| 9 | **TZ-09(CSV)** | Format `applied_at` London-pinned; keep an `applied_at_iso` column if anything parses the file | Low | XS | Cosmetic/consistency. Tidy when convenient. |
| 10 | **TZ-08** | Reject non-existent spring-forward wall-clock times | Medium | M | **Not recommended.** One night a year, at an hour the pub is shut. Recorded, not actioned. |

**Suggested batching:** items 1–4 as one PR (all user-facing rendering + the write-drift, all low risk, all in two files). Item 5 as its own migration PR. Items 6–8 as a hygiene PR. Items 9–10 backlog.

---

## 8. Open questions for the reviewer

1. **TZ-02 severity — high or medium?** I rated it high because it never reads the ambient zone and is therefore *deterministically* wrong everywhere, which excludes it from the medium band ("fragile/ambient-dependent but currently harmless"). The counter-argument is strong: it is a read-only badge, gates nothing, misleads no candidate, and is one hour a night for half the year. **Recommendation: keep it high** — "deterministically wrong on every machine" should not sit in a band whose definition is "ambient-dependent" — but I would not fight a reviewer who moves it to medium. The fix is a one-liner either way, so the label changes nothing practical.

2. **Should `retention_until` have a reader at all?** (Product decision.) The column is written on every candidate and read by nothing. Either wire it into the erasure path — in which case TZ-05 becomes a genuine GDPR bug and jumps priority — or delete it. Leaving a write-only GDPR date in the schema is the worst of both: it *looks* like a compliance control to any future auditor or developer, and it is wrong. **Recommendation: decide before fixing TZ-05**, because "delete the column" is a cheaper and better fix than "correct the date nobody reads".

3. **Should the retention clock start at consent or at terminal status?** Out of timezone scope but surfaced by the audit. Line 1523 starts it at **consent** for every candidate; line 649 is written to start it at **terminal status** but is unreachable, because 1523 always populates the field so the `!candidate.retention_until` guard never passes. **The two write sites encode contradictory policies and one is dead.** This is arguably a more consequential defect than any timezone finding in this document. **Recommendation: raise as its own ticket.**

4. **Should the candidate booking page show the candidate's local time, London time, or both?** Today the ambient formatter accidentally shows their local time — which for an overseas applicant is *correct and useful*. Pinning to London (TZ-01) is right for correctness and hydration, but strictly reduces information for that reader. **Recommendation: pin to London and label "(UK time)"** — one location, one zone, one number, and the label makes it unambiguous. Showing both would be more helpful but is more surface to get wrong, and the overseas applicant is a fringe case for a Stanwell Moor pub. This is a product call.

5. **Is a `TZ=UTC` CI job worth it?** Every ambient-class finding here would have been caught by running the existing suite a second time under `TZ=UTC`. Cost is one extra CI job. **Recommendation: yes** — this bug class is invisible locally by construction, and code review has demonstrably not caught it (the two fixed today shipped, and TZ-03 sits three lines from a correctly-pinned sibling).

6. **TZ-07: fix or accept?** Production is self-consistent (always UTC), errs toward under-deletion, and self-corrects on the next nightly run. The only divergence is prod-vs-dev, for a cron that does not run on laptops. **Recommendation: fix it, but only as part of the TZ-05 bundle** — the value is that `addMonths` stops being a zone landmine for future callers, not that anything is broken now.

---

**Done** — spec covers 9 confirmed findings (0 critical, 2 high, 5 medium, 2 low), 7 refuted claims with reasons, 20+ cleared surfaces, and per-finding reproduction commands.
**Next:** reviewer validates via §6; owner decides on §8 Q2/Q3/Q4 before the TZ-05 work starts.
**You need to:**
- [ ] Decide whether `retention_until` gets a reader or gets deleted (§8 Q2) — this changes TZ-05's priority
- [ ] Decide consent-vs-terminal-status for the retention clock (§8 Q3) — likely a separate ticket
- [ ] Approve "(UK time)" labelling on the candidate booking page (§8 Q4)
- [ ] Approve the TZ-06 migration for production (follows the prod-migration workflow)