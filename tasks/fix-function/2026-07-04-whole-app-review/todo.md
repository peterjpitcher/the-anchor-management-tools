# Remediation run — 2026-07-04 (approved: full door price / delete Tabology / spinners)

## Wave 1 (parallel, file-disjoint scopes)
- [x] A1 events-server: EV-01,02(full door price),03,05,06,07,08,09,10,12,13,14,16,18 + refund action for EV-11
- [x] B table-bookings: TP-01,02,03,04,05,06
- [x] C contracts/PB: TP-08,09,10,11
- [x] D feedback funnel: FB-01,02,04,05,06,07,08(code),09(minimal),12 + middleware prefix
- [x] E short-links: SL-01..11
- [x] F dashboard mobile: DB-01..06
- [x] G skeletons → spinner everywhere (FF-003)
- [x] H Tabology webhook removal + .env.example updates (TP-13,14)
- [x] I residuals: onboarding audit log, getCustomerList RBAC, window.confirm×2, refunds.ts kept (3 live importers — tier tz fixed by orchestrator), raw dates, cash-up void

## Wave 2 (after A1)
- [x] A2 events UI: FF-001 names, FF-002 ticket basket + attendee names + relabel, EV-11 UI, EV-15, EV-17a-d

## Orchestrator seam fixes (agent followUps)
- [x] Guards moved into updateEventBookingSeatsById (protects table-booking linked-seats path)
- [x] mapSeatUpdateBlockedReason: friendly messages for the two new blocked reasons
- [x] FOH party-size route mirrored to BOH TP-05 pattern (+PartySizeUpdateFailedAfterMoveError)
- [x] calculateRefundTier → Europe/London calendar-day maths (live money boundary)
- [x] Transfer email carries the overpayment line (matches SMS)
- [x] redirect route passes ?src= through for feedback provenance
- [x] cashing-up service aggregates exclude voided sessions (dashboard/insights/weekly×2)
- [x] CashupSession type: voided_at/voided_by/void_reason

## After waves
- [x] Git diff audit of every changed file vs scopes (clean — only owner's parallel .claude edits, untouched)
- [x] Migration review: 5 files, all additive, no destructive ops
- [x] Lint clean; typecheck clean
- [x] Full test suite: 493 files / 3236 tests, all passing (21 fallout failures fixed: 13 tests repinned to intentional new behaviour, 8 were pre-existing breaks — verified failing at base commit — repaired to current behaviour)
- [x] Production build clean
- [ ] Commit in logical chunks (local)
- [ ] CONFIRM with owner: push to main + apply 5 migrations to prod (prod-migrate) + deploy-verify

## Deferred (explicitly out of this run)
- TP-07 N+1 set-based RPC (perf), FB-10 retention cron (unless trivial), FB-11 (business decision),
  CRUD gaps 2-10 (need prioritisation), chronic pattern-debt programme (loading states everywhere,
  hand-rolled modals, ~90 raw dates, DataTable keyboard a11y, shell/toast unification)
