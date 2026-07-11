# /recruitment review — benchmark & recommendations

**Date:** 2026-07-10
**Scope:** The Anchor Management Tools `/recruitment` feature, benchmarked against industry recruitment/ATS systems (GitHub `recruitment-system` topic + mainstream ATS + UK hospitality hiring norms).
**Method:** Multi-agent review — 7 code-map dimensions + 3 benchmark lenses → gap synthesis → every recommendation adversarially verified against the actual code. Verdicts: 23 confirmed gaps, 9 partial, 0 already-built false positives. **No P0s** (nothing critically broken or exposed was found).

> Coverage note: the dedicated AI-screening reader failed mid-run, so AI-screening was covered indirectly (via the data-model map and the per-recommendation verification passes that read `src/lib/recruitment/ai.ts`). Everything else was mapped directly.

---

## Verdict

Your `/recruitment` is **already a strong, above-average ATS for a single pub** — it is more rigorous than most of the open-source "recruitment-system" projects it would be benchmarked against. It has genuine strengths those projects usually lack: a codified status-transition graph enforced in the database, race-safe atomic appointment booking, GDPR retention/erasure modelled up front, hashed single-use booking tokens, defence-in-depth RBAC + RLS, and a mature manager-editable email pipeline with a full audit trail.

The gaps are **not foundational**. They cluster into: (1) a few **compliance-completeness** holes in features you've already built, (2) **candidate-experience and comms** polish that lifts response/show rates, and (3) **maintainability/analytics** debt. Bringing it "up to scratch" is a backlog of well-scoped increments, not a rebuild.

---

## How it compares to the benchmark

| Capability | Industry ATS | The Anchor today |
|---|---|---|
| Job postings + public feed | ✅ | ✅ (postings feed to the-anchor.pub) |
| CV upload + parsing | ✅ | ✅ (validated, magic-byte checked, AI extraction) |
| AI screening/scoring | Increasingly common | ✅ (score + recommendation + notes) |
| Pipeline/stages + audit | ✅ | ✅✅ (DB-enforced transition graph + event log — better than most) |
| Interview self-scheduling | ✅ | ✅✅ (race-safe atomic booking, Google Calendar + ICS) |
| Structured scorecards | ✅ | ✅ (per-appointment; not aggregated) |
| Email templates | ✅ | ✅✅ (DB-backed, manager-editable, defensive finalisation) |
| SMS | Common | ⚠️ reminder-only, no manager-composed SMS |
| Two-way messaging / delivery status | ✅ | ❌ outbound-only; bounces/replies not captured |
| Offer management | ✅ | ❌ status flag only, no offer object |
| Onboarding handoff | ✅ | ⚠️ single `converted_employee_id` FK |
| Right-to-work checks | Common (hospitality) | ⚠️ flag only, no evidence/expiry |
| Analytics/funnel reporting | ✅ | ❌ counts + Kanban only |
| Talent pool / CRM | ✅ | ⚠️ exists, but manual & one-at-a-time |
| GDPR consent/retention/erasure | Varies | ✅✅ built — but see P1 completeness gaps |
| Source-of-hire attribution | ✅ | ❌ coarse 5-value enum |

`✅✅` = ahead of the typical benchmark; `⚠️` = present but thin; `❌` = missing.

---

## Recommendations (verified, de-duplicated, prioritised)

Effort: **S** <1d · **M** 1–3d · **L** 1–2wk. Every item was checked against the code; file references are the verified locations.

### P1 — do soon (compliance completeness in features you already ship)

**1. Scrub AI-run PII on erasure & retention anonymisation — M**
`runRecruitmentRetentionCleanup` and `eraseRecruitmentCandidate` null the candidate row and blank `recruitment_communications`, but **never touch `recruitment_ai_runs`**, whose `structured_output`/`raw_response` hold the candidate's name, contact details and CV-derived work history. Because erasure anonymises the candidate *in place* (no row delete), the `ON DELETE CASCADE` never fires — so PII survives a supposed Article 17 erasure and the 12-month auto-anonymisation. Fix: scrub/delete `ai_runs` rows in both paths, joining on **`application_id` as well as `candidate_id`** (runs are created pre-extraction with a null `candidate_id`), inside the same audited operation. Add a regression test asserting no `ai_runs` PII survives.
`src/services/recruitment.ts:2525-2673`, `src/lib/recruitment/ai.ts:246-375`, migration `20260707000000:296-318`.

