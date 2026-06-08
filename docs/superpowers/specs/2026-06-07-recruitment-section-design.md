# Recruitment Section - Revised Implementation Spec

- **Date:** 2026-06-07
- **Status:** Revised after codebase/database discovery. Ready for implementation planning after Phase 0 acceptance gates are completed.
- **Owner:** Peter Pitcher
- **Repos touched:** `OJ-AnchorManagementTools` (management app, system of record) and `OJ-The-Anchor.pub` (public website, intake)
- **Complexity:** 5 / XL, delivered as independently deployable phases

---

## 1. Discovery Snapshot

This revision replaces the earlier "finalised" draft because discovery found live-state mismatches that must be handled before implementation.

### Live Supabase state

- No active recruitment tables exist yet.
- No old `hiring_*` tables exist in the live public schema.
- Stale `hiring` permissions still exist: `view`, `create`, `edit`, `delete`, `manage`, `send`.
- Stale `hiring_retention_policy` and `hiring_stage_reminders` settings still exist.
- A private `hiring-docs` storage bucket still exists with a 10 MB limit and PDF/DOC/DOCX MIME allow-list.
- There is no `recruitment-cvs` bucket.
- `employee-attachments` exists, is private, has a 10 MB limit, and allows PDF/DOC/DOCX.
- Live attachment categories do not include `CV`; current categories include `Contract`, `ID Scan`, `Other`, `P45`, `P60`, `Payslip`, `Performance Review`, and `Right to Work Document`.

### Management app state

- `src/types/rbac.ts` does not yet include `recruitment` or `hiring` in `ModuleName`.
- `ActionType` already supports `view`, `create`, `edit`, `delete`, `manage`, and `send`; it does not support `interview`.
- `sendEmail` supports `replyTo`; the Graph path must keep setting it on the Microsoft Graph message.
- The current public API rate limiter is in-memory, not Upstash/distributed.
- The table-bookings public API pattern uses `Idempotency-Key`, API key auth, admin client, and conditional Turnstile verification.
- OpenAI usage can be recorded in `ai_usage_events`, but there are no recruitment-specific model settings or prompt/run tables.
- `pdf2json` and `mammoth` are installed; `pdf-parse` is not installed.
- The generic Twilio wrapper can auto-create/link `customers` records by phone unless explicitly avoided. Recruitment SMS must not flow candidate PII into `customers`.
- Microsoft Graph email exists; Graph calendar event creation is net-new.
- `inviteEmployee(email, job_title)` creates an onboarding employee and sends the welcome email. If welcome email sending fails, it deletes the just-created onboarding employee.

### Website state

- `/join-our-team` is live with static role options, availability checkboxes, optional CV upload, Turnstile, honeypot, and a consent checkbox.
- Current website recruitment submission emails the application/CV to `manager@the-anchor.pub` and persists nothing.
- The website already has a management API base URL helper and table-booking proxy pattern using `ANCHOR_API_BASE_URL` and `ANCHOR_API_KEY`.
- The current recruitment form does not capture SMS consent or future-recruitment/talent-pool consent separately.

---

## 2. Goal

Add a **Recruitment** section to The Anchor Management Tools: an applicant-tracking system covering job postings, candidates, applications, CV/details storage, AI extraction/scoring/drafting, manager-reviewed communications, interview/trial scheduling, SMS reminders, printable interview/trial briefs, and hire handoff into the existing employee onboarding flow.

The management app is the system of record. The public website is an intake client.

### Goals

- One system of record for candidates, CVs/details, applications, appointments, decisions, and communications.
- Public `/join-our-team` submissions create applications in the management database whenever the management API is reachable.
- CV remains optional: candidates can upload a CV or provide free-text details.
- AI assists extraction, scoring, and email drafting, but never makes final reject/advance decisions.
- Candidate PII remains firewalled from `customers`, marketing lists, and customer SMS flows.
- Non-hired candidates are anonymised after a configurable retention window; hired candidates are retained through employee records.
- Hire handoff creates the invited employee through the existing onboarding flow and copies only safe, relevant recruitment data.

### Non-goals for v1

- Automated inbound mailbox ingestion.
- OCR for scanned/image-only CVs.
- Rota integration for trial shifts.
- Candidate reply ingestion or two-way recruitment inbox parsing.
- Multi-venue or multi-brand recruitment.
- Fully automated rejection, advancement, or hiring decisions.

---

## 3. Phase 0 Acceptance Gates

Phase 0 must be completed before Phase 1 schema/UI work starts.

