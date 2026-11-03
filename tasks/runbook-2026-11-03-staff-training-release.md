# Staff training: release checklist (3 November 2026)

Built overnight on branch `feat/staff-training`. Nothing is live and no migration is applied.
Every step below that touches production needs the owner's explicit yes at the time.

## Before you start

- [ ] Read the draft PR and try the screens on its Vercel preview (the preview has no training
      tables yet, so the training pages there will show their load error; that is expected).
- [ ] Settle the open content and policy points raised in chat. Course files live outside the repo
      in `~/Documents/Anchor training content/` (one `course.json` per course; `_parts` is stale,
      never re-merge it). Edit the `course.json`, then upload again.
- [x] The employees release's three migrations are applied (production versions
      `20261103070932`, `20261103070948` and `20261103070955`, 3 November 2026).

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
- [ ] Deploy production before 09:00 UTC on 10 November. The new `training-daily` cron and the
      existing `signing-reminders` cron (now recorded run by run) are watched from 9 November, and
      each needs one completed run before the 07:40 UTC check on 11 November. A later release would
      raise one false "no completed run" alert unless `monitoredFrom` in
      `src/lib/cron/monitored-jobs.ts` is moved to the release day.

## 3. Database, after the deploy

- [ ] `20261103090200_training_permissions.sql` through `prod-migrate` (training view and manage
      for super_admin and manager; publish for super_admin only, owner decision 3 November 2026).
      Never before the code is live. Publish covers uploading, previewing, publishing and retiring
      courses, adding external qualification types, and the two training switches. Every
      super_admin account can do all of that (four accounts on 3 November 2026; the app lets
      super_admin through before it reads any grant), so this grant changes nothing for anyone
      today: the manager role has no users. A manager-role user added later can view and manage
      training but cannot add a qualification type or preview a course.
- [ ] Read-only check of the grant, expecting exactly `manager: manage, view` and
      `super_admin: manage, publish, view`:

```sql
SELECT r.name, string_agg(p.action, ', ' ORDER BY p.action) AS actions
FROM public.role_permissions rp
JOIN public.roles r ON r.id = rp.role_id
JOIN public.permissions p ON p.id = rp.permission_id
WHERE p.module_name = 'training'
GROUP BY r.name
ORDER BY r.name;
```

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

Employees, Training, Courses, signed in as a super_admin account (only super_admin can publish). For each
course: upload its `course.json` (and its `images` folder if it has one; 4 MB limit per upload),
read the problem list, open Preview, then Publish.

Order (a course can only go live after the one it needs):

1. [ ] Essentials
2. [ ] Team training
3. [ ] Walkthrough (needs Essentials)
4. [ ] Chemicals, Kegs, Gas, BIBs, Ramp, Hot drinks, Pool table (need Team training)

Automatic assignment ships off (section 6), so publishing makes a course live and gives it to
nobody: no new starter, existing member of staff, refresher or redo item is created, and the
publish message says so. Most staff have already done this training, and the owner wants nothing
automated going out to them yet (3 November 2026). A manager gives a course to someone by hand on
their Training tab, or records a practical sign-off there. Training people have already had in
person is recorded with Record Trained In Person on their Training tab: tick the courses and the
last day they were trained. Nothing is signed or sent, and refreshers are worked out from that day.

Only once automatic assignment is switched on does the sync give every Active member of staff in a
course's audience their courses, with people who started in the 14 days before that day having
Essentials due that day.

## 5. People

- [ ] On each person's Training tab, check their groups (Bar, Kitchen, Floor, Management).
- [ ] Check the under-16 rules against the rota before Essentials goes live (the course teaches no
      work after 7pm for anyone still at school).
- [ ] Kegs, Gas, BIBs and Chemicals are for people aged 16 or over. The app refuses to assign one
      of them by hand, or record its sign-off, for anyone under 16 or anyone with no date of birth
      on their employee record, and says which. Add missing dates of birth on the employee record
      before assigning those courses.

## 6. Automatic assignment

The automatic assignment switch ships off, beside the emails switch (Employees, Training,
Courses). Any super_admin account can change it (four today), not only the owner. Switching it on
asks first and shows how many items it would give out, to how many people; switching it off is
one click. While it is off, nobody is given a course unless a
manager assigns it: no new starters, newly published courses, yearly refreshers or redo requests,
and no "date of birth missing" flags. The daily run and the sync still cancel items for leavers,
retired courses and removed groups, release waiting items a manager assigned once the course they
need is done, and end pauses. The daily run records `autoAssignEnabled` in its summary.

- [ ] Leave it off until the owner decides to switch it on (owner, 3 November 2026).
- [ ] Before switching it on, record the training people had before the app with Record Trained
      In Person on each person's Training tab (owner decision, 3 November 2026). Otherwise the next
      check (the 09:00 UTC daily run, or sooner, whenever a manager opens a Training tab or someone
      opens My Training) gives every Active member of staff each course in their audience that is
      not already done and in date.
- [ ] Never waive Essentials or Team training to stand for training done before the app. A waived
      first go counts for nothing: every practical that needs it (the walkthrough needs
      Essentials; chemicals, kegs, gas, BIBs, ramp, hot drinks and pool table need Team training)
      waits and cannot be signed off, and no refresher of it ever comes until a manager assigns it
      again. Only a waived refresher counts, and only for one refresher period.

## 7. Emails

The training emails switch ships off. One switch covers the staff reminders and the manager's daily
training email. It does not cover the emails sent the moment someone confirms: certificate copies,
sign-off copies and the "Signed" or "Declined" notices to the manager still go whatever the switch
says (only `SUSPEND_ALL_EMAIL` stops those).

- [ ] Leave it off for now (owner, 3 November 2026: nothing automated goes out yet). When the owner
      says so, and every course wanted live is published and groups are right, turn the switch on
      (Employees, Training, Courses). The next daily run (09:00 UTC) sends each person with an open
      course their first email, at most one email per person per day; that includes items a manager
      assigned by hand while automatic assignment was off.
- [ ] Check the first staff email and the first manager email in the inboxes, then leave it on.

## 8. Tidy

- [ ] Move the privacy notice "Last updated" date to the release date
      (`src/app/privacy/page.tsx`).
- [ ] When the certificate design arrives, replace the layout in
      `src/lib/signing/documents/training-certificate.ts`.
- [ ] Update the project memory and close out `tasks/todo.md`.

## If something goes wrong

- Turn the training emails switch off first; that stops the reminders and the manager's daily
  training email from the next run. Turn automatic assignment off too; that stops new items from
  the next sync, but does not take back items already given. There is no way to cancel one item
  by hand. A manager can move its due date later, or pause that person's training, which stops
  the chasing. Waiving closes it, but a waived first go at Essentials or Team training blocks
  every practical that needs it and stops its refreshers (section 6), so do not waive those.
- Reverting the merge commit takes the screens away. The tables and their rows can stay: nothing
  else in the app writes to them, and keeping them keeps the training history.
- Straight after a revert, and before the next `signing-reminders` run (09:30 UTC), withdraw every
  open training certificate and sign-off (signing documents of kind `training_completion` or
  `training_signoff` still sent or part signed). Without the training kinds, the old reminders
  code would email reminder links for them at 3 and 7 days. This is a live database write and
  needs the owner's yes.
