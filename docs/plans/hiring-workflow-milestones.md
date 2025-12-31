# Hiring Workflow Implementation Plan

Status: Draft  
Owner: TBD  
Last updated: 2025-12-30

## Purpose
Prioritized implementation checklist derived from `docs/plans/hiring-workflow.md`.

## Milestones
### M0 — Data Model & Access (blocking)
- [x] Extend schema: candidate profile history, secondary emails, repeat applicant tracking.
- [x] Add application outcomes, interviewers/attendees, comms logs, override logs.
- [x] Formalize job template JSON structure (prereqs, screeners, rubrics, message templates).
- [x] Tighten RLS policies to permission-aware rules (not broad authenticated).
- [x] Update `src/types/database.ts` for new tables/fields.
- [x] Confirm CV storage bucket/policies (`hiring-docs` or reuse existing).
- [x] Reconcile employee status constraint vs prospective hiring flow.

### M1 — Intake + CV Ingestion
- [x] Public intake API supports file upload/presigned upload + returns `resumeUrl`.
- [x] Candidate confirm-only summary flow after CV upload.
- [x] PDF text extraction + OCR fallback for images/scans.
- [x] Rasterize PDFs for OCR when needed.
- [x] Update candidate fields from parsed CV (not only `parsed_data`).
- [x] Dedup heuristics + "needs review" queue for uncertain matches.
- [x] Bulk import ZIP/multi-file support with per-item reporting + review queue.
- [x] `parse_cv` job supports storage paths (not HTTP-only).

### M2 — AI Screening + Notifications
- [x] Job-aware screening prompt from template + job overrides.
- [x] Store eligibility checklist, score /10, recommendation, rationale per application.
- [x] Manager notification email on new application (score + key flags).
- [x] Log AI usage events using existing tracking.

### M3 — Communications
- [x] Draft invite/clarify/reject replies with compliance lines.
- [x] Review/edit/send UI + comms log.
- [x] Send via Office 365 (Microsoft Graph).
- [x] Support "sent externally" manual logging (no bulk send).

### M4 — Interview Workflow
- [x] Calendar invite with attendee (candidate email) + interviewer(s).
- [x] Persist interview time/location/attendees on application.
- [x] Downloadable interview template (summary/questions/notes).
- [x] Post-interview outcome + feedback draft (internal notes remain private).

### M5 — Retention, GDPR, Audit, Re-engagement
- [x] Retention config + anonymization/deletion tooling for hiring records.
- [x] Audit log for uploads, merges, stage changes, overrides, sends.
- [x] Re-engagement suggestions + outreach drafts for past candidates.

### M6 — UI Completion + QA
- [x] Jobs dashboard stage counts + overdue indicators.
- [x] Job detail: prerequisites/screeners/rubrics + applicant scores.
- [x] Candidate profile: contact, CV history + diffs, all applications.
- [x] Application detail: screening results, comms, interview, outcome.
- [x] Bulk import UI with progress + duplicate review queue.
