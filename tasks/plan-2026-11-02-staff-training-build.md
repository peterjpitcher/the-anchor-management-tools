# Staff training: build contract (overnight build, 2 to 3 November 2026)

This is the single contract every build agent works to. The design reasons are in
`tasks/spec-2026-11-02-staff-training.md` (spec v2). Where this contract and the spec differ, this
contract wins.

Worktree: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.claude/worktrees/staff-training`,
branch `feat/staff-training`, cut from `origin/main` at `3838d41aa`. Work only inside it.

## 0. Owner decisions and hard rules

Owner answers (2 November 2026, evening):
1. Nothing goes live tonight. Build everything; the owner reviews in the morning. No migration is
   applied to production, nothing is deployed, merged or pushed to main, no email or SMS is sent,
   no production row is written. Read-only SELECTs against production are allowed for discovery.
2. No second repository. Course content lives in the app (uploaded through the Courses page and
   versioned in the database). Course files with answers are NEVER committed to this repository,
   which is public on GitHub. During the build they live outside any repo at
   `/Users/peterpitcher/Documents/Anchor training content/` (owner's Mac).
3. The deck becomes two online courses for everyone: Essentials and Team training. Plus practical
   sign-offs. Every slide is used somewhere.
4. Deposits are taught as: groups of 15 or more pay 10 pounds per person; Christmas bookings at any size.
5. Severe allergic reaction: call 999 straight away (or get someone to), then tell a manager.
6. Challenge 25: passport, UK photocard driving licence (provisional included), PASS-hologram card.
   ID on a phone (apps, photos, screenshots) is not accepted.
7. Earlier recommendations stand (spec section 17): groups Bar, Kitchen, Floor, Management; checks
   of 4 questions, pass with every critical right and at most one wrong; lock after three fails;
   chasing as in spec section 8; deadlines as in spec 4.3; 12-month refreshers; Orange Jelly issues
   the certificate naming The Anchor; four overlapping policy drafts retired; Flow tick retired;
   7-year retention as a deliberate act.
8. Staff reminder emails and the manager training email are built but OFF until the owner turns
   them on (one setting, default off).

Hard rules for every agent:
- Never write the em dash character (U+2014) anywhere: code, comments, copy, tests, commits. A hook
  blocks it. Use a comma, colon, brackets or a new sentence.
- Anything you cannot decide goes in your final report, never into a file; the orchestrator raises
  it with the owner in chat.
- British English in all copy. Plain words, reading age about 9 for staff-facing text.
- Edit only the files your stage owns (section 9). If you need a change in another stage's file,
  say so in your final report instead of editing it.
- Another session is overhauling the employees section on another branch. Do NOT edit these files:
  `src/services/employees.ts` (except the one pre-check in 5.7), `src/lib/employees/separation.ts`,
  `src/app/actions/employeeActions.ts`, `src/app/actions/employeeInvite.ts`,
  `src/app/actions/signing-staff.ts`, `src/lib/signing/documents/worker-agreement.ts`,
  `src/components/features/employees/**`, `src/components/features/signing/EmployeeSigningTab.tsx`,
  `src/app/(authenticated)/employees/[employee_id]/page.tsx`,
  `src/app/(authenticated)/employees/new/**`, `src/app/(employee-onboarding)/**`,
  `src/app/api/cron/employee-separations/**`.
- Use the design system barrel `@/ds` and the tokens in `src/app/globals.css`; no raw colours, hex,
  pixel text sizes or `dark:` classes (guard `tests/guards/design-tokens.test.ts`). Toasts are
  `react-hot-toast`. Validation is Zod. No React Hook Form.
- Dates: use `src/lib/dateUtils.ts` (Europe/London). Never `getDay`, `getHours`,
  `toISOString().slice` or `toLocale*` without a time zone for business dates.
- Server actions return `{ success?: boolean; error?: string; data?: T }`. Permission failures throw
  as the rest of the app does (`checkUserPermission`). Public and portal write paths fail closed with
  a visible error.
- The admin client (`createAdminClient`) only in server actions, route handlers, crons and services.
  All training tables are service-role only (no RLS policies); every read and write goes through the
  server with an explicit permission or portal-identity check.
- Run node through nvm: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null` in the same Bash call.
- Tests: Vitest. Add tests for your logic. Run only your own test files while building; the
  integration stage runs the full gates. `tsc` needs `NODE_OPTIONS=--max-old-space-size=8192`.
- `git`: do not commit, stash, checkout or reset. The orchestrator commits.

## 1. Courses: the content format (`course.json`)

Validated by `src/lib/training/course-schema.ts` (Zod). One file per course. Fields:

```jsonc
{
  "schemaVersion": 1,
  "slug": "essentials",                 // ^[a-z0-9-]{2,60}$, stable forever
  "title": "Essentials",
  "summary": "One or two sentences shown on My Training.",
  "kind": "online",                      // "online" | "practical"
  "audience": { "groups": [], "age": "all" },   // groups [] = everyone; age "all" | "under_18" | "adult"
  "essentials": true,                    // shown first, stricter escalation
  "deadline": { "newStarterDays": 0, "existingStaffDays": 14 },  // either may be null = no due date
  "refresherMonths": 12,                 // null = never expires
  "windowDays": 30,
  "prerequisite": null,                  // another course slug, or null
  "legalBasis": "Short note for the record: which law or policy this course supports.",
  "estimatedMinutes": 25,
  "intro": [ /* cards shown before section 1, optional */ ],
  "sections": [ /* online only, 1 to 12 */ ],
  "tasks": [ /* practical only, 1 to 20 */ ],
  "supervisedOnlyUnder18": false,       // practical only: under-18 sign-offs are "supervised only"
  "closing": [ /* cards shown after the last section, optional */ ]
}
```

Section:

```jsonc
{
  "key": "fire-and-emergencies",         // ^[a-z0-9-]{2,60}$, unique in the course
  "title": "Fire, 999 and first aid",
  "objectives": [ { "key": "raise-alarm", "text": "Raise the alarm and get out safely" } ],  // 2 to 4
  "cards": [ /* 2 to 20 */ ],
  "resitNote": "Optional text shown before a retake.",
  "check": { "questionsPerAttempt": 4, "maxWrong": 1 },   // defaults 4 and 1
  "questions": [
    {
      "id": "fire-01",                   // unique in the course, never reused for different content
      "objective": "raise-alarm",
      "critical": true,
      "prompt": "A customer says there is smoke coming from the bin store. What do you do first?",
      "options": ["Fetch an extinguisher", "Raise the alarm", "Go and look"],  // exactly 3
      "answer": 1,                       // index into options
      "explanation": "Raise the alarm first, always. Only tackle a fire if you are trained and it is no bigger than a waste-paper basket."
    }
  ]
}
```

Cards (one per screen in the player):

| type | fields |
|---|---|
| `paragraph` | `title?`, `text` |
| `bullets` | `title?`, `items: string[]` (1 to 12) |
| `do_dont` | `title?`, `do: string[]`, `dont: string[]` |
| `callout` | `tone: "info" \| "warning" \| "manager"`, `title`, `text` |
| `table` | `title?`, `columns: string[]` (2 to 4), `rows: string[][]` |
| `steps` | `title?`, `steps: { title: string, text: string }[]` (2 to 9) |
| `image` | `src` (relative path in the upload, e.g. `images/cover.jpg`), `alt`, `caption?` |
| `check_yourself` | `prompt`, `options` (3), `answer`, `explanation` (unscored, not recorded) |

Practical task: `{ "key": "change-keg", "text": "Changes a keg safely: product off, dry route, trolley or team lift, test pour." }`.

Validation (`validateCourse(json, { mode: 'draft' | 'publish' })` returns
`{ ok, course?, errors: string[], warnings: string[], gaps: string[] }`):
- structure per the schema; unique keys and ids; every question's objective exists in its section;
- every objective has at least `2 x` the number of questions a check would draw from it (the draw
  spreads `questionsPerAttempt` across objectives round-robin), so a resit can avoid repeats;
  an objective with any critical question has at least 2 critical questions;
- no em dash anywhere (error); no `{{` or `}}` (error); text over 600 characters in one card (warning);
- `[[TO CONFIRM: ...]]` markers: allowed in draft mode (listed in `gaps`), an error in publish mode;
- every `image` card's `src` must be present in the upload (checked by the upload action).

## 2. Database (migrations; NOT applied anywhere tonight)

Timestamps must sort after everything already in production and on open branches. Use
`20261103090000` to `20261103090400`. Each file is self-contained and idempotent where practical.

### 2.1 `20261103090000_training_tables.sql`

```sql
create table public.training_courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  title text not null check (length(title) between 2 and 120),
  kind text not null check (kind in ('online','practical','external')),
  audience_groups text[] not null default '{}' check (audience_groups <@ array['bar','kitchen','floor','management']::text[]),
  audience_age text not null default 'all' check (audience_age in ('all','under_18','adult')),
  is_essentials boolean not null default false,
  prerequisite_course_id uuid references public.training_courses(id) on delete restrict,
  new_starter_due_days int check (new_starter_due_days between 0 and 365),
  existing_staff_due_days int check (existing_staff_due_days between 0 and 365),
  refresher_months int check (refresher_months between 1 and 120),
  window_days int not null default 30 check (window_days between 0 and 180),
  supervised_only_under_18 boolean not null default false,
  display_order int not null default 100,
  status text not null default 'draft' check (status in ('draft','live','retired')),
  current_version_id uuid,            -- FK added after training_course_versions exists
  summary text,
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.training_course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.training_courses(id) on delete restrict,
  state text not null check (state in ('draft','published')),
  major int, minor int,
  content jsonb not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  images jsonb not null default '[]'::jsonb,    -- [{ "src", "path", "sha256", "contentType", "bytes" }]
  change_note text,
  redo_required boolean not null default false,
  uploaded_by uuid, uploaded_by_name text, uploaded_at timestamptz not null default now(),
  published_by uuid, published_by_name text, published_at timestamptz,
  check ((state = 'draft' and major is null and minor is null and published_at is null)
      or (state = 'published' and major is not null and minor is not null and published_at is not null))
);
create unique index training_course_versions_one_draft on public.training_course_versions(course_id) where state = 'draft';
create unique index training_course_versions_number on public.training_course_versions(course_id, major, minor) where state = 'published';
alter table public.training_courses add constraint training_courses_current_version_fk
  foreign key (current_version_id) references public.training_course_versions(id) on delete restrict;