**2. Store right-to-work evidence with expiry + follow-up — L**
RTW is four flat columns (`right_to_work_status/document_type/checked_at/checked_by`) — no stored evidence, no share-code/DOB, **no visa/permission expiry**, no follow-up cron, and no verified-gate before a trial shift. Hospitality is an active Home Office enforcement sector (penalties up to £45k first breach / £60k per worker repeat). Fix: capture the 9-char share code + DOB, store the checked evidence in a restricted bucket (reuse the `recruitment-cvs` pattern), add `permission_expiry_date` + a reminder cron for time-limited RTW, and surface an RTW-verified gate on the hire handoff. A structured checklist is enough to establish the statutory excuse — no IDSP integration needed.
`recruitment_candidates` RTW columns `20260707000000:202-208`; templates only say "bring proof" (`communications.ts:222`).

### P2 — high value (compliance correctness, comms, candidate experience, sourcing, maintainability)

**3. Honour `retention_until` + the DB retention policy — M** (compliance correctness)
Cleanup keys off `application.created_at` and reads only the `RECRUITMENT_RETENTION_MONTHS` env var; the per-candidate `retention_until` the system itself computes **and** the seeded `system_settings.recruitment_retention_policy` are both ignored (dead config). No live divergence today because all three currently equal 12 months, but editing the policy has no effect and long pipelines anonymise on the wrong date. Fix: drive cleanup from `candidate.retention_until` (fallback to `created_at + window`), read the window/action from `system_settings` with env override.
`src/services/recruitment.ts:155-158, 631-647, 2528-2534`; migration `20260707000000:147-157`.

**4. Confirm-before-cancel on the public booking page — S** (candidate experience)
The Cancel button fires `cancel()` immediately — one mis-tap on mobile cancels the interview/trial, deletes the calendar event and pings a manager. Gate it behind a lightweight confirm/Modal. (Recoverable — the candidate can rebook — but cheap to fix on the one destructive control in the public flow.)
`src/app/recruitment/book/[token]/RecruitmentBookingClient.tsx:117-133,187`.

**5. Wire the dead KPI cards + URL-synced filters + server-side pagination — S→M** (dashboard UX + scale)
Six of seven headline KPI tiles look clickable but do nothing — the data layer emits an `href` per tile, the client discards it. Filters are `useState`-only (reset on reload, not shareable), and the applications list is paginated **client-side over the full array** (every non-archived application ships to the browser). Fix: consume `item.href` to deep-link into filtered views, URL-sync search/status/archived, and move list filtering + pagination server-side (mirror the talent-pool path).
`RecruitmentDashboardClient.tsx:1861-1878, 1322, ~APPLICATION_PAGE_SIZE`; `getRecruitmentDashboard` `recruitment.ts:748-755`.

**6. Malware-scan uploaded CVs — M** (security)
CVs pass format/size/magic-byte checks then go straight to storage and are later downloaded by staff via signed URL — **no AV scan** anywhere (grep-confirmed). Untrusted public upload → staff download is a standard AV-control path; magic bytes don't catch a malicious-but-well-formed PDF/DOC macro. Add a scan step between validation and storage write, block signed-URL generation for unscanned/failed objects, record scan status. Cover both `.upload` paths (`recruitment.ts:291-301` and `:2450`).
`src/lib/recruitment/files.ts:84-119`.

**7. Candidate application-status page — M** (candidate experience)
The only candidate surface is the token-gated slot picker, which appears **after** a manager issues a booking link. A freshly-applied candidate can't see "received → reviewing → booked → outcome". Mint a hashed status token at application time (via the acknowledgement email) and render a simple no-account status page. Cuts "have you seen my application?" chases; rejected applicants are also customers.
Only candidate route is `/recruitment/book/[token]`; tokens minted only at scheduling (`recruitment.ts:2151-2208`).

