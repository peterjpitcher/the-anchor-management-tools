# Jobs, Candidates, and Hiring Workflow

Status: Draft
Owner: TBD
Last updated: 2025-12-30

## Summary
Define the requirements for a job-agnostic hiring workflow inside Anchor Management Tools, including job postings, candidate intake, CV parsing, AI screening, communications, interview scheduling, and retention. This document also records discovery notes about the current build and where updates are needed to align the requirements with the existing architecture.

## Design principle
This functionality must work for any job type. "Bar staff" is only the default template example. The system must support:
- Multiple concurrent job postings (roles, requirements, comms).
- Job-specific prerequisites and screening questions.
- Job-specific scoring rubrics and message templates.
- Reuse via templates (Bartender, Kitchen, Cleaner, Supervisor) with per-job overrides.

## Goals
### What success looks like
Managers can:
- Create job postings in Anchor Management Tools and syndicate them to the website.
- Receive applications from the website and via CV uploads (single and bulk).
- Parse CVs into structured candidate profiles.
- Screen candidates against job-specific requirements and score /10.
- Track candidates through a simple stage pipeline.
- Generate warm, friendly replies (Peter / The Anchor tone), review in UI, and send via Office 365 email integration or copy/paste.
- Schedule interviews using the existing Gmail calendar integration.
- Record outcomes and send constructive feedback (internal notes remain private).
- Re-engage previous applicants for new roles.

## Constraints
- Candidates never log in and cannot edit profiles.
- Candidate-facing form stays minimal and relies on CV parsing.
- Do not capture "date they can start" as a structured field.
- No new email/calendar integrations:
  - Use Office 365 (Microsoft Graph) for sending emails.
  - Use existing Gmail calendar integration for interview invites.
- No bulk messaging to candidates (handle individually).
- AI is decision support only; no fully automated rejection without human involvement.

## Core entities (data model)
### Candidate
- Identity and contact details (primary vs secondary emails).
- Structured profile extracted from CV(s).
- CV upload history with "what changed" diffs over time.
- All applications across all jobs.

### Job Posting
- Job content fields for publishing and syndication.
- Job-specific prerequisites and screening questions.
- Job-specific AI screening rubric and messaging settings.
- Status: draft, open, closed, expired.

### Application
- Candidate applying for a specific job.
- Stage and timestamps.
- Screener answers (from website).
- AI screening results (score /10, eligibility checklist, recommendation, rationale).
- Comms drafts/logs, interview scheduling info, and outcome.

## Job posting management (multi-job support)
### Create/edit/close jobs
- Create from template (recommended) or blank job.
- Edit in draft/open states.
- Close/expire a job to stop being presented as open.

### Job templates
Templates define defaults without code changes:
- Job content structure (sections).
- Prerequisites (essential + scored signals).
- Candidate-facing screener questions.
- AI evaluation prompt/rubric.
- Message templates + mandatory compliance lines.

Example templates:
- Part-time Bartender (Village Pub)
- Kitchen Assistant / KP
- Cleaner
- Supervisor / Duty Manager
- Seasonal role

### Job prerequisites (job-specific)
Each job supports configurable prerequisites:
1) Essential checks (eligibility checklist)
   - Output per item: Yes / No / Unclear.
2) Scored signals
   - Good fit indicators (adds weight).
   - Red flags (subtracts weight).
   - Guiding principles, not absolute gates.

Each prerequisite includes:
- Key (example: commute_time, weekend_availability, bar_experience_years).
- Type (boolean/number/enum/text).
- Essential flag.
- Candidate-facing flag.
- If candidate-facing: question text + answer options.
- Weighting / scoring behavior.

### Job posting fields for JobPosting schema
Store enough structured data to render valid JobPosting markup:
- title
- description (HTML)
- datePosted
- hiringOrganization
- jobLocation
- validThrough

Avoid policy violations:
- No markup on list pages.
- No content mismatch between page and structured data.
- No jobs without a way to apply.

### Jobs to website feed (outbound)
Provide a feed to the website containing:
- Job ID and canonical URL slug.
- Job content fields for page rendering.
- Schema-relevant fields above.
- Status, open/close dates, validThrough.
- Apply URL (website form link).

## Candidate application intake (simple for candidates)
### Website application flow (inbound push API)
- Website sends application payload into Anchor via API.
- Anchor creates/updates candidate and application.
- Anchor runs AI extraction + screening.
- Anchor emails managers a notification with score + recommendation.

### Candidate-facing fields (minimal)
Recommended minimum:
- Full name
- Personal email
- Phone number
- Postcode
- Job-specific screener questions
- CV upload
- Optional note/message

Explicitly do not capture:
- "Date you can start" (do not store or ask).

### Confirm extracted details (confirm-only)
After CV upload, show a short summary of extracted details and ask the candidate to:
- Confirm each section looks correct (section-level confirmation).
- Add a note if anything changed.
- Upload a newer CV if needed.

Candidates cannot edit extracted fields directly.

## CV ingestion and candidate profile building
### Single CV upload (manual)
Managers can:
- Upload a CV.
- Assign it to a specific job (screening runs correctly).
- Tag the source (Indeed / Email / Walk-in / Other).