1. **Naming decision:** Use the new `recruitment_*` module/table prefix. Do not reuse `hiring_*`.
2. **Legacy cleanup migration:** Remove or migrate stale `hiring` permissions, stale `hiring_*` system settings, stale docs references that describe removed tables, and the old `hiring-docs` bucket decision. Do not delete storage objects blindly; first check whether the bucket contains files.
3. **RBAC contract:** Add `recruitment` to `ModuleName`; use existing actions only: `view`, `create`, `edit`, `manage`, `send`, `delete`. Do not add a custom `interview` action unless the whole RBAC type/migration/UI stack is deliberately updated.
4. **Rate limiting:** Add a distributed limiter for public recruitment POSTs, preferably Upstash, before allowing public CV uploads. The current in-memory limiter is acceptable only for local development.
5. **Email identity:** Ensure Graph email supports `replyTo` and verify SPF/DKIM/DMARC for `orangejelly.co.uk`.
6. **Graph calendar spike:** Confirm the Microsoft Graph app can create events from `peter@orangejelly.co.uk` and invite `manager@the-anchor.pub` across domains. If blocked, implement `.ics` attachment fallback first.
7. **Storage decision:** Create `recruitment-cvs` as a new private bucket and retire `hiring-docs` after it is confirmed empty or migrated.
8. **Employee handoff prerequisites:** Seed a `CV` attachment category; confirm exact right-to-work document type mapping.
9. **Website consent copy:** Add SMS consent and future-recruitment/talent-pool consent before public dynamic intake goes live.

---

## 4. Domain Model

