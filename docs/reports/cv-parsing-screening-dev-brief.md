# Developer Brief - Reliable, Low-Risk CV Parsing + Screening

Goal: make CV parsing and AI screening reliable, low-risk, and "common-sense" while keeping auditability and fast review (3-5 minutes per candidate).

## Background (current behavior)

There are two flows:

1) parse_cv -> extracts resume_text + structured parsed_data
2) screen_application -> chunk-based evidence extraction -> deterministic score + recommendation

Reported issue: inconsistent screening quality, especially false negatives caused by brittle chunking/merging and overly binary evidence decisions.

Concrete example (Sammie):

- CV text includes:
  - "Assistant Manager | No1 Kitchen | Sept 2021-Present"
  - "Previous roles worked within the company include: potwash, waiter, Bartender and Bar-supervisor"
  - "Since July 2023 - Present I have worked full time as the assistant manager."

System outcome: "Experienced bartender" = NO -> rejected.

This is a false negative. We need conservative, evidence-based classification and better handling of non-standard phrasing and role progression.

## Goals (must-have outcomes)

- Reduce false negatives, especially on essentials.
- Make NO hard to reach unless explicitly contradicted.
- Keep fast review: short summary, evidence quotes with anchors, "what to ask next."
- Preserve deterministic scoring for consistency.
- Make job setup simple: plain text inputs, not JSON.

## Non-goals (for now)

- Fully automated hiring decisions.
- Data retention beyond hiring process.

## Proposed solution (high level)

Hybrid "LLM + rules" screening:

- Parsing produces a richer, audit-friendly "Candidate Facts" layer.
- Evidence extraction is citation-driven (quotes + anchors).
- Essentials use conservative tri-state policy:
  - YES when clearly supported
  - NO only when explicitly contradicted
  - otherwise UNCLEAR -> Clarify
- Add a manual "second opinion" recheck for suspicious NOs.

## Requirements (what to build)

### 1) Store anchored resume text

Problem: Evidence is hard to audit; chunking can lose context.

Change:

- Persist anchored resume text alongside resume_text:
  - Add page markers: "=== Page 1 ==="
  - Add line numbers per page or per block
  - Preserve section headings where possible ("Experience", "Education", etc.)
- Store this in parsed_data (or a new field) and keep raw resume_text as-is.

Where:

- src/lib/hiring/parsing.ts

Acceptance criteria:

- UI can display an evidence quote and show which page/lines it came from.
- Debugging a miss (like Sammie) is straightforward.

### 2) Work History Timeline Extraction (post-parse)

Problem: Raw chunk evidence is brittle; role progression in one company is easily missed.

Change:

- After resume_text is obtained (before screening), run a single model call to extract timeline facts into strict schema.

Schema (example):

type EmploymentEntry = {
  employer?: string;
  titles: string[];
  start_date?: string;
  end_date?: string; // "Present" allowed
  is_hospitality?: boolean;
  is_bar_role?: boolean;
  bullets?: string[];
  evidence_quotes: Array<{
    quote: string;
    anchor: string; // "Page 2, lines 14-20"
  }>;
};

Key instruction:

- If a CV says "Assistant Manager ... previous roles include Bartender ...", keep a single employer entry with titles array including "Bartender", "Bar-supervisor", etc.

Where:

- new helper in src/lib/hiring/parsing.ts or src/lib/hiring/data-quality.ts
- store output in hiring_candidates.parsed_data (and in profile version snapshots)

Acceptance criteria:

- Sammie-like CVs show bartender/bar-supervisor as recognized bar roles with evidence quotes.

### 3) Evidence extraction rules: "NO requires contradiction"

Problem: NO is being returned when evidence is missing or ambiguous.

Change:

- Update evidence prompt and/or post-processing:
  - YES: explicit supporting evidence
  - NO: explicit contradiction (e.g., "no bar experience", "cannot work weekends", "CV not in English")
  - UNCLEAR: missing or ambiguous