### Supported formats
- PDF, DOCX, and image formats (scans/photos).
- Use OCR when needed.

### AI CV parsing
Extract and normalize:
- Name
- Personal email + secondary emails (e.g., Indeed relay)
- Phone
- Postcode/location (if available)
- Work history (employer, role, dates)
- Skills/certifications
- Short internal summary (manager-only)

Indeed nuance:
- Prefer a likely personal email as Primary and store Indeed relay as Secondary.

### Duplicate detection and repeat applicants
- Attempt to match existing candidates on new CV/application.
- Auto-link on strong matches (same personal email or phone).
- If uncertain, flag for manager review.
- Track repeat applicants with an audit trail (date, source, optional job).
- Show "Applied X times" and most recent date.
- Maintain profile version history and "what changed" diffs.

### Change detection
- Generate diff summary against previous profile version.
- If no material changes, show "No changes detected."

## Bulk import of historic CVs
### Bulk upload
- Upload multiple files or a ZIP.
- Optionally associate batch with a job.
- If no job chosen, create candidates + "historic import" events.

### Bulk processing behavior
For each CV:
1. Parse/OCR
2. Extract details
3. Match existing candidate or create new
4. Create CV record + profile version + diff
5. If job associated: create application + run screening
6. Record success/failure outcome

### Bulk import reporting
- Processed / created / linked / needs-review / failed counts
- Per-item links to candidate/application
- Fail reasons for troubleshooting

## AI screening, scoring, and recommendations
### Screening must be job-aware
Include:
- Job title + description + context
- Job prerequisites (essential + scored signals)
- Candidate structured profile + CV text
- Website screener answers (if provided)

### Standard output format
1) Eligibility checklist (Yes/No/Unclear + justification)
2) Experience analysis (relevant summary + indicators)
3) Strengths / concerns (bullets; missing info called out)
4) Score and recommendation (Invite / Clarify / Hold / Reject)
5) Draft replies (Invite / Clarify / Reject), warm and Anchor tone

### Job-specific scoring knobs
- Thresholds for recommendation mapping.
- Weighting of signals.
- Non-negotiables as essential requirements.

### Human decision remains mandatory
- Managers can override AI recommendations.
- Overrides are logged (who/when/why).
- No automatic rejection without meaningful human review.

## Candidate communications (review-first)
### Draft generation
- Friendly, warm, appreciative, specific, job-aware.

### Mandatory compliance lines
- Job/template-level configurable lines that must appear in certain messages.

### Sending and channels
- Copy/paste drafts for Indeed/WhatsApp/etc.
- Email: Send button uses existing Office 365 integration.
- Always review in UI before sending. No auto-send.

### Comms log
- Drafts generated
- Sent via Office 365 or "sent externally" manual tick
- Timestamps + user

## Stages, notes, reminders, and dashboard
### Application stages
Default pipeline:
1. Application received
2. Screening complete
3. In conversation
4. Interview scheduled
5. Interview completed
6. Offer made
7. Hired
8. Rejected
9. Withdrawn / no response

### Notes
- Private internal notes at candidate and application levels.
- Notes never visible to candidates.

### Reminder emails (stale stage)
- If an application sits in a stage too long, email manager@the-anchor.pub.
- Thresholds configurable per stage (with defaults).

### New website application notification
Email manager@the-anchor.pub with:
- Candidate name
- Job name
- Score /10 + recommendation
- Key flags (commute, weekends, right to work)
- Link to application

## Interview workflow
### Interview scheduling
- Capture interview date/time and interviewer(s).

### Calendar invite (existing Gmail calendar integration)
- Create calendar event.
- Include candidate name + job title + link to application page.

### Downloadable interview template
- Candidate summary (job-relevant highlights)
- Job context
- Standard questions (template-level)
- Optional job-specific questions
- Space for handwritten notes

### Post-interview outcome + feedback
- Outcome: hired/rejected
- If rejected: structured reason category + optional private note
- Generate supportive feedback email draft (optional to send)
- All post-interview notes and reasons are internal-only

## Re-engagement
When a new job opens:
- Suggest past candidates based on skills, prior outcomes/stages, updated CVs.
- Managers can generate, review, and send outreach (no auto-send).

## GDPR / UK data protection
### Retention
- Default retention target: 2 years.
- Must be configurable.
- Provide deletion/anonymisation tooling for expired records.

### Access controls and audit
- Role-based access to candidate data.
- Audit log for key events (uploads, merges, stage changes, sends, overrides).

### AI transparency and safeguards
- Clear internal visibility of how recommendations were formed.
- Human review and override always available.

## UI requirements (minimum screens)
1) Jobs dashboard
   - Open roles list
   - Counts by stage per job
   - Overdue reminders indicator
   - Quick links to applicants
2) Job detail page
   - Job content + prerequisites + screener questions
   - Applicants list with score/recommendation/stage/repeat indicator
3) Candidate profile
   - Contact details (primary email highlighted)
   - CV upload history + diff summaries
   - All applications across jobs
   - Private notes