All new tables use `recruitment_*` prefixes to avoid generic names such as `candidates` and `applications`. All tables have `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, RLS enabled, and explicit check constraints for enum-like text columns.

### 4.1 `recruitment_job_postings`

Purpose: public/internal vacancy definition.

Columns:

- `title text not null`
- `slug text not null unique`
- `role_type text not null check in ('bar','kitchen','either','management','other')`
- `description text not null`
- `requirements text not null`
- `ai_scoring_notes text null`
- `employment_type text not null check in ('full_time','part_time','casual')`
- `positions_available integer not null default 1 check > 0`
- `status text not null check in ('draft','open','closed','archived')`
- `is_public boolean not null default false`
- `version integer not null default 1`
- `opened_at timestamptz null`
- `closed_at timestamptz null`
- `created_by uuid null references users(user_id)`

Rules:

- Public GET returns only `status='open' and is_public=true`.
- Editing `requirements` or `ai_scoring_notes` increments `version`.
- Closing a posting blocks new applications but does not automatically reject in-flight applications.

### 4.2 `recruitment_candidates`

Purpose: person-level recruitment record.

Columns:

- `first_name text null`
- `last_name text null`
- `email text null`
- `email_normalized text generated always as (lower(email)) stored`
- `phone text null`
- `phone_e164 text null`
- `location text null`
- `source text not null check in ('website','manual_upload','referral','job_board','other')`
- `cv_file_path text null`
- `cv_file_name text null`
- `cv_mime_type text null`
- `cv_file_size_bytes integer null`
- `cv_text text null`
- `cv_extraction_status text not null default 'no_cv' check in ('pending','done','failed','unsupported','no_cv')`
- `provided_details text null`
- `extracted_data jsonb null`
- `cv_summary text null`
- `right_to_work_status text not null default 'not_checked' check in ('not_checked','pending','verified','failed')`
- `right_to_work_document_type text null check in ('Passport','Biometric Residence Permit','Share Code','Other','List A','List B')`
- `right_to_work_checked_at timestamptz null`
- `right_to_work_checked_by uuid null references users(user_id)`
- `consent_source text null`
- `consent_at timestamptz null`
- `privacy_notice_version text null`
- `sms_consent boolean not null default false`
- `sms_consent_at timestamptz null`
- `future_recruitment_consent boolean not null default false`
- `future_recruitment_consent_at timestamptz null`
- `retention_until date null`
- `anonymised_at timestamptz null`
- `converted_employee_id uuid null references employees(employee_id)`
- `notes text null`
- `created_by uuid null references users(user_id)`

Indexes and constraints:

- Active candidates require `email` unless anonymised.
- Unique partial index on `email_normalized` where `email is not null and anonymised_at is null`.
- Optional fuzzy duplicate detection on name plus phone; never silently merge fuzzy matches.

### 4.3 `recruitment_applications`

Purpose: candidate application to a posting, or a general talent-pool application.

Columns:

- `candidate_id uuid not null references recruitment_candidates(id)`
- `job_posting_id uuid null references recruitment_job_postings(id)`
- `is_general boolean generated always as (job_posting_id is null) stored`
- `status text not null`
- `source text not null check in ('website','manual_upload','referral','job_board','other')`
- `availability jsonb null`
- `cover_note text null`
- `relevant_experience_answer text null`
- `travel_answer text null`
- `start_availability text null`
- `latest_ai_run_id uuid null`
- `ai_score integer null check between 0 and 100`
- `ai_recommendation text null check in ('reject','review','fast_track')`
- `ai_rationale text null`
- `ai_strengths jsonb null`
- `ai_concerns jsonb null`
- `ai_flags jsonb null`
- `ai_model text null`
- `ai_scored_at timestamptz null`
- `ai_scored_against_version integer null`
- `rejected_at timestamptz null`
- `rejection_reason text null`
- `duplicate_of_application_id uuid null references recruitment_applications(id)`
- `created_by uuid null references users(user_id)`

Status values:

- Main path: `new`, `ai_screened`, `shortlisted`, `interview_invited`, `interview_scheduled`, `interviewed`, `trial_offered`, `trial_scheduled`, `trial_completed`, `offered`, `hired`
- Side/terminal states: `talent_pool`, `rejected`, `withdrawn`, `on_hold`, `declined_duplicate`

Rules:

- General applications (`job_posting_id is null`) start as `talent_pool` and are not scored.
- Re-applicant guard: if the same candidate has a prior `rejected` or `declined_duplicate` application for the same posting, create a new row with `status='declined_duplicate'`, set `duplicate_of_application_id`, and do not score.
- Different posting from the same candidate is a normal new application with prior history visible.
- Status updates and status-event inserts must be transactional through one service/RPC.
- Do not hard-block duplicate same-posting submissions at the database level if the business rule needs a visible `declined_duplicate` row.

### 4.4 `recruitment_application_status_events`

Purpose: append-only application timeline.

Columns:

- `application_id uuid not null references recruitment_applications(id)`
- `from_status text null`
- `to_status text not null`
- `changed_by uuid null references users(user_id)`
- `note text null`
- `metadata jsonb null`

Rules:

- Inserted by the status transition service/RPC only.
- No updates or deletes except service-role maintenance.

### 4.5 `recruitment_ai_runs`

Purpose: audit trail for extraction, scoring, and drafting. This avoids overwriting old scores/prompts and supports fairness review.

Columns:

- `operation text not null check in ('cv_extraction','application_scoring','email_draft')`
- `candidate_id uuid null references recruitment_candidates(id)`
- `application_id uuid null references recruitment_applications(id)`
- `job_posting_id uuid null references recruitment_job_postings(id)`
- `model text not null`
- `prompt_version text not null`
- `input_hash text not null`
- `status text not null check in ('pending','success','failed','skipped')`
- `score integer null check between 0 and 100`
- `recommendation text null`
- `structured_output jsonb null`
- `raw_response jsonb null`
- `error_message text null`
- `prompt_tokens integer null`
- `completion_tokens integer null`
- `total_tokens integer null`
- `cost numeric(12,6) null`
- `completed_at timestamptz null`

Rules:

- Also record cost in `ai_usage_events` with context like `recruitment:application_scoring:<application_id>`.
- `recruitment_applications.latest_ai_run_id` points to the current displayed scoring run.
- Re-screening creates a new run, never overwrites the run history.

### 4.6 `recruitment_appointment_slots`

Purpose: manager-defined availability for interviews and trial shifts.

Columns:

- `type text not null check in ('interview','trial_shift')`
- `starts_at timestamptz not null`
- `ends_at timestamptz not null`
- `timezone text not null default 'Europe/London'`
- `location text not null default 'The Anchor'`
- `interviewer_user_id uuid null references users(user_id)`
- `supervisor_staff_id uuid null references employees(employee_id)`
- `status text not null default 'open' check in ('open','booked','cancelled')`
- `capacity integer not null default 1 check (capacity = 1)`
- `created_by uuid null references users(user_id)`

Rules:

- v1 is single-capacity only. The `capacity` column is retained only for future compatibility and constrained to 1.
- Store timestamps in UTC as `timestamptz`; display in Europe/London.
- Past slots cannot be created.
- Trial supervisors must be active employees if set.

### 4.7 `recruitment_candidate_appointments`

Purpose: a booked interview or trial shift.

Columns:

- `application_id uuid not null references recruitment_applications(id)`
- `candidate_id uuid not null references recruitment_candidates(id)`
- `slot_id uuid null references recruitment_appointment_slots(id)`
- `type text not null check in ('interview','trial_shift')`
- `scheduled_start timestamptz not null`
- `scheduled_end timestamptz not null`
- `timezone text not null default 'Europe/London'`
- `location text not null`
- `supervisor_staff_id uuid null references employees(employee_id)`
- `status text not null check in ('scheduled','completed','no_show','cancelled','rescheduled')`
- `calendar_event_id text null`
- `calendar_sync_status text not null default 'pending' check in ('pending','synced','failed','ics_fallback')`
- `booking_token_hash text null`
- `token_expires_at timestamptz null`
- `reschedule_count integer not null default 0 check >= 0`
- `reminder_email_sent_at timestamptz null`
- `reminder_sms_sent_at timestamptz null`
- `outcome text null`
- `outcome_rating integer null check between 1 and 5`
- `meal_provided boolean not null default false`
- `outcome_recorded_at timestamptz null`

Rules:

- Store only a hash of booking tokens, never the raw token.
- Candidate self-reschedule/cancel is allowed once and only before `scheduled_start`.
- After `scheduled_start`, candidate booking pages are read-only; manager controls no-show, reschedule, and cancellation.
- Rescheduling keeps the old row as `rescheduled` and creates a new `scheduled` row, preserving history.

### 4.8 `recruitment_email_templates`

Purpose: editable base templates.

Columns:

- `type text not null check in ('interview_invite','rejection','already_considered','trial_invite','offer','interview_confirmation','trial_confirmation','reminder','manager_alert')`
- `subject text not null`
- `body text not null`
- `is_active boolean not null default true`
- `updated_by uuid null references users(user_id)`

Rules:

- Seed defaults with right-to-work wording where relevant.
- Deterministic merge-field validation blocks sends with unresolved placeholders.

### 4.9 `recruitment_communications`

Purpose: recruitment-specific communication log separate from customer messaging.

Columns:

- `application_id uuid null references recruitment_applications(id)`
- `candidate_id uuid not null references recruitment_candidates(id)`
- `type text not null`
- `channel text not null check in ('email','sms')`
- `subject text null`
- `final_body text not null`
- `was_ai_assisted boolean not null default false`
- `ai_run_id uuid null references recruitment_ai_runs(id)`
- `edited_by uuid null references users(user_id)`
- `sent_by uuid null references users(user_id)`
- `sent_at timestamptz null`
- `delivery_status text not null default 'queued' check in ('queued','sent','failed','bounced','suppressed')`
- `provider text null`
- `provider_message_id text null`
- `idempotency_key text null unique`
- `metadata jsonb null`

Rules:

- Recruitment SMS must log here and must not create/link `customers`.
- Email provider webhooks should update `delivery_status` when provider IDs can be matched; otherwise status remains `sent` or `failed`.

---

## 5. RBAC and RLS

Add `recruitment` to `ModuleName`.

Use existing action types:

- `view`: read recruitment section
- `create`: create postings/candidates/applications/slots
- `edit`: edit postings/candidates/applications/slots and transition statuses
- `manage`: settings, AI re-runs, talent-pool matching, retention tooling
- `send`: candidate emails/SMS and manager alerts
- `delete`: GDPR erasure and destructive cleanup

Default seeding:

- `super_admin`: all recruitment actions
- `manager`: `view`, `create`, `edit`, `manage`, `send`
- `delete`: seed to `super_admin` only unless the owner explicitly wants managers to perform hard erasure

All recruitment tables use RLS with `user_has_permission(auth.uid(), 'recruitment', '<action>')`.

The hire handoff additionally requires `employees/create`.

Public endpoints use admin client plus API-key/Turnstile/rate-limit/idempotency controls. They do not rely on user RBAC.

---

## 6. AI Operations

All AI operations are best-effort. Intake and booking must never fail solely because OpenAI is down.

Use:

- `response_format: json_schema`
- schema validation and normalisation
- retry on transient failure
- token budget and truncation
- cost logging to `ai_usage_events`
- run history in `recruitment_ai_runs`
- model setting `OPENAI_RECRUITMENT_MODEL`, defaulting to the existing OpenAI config fallback (`gpt-4o-mini`)

### 6.1 CV extraction

Trigger: CV upload.

Parsing:

- PDF: use installed `pdf2json` or `pdfjs-dist`; do not reference `pdf-parse` unless the dependency is deliberately added.
- DOCX: use installed `mammoth`.
- DOC: store and flag for manual review unless a safe parser is added.
- Scanned/image-only PDFs: `unsupported`; OCR is future scope.

Output:

```json
{
  "first_name": "string|null",
  "last_name": "string|null",
  "email": "string|null",
  "phone": "string|null",
  "location": "string|null",
  "experience_summary": "string|null",
  "relevant_skills": ["string"],
  "total_years_experience": "number|null",
  "flags": ["string"]
}
```

Rules:

- Prompt must say extract only what is present; never invent.
- Human validates AI-extracted fields before manually-created records are finalised.
- Website submissions can create records immediately, but extracted values must be marked AI-derived and editable.
- Prompt injection in CV text must be treated as untrusted content.

### 6.2 Application scoring

Trigger: application create when `job_posting_id` is not null, and manual re-score.

Input:

- posting title, requirements, AI scoring notes, role type, version
- CV text or provided details
- application availability, travel, relevant experience, start availability

Output:

```json
{
  "score": 0,
  "recommendation": "reject|review|fast_track",
  "rationale": "string",
  "strengths": ["string"],
  "concerns": ["string"],
  "flags": ["string"]
}
```

Rules:

- General/talent-pool applications are not scored until matched to a posting.
- Concerns are internal only and never passed to rejection email drafting.
- Staleness is detected by comparing `ai_scored_against_version` with posting `version`.
- Scoring must avoid protected-characteristic reasoning and must not infer age, nationality, disability, ethnicity, religion, pregnancy, sexuality, or similar protected traits.
- A human must make every decision to reject, shortlist, interview, trial, offer, or hire.

### 6.3 Email drafting

Trigger: manager opens a decision email composer.

Rules:

- Base template plus AI personalisation.
- Deterministic code injects logistics: booking link, exact date/time, venue, right-to-work line, pay/hours, signature.
- Rejections never include `ai_concerns`.
- Pre-send validation blocks unresolved placeholders and invented offer terms.
- Draft edits are preserved if sending fails.

---

## 7. Communications

### Email identity

- Candidate emails send from `peter@orangejelly.co.uk`, branded as The Anchor.
- `replyTo` is `manager@the-anchor.pub`.
- Calendar invites are organised by `peter@orangejelly.co.uk`.
- Manager alerts go to `manager@the-anchor.pub`.

### Email classes

| Class | Types | Sending rule |
|---|---|---|
| Decision | `interview_invite`, `rejection`, `already_considered`, `trial_invite`, `offer` | AI-drafted where useful, manager reviews and sends |
| Transactional | `interview_confirmation`, `trial_confirmation`, `reminder` | Template-first, auto-sent, deterministic fallback |
| Manager alert | `manager_alert` | Template-only email to manager address |

### SMS

Recruitment SMS is transactional only.

Rules:

- Send one SMS reminder 24 hours before each interview/trial.
- Require `sms_consent=true` and a valid phone.
- Do not use a send path that creates or links `customers`.
- Either build `recruitmentSmsService` around Twilio directly, or extend the generic SMS wrapper so it can log to `recruitment_communications` without customer creation.
- Respect SMS opt-out if a candidate replies STOP or the provider reports suppression. Store this on recruitment candidate data, not `customers`.
- If phone is missing/invalid/no consent, skip SMS and rely on email.

---

## 8. Public Website Integration

### GET postings

Endpoint:

- Management: `GET /api/recruitment/postings`
- Website: server-side fetch using `ANCHOR_API_BASE_URL`

Rules:

- Return open public postings only.
- Cache server-side for a short period.
- If management API is unavailable, website falls back to the current static role list and labels it as fallback content internally.
- The public page must always include "No specific role - keep me on file" only if talent-pool intake is enabled and future-recruitment consent copy is present.

### POST application

Endpoint:

- Website route remains `POST /api/enquiry/recruitment`.
- Website forwards to management `POST /api/recruitment/applications`.
- Management endpoint accepts `multipart/form-data`.

Controls:

- Website verifies honeypot/timing/Turnstile.
- Website forwards `X-API-Key` and `Idempotency-Key`.
- Management route applies distributed rate limit before storage or AI work.
- Management route verifies Turnstile only for direct browser/no-API-key requests. API-key website proxy requests may trust website verification, matching the current table-booking pattern.
- File validation is repeated server-side in management.

Fallback:

- Fallback email is allowed only when the management API is unreachable or returns an infrastructure failure before a definitive application response.
- Do not fallback on validation errors.
- Include "manual import needed" and the same idempotency key in the fallback email.
- If the upstream request times out after possible partial creation, fallback email must say "possible duplicate - check management system first".

Website form changes:

- Replace static role select with dynamic postings plus static fallback.
- Keep CV optional.
- Keep details textareas.
- Add separate SMS consent.
- Add separate future-recruitment/talent-pool consent.
- Keep current 5 MB website CV cap; management storage bucket can allow 10 MB for admin uploads.

---

## 9. End-to-End Flows

### 9.1 Website application

1. Website loads public postings from management; falls back to static list if needed.
2. Candidate completes form, uploads CV or provides details, accepts recruitment privacy consent, and optionally accepts SMS/future-recruitment consent.
3. Website route verifies spam controls and forwards multipart form to management with API key and idempotency key.
4. Management validates, stores CV if present, upserts candidate by normalised email, creates application, starts AI extraction/scoring if eligible, and notifies manager.
5. Candidate sees success only after a definitive management success or fallback email success.

### 9.2 Manual upload

Manager creates candidate/application in the management app, uploads CV or enters details, reviews extraction, selects posting or talent pool, and saves. Scoring runs only when attached to a posting.

### 9.3 Re-applicant guard

If a candidate reapplies to the same posting after rejection, create a visible `declined_duplicate` application, do not score, and offer a one-click `already_considered` response.

### 9.4 Reject

Reject flow:

1. If an appointment is scheduled, cancel appointment and Graph event first using an outbox/retry-safe operation.
2. Manager reviews/edits rejection email.
3. Send email.
4. Transactionally set `status='rejected'`, `rejected_at`, timeline event, and `retention_until`.

If email send fails, keep the edited draft and do not mark rejection as communicated unless the manager explicitly chooses a manual-send override.

### 9.5 Interview

Shortlist -> invite email with tokenised booking link -> candidate chooses an open interview slot -> atomic claim -> appointment row -> Graph event or `.ics` fallback -> confirmation email -> status `interview_scheduled` -> manager can print interview kit.

### 9.6 Trial shift

Positive interview -> trial invite states unpaid, complimentary meal, approximate 2 hour length, alongside a team member, and right-to-work requirement -> candidate books or manager direct-schedules -> trial brief -> manager records outcome and meal provided -> offer/hire/reject.

Right-to-work handling:

- Trial shift cannot proceed to active duties unless `right_to_work_status='verified'`.
- If not verified at scheduling time, show warning and require manager acknowledgement.
- Candidate communications must say they must bring passport or proof of right to work.

### 9.7 Offer -> hire -> invited employee

Guard:

- Block if email already belongs to an active employee.
- If an onboarding/former employee exists, surface it for manager decision.

Sequence:

1. Manager confirms accepted offer and has `employees/create`.
2. Call existing `create_employee_invite(email, job_title)` flow.
3. Only after welcome email succeeds and employee remains created, enrich employee name, phone, and intended start.
4. Copy CV from `recruitment-cvs` to `employee-attachments` if CV exists.
5. Insert `employee_attachments` row using seeded `CV` category.
6. Seed `employee_right_to_work` only if candidate RTW is verified and has the required employee RTW fields (`document_type`, `verification_date`, optional reference/details/expiry).
7. If RTW is not fully verified, do not insert a partial employee RTW row; instead surface an onboarding task/warning.
8. Set `converted_employee_id` and `application.status='hired'` transactionally.

---

## 10. Scheduling and Concurrency

- v1 slots are single-capacity.
- Slot claim must be atomic: update `recruitment_appointment_slots set status='booked' where id=:slot_id and status='open'`.
- Candidate booking tokens are high entropy, single purpose, expiry-bound, and stored as hashes.
- Token pages show only data required for booking, not full application/candidate data.
- Candidate can reschedule/cancel once before the appointment time.
- After appointment time, candidate pages are read-only.
- Manager cancellation notifies candidate, cancels Graph event, and can reopen invitation.
- Graph writes should use an outbox or retry-safe service so DB and calendar can reconcile after provider failure.
- Store timestamps in UTC; display Europe/London everywhere.

---

## 11. Security

- Private `recruitment-cvs` bucket.
- External website CV cap: 5 MB. Admin manual upload cap: 10 MB, matching storage.
- Server-side extension allow-list and MIME sniff for PDF/DOC/DOCX.
- Treat uploads as inert; never render raw CV HTML.
- AV scanning is a hardening task, not v1 blocker, but the storage API should be designed so scanning can be inserted later.
- Public POSTs use distributed rate limit, idempotency, API key, spam protection, and Turnstile according to request path.
- Public booking tokens prevent IDOR by using token lookup only, never candidate/application IDs from the URL.
- Sanitize email/template inputs against header injection and stored XSS.
- RLS on every table.
- Service-role use only in API routes, crons, and token booking pages.

---

## 12. Data Protection

- Candidate PII and CVs are a new PII location and must be reflected in privacy notice copy.
- Capture recruitment consent source, timestamp, and privacy notice version.
- Capture SMS consent separately from recruitment contact consent.
- Capture future-recruitment/talent-pool consent separately.
- AI scoring is decision-support only; privacy copy must say applications may be AI-assisted and humans make decisions.
- Candidate PII must not flow into `customers`, marketing lists, or customer SMS tooling.
- Send only necessary text to OpenAI.
- Avoid persisting special-category data extracted from CVs unless strictly necessary.

### Retention

Default:

- Non-hired terminal applications: anonymise 12 months after terminal state.
- Talent-pool candidates: retain only while future-recruitment consent is valid and within the configured retention period.
- Hired candidates: recruitment record is retention-exempt but should minimise duplicate PII once converted to employee.

Implementation:

- Replace stale `hiring_retention_policy` with `recruitment_retention_policy`.
- Default new setting: `{ "action": "anonymize", "retention_months": 12 }`.
- Retention cron deletes CV file, nulls direct PII, clears phone/email/name/location/free-text notes where needed, sets `anonymised_at`, and preserves aggregate/audit-safe application data.

### Erasure

Right to erasure is not the same as normal retention.

- Cancel active appointments first.
- Delete CV object.
- Remove or anonymise candidate PII.
- Keep a non-PII audit tombstone proving erasure happened.
- Do not leave provider message bodies with PII if hard erasure is requested and legally required.

---

## 13. Infrastructure and Config

Supabase:

- Create 9 tables: `recruitment_job_postings`, `recruitment_candidates`, `recruitment_applications`, `recruitment_application_status_events`, `recruitment_ai_runs`, `recruitment_appointment_slots`, `recruitment_candidate_appointments`, `recruitment_email_templates`, `recruitment_communications`.
- Create private `recruitment-cvs` bucket.
- Seed `CV` attachment category.
- Seed `recruitment` permissions.
- Remove/migrate old `hiring` permissions and settings.

Dependencies:

- Add `@upstash/ratelimit` and required Upstash env if distributed limiting is implemented with Upstash.
- Use installed `pdf2json`/`pdfjs-dist` and `mammoth`; do not reference `pdf-parse` unless added.

Environment:

- `RECRUITMENT_NOTIFICATION_EMAIL`, default `manager@the-anchor.pub`
- `RECRUITMENT_FROM_EMAIL`, default `peter@orangejelly.co.uk`
- `RECRUITMENT_RETENTION_MONTHS`, default `12`
- `OPENAI_RECRUITMENT_MODEL`, default fallback `gpt-4o-mini`
- `RECRUITMENT_CV_MAX_BYTES_PUBLIC`, default `5242880`
- `RECRUITMENT_CV_MAX_BYTES_ADMIN`, default `10485760`

Crons:

- Reminder sweep for email and 24h SMS.
- Retention anonymisation sweep.
- Optional calendar reconciliation sweep for `calendar_sync_status='failed'`.

---

## 14. Phased Roadmap

| Phase | Scope | Complexity | Deployable result |
|---|---|---:|---|
| 0 - Cleanup and prerequisites | Legacy `hiring` cleanup, RBAC decision, Graph replyTo/calendar spike, distributed limiter, storage/category setup decisions | S-M | Implementation is unblocked and old state is not misleading |
| 1 - Foundation | Schema, RLS, types, services, admin CRUD for postings/candidates/applications, nav, manual create, CV/details storage | L | Managers can manage candidates/applications manually |
| 2 - AI | CV text extraction, AI extraction, scoring, `recruitment_ai_runs`, re-score, stale-score badges | M | Applications are triaged with auditable AI support |
| 3 - Website intake | Dynamic postings GET, multipart application POST, website form changes, consent, fallback email, idempotency | M | Public applications persist in management app |
| 4a - Scheduling | Slots, token booking page, atomic claim, reschedule/cancel rules, Graph/ICS, interview kit, trial brief | L | Candidates can self-book interviews/trials |
| 4b - Communications | Email templates, AI drafting, decision send flow, SMS reminder, manager alerts, webhook status where possible | M | Candidate comms are logged and reviewable |
| 5 - Hire handoff | Offer/hire action, employee invite, enrich employee, CV copy, RTW seed/warning, conversion audit | S-M | Accepted candidates enter onboarding safely |
| 6 - Retention operations | Retention/anonymisation cron, erasure tooling, reporting | S-M | GDPR lifecycle is operational |

Each phase must pass lint, typecheck, tests, and build before deployment.

---

## 15. Edge Cases and Failure Modes

### Intake and dedup

- Same person applies to several postings: one candidate, many applications.
- Same email with different name/phone: flag for manual review, do not silently merge.
- Same person with new email: fuzzy duplicate warning only.
- Same posting after rejection: create `declined_duplicate`, do not score.
- Double-submit: idempotency returns existing result.
- No CV but details provided: use details for scoring.
- No CV and no useful details: create manual-review application; do not fail intake.
- General application without future-recruitment consent: reject general/talent-pool submission or require a specific posting.
- Corrupt/password-protected/image-only PDF: mark extraction failed/unsupported, manager review.
- Oversized or dangerous file: reject before storage.
- Management API timeout: fallback email warns possible duplicate.

### AI

- OpenAI down: create application, mark AI run failed, make retry available.
- Malformed JSON: retry; if still invalid, manual review.
- CV prompt injection: CV text is untrusted data; model instructions must ignore candidate-supplied commands.
- Protected characteristics: do not score based on protected traits; flag if CV includes irrelevant protected information.
- Posting edited after scoring: stale score visible until re-score.
- Email draft invents logistics/terms: deterministic merge validation blocks send.

### Scheduling

- Two candidates race for a slot: exactly one atomic update wins.
- Token expired/used/tampered: friendly error, manager can issue a new link.
- Candidate tries after appointment time: read-only, manager only.
- Reschedule more than once: blocked.
- Manager cancels booked slot: candidate notification and Graph cancellation are retried until reconciled.
- Graph create fails: appointment remains booked with `calendar_sync_status='failed'`, retry or `.ics` fallback.
- Trial supervisor missing email: invite candidate and manager only, warn manager.
- Candidate no-shows: manager marks no-show; system does not infer automatically unless a later reminder/reporting task is added.

### Comms

- Double-send decision email: unique idempotency key blocks duplicate.
- Send fails after manager edits: preserve edited body, mark failed, allow retry.
- Provider bounce: update status when webhook can map provider message ID.
- SMS no consent: skip SMS.
- Candidate replies: replies go to manager inbox; not ingested.

### Status/workflow

- Reject/withdraw scheduled candidate: cancel appointment and Graph event first.
- Posting filled/closed with active candidates: block new applications, prompt manager to resolve in-flight applications.
- Hiring beyond `positions_available`: warn but allow manager override.
- Concurrent manager edits: use optimistic concurrency on `updated_at`.

### Hire handoff

- Existing active employee email: block and link existing record.
- Invite welcome email fails: existing `inviteEmployee` rolls back employee; do not copy CV/RTW until invite succeeds.
- CV copy fails after employee invite succeeds: keep employee, log failure, retry copy.
- RTW not verified: do not seed partial `employee_right_to_work`; surface task.
- Candidate already converted: idempotency returns existing employee link.

### GDPR

- Retention cron skips active applications and hired candidates.
- Retention anonymisation does not leave CV files orphaned.
- Erasure cancels future appointments.
- Candidate PII never enters `customers`.

---

## 16. Testing Strategy

Use Vitest and mock all external services.

Service tests:

- Candidate upsert/dedup.
- Re-applicant guard.
- Status transition plus event insert transaction.
- AI run creation and latest-run update.
- Retention eligibility.
- Hire handoff sequencing and idempotency.

API route tests:

- Public postings GET filtering.
- Multipart validation.
- Idempotency replay.
- Distributed rate limit behaviour.
- Turnstile direct request vs API-key website proxy behaviour.
- Fallback email only on infrastructure failure.

AI tests:

- Schema validation and malformed responses.
- Prompt-injection guard fixture.
- Protected-characteristic fixture.
- Token truncation.

Scheduling tests:

- Atomic slot claim race.
- Token hash lookup and expiry.
- Reschedule-once rule.
- Post-time read-only rule.
- Graph failure and `.ics` fallback.

Comms tests:

- `replyTo` on Graph and Resend paths.
- Merge-field validation.
- No `ai_concerns` in rejection drafts.
- SMS consent gating.
- No customer creation/linking for recruitment SMS.

Website tests:

- Dynamic postings success.
- Static fallback.
- Consent fields required.
- CV size/type validation.
- Management success and fallback email paths.

---

## 17. Implementation Notes

- Keep public API response shapes stable and simple; website should not know internal table names.
- Prefer service/RPC methods for operations requiring consistency: status transitions, slot claim, hire handoff, retention anonymisation.
- Avoid adding recruitment data to generic customer comms tables unless it is metadata-only and contains no candidate PII.
- Stale hand-maintained docs/types that reference removed `hiring_*` tables must be updated or clearly marked historical.
- The actual production implementation should be split by roadmap phase; do not attempt the full ATS in one PR.
