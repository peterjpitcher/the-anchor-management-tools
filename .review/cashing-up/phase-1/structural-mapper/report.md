# Structural Mapper Report — Cashing-Up Module

> Agent output saved from Phase 1 discovery. Full content in orchestrator's consolidation files.

## Key Findings Summary
- 15 files, ~3,500 lines across services, actions, pages, and components
- 4 DB tables: cashup_sessions, cashup_payment_breakdowns, cashup_cash_counts, cashup_targets
- 1 DB view: cashup_weekly_view
- Status machine: draft → submitted → approved → locked (unlock: locked → approved)
- 13 server actions, 13 service methods, 5 RSC pages, 3 client components, 1 API route
- Zero audit logging calls anywhere in module
- RLS policies are permissive (authenticated = allowed); RBAC fully delegated to app layer
- Legacy artifacts: shift_code column, workbook_payload JSONB, cashup_config table (all unused)
- No unit tests for any service methods or state transitions

See orchestrator's consolidated-defect-log.md for full cross-referenced findings.