**8. Manager-composed SMS + SMS templates — M** (communications)
All 9 editable templates are email-only; the sole SMS is a hardcoded reminder string, and `sendRecruitmentSms` (consent-gated, wired to the comms log) has **no UI caller**. For fast pub hiring a text gets a same-hour reply. Add SMS template variants (invite/confirmation/reminder/decision) and a consent-gated "Send SMS" drawer control reusing `sendRecruitmentSms`. Plumbing already exists (`channel='sms'` supported).
`communications.ts:836, 1074`; templates `20260707000000:379-406`.

**9. Automate no-show detection + close the sub-24h reminder hole — M** (scheduling)
Reminders only fire in a **23–25h window** on an hourly cron, so an appointment booked <24h out (common in hospitality) gets **no reminder**, and there's no day-of nudge. Elapsed `scheduled` appointments are never auto-flagged (deliberate per migration comment). Add a cron that flags/auto-no-shows past appointments and surfaces them, plus a ~2h same-day reminder. (No-show alert + manual reschedule already exist.)
`communications.ts:1037-1038`; migration `20260716000000:20`; `recruitment.ts:2010-2015`.

**10. Source attribution + QR/short-link walk-in apply — M** (sourcing)
Source is a coarse 5-value enum; the public path hardcodes `'website'`; no `referred_by`, no per-posting QR, no source-of-hire tally. Add "how did you hear about us?" + optional referrer, generate a per-posting QR/short-link (you already run `vip-club.uk`/`l.the-anchor.pub` + QR generation), tally source by hires. Walk-in/word-of-mouth are top hospitality channels; a beer-mat QR captures locals cheaply.
`source` CHECK `20260707000000:192,256`; intake hardcodes source `applications/route.ts:170,178`.

**11. Structured availability + knock-out capture at apply time — L** (intake) *(partial — some exists)*
Free-text availability is already captured, shown on the drawer, and AI-weighted — so this is a **refinement**, not a hole. Add a typed availability grid (days × day/evening), weekly hours, earliest-start date, and 18+/alcohol + RTW self-declarations, with optional auto-deprioritisation. Availability is the primary pub screening signal; structuring it speeds triage.
`applications/route.ts:182-186`; `types/recruitment.ts:87-95`; AI already uses it `ai.ts:396-436`.

**12. Inbound replies + delivery/bounce status + STOP opt-out — L** (reliability/comms)
The comms trail is **outbound-only**: the Twilio webhook has no recruitment branch, email `replyTo` is a personal inbox, `bounced`/`suppressed` are reserved but never set, and an SMS **STOP does not clear candidate `sms_consent`** (a PECR risk). Add a recruitment branch to the inbound webhook (match by `phone_e164`, log to `recruitment_communications` + timeline, process STOP), and wire Twilio/Graph status callbacks to set `failed`/`bounced`. (Send failures already flip to `failed`; replies currently reach a monitored human inbox — so the STOP/compliance strand is the real driver.)
`webhooks/twilio/route.ts` (no `recruit` match); `communications.ts:39-40,440`; `contact.ts:26`.

**13. Break up the 3,868-line `RecruitmentDashboardClient` + kill `any` — L** (maintainability)
The live dashboard is one 3,868-line client component holding all 7 tabs, the Kanban board, the 5-tab drawer, every dialog and form inline, with **72 `: any` casts** against the project's strict-TS standard — the single biggest regression risk in the feature. Extract each tab/drawer into `_components/`, lift shared state into a hook/context first, type props with the existing `src/types/recruitment.ts` interfaces. One tab per PR to stay deployable. (Lifting the shared state is the hard first step — could push toward XL.)
`RecruitmentDashboardClient.tsx` (3868 lines); typed interfaces already in `types/recruitment.ts`.

**14. Lightweight recruiting analytics/funnel — M** (analytics)
Two independent readers flagged "no real reporting" as the biggest **structural** gap: only 7 raw counts + a Kanban board — no conversion rates, time-to-hire, source effectiveness, per-posting fill-rate, or no-show/trial-conversion rate. All computable from existing `status_events` timestamps. Add a small analytics panel: applied→trial→hired funnel with drop-off, median time-to-hire, source-of-hire, and (highest pub value) **no-show rate + trial-conversion rate**. High value, low urgency for a single pub.
`getRecruitmentDashboard` `recruitment.ts:734-757`.

