# Triage — Developer review of the FOH table-booking print-sheets spec

Ground rules applied: locked owner decisions (one-page-per-booking, events look, FOH-basics-only, minimal/additive) are not reopened. Verified verdicts drive every ACCEPT/REJECT. Several data-consistency/determinism/precedence findings (F-08, F-11, F-18, F-19) collapse into **one additive fix**: a single nested Supabase select in the *new* route (`table_bookings → booking_table_assignments → tables`), which does **not** touch `loadScheduleBookingRows` and so respects minimal-impact.

## Disposition table

| ID | Pri | Disposition | One-line resolution |
|---|---|---|---|
| F-01 | P0 | ACCEPT-FIX | Declare the spec authoritative; archive/strike the divergent table-booking plan in `tasks/todo.md` before coding. |
| F-02 | P0 | OWNER-DECISION | Permission tier for the export. Recommend `view`. |
| F-03 | P0 | PARTIAL | ACCEPT reclassify `special_requirements` as free-text-possibly-sensitive; OWNER-DECISION on whether to print it. |
| F-04 | P0 | PARTIAL | OWNER-DECISION on truncation policy; ACCEPT clamp the note *text* + print a "Truncated — check live booking" flag when clipped. |
| F-05 | P0 | PARTIAL | ACCEPT correct the `no-store` wording; OWNER-DECISION on shared-kiosk download retention. |
| F-06 | P1 | ACCEPT-FIX | Guard empty/invalid client date; derive filename from server `Content-Disposition`; return 400 for a present-but-malformed date. |
| F-07 | P1 | ACCEPT-FIX | Gate the button on `schedule?.date === date` (loaded-date match), not just `loading`. |
| F-08 | P1 | ACCEPT-FIX | In `tableField()` check `is_outside_seating` **first**, then indoor labels (matches live schedule precedence). |
| F-09 | P1 | ACCEPT-FIX | Derive `printableBookingCount` from the loaded schedule (drop private/communal/`standing-`) and disable on that; keep 404 as safety net. |
| F-10 | P1 | PARTIAL | ACCEPT naming private-booking blocks explicitly in the out-of-scope list; OWNER-DECISION whether to include them (recommend exclude). |
| F-11 | P1 | PARTIAL | ACCEPT one nested Supabase query in the new route; REJECT extracting a shared server loader (beyond minimal scope). |
| F-12 | P1 | PARTIAL | ACCEPT a hard row/page cap (413/422) + an overall generation timeout; REJECT a full per-user rate limiter (staff-gated, mirrors events route). |
| F-13 | P1 | ACCEPT-FIX | Drop "mandatory"; state audit is best-effort/non-blocking and add a structured success/failure log line (date, count, duration, userId — no PII). |
| F-14 | P1 | ACCEPT-FIX | Add one real-Chromium integration test (pdf-lib page count + render) for long-name/multi-table/long-note fixtures. |
| F-15 | P1 | PARTIAL | ACCEPT `overflow-wrap`/`word-break` on name/ref/table + `white-space: pre-wrap` on notes; REJECT a "project minimum font-size standard" (none exists). |
| F-16 | P1 | ACCEPT-FIX | Print a London "Generated at …" line + "Live system is the source of truth" footer; put generated-at in audit metadata. |
| F-17 | P1 | PARTIAL | ACCEPT "resolve P0s + one production smoke test before wide use"; REJECT a mandatory feature flag/role-staging (permission tier is the gate). |
| F-18 | P2 | ACCEPT-FIX | Resolved by the F-11 single nested query (one snapshot) + F-16 timestamp. |
| F-19 | P2 | ACCEPT-FIX | Secondary sort `booking_reference` then `id`; de-dup by table id; `Intl.Collator('en',{numeric:true})`. |
| F-20 | P2 | ACCEPT-FIX | Distinct handling for 401/403/404/429/500; `aria-busy`; success toast with the date; validate `Content-Type` before saving. |
| F-21 | P2 | ACCEPT-FIX | Correct the test plan; drop the impossible "404 with correct filename" assertion; add DB/PDF-error + FohHeader/hook tests. |
| F-22 | P2 | PARTIAL | ACCEPT weakening the font-fallback guarantee; OWNER-DECISION whether to self-host fonts (recommend accept remote for now, bounded by 30s). |
| F-23 | P2 | PARTIAL | ACCEPT an honest re-score noting the two test files; REJECT a mandatory two-PR split (one coherent additive concern). |
| F-24 | P2 | PARTIAL | ACCEPT a preview-deploy Chromium smoke test; REJECT per-column schema pre-check (columns are stable; `maxDuration=300` already ships on live routes). |
| F-25 | P2 | ACCEPT-FIX | Replace "active" with "printable service-day booking" (real row, status ≠ cancelled/no_show, departed/completed included). |
| F-26 | P2 | ACCEPT-FIX | Add focus/keyboard + busy/error-announcement ACs; state tagged-PDF a11y out of scope with the live FOH view as the accessible alternative. |
| F-27 | P3 | ACCEPT-FIX | Reuse `downloadBlob` + `filenameFromContentDisposition` from `src/lib/download-file.ts` (also fixes F-06). |
| F-28 | P3 | PARTIAL | ACCEPT the query dedup (same as F-11); REJECT extracting shared print-shell primitives (over-generalising a single fork). |
| F-29 | P3 | REJECT | Note only — one-page-per-booking is a locked owner decision, not reopened. |

