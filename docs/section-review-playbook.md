---
title: Section Review Playbook
description: Repeatable discovery, remediation, and validation process for any authenticated surface in the application.
last_updated: 2025-10-25
---

# Section Review Playbook

This playbook documents the full review process we use when hardening a section of the application (e.g. `/customers`, `/events`, `/invoices`). Follow it end-to-end whenever you pick up a new area so every surface reaches the same standard of reliability, security, and performance.

Use `docs/section-review-tracker.md` to record progress per route group.

---

## 1. Scope & Inventory

1. **Identify route prefix** (e.g. `/customers`), sub-pages (dynamic routes, modals), and navigation entry points.
2. **List supporting modules**:
   - Server actions in `src/app/actions/**`
   - Shared components/hooks (tables, forms, pagination)
   - Background jobs/cron tasks touching the same data
   - Supabase tables, views, RPCs involved
3. **Note cross-cutting dependencies** (permissions, messaging, reminders, analytics).

Outcome: a scoped checklist of files, tables, and jobs you will audit.

---

## 2. Behaviour Baseline

- Capture current UX (screen recording or annotated screenshots) for key flows (list, detail, create/update/delete, imports/exports, modals).
- Profile with DevTools:
  - Network requests (count, payload size, duplication)
  - React render counts via Profiler
  - Bundle impact (Next build stats)
- Document business rules (permission matrix, special states like reminders, status flows).

Deliverable: a short baseline report summarising observed behaviour and metrics.

---

## 3. Data Flow Mapping

| Surface | Data Source | Notes |
|--------|-------------|-------|
| List view | Hooks/server actions fetching table records | Search columns, filters, sort, pagination strategy |
| Detail view | Hydration strategy (server vs client), nested fetches | Sequence of calls, batching opportunities |
| Related panels | Stats, badges, messages, labels | Derived data requirements |
| Background jobs | Reminder scheduling, notifications | Triggers, dependencies |

Steps:
1. Enumerate every query (table, columns, filters, ordering).
2. Diagram data dependencies (client calls, server actions, caching).
3. Note where duplicate or redundant requests occur.

---

## 4. State & Effect Audit

For each component/hook:
1. List `useState`/`useReducer`, `useEffect`, `useMemo`, `useCallback`.
2. Categorise state: UI local, derived, async lifecycle, permission toggles.
3. Flag race conditions (overlapping fetches, missing cleanup) and redundant memoisation.
4. Validate debouncing/throttling (avoid double debounces between component and page).
5. Ensure heavy child props (columns, handlers) are memoised.

Produce a table linking each effect to its purpose and dependencies.

---

## 5. Permissions & Security

1. Create a permission matrix:
   - Required scopes per view/action (`view`, `manage`, `delete`, etc.)
   - Expected behaviour when scope is missing (hide, disable, readonly).
2. Verify server actions enforce permissions (e.g. `requirePermission`, `checkUserPermission`).
3. Confirm UI respects these checks (no leaked controls, informative toasts).
4. Validate audit logging for CRUD/bulk operations.
5. Review RLS policies/RPC usage for alignment with new requirements (e.g. new columns).

Document gaps and remediation steps.

---

## 6. Server Actions & Service Logic

- Consolidate duplicated parsing/validation (e.g., FormData -> `zod`).
- Normalise data transformations (phone/email formatting, reminder flags, duplicates).
- Batch related queries using `Promise.all`.
- Harden error handling (typed responses, consistent toast messages).
- Ensure mutating actions trigger cache invalidation (`revalidatePath`, `router.refresh`).

Outcome: cleaned, reusable server logic with consistent API contracts.

---

## 7. UI & Layout Enhancements

- Revisit layout hierarchy (grid vs stacked, responsive breakpoints).
- Introduce summary vs detail columns or cards for readability on desktop and mobile.
- Ensure list/table components share render logic across breakpoints.
- Provide explicit toggles for special flows (e.g., reminder-only bookings).
- Add/standardise loading, empty, and error states.
- Verify accessibility (labels, focus management, keyboard navigation).

Capture before/after screenshots for major layout updates.

---

## 8. Performance Review

- Reduce network chatter (batching, server-side hydration, caching).
- Limit payloads to necessary columns (explicit selects).
- Profile renders and memoise high-cost components.
- Evaluate pagination for large datasets (caps, virtualization, “All” fallback).
- Leverage caching strategies (SWR/fetch caching, server-side caching) when appropriate.

Record measurable improvements (fetch reduction, render time drop).

---

## 9. Messaging, Notifications & Polling

- Assess polling/intervals: ensure they are permission-aware, pausable, and rate-limited.
- Provide manual “refresh” controls when polling is reduced.
- Confirm status badges (unread counts, reminders) stay in sync with mark-as-read/update flows.
- Ensure notification toasts are informative but not noisy.

---

## 10. Testing & Observability

- Update/add unit tests for new helpers and validation logic.
- Extend integration/e2e coverage around critical flows:
  - Create/update/delete entries
  - Special cases (reminders vs active bookings, permission-restricted views)
  - Messaging toggles / SMS enablement
- Update fixtures/seed data to cover new scenarios.
- Add SQL sanity checks (see below) into runbooks.
- Confirm telemetry/logging (if available) includes new fields and error states.

Testing matrix example:
| Scenario | Expected outcome | Test coverage |
|----------|-----------------|---------------|
| Reminder-only creation | Flag set, seats zero, UI shows reminder badge | Integration test |
| Permission denied path | Action prevented, toast shown, UI hidden | Unit + e2e |
| Bulk import validation | Duplicates skipped, audit logged | Unit (server) + integration |

---

## 11. Data Integrity Checks

Add section-specific queries. For booking reminders, for example:

```sql
SELECT id, event_id, customer_id, seats, is_reminder_only
FROM bookings
WHERE is_reminder_only = true AND COALESCE(seats, 0) > 0;

SELECT id, event_id, customer_id, seats, is_reminder_only
FROM bookings
WHERE is_reminder_only = false AND COALESCE(seats, 0) = 0;
```

Adapt queries to match the section’s invariants (e.g., invoice totals, receipt statuses).

---

## 12. Deployment & Migration Checklist

1. Apply schema migrations (Supabase CLI `db push`) in staging → production.
2. Backfill data (SQL updates, scripts) as required by new fields.
3. Redeploy application (Next build) after server/client updates.
4. Run integrity checks post-deploy.
5. Monitor background jobs (reminders, messaging) for regressions.

---

## 13. Wrap-Up

- [ ] Lint/tests pass (`npm run lint`, targeted integration/e2e suites).
- [ ] Manual regression of core flows.
- [ ] Documentation updated (tracker entry, playbook notes, release notes).
- [ ] Stakeholder communication (summaries, testing instructions).
- [ ] Artefacts archived (profiling screenshots, recordings).

---

## 14. Applying the Playbook

When assigned a new section:
1. Reference the tracker to confirm status.
2. Duplicate this playbook’s steps with section-specific details.
3. Update `section-review-tracker.md` with discovery date, remediation notes, outstanding follow-ups.
4. If deviations are needed (e.g., section has extra subsystems), document adjustments here for future reviewers.

Maintaining this playbook ensures each surface reaches the same standard, even as ownership shifts between developers. Use it as the single source of truth for expectations and deliverables when running a section review.
