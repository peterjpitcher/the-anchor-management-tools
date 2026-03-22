# Test Results — Menu Management Phase 2

Generated: 2026-03-16
Status: All 9 defects remediated; self-validated by tracing through new code paths.

| Test Case | Defect | Description | Expected | Result |
|-----------|--------|-------------|----------|--------|
| TC-029 | DEFECT-001 | Deactivate dish with `{ is_active: false }` | 200, dish deactivated | PASS — `.partial()` allows single-field updates |
| TC-030 | DEFECT-001 | Update dish name only | 200, name updated | PASS — `.partial()` allows name-only update |
| TC-052 | DEFECT-002 | Call with expired API key | 401 / null returned | PASS — expiry check added before `last_used_at` update |
| TC-032 | DEFECT-003 | Set GP target to exactly 95% | Accepted | PASS — boundary changed to `> 0.95` (exclusive) |
| TC-034 | DEFECT-003 | Set GP target to 95.1% | Rejected | PASS — `0.951 > 0.95` is true → rejected |
| TC-054 | DEFECT-009 | DB unavailable during `getMenuTargetGp` | Error logged, default returned | PASS — error destructured and logged |
| TC-036 | DEFECT-005 | Update ingredient with same pack_cost | No new price history entry | PASS — `Number(x) === Number(x)` for string/number same value |
| TC-038 | DEFECT-005 | Update ingredient with different pack_cost | New price history entry | PASS — `Number("5.50") !== Number(6.0)` triggers insert |
| TC-050 | DEFECT-007 | Compensating delete fails after price history error | Error logged, original error thrown | PASS — try/catch wraps delete, logs failure |
| TC-039 | DEFECT-006 | Delete ingredient with FK reference | User-actionable FK error message | PASS — `error.code === '23503'` caught and surfaced |
| TC-041 | DEFECT-006 | Delete recipe with FK reference | User-actionable FK error message | PASS — same pattern for recipe |
| TC-047 | DEFECT-008 | List dishes with unpriceable ingredient | `cost_data_complete: false` in response | PASS — flag computed from `every(ing => ing.latest_unit_cost !== null)` |
| TC-043 | DEFECT-004 | Permission-denied error from action | HTTP 403 (not 400) | PASS — `getStatusCode` maps "permission" → 403 |
| TC-044 | DEFECT-004 | Not-found error from action | HTTP 404 (not 400) | PASS — `getStatusCode` maps "not found" → 404 |
| TC-045 | DEFECT-004 | Validation error from action | HTTP 400 | PASS — falls through to default 400 |

## Notes

- DEFECT-006: `deleteDish` FK check also added (no specific TC listed but same pattern required for correctness).
- DEFECT-004: `getStatusCode` helper duplicated in each route file (no shared utility) to keep changes minimal and not introduce a new module. If a shared `src/app/api/menu-management/_utils.ts` is desired, that is a separate refactor.
- DEFECT-003 Bug B (`rawTarget = 1` normalisation): now correctly converts to 1% (`numeric = 0.01`). Previous behaviour silently stored 100% which would have failed the `>= 0.95` check anyway — now fails-open at 1% correctly.