create table public.training_profiles (
  employee_id uuid primary key references public.employees(employee_id) on delete restrict,
  groups text[] not null default '{}' check (groups <@ array['bar','kitchen','floor','management']::text[]),
  groups_confirmed_at timestamptz, groups_confirmed_by uuid, groups_confirmed_by_name text,
  paused_from date, paused_until date,
  pause_reason text check (pause_reason in ('leave_of_absence','parental_leave','other')),
  adjustment_note text check (length(adjustment_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(employee_id) on delete restrict,
  course_id uuid not null references public.training_courses(id) on delete restrict,
  cycle int not null check (cycle >= 1),
  reason text not null check (reason in ('new_starter','existing_staff','course_added','refresher','redo','manual','renewal')),
  status text not null check (status in ('waiting','assigned','in_progress','locked','awaiting_confirmation','declined','completed','waived','cancelled')),
  assigned_on date not null,
  due_on date,
  window_opens_on date,
  version_id uuid references public.training_course_versions(id) on delete restrict,
  progress jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  last_section_passed_at timestamptz,
  completed_on date,
  expires_on date,
  certificate_number text unique,
  signing_document_id uuid references public.signing_documents(id) on delete restrict,
  confirmed_at timestamptz,
  locked_at timestamptz, locked_section text,
  declined_at timestamptz,
  waived_at timestamptz, waived_by uuid, waived_by_name text, waive_reason text,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason in ('left','group_removed','course_retired','replaced','manual')),
  external_issuer text, external_reference text, external_issued_on date, external_file_path text,
  signoff_tasks jsonb, signed_off_by uuid, signed_off_by_name text, signed_off_on date,
  supervised_only boolean not null default false,
  due_change_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, course_id, cycle)
);
create unique index training_assignments_one_open on public.training_assignments(employee_id, course_id)
  where status in ('waiting','assigned','in_progress','locked','awaiting_confirmation','declined');