- For essentials, default to UNCLEAR unless contradiction exists.
- Add a policy that essential NO only triggers reject if:
  - status == NO
  - contradiction quote exists
  - confidence >= threshold (e.g., 0.75)

Where:

- src/lib/hiring/screening.ts (prompt + merge logic)
- src/lib/hiring/scoring-logic.ts (override logic)

Acceptance criteria:

- Candidates are not rejected because a single chunk lacked evidence.
- Essential failure override only triggers on explicit contradictions with strong confidence.

### 4) Structure-aware chunking

Problem: character chunking can split job blocks across chunks.

Change:

- Replace/augment splitTextIntoChunks with structure-aware chunking:
  - Split by page markers first
  - Within page, split by headings (Experience, Employment, Work History, etc.)
  - Keep date-pattern blocks together (e.g., "Sep 2021 - Present")
  - Add small overlap (200-400 chars)

Where:

- src/lib/hiring/chunking.ts

Acceptance criteria:

- Common CV formats keep each employment block intact in a single chunk.

### 5) Deterministic experience duration

Problem: model math is inconsistent; tenure should be deterministic.

Change:

- Use the timeline facts to compute bar_experience_months:
  - Sum durations for bar roles
  - If umbrella tenure includes bar titles, count from earliest bar-related date when stated
  - If dates missing, do NOT invent; mark as UNCLEAR and provide a clarify question
- Store computed_signals with screening results.

Where:

- src/lib/hiring/data-quality.ts or new src/lib/hiring/signals.ts
- integrate into src/lib/hiring/screening.ts as additional context

Acceptance criteria:

- Deterministic durations match obvious timelines when dates exist.
- Missing dates do not produce false NOs.

### 6) Plain-text job template inputs

Problem: JSON config is too opaque for Peter.

Change:

- UI: textareas with one item per line:
  - Essentials (non-negotiables)
  - Positive signals (nice-to-have)
  - Red flags
  - Clarify questions (optional)
- Compile into internal rubric config (defaults for weights/thresholds).
- Add a read-only "preview" of the compiled rubric before saving.

Where:

- Job/template creation UI
- src/lib/hiring/scoring-logic.ts buildRubricConfig

Acceptance criteria:

- Job editing takes under 2 minutes without touching JSON.
- Compiled rubric preview is visible before save.

### 7) Manual "Second Opinion" button

Problem: need a safe, manual recheck when a result looks wrong.

Change:

- Add UI button: "Run second opinion (full CV)"
- Runs a single call using:
  - full anchored resume text
  - rubric
  - extracted timeline facts
- Stores as a new hiring_screening_runs entry (mode=second_opinion).

Where:

- UI: src/components/features/hiring/ApplicationScreeningPanel.tsx
- Backend: new action that queues screen_application with runType=second_opinion

Acceptance criteria:

- Second opinion can overturn suspicious NOs with quotes and anchors.

## Output requirements (what must be shown)

For each essential item, store and display:

- status: yes/no/unclear
- confidence
- quote(s) + anchor (page/lines)
- "what to ask next" if unclear

This supports auditability, rejection reasons, and clarifying emails.

## Test plan (minimum)

- Create a fixture set of CVs (including binder samples).
- Run: parse -> anchored text -> timeline -> evidence extraction.
- Regression test for Sammie pattern:
  - "Assistant Manager ... previous roles include Bartender ..." must NOT yield bar experience = NO.
- Add logging: which chunks were used per rubric item and why a status became NO (must include contradiction quote).

## Delivery order (recommended)

1) Anchored resume text storage + show anchors in UI
2) Timeline extraction step + persistence
3) Evidence prompt update + "NO requires contradiction" policy
4) Structure-aware chunking
5) Deterministic experience duration signals
6) Plain-text template inputs + rubric preview
7) Manual second opinion run