## Per-finding notes

**F-01 — ACCEPT-FIX.** Verified: `tasks/todo.md:130–163` prescribes full-page nav, empty-day PDF, DS Button, sort-by-table — the exact opposite of the spec on four points. The todo plan is dated today, unticked, "(discovery)". Add the reviewer's line 7 ("This spec supersedes the print instructions in `tasks/todo.md`") and strike that todo section.

**F-02 — OWNER-DECISION.** Verified: `requireFohPermission` returns the **service-role** client after the gate, so the chosen action is the *only* row boundary. Genuine privacy/business call. Recommended default **`view`**: the same PII is already on-screen to `view` users and the floor staff who carry the sheets are typically `view`-level; `edit`/`manage` would block the intended users. Whatever is chosen, gate the **route**, not just the button.

**F-03 — PARTIAL.** Verified partial: the combined-blob problem is a *website-proxy* artifact (`buildLegacyNotes`) landing in `special_requirements`; staff/FOH bookings already write structured dietary/allergy columns; there is **no** documented backfill. But the core point stands — free text can hold health/accessibility info. ACCEPT the wording reclassification (review's suggested change #3). Whether to print the note at all is folded into the OWNER-DECISION below.

**F-04 — PARTIAL.** OWNER-DECISION on truncation (recommend: keep the 8-line clamp but make it honest). ACCEPT the technical correction: apply `-webkit-line-clamp` to the note **text element**, not the `.notes` container, and when the note is clipped render a visible "Truncated — check live booking" flag (an ellipsis alone doesn't tell staff anything was removed).

**F-05 — PARTIAL.** The `no-store` statement is factually wrong for an intentional download — ACCEPT review wording change #4. Retention on the named shared manager-kiosk mode is an OWNER-DECISION. Recommended default: **allow the download**, document the manual post-service cleanup, and accept the residual risk — blocking kiosk downloads blocks the exact staff who print. Do not claim `no-store` prevents local storage.

**F-06 — ACCEPT-FIX.** Verified: the FOH date input emits `''` when cleared and that flows to state; the schedule route silently falls back to today, and the *client* filename rebuilds from the empty string → `table-bookings-.pdf`. Fix: disable export when the date is empty/invalid; take the filename from the server `Content-Disposition` (via F-27's helper); return 400 for a present-but-malformed `date` (absent still defaults to today).

**F-07 — ACCEPT-FIX.** Verified: `setLoading(true)` runs in a passive effect *after* the `setDate` render, and the totals `useMemo` never compares `schedule.date` to `date` — so the header shows the previous day's totals for the whole refetch, not one frame. `schedule.date` is already exposed. Gate the button (and the printable count) on `schedule?.date === date && !downloading`.

**F-08 — ACCEPT-FIX.** Verified genuine contradiction: the live schedule makes `is_outside_seating` authoritative *before* any assignment (route.ts:676–681). The spec's `tableField()` inverts this. Reorder: outside check first, then labels. Add a route test for outside+stray-assignment.

**F-09 — ACCEPT-FIX.** Verified: the payload carries robust discriminators (synthetic `private-`/`communal-event-`/`standing-` id prefixes + `is_private_block`/`is_communal_event_block` flags) so a real-only count is computable client-side. Today's totals count communal/standing entries. Compute and pass `printableBookingCount` (real rows only); keep the server 404 as the race/data-change net. Event-linked bookings that are *real* `table_bookings` rows count as printable (matches scope).

**F-10 — PARTIAL.** Verified: private-booking blocks are synthetic entries built from the separate `private_bookings` table and do occupy FOH lanes. The spec's open question 15.3 covers communal/standing but omits private. ACCEPT: name private blocks explicitly in the out-of-scope list and the printable-count exclusion. OWNER-DECISION whether to include them — recommend **exclude** (a combined FOH pack is a separate feature).

**F-11 — PARTIAL.** ACCEPT the collapse: a single nested Supabase select in the new route (bookings with embedded assignments and tables, pinned FKs) removes the copied field-list/label-visibility divergence *and* fixes F-18's snapshot concern — and it is still additive (new route only). REJECT the broader "extract a shared server-only loader + shared display helpers" refactor: it touches shipped code and breaks the one-concern/minimal-impact constraint. Note the loader's 3-tier drift fallback is irrelevant here — the columns this route needs are stable (see F-24).

**F-12 — PARTIAL.** Verified: only `setContent` has a 30s bound; `page.pdf()` is unbounded and there's no concurrency guard. ACCEPT a modest hard cap (e.g. refuse > ~200 rows with 413/422) and an overall generation timeout wrapping `page.pdf()`. REJECT a full per-user rate limiter as required — the route is staff-permission-gated and mirrors the events route, which has none; treat it as OPTIONAL hardening.

**F-13 — ACCEPT-FIX.** Verified: `logAuditEvent` swallows both insert errors and exceptions to `console.error` and there is no strict/throwing variant, so "mandatory" is unachievable and a route-level catch can't observe failures. Reword to best-effort/non-blocking (review change #5, second option) and add a structured success/failure log line (date, count, duration, userId — no customer content). Don't build a strict audit path (none exists; YAGNI).

**F-14 — ACCEPT-FIX.** Counting `<section class="page">` proves HTML, not PDF pages/clipping. Add one targeted real-Chromium test: assert page count via `pdf-lib` and render-check long-name, multi-table and long-note fixtures. Can live as a preview-deploy smoke test if too heavy for unit runs.

**F-15 — PARTIAL.** ACCEPT overflow rules for every variable field (`overflow-wrap: anywhere`/`word-break`, controlled line limits) and `white-space: pre-wrap` on notes so newlines survive. REJECT the "enforce a minimum print font size per project guideline" framing — verified there is **no** such standard; shipped templates already go to 8px and the institutional concern runs the *other* way (viewer min-font clamping distorts A4). Set explicit readable sizes in this template instead.

**F-16 — ACCEPT-FIX.** Cheap, high-value for a physical artifact: add a London "Generated at …" line and a "Live system is the source of truth" footer per page; include the generated time in audit metadata.

**F-17 — PARTIAL.** ACCEPT: resolve the P0s first and run one production-like PDF smoke test before claiming done. REJECT a mandatory feature flag / role-staging as over-cautious for a read-only, additive, single-commit download — the permission tier chosen in F-02 is the real audience gate.

**F-18 — ACCEPT-FIX.** Resolved by F-11's single nested query (one snapshot for assignments+tables) plus F-16's generated-at timestamp for the residual booking-vs-print time gap.

**F-19 — ACCEPT-FIX.** Verified: no `UNIQUE(table_booking_id, table_id)` constraint exists, so duplicate assignment rows are possible and de-dup must be in app code; equal-time order is unspecified; `localeCompare` mis-sorts "10" before "6". Fix: de-dup by table id, secondary sort `booking_reference` then `id`, and `Intl.Collator('en',{numeric:true,sensitivity:'base'})`.

**F-20 — ACCEPT-FIX.** Modest additive UX: map 401/403/404/429/500 to distinct messages, set `aria-busy` during generation, show a success toast naming the date, and validate `Content-Type: application/pdf` before saving the blob.

**F-21 — ACCEPT-FIX.** The review correctly catches that "404 with correct filename" is impossible (a 404 has no download filename) and that status-mapping can't be tested on the template (it receives a pre-formatted string). Move state-mapping asserts to route/helper tests, add DB/logo/PDF-failure and equal-time/array-vs-object-customer cases, add FohHeader fetch/download/error/date-race tests, and correct the empty-valid-date assertion to "queried date + 404 body".

**F-22 — PARTIAL.** Verified partial: the risk is real but bounded by the 30s `setContent` timeout (a hung font fails, not hangs forever), and it's overstated for the app generally (invoice/quote templates use system Arial) — but the booking-sheet template *does* use remote Google Fonts and none inline. ACCEPT weakening the guarantee wording. Self-hosting/inlining the fonts is an OWNER-DECISION/optional; recommend **accept the remote dependency for now** to match the events template, and add a blocked-font test.

**F-23 — PARTIAL.** ACCEPT an honest note that the two test files add meaningful lines and re-score accordingly. REJECT the mandatory two-PR split — this is one coherent, additive, independently-deployable concern; splitting it fights the one-concern-per-changeset preference.

**F-24 — PARTIAL.** Verified: `maxDuration=300` + `runtime='nodejs'` is present and the same value already ships on receipts/invoices/rota export routes; the deposit columns are real, unconditional, directly-queried and 2–8 months old (added by `ALTER … IF NOT EXISTS`, not the original CREATE). REJECT the per-column pre-deploy schema check — the drift fallback in the loader doesn't apply to this route's stable columns. ACCEPT one preview-deploy Chromium smoke test before wide rollout (cheap, catches cold-build/Chromium issues).

**F-25 — ACCEPT-FIX.** Verified: the FOH filter blacklists only `cancelled`/`no_show`, so `completed` and departed (`left_at`) rows are included — "active" is the wrong word. Adopt review wording change #2: "printable service-day booking". The mid-service departed/completed question is a minor owner sub-decision; recommend **include** (matches on-screen FOH).

**F-26 — ACCEPT-FIX.** Project DoD requires it. Add focus/keyboard-nav and busy/error-announcement ACs for the button; declare tagged-PDF accessibility out of scope with the live FOH view as the accessible alternative; set an explicit readable minimum print size in the template.

**F-27 — ACCEPT-FIX.** Verified: `src/lib/download-file.ts` exports `downloadBlob` (defers `revokeObjectURL` via `setTimeout(0)` — the Safari/Firefox-safe pattern the spec's hand-rolled anchor gets wrong) and `filenameFromContentDisposition` (parses the server filename). Use both; this also closes F-06's client-filename bug.

**F-28 — PARTIAL.** ACCEPT the query-dedup half (same nested query as F-11). REJECT extracting shared print-shell/template primitives — over-generalising a single template fork against the minimal-impact constraint; keep the fork.

**F-29 — REJECT (note).** One-page-per-booking is a locked owner decision. Record the paper-volume observation as a note for FOH to sanity-check post-launch; it is not a blocker and does not gate implementation.

---

## (1) ACCEPT-FIX changes the revised spec MUST contain

1. Add "This spec supersedes the table-booking print instructions in `tasks/todo.md`"; strike that todo section (F-01).
2. Reclassify `special_requirements` as free text that may still contain sensitive health/accessibility info (F-03, wording #3).
3. Clamp the note **text element** (not `.notes`) and print a visible "Truncated — check live booking" flag when clipped (F-04 technical half).
4. Correct the `no-store` wording: it stops HTTP caching, not the local downloaded file (F-05, wording #4).
5. Client date guard + server-`Content-Disposition` filename + 400 for present-but-malformed date (F-06).
6. Gate the button/printable count on `schedule?.date === date && !downloading` (F-07).
7. In `tableField()`, check `is_outside_seating` before assigned labels (F-08).
8. Compute a real-rows-only `printableBookingCount` (exclude `private-`/`communal-event-`/`standing-`) and disable on it; keep 404 as net (F-09).
9. Name private-booking blocks explicitly in the out-of-scope list and count exclusion (F-10 accept half).
10. Replace the three copied reads with one nested Supabase select (bookings → assignments → tables, pinned FKs) in the new route (F-11 / F-18 / F-28 accept half).
11. Add a hard row/page cap (413/422) and an overall generation timeout around `page.pdf()` (F-12 accept half).
12. Reword audit to best-effort/non-blocking; add a structured success/failure log line (date, count, duration, userId, no PII) (F-13).
13. Add one real-Chromium PDF test (page count via `pdf-lib` + render check of long-name/multi-table/long-note) (F-14).
14. Add `overflow-wrap`/`word-break` on name/ref/table and `white-space: pre-wrap` on notes; set explicit readable sizes (F-15 accept half).
15. Print a London "Generated at …" line + "source of truth" footer; add generated-at to audit metadata (F-16).
16. Require P0 resolution + one production smoke test before wide use (F-17 accept half).
17. Deterministic order/de-dup: secondary sort `booking_reference`→`id`, de-dup by table id, `Intl.Collator` numeric (F-19).
18. Distinct client handling for 401/403/404/429/500, `aria-busy`, success toast with date, `Content-Type` validation (F-20).
19. Correct the test plan: drop the impossible 404-filename assertion, add DB/logo/PDF-failure + customer-shape + escaping cases, add FohHeader/hook tests (F-21).
20. Weaken the remote-font guarantee wording; add a blocked-font test (F-22 accept half).
21. Re-score complexity honestly incl. the two test files (F-23 accept half).
22. Add a preview-deploy Chromium smoke test before rollout (F-24 accept half).
23. Replace "active" with "printable service-day booking" throughout (F-25, wording #2).
24. Add keyboard/focus + busy/error-announce ACs; declare tagged-PDF a11y out of scope with the live view as the accessible fallback; set a minimum print size (F-26).
25. Use `downloadBlob` + `filenameFromContentDisposition` from `src/lib/download-file.ts` (F-27).

## (2) OWNER-DECISIONS to put to the owner (each with a recommended default)

1. **Export permission tier** (F-02) — `view` / `edit` / `manage` / dedicated export perm. **Recommend `view`** (same PII already on-screen; floor staff are view-level; higher bars block the intended users). Gate the route, not just the button.
2. **Print free-text `special_requirements` at all** (F-03) — print / replace with a safe FOH note / exclude. **Recommend print, with the reclassification and controls above** (staff need service instructions), accepting it may carry sensitive text.
3. **Long-note policy** (F-04) — clamp+flag / smaller text / continuation page / full note. **Recommend keep the clamp with the visible "Truncated — check live booking" flag** (guaranteeing the full note needs per-booking auto-pagination, out of scope).
4. **Shared-kiosk download retention** (F-05) — allow+document cleanup / block on kiosk / managed-device print. **Recommend allow + documented manual cleanup** (blocking kiosk blocks the staff who print), and correct the `no-store` claim.
5. **Private-booking blocks in the pack** (F-10) — include / exclude. **Recommend exclude** (keeps the table-bookings-only scope; a combined FOH pack is a separate feature).

Secondary owner sub-choices (lower stakes): departed/completed sheets mid-service (F-25 — **recommend include**, matches on-screen FOH); self-hosting the sheet fonts (F-22 — **recommend accept remote for now**, bounded by the 30s timeout, matches the events template).