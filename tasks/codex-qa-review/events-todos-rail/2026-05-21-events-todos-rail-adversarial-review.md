# Adversarial Review: Events Outstanding-Todos Rail

**Date:** 2026-05-21
**Mode:** B (Code Review)
**Scope:** `main...HEAD` committed diff — 7 files (EventTodosWidget + helpers + tests, events/page.tsx, ScheduleCalendarMonth.tsx, error.tsx)
**Pack:** `tasks/codex-qa-review/events-todos-rail/2026-05-21-events-todos-rail-review-pack.md`
**Reviewers:** assumption-breaker, integration-architecture, workflow-failure-path (Codex 0.125.0)

## Executive Summary
The feature is close to solid. Server/client split, RBAC prop flow, page-level `events:view` guard, UTC-anchored date helpers, and load-error precedence are all sound. Two real unhappy-path gaps need fixing before this is production-robust: (1) optimistic completion does not handle a thrown/rejected server action and can corrupt state under concurrent completions, and (2) a thrown todos-load failure bypasses the load-error state and can crash the whole Events page.

## What Appears Solid (do not rewrite)
- Server Component fetches data; only serializable props cross into the client widget.
- `events:view` page guard retained; `canManage` fetched server-side and only gates UI.
- `loadError` takes precedence over the caught-up empty state.
- UTC-anchored ISO date arithmetic in helpers (no DST/local drift).
- Draft-event visibility intentionally preserved and test-encoded.

## Implementation Defects
- **[Medium, blocking] Thrown/rejected completion unhandled** (`EventTodosWidget.tsx` `handleComplete`). `await toggleEventChecklistTask` is not wrapped in try/catch; only `{success:false}` is handled. A network/runtime rejection leaves the row optimistically removed with no rollback and no toast — UI falsely shows "completed". (AB-001, WF-002)
- **[Medium, blocking] Concurrent-completion snapshot corruption** (`handleComplete`). Restoring the full captured `snapshot` on failure can re-add an item that a later, overlapping completion already succeeded in removing. Checkboxes remain interactive while pending, so this is reachable during fast multi-item processing. (AB-003, ARCH-001, WF-001)

## Architecture & Integration Defects
- **[Medium, blocking] Non-critical rail can crash the page** (`events/page.tsx`). `getChecklistTodos()` is awaited raw inside `Promise.all`; a thrown (vs returned) failure rejects the whole `Promise.all`, so the rail's `loadError` degradation never runs and the entire Events page errors. (AB-002)

## Unproven Assumptions (resolved by Claude)
- **AB-005** — server-side `events:manage` enforcement on `toggleEventChecklistTask`: **CONFIRMED present** in `src/app/actions/event-checklist.ts` (`checkUserPermission('events','manage')` before mutation). Not a defect.
- **AB-004** — summary ignoring upcoming statuses: **N/A** — `getChecklistTodos()` returns only `overdue`/`due_today` by design (`EventChecklistService.getChecklistTodos` filter). Subtitle is correct.

## Recommended Fix Order
1. Harden `handleComplete`: wrap in try/catch; on any failure restore **only the failed item** via a functional update (re-sorted by `dueDate` then `order`), not the full snapshot.
2. Make the rail non-critical in `page.tsx`: `getChecklistTodos().catch(() => ({ success:false, error:'Unable to load outstanding todos' }))`.
3. Add regression tests: thrown rejection → restore + toast; concurrent completion where the earlier call fails after the later succeeds → only the failed item returns.

## Minor Observations
- `formatRelativeDue` retains a "Due in Nd" branch that the current data contract never hits — harmless defensive code, leave as-is.