**15. Default marketing consent OFF for manager-entered candidates — S** (GDPR) *(partial — narrowed)*
Only the **`future_recruitment_consent`** (talent-pool/marketing) default is the genuine PECR weak spot — assumed opt-in for a manager-typed candidate isn't valid consent. Flip that default to off and record it only when ticked. **Do not** flip `sms_consent` off — every recruitment SMS (incl. interview scheduling) is gated on it, so defaulting it off would break texting a walk-in their interview slot. Opt-out checkboxes + `consent_source`/`consent_at` capture already exist.
`20260707000003:6-18`; `actions/recruitment.ts:524-527`; `communications.ts:854,991`.

**16. Seed the missing `recruitment.export` permission — S** (RBAC)
`export` is referenced (`actions/recruitment.ts:138,1328`) but never seeded, so **managers** (who hold every other recruitment action) can't export CSV. (Super-admin still can — it short-circuits — so impact is narrow.) One-line migration granting `export` to super_admin + manager.
seed omits it `20260707000000:104-112`.

### P3 — worthwhile later

- **Model offers as first-class objects — M.** Small `offers` table (rate/hours/start_date/status accepted|declined|expired) + candidate accept/decline via the token pattern, feeding the hire handoff. Today "offered" is just a status flag and a declined offer is indistinguishable from "withdrawn". `recruitment.ts:571-577,2515`.
- **Link trial shifts to the rota + collapse trial→hire — L.** On trial booking, create/attach a `rota_shifts` row so it shows for the duty manager; on a "pass", one-click progression toward hire. Today trial→hire is a wholly separate manual step with no rota link.
- **Talent pool: search, tags, bulk re-engage — M.** Add role/availability tags + search + a bulk "invite to apply" reusing the single-candidate match logic (+ silver-medalist tagging at reject). Today it's hidden from the main list and one-at-a-time.
- **Single source of truth for the transition graph — S.** The legal-transition graph is duplicated in the DB function and an **unused** TS map (`RECRUITMENT_ALLOWED_TRANSITIONS`, no consumers). Either delete the dead TS map or add a test asserting it equals the DB rows. `recruitment.ts:48-61` vs migration `20260708000008:102-116`.
- **Route bulk archive/restore through the audited path — S.** Bulk archive/restore writes `archived_at` directly with no `status_event`, unlike every other status change — inconsistent audit trail. `recruitment.ts:1796-1807`.
- **Booking-page timezone + a11y — S.** `formatDateTime` uses raw `new Date()`+`Intl` with no `Europe/London`, so slots render in the visitor's timezone (breaks the project's London-time rule); status message has no `aria-live`; props typed `any`. Low impact (candidates are near-universally on UK devices) but a standards regression. `RecruitmentBookingClient.tsx:29-37,231-233`.
- **Test coverage — M.** Add Vitest for retention/erasure completeness (incl. `ai_runs` scrub), consent defaults, and the transition graph — the highest-risk untested logic.
- **Quick data-model checks — S.** (a) `recruitment_interview_scorecards` trigger uses `set_updated_at()` while the other tables use `handle_updated_at()` — confirm both helper functions exist in prod or it's a latent runtime error (`20260708000008:48`). (b) Two overlapping transition RPCs and two `claim_appointment_slot` definitions coexist across migrations — confirm callers hit the guarded versions.

---

## Suggested first slice

1. **P1 compliance PR** — items 1 (`ai_runs` scrub, + test) and 3 (retention `retention_until`/policy). Same file, same subsystem, closes the real Article-17/retention holes. Needs a small migration only if you add the `export` seed alongside.
2. **Quick-wins PR** — items 4 (confirm-cancel), 5 (KPI wiring + URL filters), 15 (`future_recruitment_consent` default), 16 (`export` seed). All S, high daily-workflow return.
3. **RTW workflow (item 2)** — its own PR with a migration (share code, DOB, expiry, evidence bucket) — highest-value compliance feature, so worth doing properly and reviewed on its own.

Everything is independently deployable and backwards-compatible. Migrations touched: items 2, 3, 8/10/11 (schema), 16 (seed) — all additive, no drops.
