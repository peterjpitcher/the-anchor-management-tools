# Christmas food link: build plan (management app)

Spec: `spec.md` in this folder (owner decisions of 6 November 2026). This app ships before the website, and stays compatible with the website's current payload until the website follows.

## F, foundation
- [ ] Migration per spec §3.1, with its rollback; regenerate `src/types/database.generated.ts`.
- [ ] `preorder.ts`: new completeness rule, missing-course wording, save with the new fields and the seat-course RPC, the D6/D7 reminder ladder in `decidePreorderChases`.
- [ ] Guest token helper for `preorder_guest`, scoped to a cover and expiring at the cutoff.
- [ ] Unit tests for completeness, the ladder and token scope; pg tests for the triggers and the RPC.

## B, organiser and guest pages
- [ ] `/g/<token>/table-manage` food section rebuilt (menu panel, progress, per-guest lines, send-link).
- [ ] `/g/<token>/christmas-choice` guest page; invite email.

## C, reminders
- [ ] Ladder wired into `/api/cron/preorder-reminders`, plus a `0 9 * * *` run; organiser emails and texts; manager call list; guest reminder; choices copy.

## D1, one-pager
- [ ] `/table-bookings/<id>/sheet`, view for FOH, PDF for BOH and managers; day PDF prints unchosen seats; seat allergies raise the booking's allergy flag.

## D2, staff tools
- [ ] Send and copy the food link; seat editor with the new fields and the staff override; FOH create up to 60 for Christmas.

## E, booking API and payment path
- [ ] Christmas without course counts; email required; `CHRISTMAS_*` error codes; deposit received message with the food link; payment-link extension when a hold moves; success panel names the real channel.

## Gates
- [ ] lint, `tsc --noEmit`, `typecheck:tests`, `test`, `test:utc`, `test:pg`, uncached build, anon-surface check.
- [ ] Migration applied through prod-migrate before the merge; deploy-verify after.