create index training_assignments_course on public.training_assignments(course_id, status);
create index training_assignments_due on public.training_assignments(due_on) where status in ('assigned','in_progress','locked','awaiting_confirmation','declined');

create table public.training_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_assignments(id) on delete restrict,
  employee_id uuid not null references public.employees(employee_id) on delete restrict,
  version_id uuid not null references public.training_course_versions(id) on delete restrict,
  section_key text not null,
  attempt_no int not null check (attempt_no >= 1),
  served jsonb not null,               -- [{ "questionId", "optionOrder": [2,0,1] }]
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  answers jsonb,                       -- { questionId: originalOptionIndex }
  results jsonb,                       -- [{ questionId, chosen, correct, critical }]
  wrong_count int, critical_missed int, passed boolean,
  unique (assignment_id, section_key, attempt_no)
);
create unique index training_attempts_one_open on public.training_attempts(assignment_id, section_key) where submitted_at is null;

create table public.training_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(employee_id) on delete restrict,
  assignment_id uuid references public.training_assignments(id) on delete restrict,
  course_id uuid references public.training_courses(id) on delete restrict,
  event_type text not null check (event_type in (
    'course_draft_uploaded','course_published','course_retired','assigned','started','section_passed',
    'section_failed','locked','unlocked','extended','waived','paused','resumed','cancelled','declined',
    'confirmation_prepared','confirmation_failed','completed','reminder_sent','escalated',
    'external_recorded','signoff_recorded','groups_changed','redo_requested')),
  actor_id uuid, actor_name text,
  note_code text, note text check (length(note) <= 500),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index training_events_employee on public.training_events(employee_id, created_at desc);
create index training_events_created on public.training_events(created_at desc);

