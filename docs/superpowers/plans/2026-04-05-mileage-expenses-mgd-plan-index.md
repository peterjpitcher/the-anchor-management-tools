# Mileage, Expenses & MGD — Implementation Plan Index

> **For agentic workers:** Execute phases in order. Each phase depends on the previous one completing successfully.

**Spec:** `docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md`
**QA Review:** `tasks/codex-qa-review/2026-04-05-mileage-expenses-mgd-codex-qa-report.md`

---

## Phase Order

| Phase | Plan File | Description | Depends On |
|-------|-----------|-------------|------------|
| 1 | `phase1-foundation.md` | DB schema, RLS, RBAC, nav, storage, seed data, placeholder pages | — |
| 2 | `phase2-mileage.md` | Destinations CRUD, distance cache, trip CRUD with multi-stop legs, HMRC rate calculation | Phase 1 |
| 3 | `phase3-expenses.md` | Expense CRUD, file upload with image optimisation, receipt viewer | Phase 1 |
| 4 | `phase4-mgd.md` | Collection CRUD, return lifecycle, quarter mapping | Phase 1 |
| 5 | `phase5-oj-sync-and-export.md` | OJ-Projects mileage sync trigger, enhanced quarterly export with CSVs + claim PDF | Phases 1-4 |

Phases 2, 3, and 4 can be developed in parallel (they share the Phase 1 foundation but are independent of each other). Phase 5 depends on all modules being complete.

## Key Implementation Notes

- All server actions follow the pattern in `src/app/actions/receipts.ts`: auth → permission → Zod → service → audit → revalidate
- All pages use `PageLayout` + `HeaderNav` from `src/components/ui-v2/`
- All date display uses `formatDateInLondon()` from `src/lib/dateUtils.ts`
- All DB results converted through the project's standard pattern before TypeScript use
- Tests use Vitest, mock Supabase client, and focus on business logic (HMRC rates, MGD quarter mapping)
