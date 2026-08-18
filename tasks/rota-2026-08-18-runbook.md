# Rota production repair runbook — 2026-08-18

Restricted. Contains employee identifiers and live data state. Companion to
`tasks/rota-review-2026-08-18.md`.

Baseline: database `tfcasgxopxegwrabvwat`, checked 2026-08-18 Europe/London,
application commit `7756bcf8`.

**Rule: enforcement ships before cleanup.** PR2 and PR3 must be deployed and
verified before any repair below, or the next template run or drag will simply
recreate the clash.

**Approver required for every item.** These change who works when, and can send
staff emails. None is a developer decision.

---

## R0. Apply the migrations BEFORE the application deploy

**This is step zero and it is not optional.** The application code calls three
new Postgres functions and reads a new column, none of which exist in
production. AMS auto-deploys `main` to Vercel while migrations are applied by
hand, so if the code reaches production first:

- every shift create, edit, move, template populate and template add fails with
  "Could not find the function public.write_rota_shifts_with_leave_guard",
- publishing a week fails the same way,
- approving, booking and editing holiday fail the same way,
- `/portal/shifts` and the `rota-shift-acceptance` cron fail on the missing
  `rota_published_shifts.first_published_at` column, so nobody is warned or
  auto-accepted.

All three migrations are additive and nothing on `main` calls them, so applying
them ahead of the deploy is safe. The reverse order is not.

```bash
npx supabase db push
```

Migrations, in order:

| file | adds |
|---|---|
| `20260819000000_rota_leave_conflict_guard.sql` | `rota_shift_leave_dates`, `lock_rota_employee_leave`, `check_rota_leave_conflicts`, `write_rota_shifts_with_leave_guard` |
| `20260819000001_rota_publish_week_transactional.sql` | `publish_rota_week`, `rota_week_live_basis_is_current`, `rota_week_snapshot_basis_is_current`, `rota_published_shifts.first_published_at` |
| `20260819000002_leave_approval_rota_guard.sql` | `rota_shifts_clashing_with_leave`, `approve_leave_request_with_rota_guard`, `book_approved_leave_with_rota_guard`, replaces `update_leave_request_dates` |

Verify before promoting the deployment. Both queries must come back complete:

```sql
-- expect 10 rows
select proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where proname in (
  'rota_shift_leave_dates', 'lock_rota_employee_leave', 'check_rota_leave_conflicts',
  'write_rota_shifts_with_leave_guard', 'publish_rota_week',
  'rota_week_live_basis_is_current', 'rota_week_snapshot_basis_is_current',
  'rota_shifts_clashing_with_leave', 'approve_leave_request_with_rota_guard',
  'book_approved_leave_with_rota_guard'
);

-- expect 1 row
select column_name from information_schema.columns
where table_name = 'rota_published_shifts' and column_name = 'first_published_at';
```

Then confirm the production alias actually moved to the new deployment before
starting R1. A push is not a deploy.

---

## R1. Billy Summers rostered on approved leave

State at baseline:

| field | value |
|---|---|
| employee | Billy Summers, `c418660e-909f-4fec-9f0a-ebe493c1a9a2` |
| approved leave | 2026-08-22 to 2026-08-23, request `5a5f28e8-6e6f-467c-b08e-ad8cc247a3ee`, approved 2026-05-18 |
| clashing shifts | Saturday Kitchen 2026-08-22 12:00–21:00; Sunday Kitchen 2026-08-23 12:00–18:00 |
| visibility | present in both `rota_shifts` and `rota_published_shifts` — staff-visible |

Verification query:

```sql
select s.id, s.shift_date, s.name, s.start_time, s.end_time
from rota_shifts s
join leave_days ld on ld.employee_id = s.employee_id and ld.leave_date = s.shift_date
join leave_requests lr on lr.id = ld.request_id and lr.status = 'approved'
where s.status = 'scheduled' and s.is_open_shift = false
  and s.shift_date >= current_date;
```

Expected after repair: zero rows.

Decision needed from the approver, **before** 2026-08-22:

1. Is Billy actually on leave, or was the leave superseded? If superseded, cancel
   the leave request rather than the shifts.
2. If he is on leave, do the two kitchen shifts become open, or go to Laura
   (the only other cook)? The kitchen cannot run unstaffed.
3. Republishing the week emails affected staff. Send, or suppress and tell people
   directly?

Rollback: re-insert the two shift rows from the pre-change export and republish.

## R2. Twenty-eight unpublished shifts in the week of 2026-09-07

The week is marked `published` but only 4 of 32 shifts reached the staff
snapshot. Staff currently see 4 shifts for that week.

```sql
select count(*) from rota_shifts s
join rota_weeks w on w.id = s.week_id
where w.week_start = '2026-09-07' and s.status = 'scheduled'
  and not exists (select 1 from rota_published_shifts p where p.id = s.id);
```

Expected after repair: 0.

Repair is a normal republish of the week from the UI, once PR4 is live so the
publish is transactional. 2026-09-07 is more than 14 days out from the baseline
date, so nothing is auto-accepted by publishing it. Confirm that is still true on
the day: after 2026-08-24 it falls inside the cutoff and D13's grace window
applies.

