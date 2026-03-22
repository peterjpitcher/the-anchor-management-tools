# Remediation Plan — Cashing-Up Module

## Group 1: Critical — Fix First (Security & Data Integrity)

**Order matters: permissions first (safe, isolated), then status guards, then transaction safety.**

### 1a. Permission Fixes (5 actions + 1 page)
Each fix is 1-2 lines: add `checkUserPermission('cashing_up', 'view')` or appropriate action.

| Item | File | Fix |
|---|---|---|
| DEF-C01 | `actions/cashing-up.ts:213` | Change `'receipts', 'edit'` → `'cashing_up', 'edit'` (or `'manage'` if that action exists) |
| DEF-C02 | `actions/cashing-up.ts:167` | Add `checkUserPermission('cashing_up', 'view')` before service call |
| DEF-C03 | `actions/cashing-up.ts:225` | Add `checkUserPermission('cashing_up', 'edit')` before service call |
| DEF-H01 | `actions/cashing-up.ts:195` | Add `checkUserPermission('cashing_up', 'view')` |
| DEF-H02 | `actions/cashing-up.ts:244` | Add `checkUserPermission('cashing_up', 'view')` |
| DEF-H03 | `weekly/page.tsx` | Add `checkUserPermission('cashing_up', 'view')` + redirect if denied |

### 1b. Status Guards
| Item | File | Fix |
|---|---|---|
| DEF-C04 | `service.ts:304-315` | Add `.eq('status', 'approved')` guard to lockSession update query |
| DEF-C06 | `service.ts:208-219` | On update path: fetch current status, throw if 'locked' (approved sessions can be updated by managers with approve permission) |

### 1c. Transaction Safety
| Item | File | Fix |
|---|---|---|
| DEF-C05 | `service.ts:160-263` | Create a Supabase RPC function `upsert_cashup_session(...)` that runs the full operation in a single SQL transaction. Call it from the service. Alternatively, implement a compensating rollback: if child inserts fail, delete the session (for new) or restore from getSession (for update). RPC approach preferred. |

---

## Group 2: High — Fix Soon (Structural Correctness)

### 2a. Data Integrity
| Item | File | Fix |
|---|---|---|
| DEF-H05 | `20260402000000_create_cashup_targets.sql` | New migration: add UPDATE RLS policy to cashup_targets |
| DEF-H06 | `service.ts:498-513` | Change `setDailyTarget` INSERT → UPSERT with `onConflict: 'site_id, day_of_week, effective_from'` |

### 2b. Performance
| Item | File | Fix |
|---|---|---|
| DEF-H04 | `missing-cashups.ts:34-45` | Batch query: fetch all special_hours and business_hours in one call each, then filter in-memory instead of calling isSiteOpen per date |

### 2c. Housekeeping
| Item | File | Fix |
|---|---|---|
| DEF-H07 | All action files | Add `logAuditEvent()` to upsertSessionAction, submitSessionAction, approveSessionAction, lockSessionAction, unlockSessionAction, setDailyTargetAction, updateWeeklyTargetsAction |
| DEF-H08 | `daily/page.tsx:62` | Remove console.log statement |

---

## Group 3: Structural — Implement or Remove Stubs

These are incomplete features shipping as empty data. Decision needed: implement or remove the UI elements that reference them.

| Item | Description | Recommendation |
|---|---|---|
| DEF-S01 | paymentMix always empty | Implement: aggregate `payment_type_label/counted_amount` from joined breakdowns |
| DEF-S02 | topSitesByVariance always empty | Implement or remove chart if single-site deployment |
| DEF-S03 | compliance always empty | Implement: count expected open days vs submitted sessions |
| DEF-S04 | expectedDays hardcoded 28 | Fix: calculate actual open business days in query range |
| DEF-S05 | siteName hardcoded 'Site' | Fix: join to sites table in getDashboardData |

---

## Group 4: Medium — Data Quality

| Item | File | Fix |
|---|---|---|
| DEF-M01 | `cashing-up-import.ts:73-77` | Replace `new Date(row.date)` with direct use of the date string (already YYYY-MM-DD format); no Date construction needed |
| DEF-M02 | `service.ts` (multiple) | Replace raw `new Date()` + `.toISOString().split('T')[0]` with `toLocalIsoDate()` from `src/lib/dateUtils.ts` where applicable |
| DEF-M04 | `DailyCashupForm.tsx:656` | Rename "Total Variance" to "Cash Variance" for clarity |
| DEF-M05 | `actions/cashing-up.ts` | Standardise all actions to return `{ success: boolean; data?: T; error?: string }` |

---

## Dependency Order for Implementation

```
1. Permission fixes (independent, safe, no DB changes)
2. console.log removal (trivial)
3. Status guards (small, contained)
4. RLS migration for cashup_targets (DB change — migrate first)
5. setDailyTarget → UPSERT (after RLS in place)
6. Audit logging (after permissions confirmed correct)
7. Transaction safety (RPC — requires new migration; highest risk, test thoroughly)
8. N+1 fix in missing-cashups
9. Dashboard stubs implementation
10. Date handling improvements
11. Label fixes and error response standardisation
```
