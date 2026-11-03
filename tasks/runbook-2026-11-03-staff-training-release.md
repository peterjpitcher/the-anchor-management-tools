# Staff training: release checklist (3 November 2026)

Built overnight on branch `feat/staff-training`. Nothing is live and no migration is applied.
Every step below that touches production needs the owner's explicit yes at the time.

## Before you start

- [ ] Read the draft PR and try the screens on its Vercel preview (the preview has no training
      tables yet, so the training pages there will show their load error; that is expected).
- [ ] Settle the open content and policy points raised in chat. Course files live outside the repo
      in `~/Documents/Anchor training content/` (one `course.json` per course; `_parts` is stale,
      never re-merge it). Edit the `course.json`, then upload again.
- [ ] The employees release on main has three migrations that are not applied in production
      either (`20261102230000`, `20261102230100`, `20261102230200`; checked read-only on
      3 November, latest applied `20261102210508`). They go first, through their own release
      checklist, so the history stays in timestamp order.

## 1. Database, before or with the deploy

Through the `prod-migrate` skill, one at a time, owner's yes each time:

- [ ] `20261103090000_training_tables.sql` (seven tables, private `training` bucket, purge function)
- [ ] `20261103090100_training_signing_kinds.sql` (the two signing kinds)
- [ ] `20261103090300_retire_policy_drafts_replaced_by_training.sql` (switches off the four policy
      drafts the courses replace)

These go before the code because the employees insights section and the employee Training tab read
the training tables as soon as the code is live.

## 2. Deploy

- [ ] Merge the PR into main and let Vercel deploy production.
- [ ] Confirm the production deployment id serves the merge commit (`deploy-verify` skill).
- [ ] Release by 10 November. Both new crons (`training-daily`, `signing-reminders`) are watched
      from 9 November; a later release would raise one false "no completed run" alert unless
      `monitoredFrom` in `src/lib/cron/monitored-jobs.ts` is moved.

## 3. Database, after the deploy

- [ ] `20261103090200_training_permissions.sql` through `prod-migrate` (training view, manage and
      publish for super_admin and manager). Never before the code is live.
- [ ] Regenerate types and confirm there is no diff against the committed file:
      `npx supabase gen types typescript --project-id tfcasgxopxegwrabvwat --schema public`
- [ ] Run `npx tsx scripts/security/assert-anon-surface.ts` and confirm it exits 0.
- [ ] Read-only check that nobody but the service role can reach the tables, expecting 0 rows:

```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name LIKE 'training\_%'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC');
```

- [ ] Confirm the bucket is private: `SELECT id, public FROM storage.buckets WHERE id = 'training';`
      (expect `public = false`).

## 4. Courses

Employees, Training, Courses. For each course: upload its `course.json` (and its `images` folder if
it has one; 4 MB limit per upload), read the problem list, open Preview, then Publish.

Order (a course can only go live after the one it needs):

1. [ ] Essentials
2. [ ] Team training
3. [ ] Walkthrough, Chemicals (need Essentials)
4. [ ] Kegs, Gas, BIBs, Ramp, Hot drinks, Pool table (need Team training)

Publishing runs the assignment sync, so every Active member of staff in a course's audience gets it
straight away. People who started in the 14 days before launch have Essentials due on launch day.

## 5. People

- [ ] On each person's Training tab, check their groups (Bar, Kitchen, Floor, Management).
- [ ] Check the under-16 rules against the rota before Essentials goes live (the course teaches no
      work after 7pm for anyone still at school).

## 6. Emails

The training emails switch ships off, so nothing is sent. One switch covers staff reminders and the
manager training email.

- [ ] When every course you want live is published and groups are right, turn the switch on
      (Employees, Training, Courses). The next daily run (09:00 UTC) sends each person with an open course
      their first email, at most one email per person per day.
- [ ] Check the first staff email and the first manager email in the inboxes, then leave it on.

## 7. Tidy

- [ ] Move the privacy notice "Last updated" date to the release date
      (`src/app/privacy/page.tsx`).
- [ ] When the certificate design arrives, replace the layout in
      `src/lib/signing/documents/training-certificate.ts`.
- [ ] Update the project memory and close out `tasks/todo.md`.

## If something goes wrong

- Turn the training emails switch off first; that stops every training email at the next run.
- Reverting the merge commit takes the screens away. The tables and their rows can stay: nothing
  else in the app writes to them, and keeping them keeps the training history.
