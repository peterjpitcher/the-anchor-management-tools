# Remediation Plan — awaiting owner approval (2026-07-04)

Findings + evidence: `discovery.md` and `agent-reports/` in this folder.
Each phase is independently shippable. Nothing starts until approved.

## Phase 1 — Money and booking correctness (~1 session)
1. **Stop walk-ins grabbing communal-event tables** (TP-01 + TP-02): add the communal exclusion to the FOH override allocator, teach all three error classifiers the communal error (consolidate to one helper), and make failures clean up instead of stranding orphan bookings.
2. **Never lose an approved refund** (EV-01 + EV-11): process refund + notifications even when cancel follow-ups fail; add a "Refund…" action on cancelled/paid bookings for after-the-fact refunds.
3. **Record the right amount for cash/card door payments** (EV-02): sum the booking's actual ticket lines. *Decision needed: do door payers get the online discount? Recommend NO (full price at door).*
4. **Guard seat edits on paid/multi-type bookings** (EV-03 + EV-10): block or route to explicit charge/refund; keep attendee-name list in sync; add audit logging.
5. **Contract deposit fix** (TP-08 + TP-09): no more "£250 due" when no deposit is set; broaden the self-catering waiver fallback.

## Phase 2 — Staff booking form parity (the user's examples) (~1 session)
6. **Name fields for new customers** (FF-001): first/last name inputs when no existing customer selected; require first name.
7. **Real ticket-type selection + attendee names** (FF-002): per-type quantity basket when the event has ticket types; optional per-seat name inputs; relabel the seated/standing field. Server code already supports it — this is UI wiring.
8. **Post-creation editing** (EV-17d): let staff correct attendee names and ticket composition afterwards.

## Phase 3 — Mobile + skeletons (owner requests) (~1 session)
9. **Dashboard: hide past events on mobile** (DB-01 + DB-03): mobile-only `hidePast` in the calendar list (desktop month view untouched); stop the auto-scroll jump; fix the overflowing upcoming-events rows. Plus the two one-line polish items (sticky header offset, media-query flash).
10. **Short-links mobile** (SL-01..06): responsive column widths, mobile card list (same pattern as private bookings), Edit/Delete first in the actions menu, 34px tap targets — and the two genuine form bugs (UTM params can't be removed; URL validation bypassed).
11. **Remove skeletons everywhere** (FF-003): replace all 10 skeleton `loading.tsx` files + 5 in-component skeletons with one minimal centred spinner treatment; delete the Skeleton primitive.

## Phase 4 — Hardening and polish (approve separately, can trickle)
12. Feedback funnel: consent/thanks mismatch (FB-01), protect the funnel short link + single source for the review URL (FB-02), inbox filters/pagination (FB-04).
13. Events reporting truth: refund double-count (EV-05), transfer fixes (EV-06/07/13), per-type sell-out as friendly sold-out not 500 (EV-08), kiosk capacity/payment guard (EV-09), Est. Revenue de-fictionalised (EV-12).
14. June residuals: onboarding PII audit logging, `getCustomerList` RBAC, `window.confirm` stragglers, dead refund-tier file, raw display dates (worst offenders).
15. Table-booking robustness: atomic multi-table move (TP-03), one-step grow+move (TP-04), observable dedup guard (TP-06).
16. CRUD gaps — pick which to build: cash-up void (recommended first), manual receipt transaction, message resend-failed, attachment edit, sales-target override removal.

## Decisions needed from the owner
- Door pricing for cash/card (Phase 1.3) — recommend full price (no online discount).
- Tabology webhook — recommend unregister in Tabology Back Office + delete the stub route (prefill is disabled anyway).
- Skeleton replacement — recommend minimal centred spinner (assumed unless told otherwise).
- Phase 4 scope — which CRUD gaps matter to you.

## Owner checklist (not code)
- [ ] Verify `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set in Vercel prod (feedback + public form rate limits are per-instance memory without them).
- [ ] Confirm the `20260708*` migration series is applied to prod (June security fixes — esp. the timeclock anon-UPDATE drop).
- [ ] Decide the Tabology webhook fate; unregister it in Tabology if killing it.
- [ ] Note FB-11: the feedback funnel is "review gating" under Google's policy — business risk accepted or soften it.