4) Application detail
   - Eligibility checklist + score + rationale
   - Stage controls + private notes
   - Draft replies + send/review
   - Interview scheduling + calendar creation
   - Outcome capture + feedback draft
5) Bulk import tool
   - Upload + optional job selection
   - Progress + results report
   - Duplicate review queue

## Default bar staff template (example only)
This is a default template, not a hardcoded assumption.

Context:
- Village pub, community-focused, short shifts, often solo.

Essential requirements:
- Within 15 minutes of TW19 6AQ
- 1+ year bar/pub experience
- 18+
- Long-term intent (not student/temporary)
- Weekend rota availability
- Can provide proof of UK right to work before trial shift

Good fit indicators / red flags:
- As provided (solo working, long tenure, job-hopping, weekday-only, etc.)

Output format + draft replies:
- As provided, using "Peter at The Anchor" tone

---

## Discovery and customization notes (current build)
### Existing building blocks to reuse
- Office 365 email sending is already implemented via Microsoft Graph in `src/lib/email/emailService.ts`.
- Google Calendar integration exists for private bookings and birthdays in `src/lib/google-calendar.ts` and `src/lib/google-calendar-birthdays.ts`.
- Background job queue and processor are in place in `src/lib/unified-job-queue.ts` and `src/app/api/jobs/process/route.ts`.
- OpenAI configuration and usage tracking are centralized in `src/lib/openai/config.ts` and `src/types/database.ts` (AI usage events).
- File uploads and storage patterns exist for employee attachments in `src/services/employees.ts` and `supabase/migrations/20251123120000_squashed.sql`.
- Notes and audit logging patterns exist for employees and system-wide audit logs in `supabase/migrations/20251123120000_squashed.sql` and `src/services/audit.ts`.
- Message templates with per-record overrides exist for events in `src/components/features/events/EventTemplateManager.tsx` and `src/app/(authenticated)/settings/message-templates/MessageTemplatesClient.tsx`.
- Public API patterns (CORS + API key + validation) exist in `src/app/api/table-bookings/route.ts` and `src/lib/api/auth.ts`.
- Schema.org helpers exist for events/menus in `src/lib/api/schema.ts` and can be extended for JobPosting.

### Decisions (confirmed)
- Hiring is a top-level module with `/hiring` as the entry route and a dedicated RBAC module name (`hiring`).
- OCR will use OpenAI vision for image/scanned CVs; PDF text extraction runs first and OCR is only used when text is missing.
- Job templates will live in dedicated tables (for example `job_templates` with JSON config for prerequisites, screeners, rubrics, and message templates) with per-job overrides stored on job records.

### Implementation started (scaffolding only)
The following changes are already in the codebase to unblock implementation:
- Added `hiring` as a top-level RBAC module in `src/types/rbac.ts`.
- Added a "Hiring" navigation item in `src/components/features/shared/AppNavigation.tsx` pointing to `/hiring`.
- Added a permission-gated placeholder page for `/hiring` in `src/app/(authenticated)/hiring/page.tsx`.
- Added a permissions seeding migration for the new module in `supabase/migrations/20251230120000_add_hiring_permissions.sql`.

### Gaps and updates needed to meet the requirements
- No jobs/candidates/applications data model yet. New tables, RLS policies, and TypeScript types are required in `supabase/migrations/*` and `src/types/database.ts`.
- RBAC and navigation scaffolding are required for a new module; ensure role assignments and page-level permission checks stay aligned as screens are added.
- Current Google Calendar sync does not include attendees; interview invites will need event attendees and candidate email handling in `src/lib/google-calendar.ts`.
- No OCR or CV parsing pipeline exists today; add PDF text extraction plus OpenAI vision OCR fallback and PDF page rasterization.
- The "Prospective" employee status exists in UI/services but is not present in the current employees table check constraint in `supabase/migrations/20251123120000_squashed.sql`. Hiring data should not overload employees without addressing this mismatch.
- Existing bulk messaging tools (SMS) are customer-focused in `src/app/(authenticated)/messages/bulk/page.tsx`. Candidate messaging must remain individual per requirement.
- There is no job feed or website application intake endpoint; new API routes and validation schemas are required to match the current public API pattern.
- Job-specific templates, prerequisites, and scoring rubrics do not exist yet; a new template system (or extension of message template patterns) is needed.
- Retention/deletion tooling exists for user data only (`src/app/actions/gdpr.ts`); candidate-specific retention and anonymization flows are needed.

### Customization points to align with current build
- Use the Microsoft Graph sender and Office 365 flow for all outbound emails (`src/lib/email/emailService.ts`).
- Use the unified job queue for CV parsing, screening, and bulk import processing (`src/lib/unified-job-queue.ts`).
- Reuse the existing storage and signed URL pattern for CV files (`src/services/employees.ts`).
- Follow the public API CORS + API key pattern for the website application intake (`src/app/api/table-bookings/route.ts`).
- Extend schema helpers for JobPosting structured data in `src/lib/api/schema.ts`.
- Use the existing OpenAI configuration and usage tracking for OCR and screening (`src/lib/openai/config.ts` and `src/types/database.ts`).