create table public.training_reminders (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('staff_step','daily_cap','manager_daily','escalation','no_login','undeliverable')),
  claim_key text not null,             -- e.g. step:<assignment>:<step>:<due_on>, weekly:<assignment>:<monday>, cap:<employee>:<date>, manager:<date>, esc:<assignment>:<type>, nologin:<employee>
  assignment_id uuid references public.training_assignments(id) on delete restrict,
  employee_id uuid references public.employees(employee_id) on delete restrict,
  london_date date not null,
  status text not null check (status in ('claimed','sent','uncertain')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index training_reminders_claim on public.training_reminders(claim_key);
```

Releasing a claim deletes its row (the only training table rows that may be deleted in normal use).

Triggers:
- `training_course_versions`: a published row can never be updated or deleted; a draft can be
  updated or deleted; the only allowed change to a draft that makes it published sets `state`,
  `major`, `minor`, `published_*` and leaves `content`, `content_sha256` and `images` unchanged.
- `training_attempts`: no delete; an update is allowed only while `OLD.submitted_at is null`, and may
  change only `submitted_at`, `answers`, `results`, `wrong_count`, `critical_missed`, `passed`.
- `training_events`: no update, no delete.
- `updated_at` touch triggers on courses, profiles, assignments, reminders.
- Bypass for the retention removal function only: the triggers skip when
  `current_setting('training.retention_purge', true) = 'on'`. Add
  `public.training_retention_purge(p_employee_id uuid)` as SECURITY DEFINER, service_role only,
  which refuses unless the employee is Former and their employment ended 7 or more years ago, sets the
  setting locally, deletes the person's attempts, events, reminders, assignments and profile, and
  returns the counts (signing packs are removed by the existing signing retention path; out of scope).

Grants (every table): `alter table ... enable row level security;` no policies;
`revoke all on table ... from public, anon, authenticated; grant all on table ... to service_role;`
Functions: `revoke all on function ... from public, anon, authenticated; grant execute ... to service_role;`

Storage: a private bucket `training` (no storage policies; service role only):
`insert into storage.buckets (id, name, public) values ('training','training', false) on conflict (id) do nothing;`
Paths: `courses/<courseId>/<sha256>.<ext>` for images, `external/<employeeId>/<uuid>.<ext>` for
external certificates.

### 2.2 `20261103090100_training_signing_kinds.sql`

Add `training_completion` and `training_signoff` to every CHECK or enum that lists signing kinds
(find them in `supabase/migrations/20261013080854_document_signing_foundation.sql` and later
signing migrations; re-state the full list). Generator kinds need no `signing_templates` rows.

### 2.3 `20261103090200_training_permissions.sql` (applied AFTER the code deploy)

Insert permission rows for module `training`, actions `view`, `manage`, `publish`, and grant all
three to `super_admin` and `view` and `manage` only to `manager` (owner decision, 3 November 2026:
only super_admin accounts publish, four of them on that date; super_admin is allowed every
permission before any row is read), in the same shape as the most recent migration that
added a module (search for `'marketing'` or `'checklists'` permission inserts). Do not grant to
`staff`, `foh_staff` or `portal_shift_manager`.

### 2.4 `20261103090300_retire_policy_drafts_replaced_by_training.sql`

The four drafted policy acknowledgement templates that the courses replace (health and safety,
allergens, Challenge 25, data protection; see
`supabase/migrations/20261013080952_document_signing_template_drafts.sql`) are marked retired or
inactive the way the signing feature retires a template, so they cannot be switched on. The staff
handbook template is untouched. Data only; no schema change. If retirement needs a column that does
not exist, keep them inactive and add a guard so Settings cannot switch them on, and report it.

### 2.5 Types

Hand-add the five tables (Row, Insert, Update, Relationships) and the purge function to
`src/types/database.generated.ts` in the exact generated style, alphabetically placed, so
`tests/guards/query-columns.test.ts` passes. They are regenerated from production after the
migrations are applied.

### 2.6 Postgres harness

`scripts/testing/training-postgres.py` in the style of the other `*-postgres.py` harnesses (read
`scripts/testing/document-signing-postgres.py` and the `test:pg` script): apply the needed baseline
objects plus the training migrations to a throwaway local Postgres and assert the CHECKs, the unique
indexes (one open cycle, one open attempt, one draft), the triggers (published version immutable,
attempt update rules, events append-only, purge bypass), and that `authenticated` and `anon` hold no
privilege on any `training_*` table. Homebrew PG17 needs `LC_ALL=C`; keep cluster sockets out of
long paths.

## 3. Domain rules (implemented in `src/lib/training/`)

Statuses: `waiting` (prerequisite not met, no due date), `assigned`, `in_progress`, `locked`,
`awaiting_confirmation`, `declined`, `completed`, `waived`, `cancelled`.
Open = waiting, assigned, in_progress, locked, awaiting_confirmation, declined.

Display state (`displayStateFor`), first match wins:
`not_required` (no assignment and the course does not apply) / `paused` (profile paused today and
item open) / `locked` / `declined` / `awaiting_confirmation` / `waiting` / `overdue` (open, due_on
before today) / `due_soon` (open, due within 2 days) / `in_progress` / `not_started` / `waived` /
`expired` (latest completed, expires_on before today) / `refresher_due` (completed, today on or after
window_opens_on) / `done`.

Who gets what (`planAssignmentSync`, pure; applied by `TrainingService.syncAssignments`):
- In scope: employees with status `Active` (new and existing cycles) and `Started Separation`
  (existing open cycles only, never a new one). Everyone else: open items are cancelled with
  `cancel_reason = 'left'`.
- A course applies when it is `live`, the person's groups intersect `audience_groups` (empty = all;
  a person with no confirmed groups gets the union of suggested groups; v1 courses are all
  "everyone"), and the age rule matches (`under_18`/`adult` from date_of_birth; a missing date of
  birth means an age-restricted course is not assigned and the person is flagged).
- No assignment yet: create cycle 1. Reason `new_starter` when employment_start_date is on or after
  today minus 14 days, else `existing_staff` (or `course_added` when the course went live after the
  person started). Due date (`computeInitialDueOn`): new starter
  `max(start + newStarterDays, today)`; otherwise `today + existingStaffDays`; null rule means no
  due date. A prerequisite not yet valid: status `waiting`, no due date; when the prerequisite
  completes, status `assigned`, due `today + 14` (or no due date when the course has none).
- Latest cycle completed and `today >= window_opens_on` (expires_on minus window_days), no open
  cycle, person Active: create a `refresher` cycle due `max(expires_on, today)`.
- A published version with `redo_required` newer than the version on the latest completed cycle,
  no open cycle: create a `redo` cycle due `today + 14`.
- Course retired or person no longer in its audience: cancel open items (`course_retired`,
  `group_removed`). Completed records are never touched.

Dates (`dates.ts`): London today from `dateUtils`. `computeExpiresOn(refresherMonths, completedOn,
previousExpiresOn)`: completed on or before the previous expiry extends from the previous expiry,
else from completion; uses `addMonthsToIsoDate` (moved into `dateUtils`, month-end safe including
29 February). `window_opens_on = expires_on - window_days`. Extension: only later, with a reason.
Resume after pause: `max(current due, resume date + 14)`. Unlock: due moves on by the whole days
locked.

Checks:
- Draw (`drawQuestions`): `questionsPerAttempt` questions spread round-robin across the section's
  objectives; an objective with critical questions contributes at least one critical; never a
  question served in the previous attempt of the same section unless the pool cannot fill the draw
  without it; options shuffled; returns `[{ questionId, optionOrder }]`. Takes an injectable
  `random` for tests; production uses `crypto.getRandomValues`.
- Score (`scoreAttempt`): answers arrive as the displayed option index per question; map back
  through `optionOrder`; pass = no critical wrong and `wrongCount <= maxWrong`.
- Fail: the section's fail count goes up and the learner goes back to card 0 of that section; on the
  third fail the assignment becomes `locked` (`locked_section`, `locked_at`). Unlock by a manager
  resets that section's fail count and moves the due date.
- An open (unsubmitted) attempt for a section is returned again by `startCheck` (same questions), so
  reloading cannot fish for easier questions.
- Progress JSON on the assignment:
  `{ "sections": { "<key>": { "card": 3, "fails": 1, "passedAt": "...", "lastAttemptQuestionIds": ["..."] } }, "current": "<key>", "introSeen": true }`.
  Sections are taken in order; a later section opens when the previous one is passed.
- Version: set on the assignment at the first start to the course's current published version and
  kept for that cycle.
- Finishing: when the last section passes, `completed_on` = London date of that pass,
  `expires_on` computed, `certificate_number` = `AT-` + 10 random base32 characters (crypto, unique),
  status `awaiting_confirmation`, then `prepareTrainingCertificate`. A failure there leaves the
  status as is with no document and the daily job retries; the learner sees a friendly retry.
- Signing completed: status `completed`, `confirmed_at`. Signing declined: status `declined`
  (chasing stops; the manager is told; "prepare again" creates a new document).
- Practical: a manager records the tasks observed and the date; the item is `awaiting_confirmation`
  until the person confirms in person; then `completed` with `completed_on = signed_off_on`.
  Under-18 and `supervised_only_under_18`: `supervised_only = true`, shown everywhere.
- External: recorded by a manager as `completed` immediately with issuer, reference, issue and
  expiry dates and the file; `expires_on` is the certificate's own expiry.

Reminders (`reminders.ts`, pure planner): exactly spec section 8.1 to 8.4. Steps `assigned`,
`nudge` (from 3 days after assignment until 2 days before due), `due_soon` (2 days before due until
due), `overdue` (from the day after due), `weekly` (each London Monday after the overdue email).
Staff emails only for `online` items in `assigned`, `in_progress` or `awaiting_confirmation`
that have a due date; never for practical or external items, waiting, locked, declined, paused,
left, no login, suppressed address, or when the setting is off or a kill switch is on. One email per
person per London day listing every due step. Manager daily email triggers: spec 8.3. Claims as in
spec 8.4 with the `training_reminders` keys above.

## 4. Signing integration (`src/lib/signing/**`, `src/lib/training/signing.ts`)

Two new kinds in `kinds.ts` and `types.ts`:
- `training_completion`: label "Training confirmation", mode `acknowledge`, brand `staff`, subject
  `employee`, signer `worker`, `companySigns: false`, source `generator`, send permission
  `training/manage`, view permission `training/view`.
- `training_signoff`: label "Practical sign-off", mode `sign`, brand `staff`, subject `employee`,
  signer `worker`, `companySigns: true` (the manager signs as the business at creation), source
  `generator`, permissions as above. In person only: no link email, hidden from My Documents,
  refused by the portal sign route.

Per-kind options (add to the definition, default to today's behaviour for every existing kind):
`signingReminders: boolean` (false for both new kinds), `allowSendNewLink: boolean` (false for both),
`linkExpiryDays` (30), `agreementWording` (training: "I confirm that I have read and understood
"<course>, version <n>" and will follow it at work."; sign-off: "I confirm that <manager> watched
me do these tasks on <date> and that I will do them the same way at work."), completed-email
wording ("Your training certificate"), and `notifySenderOnCompletion` so a system-created document
sends its "Signed:" notice to the manager mailbox the app already uses for owner notices (the
owner keeps all "Signed:" notices).

Generator: `src/lib/signing/documents/training-certificate.ts` builds one A4 HTML document:
page 1 the certificate (placeholder design until the owner's design arrives: Orange Jelly staff
palette from `src/lib/brand/palette.ts` STAFF, the Orange Jelly wordmark from
`getDocumentLogoDataUri()`, "The Anchor, Stanwell Moor" as the workplace; fields: holder's name,
course title and version, "All sections passed on <date>", "Refresher due by <date>" or "No
refresher", certificate number, the confirmation slot "To be confirmed electronically" /
"Confirmed electronically on <date and time>", issuer "Orange Jelly Limited", signatory "Peter
Pitcher, Director" (kept in one constant so it can change), "In-house training, not an accredited
qualification"); page 2 the training record (sections, version, attempts per section, dates). The
signing record page is appended by the signing feature as it is for every document.
`training-signoff.ts` does the same for a practical sign-off (tasks observed, manager, date,
supervised-only line).

`src/lib/training/signing.ts` exports:
- `prepareTrainingCertificate(assignmentId: string): Promise<{ documentId: string; partyId: string }>`
  idempotent (returns the open document if one exists), series key `training:<slug>`,
  `sendLinkEmails: false`, the learner's email on the party.
- `createPracticalSignoff(input: { assignmentId: string; tasks: string[]; observedOn: string; actor: { id: string; name: string } }): Promise<{ documentId: string; partyId: string; inPersonUrl: string }>`
  series key `training-signoff:<slug>`, the manager signs as the business now, the learner signs in
  person (use the existing in-person handover flow; return its URL).
- `onTrainingSigningCompleted(documentId)` and `onTrainingSigningDeclined(documentId)`, registered
  as completion hooks, idempotent on `signing_document_id`.

Update `tests/guards/signing.test.ts` so generator kinds are not required to seed template wording,
and update counts in `scripts/testing/document-signing-postgres.py` if it counts kinds.

## 5. Server code

### 5.1 `src/services/training.ts` (class `TrainingService`, admin client inside)
Reads and writes for everything below; maps snake_case rows to the camelCase types in
`src/lib/training/types.ts` by hand. Includes `syncAssignments(opts: { employeeId?: string; today?: string; actor?: Actor }): Promise<{ created: number; cancelled: number; updated: number }>`,
`writeEvent(...)`, `getMatrix()`, `getEmployeeTraining(employeeId)`, course and version reads.

### 5.2 Manager actions `src/app/actions/training.ts` (`'use server'`)
Each checks `checkUserPermission('training', <action>)` first (view, manage or publish as noted),
validates with Zod, writes a `training_events` row and `logAuditEvent`, `revalidatePath`.
- `getTrainingMatrix()` view
- `getEmployeeTraining(employeeId)` view; also runs `syncAssignments({ employeeId })` first
- `getTrainingActivity(input: { page?: number; employeeId?: string })` view
- `syncTrainingNow()` manage
- `assignCourse(input: { employeeIds: string[]; courseId: string; dueOn?: string | null; note?: string })` manage; creates a `manual` cycle where none is open
- `extendDueDate(input: { assignmentId: string; dueOn: string; reason: string })` manage
- `waiveAssignment(input: { assignmentId: string; reason: string })` manage
- `unlockSection(input: { assignmentId: string; note: string })` manage
- `setTrainingGroups(input: { employeeId: string; groups: TrainingGroup[]; confirm: boolean })` manage
- `pauseTraining(input: { employeeId: string; from: string; until: string | null; reason: PauseReason })` manage
- `resumeTraining(input: { employeeId: string })` manage
- `prepareConfirmationAgain(input: { assignmentId: string })` manage
- `recordPracticalSignoff(input: { employeeId: string; courseId: string; tasks: string[]; observedOn: string; note?: string })` manage; returns `{ inPersonUrl }`
- `recordExternalQualification(formData: FormData)` manage; fields employeeId, courseId, issuer, reference, issuedOn, expiresOn, file (pdf, jpg, png, max 10 MB)
- `getTrainingPayReport(input: { from: string; to: string })` view; attempt time outside clocked or rostered shifts, per person

### 5.3 Course actions `src/app/actions/training-courses.ts`
- `listTrainingCourses()` view
- `getTrainingCourse(slug: string)` view (versions, current, draft, stats)
- `uploadCourseDraft(formData: FormData)` publish; accepts `course.json` plus images, or one `.zip`
  (use `jszip`); validates in draft mode; creates the course row on first upload (status `draft`);
  replaces the existing draft; stores images in the `training` bucket; returns
  `{ data: { slug, courseId, errors, warnings, gaps } }` (errors mean nothing was saved)
- `publishCourseDraft(input: { courseId: string; change: 'first' | 'minor' | 'redo'; changeNote: string })` publish; validates in publish mode; freezes; copies course metadata to the course row; sets `current_version_id`; first publish sets status `live` and runs `syncAssignments`; `redo` sets `redo_required` and runs `syncAssignments`
- `retireTrainingCourse(input: { courseId: string })` publish; cancels open items
- `createExternalCourse(input: { title: string; refresherMonths: number | null; groups: TrainingGroup[]; required: boolean })` publish
- `getCourseVersionJson(versionId: string)` publish; returns the JSON for download
- `previewDraw(input: { versionId: string; sectionKey: string; previousQuestionIds: string[] })` publish; nothing recorded
- `previewScore(input: { versionId: string; sectionKey: string; served: ServedQuestion[]; answers: Record<string, number> })` publish; nothing recorded

### 5.4 Portal actions `src/app/actions/training-portal.ts`
Identity from the shared portal helper (`getPortalWorker`, moved to `src/lib/portal/worker.ts` and
re-exported from `src/lib/signing/portal.ts`); every query filtered to that employee; no permission
module. Fail closed with a plain error.
- `getMyTraining()` runs `syncAssignments({ employeeId: self })` then lists due, done, waiting
- `getMyAssignment(assignmentId)` course meta, intro, section titles and cards (no questions), progress, version
- `saveTrainingProgress(input: { assignmentId: string; sectionKey: string; card: number })`
- `startTrainingCheck(input: { assignmentId: string; sectionKey: string })` returns `{ attemptId, attemptNo, questions: { id: string; prompt: string; options: string[] }[] }` (displayed order, no answers)
- `submitTrainingCheck(input: { attemptId: string; answers: Record<string, number> })` returns `{ passed, wrongCount, results: { questionId, prompt, options, chosen, correctIndex, correct, critical, explanation }[], next: 'next_section' | 'retry' | 'locked' | 'confirm' | 'confirm_retry', confirmUrl?: string }`
- `prepareMyConfirmation(input: { assignmentId: string })` returns `{ confirmUrl }` (the existing `/portal/documents/<partyId>` page)

### 5.5 Routes (`src/app/api/training/**`)
- `GET /api/training/images/[versionId]/[...src]`: session user who holds training view or publish,
  or a portal worker with an assignment on that course; streams from the bucket; `Cache-Control: private`.
- `GET /api/training/external/[assignmentId]`: training view; streams the stored certificate file.
- `GET /api/training/export`: training view; CSV of the log with an "as at" line, using the app's safe
  CSV helpers.

### 5.6 Daily job `src/app/api/cron/training-daily/route.ts`
`0 9 * * *` in `vercel.json`, `maxDuration` exported, `cron-auth`, `withCronRun` with item failures,
added to `src/lib/cron/monitored-jobs.ts`. Stages in their own try/catch: sweep (`syncAssignments`),
finalise signed but unrecorded documents and retry certificate preparation, staff reminders,
manager email. Staff reminders and the manager email run only when the setting
`training_emails_enabled` is true (store it the way the app stores other on/off settings; default
off; a switch on the Training page for `training.publish` holders). The setting off is a quiet path
with a test. Also wrap `src/app/api/cron/signing-reminders` in `withCronRun` and add it to the
monitored list.

Emails (`src/lib/training/emails.ts`): plain staff notices in the Orange Jelly STAFF palette through
`sendEmail`; each says the training is paid working time and to do it on shift or ask for a training
shift; links to `/portal/training`; never copied to the manager mailbox. Manager email lists only
new problems. Render every template with fixture data in tests under London and UTC and fail on
`undefined`, `Invalid Date`, `NaN`.

### 5.7 Other server changes
- Sign-in keeps a safe portal link: `src/app/actions/auth.ts` and the login client honour a
  same-origin `next` (or the existing redirect param) that starts with `/portal/` for portal-only
  users instead of always `/portal/shifts`.
- `src/services/employees.ts` `deleteEmployee`: one pre-check at the very top that refuses with
  "This person has training records. Mark them as left instead." when any `training_assignments`
  row exists. Nothing else in that file.
- Insights (`src/lib/insights/sections/employees.ts`, `thresholds.ts`, its test): rated training
  checks per spec 8.3; remove the word "training" from the not-tracked note.
- `src/app/privacy/page.tsx`: a staff training section per spec 11.
- `src/types/rbac.ts`: module `training` (actions view, manage, publish already exist in ActionType).
- `docs/agent-reference.md`: add the module and the cron.

## 6. Manager pages

- `EMPLOYEES_NAV`: add `{ label: 'Training', href: '/employees/training' }` after Policies.
- `/employees/training` (`page.tsx` server, checks `training:view` server-side and shows a plain
  no-access message otherwise). A view switch (not a second tab row): Matrix (default), Courses,
  Activity, Pay report. Buttons: Sync now, Export CSV, Assign training (choose course, people,
  optional due date).
  - Matrix: Active and Started Separation staff down the side, live courses across, cells from
    `displayStateFor` with labels and tones from `src/lib/training/labels.ts`; flags (Groups not
    confirmed, No login, Date of birth missing); completion rate per course (excluding paused).
    Mobile: a list per person instead of a grid.
  - Courses: list with status, current version, assigned and completed counts; Upload course
    (file input, multiple files or a zip) showing errors, warnings and gaps; per course: Preview
    draft, Publish (first, minor, ask everyone to redo, with a change note), Download JSON, Retire;
    Add external qualification type; the `training_emails_enabled` switch.
  - Activity: `training_events`, newest first, paged.
- `/employees/training/courses/[slug]`: versions, draft, publish panel.
- `/employees/training/courses/[slug]/preview?version=<id>`: the shared player in preview mode.
- Employee record: a Training tab in `EmployeeDetailTabs.tsx`, rendered by a self-loading
  component `src/components/features/training/EmployeeTrainingTab.tsx` (takes `employeeId`, calls
  `getEmployeeTraining`), with groups (suggested and confirmed), current items, history, attempts,
  certificates (download via signing), external qualifications, and the manager actions in 5.2.
  Shown only to users with `training:view` (use the permission context on the client and the
  server check in the action). Linkable as `?tab=training` if the tabs component supports it.

## 7. Staff portal

- `PORTAL_NAV`: add `{ label: 'My Training', href: '/portal/training' }`.
- `/portal/training`: due (with dates and a Start or Continue button), waiting for a manager,
  done (with "View certificate" linking to the signed document in My Documents).
- `/portal/training/[assignmentId]`: the player.
- Shared player `src/components/features/training/player/CoursePlayer.tsx` with
  `mode: 'live' | 'preview'`: intro cards, section list with progress, one card per screen with Back
  and Next, progress saved on each Next (live), a read-aloud button per card (Web Speech API,
  `en-GB`, no outside service), the check (radio options, Submit), results with every explanation,
  retry or locked messages, and the finish screen with "Confirm your training" (live) or "Preview
  finished" (preview). No timers, no scroll gates. 320 px wide minimum, 44 px tap targets, WCAG 2.2 AA.
  In preview mode it calls `previewDraw` and `previewScore` and records nothing.

## 8. Course content (outside the repo)

Folder: `/Users/peterpitcher/Documents/Anchor training content/` with one folder per course
(`essentials/course.json`, `team-training/course.json`, `walkthrough/course.json`, ...) and a
`README.md` (how to upload, and what changed from the deck and why). Sources: the deck transcription
and the fact-check in the session scratchpad (`.../scratchpad/training/deck/g1.md` to `g4.md`,
`factcheck.md`, `decisions.md`, `gaps.md`, `course-map.md`). Content policy:
1. The deck's wording is the owner's authority for house rules and venue facts. Keep it close to the
   slide wording, re-cut into one-idea cards.
2. Apply the owner's answers (section 0) and every verified correction in `factcheck.md` "Upheld",
   and the "Fixes that need no answer" list in `decisions.md`.
3. Where `decisions.md` recommends wording that needs no new fact, use the recommendation
   (one goodbye for every guest, hours as a pattern plus "check today's hours", the checklist wins
   on candles and utensils, takeaway drinks only if a manager confirms, garnish "ask a manager",
   the manager on shift is the appointed person for first aid, phones rule as recommended).
4. Never invent a name, phone number, price or time that no source gives. Where one is
   unavoidable, write a `[[TO CONFIRM: what is needed]]` marker and keep these to an absolute
   minimum, because publishing is blocked until each is filled.
5. Courses: Essentials (everyone, due the start date, existing staff 14 days) and Team training
   (everyone, 14 days new starters, 28 existing staff, prerequisite none); then practical courses,
   each `kind: practical`, prerequisite `team-training` unless stated, no due date unless stated:
   walkthrough (nine areas, prerequisite `essentials`, new starters 14 days, existing 28), kegs,
   gas, bibs, ramp, hot-drinks, pool-table, chemicals. Under-18 supervised-only for kegs, gas, bibs,
   chemicals.
6. Each online section: 2 to 4 objectives, 6 to 14 cards, at least 8 questions (at least 2 per
   objective times the draw share, at least 2 critical for each objective that has critical
   content), scenario questions with three plausible options and a one or two sentence explanation.

## 9. Stage ownership

| Stage | Owns (creates or edits) |
|---|---|
| F1 schema | the four migrations, `scripts/testing/training-postgres.py`, `tests/guards/training-tables.test.ts`, `src/types/database.generated.ts` |
| F2 contracts | `src/types/rbac.ts`, `src/lib/training/types.ts`, `labels.ts`, `course-schema.ts` (+ tests), stubs with final signatures for `dates.ts`, `draw.ts`, `scoring.ts`, `states.ts`, `sync.ts`, `reminders.ts`, `signing.ts`, `storage.ts`, `src/services/training.ts`, and the three action files |
| B1 engine | `src/lib/training/{dates,draw,scoring,states,sync,reminders}.ts` + tests, `src/lib/dateUtils.ts` (add `addMonthsToIsoDate`), `src/lib/oj-projects/recurring-periods.ts` (re-export) |
| B2 data | `src/services/training.ts`, `src/lib/training/storage.ts`, `src/lib/training/certificate-number.ts`, the three action files + tests, the `deleteEmployee` pre-check |
| B3 signing | `src/lib/signing/**` (not worker-agreement.ts), `src/lib/training/signing.ts`, `tests/guards/signing.test.ts`, `scripts/testing/document-signing-postgres.py`, signing tests |
| B4 manager UI | `src/app/(authenticated)/employees/training/**`, `src/components/features/training/manager/**`, `src/components/features/training/EmployeeTrainingTab.tsx`, `EMPLOYEES_NAV`, `EmployeeDetailTabs.tsx` |
| B5 portal | `src/app/(staff-portal)/portal/training/**`, `src/components/features/training/player/**`, `PORTAL_NAV`, `src/lib/portal/worker.ts`, `src/lib/signing/portal.ts` (re-export only), `src/app/actions/auth.ts`, the login client |
| B6 jobs | `src/app/api/cron/training-daily/**`, `src/app/api/cron/signing-reminders/**`, `src/app/api/training/**`, `src/lib/training/{emails,daily-job,settings}.ts` + tests, `vercel.json`, `src/lib/cron/monitored-jobs.ts`, insights files, `src/app/privacy/page.tsx`, `docs/agent-reference.md` |
| B7 content | `/Users/peterpitcher/Documents/Anchor training content/**` only |

Final report from every stage: files changed, tests added and their result, anything left undone
and why, any change needed in a file another stage owns, and anything that needs the owner's say.
