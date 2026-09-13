# Friday manager report implementation plan

> For agentic workers: use the implement-plan skill. Checkboxes track completion.

**Goal:** Replace the approved individual manager emails with one Friday report at 09:00 Europe/London, while retaining the explicitly selected immediate emails.

**Architecture:** Reuse the existing email_messages queued state to retain deferred notifications, with explicit category and stable source keys. A protected Friday cron assembles and sends a single report with an immutable payload and provider idempotency. Existing summaries prepare fresh snapshots before Friday delivery. No schema change is planned.

**Tech stack:** Existing Next.js routes, TypeScript, Supabase, Resend and Vitest.

**Spec:** Owner decisions in this task on 5 September 2026; discovery at /Users/peterpitcher/Documents/Codex/2026-09-05/manager-email-discovery/discovery.md.

## Global constraints

- Weekly: new table bookings, manager copies of staff shift reminders, holiday approval reminders, manager checklist alerts and summary, recruitment manager alerts, private-booking summary and weekly rota alert.
- Immediate: private enquiries, rejected shifts, completed onboarding, private-event outcome requests, payroll earnings alerts, open-shift requests and guest feedback.
- Other streams retain their existing policy, including daily urgent unfilled-shift alerts, birthdays, pre-order escalation, parking and website failure fallback.
- Staff/candidate/customer emails continue normally. Only manager alerts or copies are consolidated.
- Use 09:00 Europe/London on Friday as the scheduling assumption. No synthetic/test email may be sent to a real recipient.
- Preserve all existing unrelated changes using isolated worktree codex/friday-manager-report.
- Complexity 4: stage 1 adds inactive queue/report support; stage 2 connects sources and scheduling. Each stage remains independently deployable.

## Task 1: Durable queue and Friday delivery

Files: src/lib/manager-report/{types,queue,delivery}.ts; src/app/api/cron/manager-weekly-report/route.ts; matching tests.

Interfaces: queueManagerReportEmail(input: ManagerReportInput) returns Promise<ManagerReportQueueResult>. Sections are table_bookings, staff_shift_reminders, holiday_reminders, checklist_alerts, checklist_summary, recruitment, private_bookings, rota. Renderer accepts entries and report period and returns subject/html/text.

- [x] Read live schema and constraints, reuse existing queued state without schema mutation.
- [x] Prove queue insert deduplication and failure handling with mocked database and provider.
- [x] Freeze report payload and membership before sending, use a stable Resend idempotency key, acquire an atomic lease and never lose unsent items after failure.
- [x] Test empty week, Friday London/DST boundaries, concurrent runs, failed sends and send-success/database-failure retry.
- [x] Run focused checks and commit inactive foundation once integration interfaces agree. Foundation commit: 8554972c.

## Task 2: Summary rendering and sources

Files: src/lib/manager-report/render.ts and tests; table-booking manager helper; recruitment communication helper; leave reminder cron; rota acceptance/manager cron; checklist outbox and summary routes; private-booking weekly sender and cron; vercel.json.

- [x] Render each approved category with counts, concise entries and existing management links, and label snapshot dates.
- [x] Queue selected manager messages with stable source keys and truthful queued state; preserve immediate paths.
- [x] Send staff shift warnings to staff without manager CC; retain a separately queued summary record with employee/shift details.
- [x] Prepare private/rota/checklist snapshots on Friday before the 09:00 report and remove their separate sends.
- [x] Ensure old pending checklist manager rows also go to the digest while Peter's technical alerts remain immediate.
- [x] Test selected paths cannot send immediate manager mail and protected immediate paths remain intact.

## Task 3: Verification and release

- [ ] Run lint, typecheck, relevant tests in London and UTC, full tests and a clean build.
- [x] Render a synthetic report and inspect its contents without sending. Automated HTML checks passed; browser layout inspection was blocked by the URL policy.
- [x] Review every changed path against scope, including paired website compatibility.
- [ ] Record exact validation and local/deployment status; carry approved changes through release where authorised.

## Checks to run

```sh
npm run lint
npx tsc --noEmit
npx vitest run src/lib/manager-report tests
npm test
npm run build
```

Tests inject database and email transport substitutes. Production verification reads configuration and logs only; the Friday report is not invoked manually to generate a test send.

## Verification record

- Full suite: 729 files passed, 6,274 tests passed and two existing skips before the final staff retry refinement. The full coverage run includes that refinement.
- Report rendering, delivery and snapshot checks: 56 tests passed under UTC. Source and customer regression checks: 109 tests passed under London and UTC before the final staff retry refinement.
- Whole-source ESLint passed with zero warnings. Full uncached TypeScript check passed before the final staff retry refinement; the production build repeats it.
- Synthetic HTML and text previews generated without database or provider calls. All eight sections, management links, escaped text, complete attachment and invalid-value checks passed. Browser visual inspection was blocked by the browser URL policy; no workaround was attempted.
- First production build compiled but reached Node's default heap limit during type checking. Re-run uses the project's CI memory allowance.
- Paired website checked: its enquiry fallback and customer notification contract need no changes.
- No production database writes, emails or migrations were used for verification.

## Source files changed

- New report foundation: `src/lib/manager-report/types.ts`, `queue.ts`, `schedule.ts`, `delivery.ts`, `render.ts` and `src/app/api/cron/manager-weekly-report/route.ts`.
- Source routing: `src/lib/table-bookings/bookings.ts`, `src/lib/recruitment/communications.ts`, `src/lib/checklists/jobs/outbox.ts`, `src/lib/private-bookings/manager-notifications.ts`.
- Cron routing: `src/app/api/cron/leave-approval-reminders/route.ts`, `rota-shift-acceptance/route.ts`, `rota-manager-alert/route.ts`, `private-bookings-weekly-summary/route.ts`, `checklists-weekly-summary/route.ts`.
- Scheduling: `vercel.json`. Matching tests, synthetic preview script, operations guide and task records accompany these changes.

## Deliberately retained

Immediate private enquiries and private-event outcome sends in `manager-notifications.ts` remain unchanged. Rejected shifts, onboarding completion, payroll threshold alerts, open-shift requests and guest feedback keep their existing senders. The urgent unfilled-shift cron, customer/applicant emails, website fallback and original working directory's unrelated changes are untouched.

- Final staff isolation and original-date rendering checks: 21 tests passed in London and 21 in UTC.
- Production build completed successfully with the CI memory allowance; all 154 static pages generated.
