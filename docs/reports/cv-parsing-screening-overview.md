# CV Parsing and Screening - End to End Overview

This document explains exactly how CV parsing and AI screening work today, end to end, with references to the code paths and data written. It is intended for an external consultant who cannot access the repository. The goal is to provide full context for review and recommendations.

## 1) High-Level Architecture

There are two main AI flows:

1. CV parsing (extract structured candidate data + resume text)
2. AI screening (evaluate candidate against a job rubric and produce score + recommendation)

Key components:

- Upload APIs and storage (Supabase storage bucket `hiring-docs`)
- Job queue that runs `parse_cv` and `screen_application`
- Parsing pipeline (PDF/DOCX/Image handling + OpenAI extraction)
- Screening pipeline (chunked evidence extraction + deterministic scoring)
- UI surfaces results and diagnostics

Primary runtime entry points:

- Upload endpoints: `src/app/api/hiring/resumes/route.ts`, `src/app/api/hiring/resumes/presign/route.ts`
- Application submission: `src/lib/hiring/service.ts` (submitApplication)
- Job queue handler: `src/lib/unified-job-queue.ts`
- CV parsing logic: `src/lib/hiring/parsing.ts`
- Screening logic: `src/lib/hiring/screening.ts`
- Scoring logic: `src/lib/hiring/scoring-logic.ts`

## 2) Data Model and Storage

Supabase tables involved (key columns only):

- `hiring_candidates`
  - `resume_url`, `resume_text`, `parsed_data`, `parsing_status`, `parsing_error`
  - `first_name`, `last_name`, `email`, `secondary_emails`, `phone`, `location`
  - `current_profile_version_id`
- `hiring_candidate_documents`
  - `storage_path`, `file_name`, `mime_type`, `file_size_bytes`
- `hiring_candidate_profile_versions`
  - `parsed_data`, `diff_summary`, `diff_data`, `version_number`
- `hiring_candidate_events`
  - events like `application_submitted`, `cv_parsed`, `cv_parsing_failed`
- `hiring_applications`
  - `ai_score`, `ai_recommendation`, `ai_score_raw`, `ai_recommendation_raw`
  - `ai_confidence`, `ai_screening_result`
  - `screening_status`, `screening_error`, `latest_screening_run_id`
- `hiring_screening_runs`
  - run history, snapshots, raw and calibrated outcomes
- `ai_usage_events`
  - usage and cost tracking for model calls

Types and schema references:

- `src/types/database.ts`

## 3) CV Upload Flow

### A) Upload via API (server handled)

Endpoint:

- `POST /api/hiring/resumes`
  - Code: `src/app/api/hiring/resumes/route.ts`

Flow:

1. Receive `multipart/form-data` with a `file` field.
2. Validate file size and type (`MAX_FILE_SIZE`, `ALLOWED_FILE_TYPES`).
3. Upload into Supabase storage bucket `hiring-docs`, in `resumes/` prefix.
4. Return storage path + public URL + metadata.

### B) Upload via presigned URL (client handled)

Endpoint:

- `POST /api/hiring/resumes/presign`
  - Code: `src/app/api/hiring/resumes/presign/route.ts`

Flow:

1. Client requests signed upload URL with file name/size/type.
2. Server validates file type and size.
3. Server returns `signedUrl`, `token`, `storagePath`, `resumeUrl`.

### C) Candidate + application creation

Entry point:

- `submitApplication` in `src/lib/hiring/service.ts`

Flow:

1. Normalize and match candidate by email/secondary email/phone.
2. Create or update `hiring_candidates`.
3. Insert a row in `hiring_candidate_documents`.
4. Insert `hiring_applications` (if jobId provided).
5. Enqueue `parse_cv` job.

## 4) CV Parsing Pipeline (parse_cv job)

Handler:

- `parse_cv` in `src/lib/unified-job-queue.ts`

Core parser:

- `parseResumeWithUsage` in `src/lib/hiring/parsing.ts`

### Step 1: Download the resume

Inputs:

- `storagePath` (preferred) or `resumeUrl` (fallback)

Logic:

- If storage path exists, download from Supabase storage.
- Else if URL provided, fetch from HTTP.
- Infer MIME type from file name or response headers.

### Step 2: Extract raw text (and/or images)

Supported formats:

- PDF (`application/pdf`)
  - Text extraction per page via `pdfjs-dist`.
  - Per-page quality scoring (line length, short lines, weird chars, repeat headers/footers).
  - OCR fallback is selective: always page 1 + low-quality pages (threshold controlled by `OPENAI_HIRING_PARSER_OCR_QUALITY_THRESHOLD`).
  - Optional OCR page cap via `OPENAI_HIRING_PARSER_VISION_MAX_PAGES` (0 = no limit).
  - OCR uses `@napi-rs/canvas` + OpenAI vision per page.
