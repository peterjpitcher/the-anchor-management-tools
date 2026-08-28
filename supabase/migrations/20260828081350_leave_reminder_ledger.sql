-- Ledger for holiday approval reminders.
--
-- Eight requests were sitting unapproved when this was written, the oldest raised on 17 July for
-- leave that had already started. Nothing chased anybody.
--
-- The ledger is the whole point. A reminder job without one either emails the same request every
-- morning until somebody snaps, or tries to infer "have I already sent this" from timestamps and
-- gets it wrong. One row per request per reminder kind, with a unique key, so a second send is
-- refused by the database rather than by hopeful code.
--
-- Applied 2026-08-28. The code for this shipped on 19 August and the migration did not, so
-- /api/cron/leave-approval-reminders had been failing at 09:30 every morning since. Renumbered
-- from 20260819100000 to the version actually recorded when it was applied.

create table if not exists public.leave_reminder_log (
  id            uuid        primary key default gen_random_uuid(),
  request_id    uuid        not null references public.leave_requests (id) on delete cascade,
  -- 'waiting'  the request has been sitting unreviewed
  -- 'imminent' the leave starts soon and still is not approved
  reminder_kind text        not null,
  sent_at       timestamptz not null default now(),
  sent_to       text[]      not null default '{}',
  constraint leave_reminder_log_kind_check check (reminder_kind in ('waiting', 'imminent'))
);

-- The guard. One reminder of each kind per request, ever.
create unique index if not exists leave_reminder_log_unique
  on public.leave_reminder_log (request_id, reminder_kind);

create index if not exists idx_leave_reminder_log_sent_at
  on public.leave_reminder_log (sent_at desc);

alter table public.leave_reminder_log enable row level security;

-- Written only by the cron using the service role, which bypasses RLS. Managers may read it so
-- "did we already chase this" is answerable without database access.
drop policy if exists leave_reminder_log_select on public.leave_reminder_log;
create policy leave_reminder_log_select
  on public.leave_reminder_log for select to authenticated
  using ((select public.user_has_permission(auth.uid(), 'leave', 'view')));

comment on table public.leave_reminder_log is
  'One row per holiday request per reminder kind. The unique index is what stops a daily job re-sending the same nag.';
