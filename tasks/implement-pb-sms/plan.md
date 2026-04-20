# Private Bookings SMS Redesign — Orchestration Plan

**Source plan:** `docs/superpowers/plans/2026-04-18-private-bookings-sms-redesign.md`
**Source spec:** `docs/superpowers/specs/2026-04-18-private-bookings-sms-redesign-design.md`
**Branch:** `feat/private-bookings-sms-redesign`

## Work Streams

| # | Role | Wave | Depends On | Owns (files) |
|---|------|------|------------|--------------|
| 1 | Migrations-Ops | 1 | None | `supabase/migrations/*.sql` (4 new), `vercel.json`, deletes 2 legacy cron route files |
| 2 | Lib-Tests | 1 | None | `src/lib/sms/sanitise.ts`, `src/lib/private-bookings/tbd-detection.ts`, `src/lib/private-bookings/messages.ts`, related tests |
| 3 | Refactor | 2 | Wave 1 | `src/services/private-bookings/mutations.ts`, `payments.ts`, `src/app/api/cron/private-booking-monitor/route.ts`, `PrivateBookingMessagesClient.tsx`, updated tests |
| 4 | Services-Cancel-Delete | 3 | Wave 2 | `src/services/private-bookings/financial.ts`, `mutations.ts` (cancel variants + delete gate guard), `src/services/sms-queue.ts` (trigger list), tests |
| 5 | UI-Email | 3 | Wave 2 | `src/lib/private-bookings/manager-notifications.ts`, delete UI in `PrivateBookingDetailClient.tsx`, `privateBookingActions.ts` |
| 6 | Outcome-Gate | 4 | Wave 3 | `src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts`, Pass 5 in monitor route, weekly ops query, tests |
| 7 | Comms-Tab | 4 | Wave 3 | `src/services/private-bookings/scheduled-sms.ts`, `src/components/private-bookings/CommunicationsTab*.tsx`, booking page wiring, preview modals, tests |

## Wave Structure

- **Wave 1** (parallel): Migrations-Ops, Lib-Tests — no shared files
- **Wave 2** (single): Refactor — depends on messages module existing
- **Wave 3** (parallel): Services-Cancel-Delete, UI-Email — disjoint file ownership
- **Wave 4** (parallel): Outcome-Gate, Comms-Tab — minor overlap on booking page (resolved by read-then-edit discipline)

## File Overlap Risk Table

| File | W1 | W2 | W3 | W4 |
|------|:--:|:--:|:--:|:--:|
| `supabase/migrations/*.sql` | M-Ops creates | — | — | — |
| `vercel.json` | M-Ops edits | — | — | — |
| `src/lib/private-bookings/messages.ts` | L-Tests creates | — | — | — |
| `src/services/private-bookings/mutations.ts` | — | Refactor | S-C-D modifies | — |
| `src/services/private-bookings/payments.ts` | — | Refactor | — | — |
| `src/services/private-bookings/financial.ts` | — | — | S-C-D creates | — |
| `src/services/sms-queue.ts` | — | — | S-C-D modifies | — |
| `src/app/api/cron/private-booking-monitor/route.ts` | — | Refactor | — | O-Gate modifies Pass 5 |
| `src/lib/private-bookings/manager-notifications.ts` | — | — | UI-Email modifies | — |
| `src/app/.../PrivateBookingDetailClient.tsx` | — | — | UI-Email modifies | C-Tab adds tab |
| `src/app/.../[id]/page.tsx` | — | — | — | C-Tab modifies |
| `src/app/actions/privateBookingActions.ts` | — | — | UI-Email modifies | — |
| `src/services/private-bookings/scheduled-sms.ts` | — | — | — | C-Tab creates |
| `src/components/private-bookings/*` | — | — | — | C-Tab creates |
| `src/app/api/private-bookings/outcome/...` | — | — | — | O-Gate creates |

No same-file conflicts within a wave. Cross-wave conflicts resolved by wave ordering + read-before-edit discipline (agents always pull before editing).

## Git Discipline

- All agents commit to `feat/private-bookings-sms-redesign`.
- One commit per task per the source plan's commit messages.
- Agents **must not push** — user reviews before push.
- Within a wave, parallel agents touch disjoint files; their commits interleave cleanly in git log.

## Definition of Done

- All 6 phases in the source plan are implemented.
- `npm run lint && npx tsc --noEmit && npm test && npm run build` all pass.
- No files modified outside the ownership scopes in this plan.
- Each agent's handoff.md exists and reports success.
- Final codex-qa-review adversarial pass on the implementation produces no BLOCKERS.
