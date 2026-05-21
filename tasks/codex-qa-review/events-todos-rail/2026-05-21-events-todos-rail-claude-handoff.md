# Claude Hand-Off Brief: Events Outstanding-Todos Rail

**Generated:** 2026-05-21
**Review mode:** B (Code Review)
**Overall risk:** Medium (two unhappy-path gaps; happy path and architecture sound)

## DO NOT REWRITE
- Server/client split and serializable props in `events/page.tsx`.
- `events:view` guard, `canManage` server fetch + UI gating.
- `loadError`-over-empty precedence; UTC-anchored date helpers; draft-event visibility.

## IMPLEMENTATION CHANGES REQUIRED
- [ ] **Harden `handleComplete`** — `src/app/(authenticated)/events/_components/EventTodosWidget.tsx`: wrap the awaited `toggleEventChecklistTask` in try/catch; on returned-failure **and** on throw, restore **only the failed item** via a functional `setTodos` update re-sorted by `dueDate` then `order` (guarded against duplicate re-insert), and show an error toast. Removes both the rejection gap and the concurrent-snapshot corruption.
- [ ] **Make the rail non-critical** — `src/app/(authenticated)/events/page.tsx`: `getChecklistTodos().catch(() => ({ success: false, error: 'Unable to load outstanding todos' }) as Awaited<ReturnType<typeof getChecklistTodos>>)` so a thrown load failure degrades to the `loadError` state instead of crashing the page.

## ASSUMPTIONS RESOLVED (no action)
- Server-side `events:manage` enforcement on `toggleEventChecklistTask`: confirmed present.
- Summary scope: `getChecklistTodos()` returns only overdue/due-today by design.

## REPO CONVENTIONS TO PRESERVE
- Server actions return `{ success?: boolean; error?: string }`; surface errors via `@/ds` `toast`.
- No direct DB access from client components; mutations stay behind the server action.

## RE-REVIEW REQUIRED AFTER FIXES
- [ ] Re-run the widget test suite (add: thrown-rejection restore+toast; concurrent earlier-fail-after-later-success → only failed item restored).

## REVISION PROMPT
In `EventTodosWidget.tsx`, rewrite `handleComplete` to optimistically remove the item, then in a try/catch around `toggleEventChecklistTask`, on failure or throw re-insert only that item via a functional update sorted by `dueDate`/`order` and toast the error. In `events/page.tsx`, add `.catch(...)` to the `getChecklistTodos()` call in `Promise.all` to degrade to `loadError`. Add the two regression tests, then run `npx vitest run` on the two test files, `npx tsc --noEmit`, and `npx eslint` on the changed files.
