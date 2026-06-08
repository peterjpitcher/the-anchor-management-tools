# Recruitment ATS v1 Implementation Addendum

Date: 2026-06-07

## Scope

This addendum captures the implemented revised v1 ATS. The management app is the system of record. The public website is an intake client that proxies applications to the management API and falls back to email only when the management API is unavailable, times out, or returns a 5xx infrastructure failure.

Explicit non-goals remain out of scope: OCR, inbound mailbox ingestion, reply ingestion, rota integration, and automated reject/advance/hire decisions.

## Implemented Surfaces

- `recruitment` RBAC module with existing actions only.
- Private `recruitment-cvs` bucket and `CV` employee attachment category.
- `recruitment_*` schema for postings, candidates, applications, status events, AI runs, appointment slots, appointments, templates, and communications.
- Dashboard-first admin UI at `/recruitment`.
- Public management APIs:
  - `GET /api/recruitment/postings`
  - `POST /api/recruitment/applications`
  - `/api/recruitment/booking/[token]`
  - `/api/recruitment/booking/[token]/cancel`
  - `/api/recruitment/booking/[token]/reschedule`
- Cron routes:
  - `/api/cron/recruitment-reminders`
  - `/api/cron/recruitment-calendar-retry`
  - `/api/cron/recruitment-retention`
- Website `/api/enquiry/recruitment` proxy with validation-preserving fallback email.

## Edge-Case Decisions

- Same-candidate same-posting reapplications create a new application with `declined_duplicate` and point at the prior application.
- Initial appointment booking tokens are single-use. The same token can manage the already-booked appointment for cancel/reschedule.
- Candidate reschedule is allowed once and only before appointment start.
- Public CVs are capped at 5 MB; admin/manual CVs at 10 MB.
- DOC CVs are stored but marked unsupported for manual review.
- General/talent-pool applications are not scored until attached to a posting.
- Rejection AI drafting does not receive `ai_concerns`.
- Email sends are blocked when merge placeholders remain unresolved.
- Recruitment SMS uses Twilio with customer creation disabled and logs only to `recruitment_communications`.
- Graph calendar failures mark rows `ics_fallback`; confirmation emails include an ICS attachment so the candidate still receives calendar details.
- Hard candidate erasure requires the current user to hold `super_admin`, not only a generic delete permission.

## Required Environment

Management app:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `RECRUITMENT_NOTIFICATION_EMAIL=manager@the-anchor.pub`
- `RECRUITMENT_FROM_EMAIL=peter@orangejelly.co.uk`
- `RECRUITMENT_RETENTION_MONTHS=12`
- `OPENAI_RECRUITMENT_MODEL=gpt-4o-mini`
- `RECRUITMENT_CV_MAX_BYTES_PUBLIC=5242880`
- `RECRUITMENT_CV_MAX_BYTES_ADMIN=10485760`

Website:

- `RECRUITMENT_MANAGEMENT_API_BASE_URL`
- `RECRUITMENT_MANAGEMENT_API_KEY`

## Verification Targets

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`

Run the management app verification first, then the website verification for the updated intake route/page.
