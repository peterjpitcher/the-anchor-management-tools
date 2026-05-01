# Claude Hand-Off Brief: Multi-Frequency Recurring Charges

**Generated:** 2026-04-22
**Review mode:** C (Spec Compliance)
**Overall risk:** Medium

## DO NOT REWRITE

- Backwards compatibility approach (DEFAULT 'monthly')
- Quarterly/annual due-date alignment with existing monthly cron
- Reuse of `period_yyyymm` with frequency-specific labels
- Weekly/custom intervals correctly excluded from scope

## SPEC REVISION REQUIRED

- [ ] **SPEC-006**: Add explicit statement that non-monthly charges bill for the full containing period regardless of when the charge was created. This matches existing monthly behaviour and is the simplest approach.
- [ ] **SPEC-007**: Add rule that frequency changes take effect from the next unopened period only. Past instances remain as-is under their original frequency. When generating virtual instances, use the charge's current frequency — but if instances already exist for overlapping date ranges under a previous frequency, skip generation.
- [ ] **SPEC-008**: Add acceptance criterion verifying that invoice notes/line items display the period covered (`period_start` to `period_end`) for recurring charge instances.
- [ ] Add acceptance criterion for test coverage of period determination logic (the `isChargeDueThisRun` and period label generation functions).
- [ ] Clarify cap warning behaviour: note that the monthly cap warning on the clients page should only count charges due in the current billing period, not all active charges regardless of frequency.

## ASSUMPTIONS TO RESOLVE

- None — all decisions can be resolved by spec revision above (recommended options align with existing patterns).

## REPO CONVENTIONS TO PRESERVE

- Server actions use Zod schemas and FormData pattern
- Mutations call `logAuditEvent`
- DB columns are `snake_case`; TypeScript is `camelCase`
- Cron routes use `authorizeCronRequest` and `createAdminClient`

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] SPEC-007: re-review after frequency change logic is implemented to verify no double-billing path exists