## R3. Draft gap at the week of 2026-08-31

2026-08-31 is `draft` while 2026-09-07 after it is `published`. 27 shifts are
affected.

This week is **already inside the 14-day cutoff** as of the baseline date. Under
D13 it can still be published, and the 48-hour grace window gives staff a fair
chance to reject. Publishing it without PR4 deployed would auto-accept all 27
shifts on the next acceptance cron run, so **do not publish this week until PR4
is live**.

## R4. Three ghost shifts in the week of 2026-08-03

Three rows remain in `rota_published_shifts` for shifts deleted from the draft.
One more exists for 2026-06-15. Both weeks are in the past, so this is tidy-up
with no staffing consequence. Republishing each week clears them.

## R5. Historical `holiday_conflict` reliability events

Three events exist, latest 2026-06-24. Under F2 these penalise employees for
clashes a manager created. Once PR3 removes the penalty, review each of the three
and delete any that were manager-caused.

```sql
select id, employee_id, event_at, leave_request_id, impacted_shift_count
from employee_reliability_events where event_type = 'holiday_conflict';
```

Do not blanket-delete. Per the 2026-08-10 open-shift-request precedent, check
what actually happened to each before choosing.

---

## Post-deploy verification

Run all of these after PR3 and PR4 are live and repairs are done:

```sql
-- 1. no shift on approved leave (expect 0)
select count(*) from rota_shifts s
join leave_days ld on ld.employee_id=s.employee_id and ld.leave_date=s.shift_date
join leave_requests lr on lr.id=ld.request_id and lr.status='approved'
where s.status='scheduled' and s.is_open_shift=false and s.shift_date>=current_date;

-- 2. no live/published drift on any published future week (expect 0 rows)
select w.week_start,
  (select count(*) from rota_shifts s where s.week_id=w.id and s.status='scheduled'
     and not exists (select 1 from rota_published_shifts p where p.id=s.id)) as missing,
  (select count(*) from rota_published_shifts p where p.week_id=w.id
     and not exists (select 1 from rota_shifts s where s.id=p.id)) as ghosts
from rota_weeks w where w.status='published' and w.week_start >= current_date
having (select count(*) from rota_shifts s where s.week_id=w.id and s.status='scheduled'
     and not exists (select 1 from rota_published_shifts p where p.id=s.id)) > 0;

-- 3. no draft week earlier than a published week (expect 0)
select count(*) from rota_weeks d
where d.status='draft'
  and exists (select 1 from rota_weeks p where p.status='published' and p.week_start > d.week_start)
  and d.week_start >= current_date;
```

---

# Post-deploy status, 2026-08-18

PR #108 merged (`af93b346`) and **verified live** on
`management.orangejelly.co.uk`: the new `/api/cron/rota-unfilled-urgent` route
answers 401 (exists, auth-gated) where a nonsense path answers 404. Migrations
were already applied and all eleven functions verified.

PR #109 merged into its stacked base branch instead of `main`, so the design
tokens never reached production. Re-raised as **#110** against `main`.

| item | at review | now | outstanding |
|---|---|---|---|
| R1 shifts on approved leave | 9 | **0** | none, and now blocked at the database |
| R2 shifts staff cannot see, week of 2026-09-07 | 28 | 28 | republish the week |
| R3 draft week before a published week | 1 | 1 | publish 2026-08-31 |
| R4 ghost shifts staff still see | 4 | 7 | see below |
| R5 historical `holiday_conflict` events | 3 | 4 | review and delete the manager-caused ones |

**The drift is wider than the review found.** Thirteen weeks are affected, not
four. Ten are historical and small:

| week | staff cannot see | ghosts |
|---|---|---|
| 2026-01-12, 01-19, 01-26 | 1 each | 0 |
| 2026-02-02 | 3 | 0 |
| 2026-02-09, 02-16, 02-23 | 2 each | 0 |
| 2026-03-16 | 0 | 3 |
| 2026-06-15 | 0 | 1 |
| 2026-08-03 | 0 | 3 |

**Recommendation: leave the ten historical weeks alone.** Republishing a past
week emails staff about shifts that already happened, which is worse than the
stale snapshot it fixes. They are inert history. The new readiness model reports
on the horizon ahead, so they will not generate noise.

**The two that matter, both future:**

1. **Publish the week of 2026-08-31** (27 shifts). Now safe: with #108 live,
   publishing inside the cutoff no longer auto-accepts, and those staff get the
   48-hour grace window instead. Before the deploy this would have auto-accepted
   all 27 on the next 07:30 cron run.
2. **Republish the week of 2026-09-07** (28 shifts). Staff currently see 4 of 32.

The week of 2026-09-14 is draft with 30 shifts, but nothing is published after
it, so that is ordinary planning rather than a hole.

**R5 detail.** Four events, latest 2026-06-24, so nothing has fired since the
review. Two are `backfill`, one `holiday_edit`, one `holiday_direct_booking`.
Check what actually happened in each case before deleting: the 2026-08-10
open-shift-request precedent showed that blanket-resolving a queue tells nine
people the wrong thing.