- DOC/DOCX (`application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
  - Text extraction via `mammoth`.
- Images (`image/*`)
  - Direct OCR using OpenAI vision per image.
- Text files (`text/*`)
  - Read as UTF-8.

Extraction sources recorded in result:

- `text`, `vision`, `image`, or `manual`

### Step 2b: Deterministic facts (language + postcode)

After raw text extraction, a deterministic facts pass runs in `src/lib/hiring/fact-extraction.ts`:

- Language detection using `franc` plus simple English stopword/ascii checks.
- UK postcode extraction with regex and normalization.
- Distance to anchor postcode (default `TW19 6AQ`) via `postcodes.io` lookup.
- Commute status derived from distance thresholds (`HIRING_COMMUTE_MAX_MILES`, `HIRING_COMMUTE_REJECT_MILES`).

These facts are merged into `parsed_data` alongside AI-extracted fields.

### Step 3: Chunking (no truncation)

We do not cut off resume content.

- Text is split into chunks (`splitTextIntoChunks`) with a default target size (8000 chars).
- Each chunk is parsed independently; results are merged.

Chunking helper:

- `src/lib/hiring/chunking.ts`

### Step 4: Structured data extraction

For multi-chunk resumes:

- Each chunk is parsed by OpenAI with a "partial extraction" prompt.
- Output fields include: name, email, phone, location, skills, experience, education.
- After all chunks, results are merged:
  - Select most common name.
  - Choose best primary email, keep others as secondary.
  - Merge skills/education sets.
  - Merge experience entries with de-duplication.

Then a final summary is generated in a separate call:

- 2-3 sentences focused on hospitality experience only.
- If none, output: "No explicit hospitality experience listed."

For single-chunk resumes:

- One OpenAI extraction call for full structured output.

### Step 5: Normalize and persist candidate data

After parsing:

- Normalize emails (lowercase, primary vs secondary).
- Populate candidate fields if placeholders are present.
- Save:
  - `parsed_data` (structured + deterministic facts)
  - `resume_text` (full text)
  - `parsed_data.resume_text_pages` (page-aware text with OCR source: pdf_text, vision_ocr, docx, image, manual)
  - `parsed_data.resume_text_meta` (quality scores + OCR pages)
  - `parsing_status` -> `success`
  - `parsing_error` -> null

Create profile version:

- Compare with prior `hiring_candidate_profile_versions`.
- Store `diff_summary` and `diff_data`.

Log events:

- `hiring_candidate_events` with `event_type = cv_parsed`.
- `ai_usage_events` for OpenAI usage and cost.

### Step 6: Failure handling

If parsing fails:

- Set `parsing_status = failed`
- Record `parsing_error`, clear `resume_text`
- Save failure event `cv_parsing_failed`
- Still enqueue screening if there is an application

Manual recovery:

- `retryCandidateParsing` (re-queues parse_cv)
- `submitManualResumeText` (human pastes text and re-parses)

Code:

- `src/actions/hiring-retry.ts`

## 5) Screening Pipeline (screen_application job)

Handler:

- `screen_application` in `src/lib/unified-job-queue.ts`

Core logic:

- `screenApplicationWithAI` in `src/lib/hiring/screening.ts`

### Step 1: Load application context

Load:

- `hiring_applications` + candidate + job + template
- Screener answers from the application

### Step 2: Build rubric

From job and template:

- `prerequisites` become essential items, weight 2
- `screening_rubric` items are weight 1
- Both fields can be JSON or plain text (one item per line); strings are parsed into items.
- Thresholds come from `screening_rubric.score_thresholds` or defaults:
  - invite: 8
  - clarify: 6

Code:

- `buildRubricConfig` in `src/lib/hiring/scoring-logic.ts`

### Step 3: Evidence extraction per resume chunk

We do not pass the full resume to a single model call.

Process:

1. Split resume text into chunks (page-aware if `resume_text_pages` exists).
   - Chunk size controlled by `OPENAI_HIRING_SCREENING_CHUNK_CHARS`.
2. For each chunk, call OpenAI with rubric + answers.
3. Each chunk returns evidence for items:
   - status: yes/no/unclear/not_stated/contradictory
   - evidence_quotes: 1-3 verbatim quotes
   - evidence_source: resume_chunk or application_answer
   - confidence (0-1)
4. Quotes are verified in code against the chunk text or answers.
   - If a quote is not found, evidence is downgraded to not_stated.
5. Merge evidence by rubric item:
   - prefer yes/no over unclear/not_stated, and handle contradictions.

Result:

- A consolidated evidence list, one entry per rubric item, with page refs when available.

Deterministic evidence is injected for:

- Language (is the CV in English)
- Commute distance (postcode -> miles to TW19 6AQ)

This uses `parsed_data` signals from `fact-extraction.ts` to keep decisions grounded.

### Step 4: Narrative generation (separate call)

Using only:

- Job details
- Rubric
- Consolidated evidence checklist
- Parsed candidate profile
- Screener answers

Outputs:

- Rationale
- Strengths
- Concerns
- Experience analysis
- Draft replies
- Raw model score and recommendation (if provided)

### Step 5: Deterministic scoring and recommendation

Scoring formula:

- Base score: (yes + 0.5 * unclear) / total * 10
- Penalty: (no / total) * 1.5
- Final score: base - penalty, rounded to 0..10

Recommendation mapping:

- invite >= invite threshold
- clarify >= clarify threshold
- hold >= clarify - 1
- reject >= clarify - 2

Overrides:

- If any essential item is "no": recommendation is reject.
- If essentials are missing/unclear: invite is downgraded to clarify.
- If recommendation is reject/hold without a hard "no": downgrade to clarify.
- If confidence < 0.5: invite/reject become clarify.
- If resume text missing: invite becomes clarify.

Diagnostics captured:

- thresholds used
- base score + penalty
- evidence counts (yes/no/unclear/not_stated/contradictory)
- whether essential failed and how many essentials are missing
- override reasons
- raw model score + recommendation (when provided)

Code:

- `computeDeterministicScore` in `src/lib/hiring/scoring-logic.ts`

### Step 6: Persist screening results

Stored in:

- `hiring_applications`:
  - `ai_score`, `ai_recommendation`
  - `ai_score_raw`, `ai_recommendation_raw`
  - `ai_confidence`, `ai_screening_result`
- `hiring_screening_runs`:
  - snapshots + raw outputs

`ai_screening_result` includes:

- evidence list
- rationale, strengths, concerns
- confidence
- diagnostics
- prompt version

### Step 7: UI surfacing

Screening panel shows:

- score, recommendation, confidence
- evidence checklist
- narrative (rationale + experience analysis)
- diagnostics:
  - thresholds
  - base vs final score
  - evidence counts
  - override reasons
  - raw model score/recommendation

Code:

- `src/components/features/hiring/ApplicationScreeningPanel.tsx`

## 6) Environment Variables and Model Config

Parsing:

- `OPENAI_HIRING_PARSER_MODEL`
- `OPENAI_HIRING_PARSER_VISION_MODEL`
- `OPENAI_HIRING_PARSER_VISION_MAX_PAGES` (0 means all pages)
- `OPENAI_HIRING_PARSER_VISION_MAX_TOKENS`
- `OPENAI_HIRING_PARSER_OCR_QUALITY_THRESHOLD` (0-1, lower = more OCR)
- `HIRING_ANCHOR_POSTCODE` (default TW19 6AQ)
- `HIRING_COMMUTE_MAX_MILES`
- `HIRING_COMMUTE_REJECT_MILES`

Screening:

- `OPENAI_HIRING_MODEL`
- `OPENAI_HIRING_SCREENING_EVIDENCE_MODEL`
- `OPENAI_HIRING_SCREENING_NARRATIVE_MODEL`
- `OPENAI_HIRING_SCREENING_CHUNK_CHARS`
- `OPENAI_HIRING_SCREENING_EVIDENCE_MAX_TOKENS`
- `OPENAI_HIRING_SCREENING_NARRATIVE_MAX_TOKENS`

OpenAI config:

- `src/lib/openai/config.ts`

## 7) Known Constraints and Risks (current behavior)

- Resume text is now full-length, but large inputs increase model cost.
- Evidence extraction is chunked; narrative is based on evidence, not raw text.
- Missing or poor parsing still allows screening to proceed.
- Thresholds and essential items come from job/template configuration; misconfiguration leads to surprising recommendations.
- The model provides "raw" recommendations; calibrated results are deterministic and may differ.
- OCR quality depends on PDF rendering and model performance.

## 8) Files and Entry Points (for review)

Parsing:

- `src/lib/hiring/parsing.ts`
- `src/lib/hiring/chunking.ts`
- `src/lib/hiring/fact-extraction.ts`

Screening:

- `src/lib/hiring/screening.ts`
- `src/lib/hiring/scoring-logic.ts`
- `src/lib/hiring/data-quality.ts`

Job queue:

- `src/lib/unified-job-queue.ts`

Upload + application flow:

- `src/app/api/hiring/resumes/route.ts`
- `src/app/api/hiring/resumes/presign/route.ts`
- `src/app/api/hiring/applications/route.ts`
- `src/lib/hiring/service.ts`
- `src/app/api/hiring/applications/[applicationId]/confirm/route.ts`
- `src/app/api/hiring/applications/[applicationId]/summary/route.ts`

Manual parsing actions:

- `src/actions/hiring-retry.ts`

UI:

- `src/components/features/hiring/ApplicationScreeningPanel.tsx`

## 9) Open Questions for Consultant

These are the areas we want an expert recommendation on:

1. Best-in-class resume parsing for hospitality hiring (layout, OCR, structure).
2. Optimal evidence extraction design (chunking strategy, merge strategy).
3. How to ensure model recommendations align with calibrated score and risk.
4. How to measure accuracy and reduce false negatives.
5. What additional signals should be used (and what should be excluded).
6. How to handle uncertainty and "clarify" outcomes.
7. How to validate fairness and reduce bias.
8. Suggestions for tests, evaluation datasets, and ongoing monitoring.
