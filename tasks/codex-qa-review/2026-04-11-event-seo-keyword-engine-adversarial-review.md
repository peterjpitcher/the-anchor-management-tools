# Adversarial Review: Event SEO Keyword Engine

**Date:** 2026-04-11
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** `docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md` vs codebase
**Spec:** `docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md`

## Executive Summary

The spec is directionally sound — the three-tier keyword strategy, AI-driven content generation, and E-E-A-T additions are well-reasoned. However, Codex found **7 critical/high findings** where the spec contradicts codebase reality, plus **6 medium findings** covering gaps and ambiguities. The spec cannot be implemented as written without revisions to address FAQ persistence, type file targeting, social copy duplication, API serialisation, and RPC updates.

## What Appears Solid

- Three-tier keyword model (primary/secondary/local) with clear placement rules
- Keyword input as textarea with comma+newline parsing — well matched to workflow
- Retaining flat `keywords` for backwards compatibility
- Using existing `event_faqs` table for FAQ storage
- SEO health indicator concept (non-blocking guidance)
- E-E-A-T field additions (previous event summary, attendance note, cancellation policy, accessibility)
- AI constraint rules (no stuffing, UK English, venue tone)
- Migration strategy as additive/non-breaking

## Critical Risks

### CR-1: FAQ deletion on every edit save (AB-001, SPEC-001)
**Severity:** Critical | **Confidence:** High | **Engines:** Codex
The edit page doesn't load `event_faqs`. The form has no FAQ state. `prepareEventDataFromFormData()` normalises missing FAQs to `[]`. The RPC deletes all existing FAQs when `p_faqs IS NOT NULL`. **Any AI-generated FAQs will be wiped on the next normal edit save.**
**Action:** Must fix FAQ persistence before or during this feature — load FAQs on edit, add FAQ state to form, only delete/replace when explicitly changed.

### CR-2: Wrong type file target (AB-002, SPEC-002)
**Severity:** Critical | **Confidence:** High | **Engines:** Codex
The spec says to update `src/types/event.ts`, but the live app imports `Event` from `src/types/database.ts` which re-exports from `database.generated.ts`. The stale `event.ts` still has removed columns. Updating it alone won't affect the actual event flow.
**Action:** Spec must target `database.generated.ts` (via migration + type generation) and `database.ts` for any manual type extensions.

## Spec Defects

### SD-1: Facebook copy duplication (AB-003, SPEC-004)
**Severity:** High | **Confidence:** High
The schema already has `facebook_event_name`, `facebook_event_description`, `gbp_event_title`, `gbp_event_description`, and `opentable_experience_*` with an existing AI promotion-copy workflow. Adding `social_copy_facebook` duplicates an existing domain without defining the relationship.
**Suggested revision:** Repurpose or extend the existing Facebook copy fields instead of adding a new one. WhatsApp is genuinely new.

### SD-2: API fields won't appear automatically (AB-004, SPEC-003)
**Severity:** High | **Confidence:** High
Both `/api/events` routes manually shape responses — they don't spread raw DB rows. New columns stay invisible until the API routes are explicitly updated.
**Suggested revision:** Add explicit API route updates to the spec's migration strategy (Section 11).

### SD-3: Category cascading is already broken (AB-005, SPEC-007)
**Severity:** High | **Confidence:** High
Server-side cascade reads `event_categories.image_url` and `event_categories.brief`, but the real schema has `default_image_url` and no category `brief`. Extending this broken path compounds errors. Also: no authoring UI for new category defaults is specified.
**Suggested revision:** Fix existing cascade bugs as a prerequisite, then extend. Add category edit form changes to scope.

### SD-4: RPC functions need explicit migration (AB-006)
**Severity:** High | **Confidence:** High
`create_event_transaction` and `update_event_transaction` enumerate columns explicitly. Adding DB columns alone does nothing — the PostgreSQL functions must be updated in a migration.
**Suggested revision:** Section 11 mentions RPCs but needs to be explicit that new `CREATE OR REPLACE FUNCTION` migrations are required.

### SD-5: Keywords precedence undefined (AB-007, SPEC-012)
**Severity:** High | **Confidence:** High
Current code treats `keywords` as a category-cascaded field on both client and server. If the UI removes the old field but cascades remain, category defaults and the union logic will compete. Also: no migration path for existing events' flat `keywords` → three-tier model.
**Suggested revision:** Define precedence explicitly. On first edit of an existing event, pre-populate `secondary_keywords` from legacy `keywords`. Remove `keywords` from cascade sources.

### SD-6: Accessibility notes storage contradiction (SPEC-008, AB-012)
**Severity:** Medium | **Confidence:** High
Group 3 says "venue-level default", Section 4 adds it to `event_categories`, Section 9 says "category-level cascade". No actual venue-level storage exists.
**Suggested revision:** Pick one source of truth — recommend category-level default with a single venue-wide default as a fallback constant in code.

### SD-7: Validation limits inconsistent (SPEC-010, AB-011)
**Severity:** Medium | **Confidence:** High
Group 3 char limits (~125/~300/~200 etc.) don't match proposed Zod limits (200/500/300 etc.). Meta title/description UI limits (60/160) differ from Zod (255/500). No keyword validation rules for max items, max per-keyword length, or character restrictions.
**Suggested revision:** Align all limits. Define keyword validation: max 10 items per tier, max 100 chars per keyword, alphanumeric + spaces + hyphens only, case-normalised.

### SD-8: AI non-invention rule conflicts with required outputs (SPEC-011)
**Severity:** Medium | **Confidence:** High
The spec forbids inventing details, but `previous_event_summary` asks AI to invent a template recap, and `attendance_note` depends on history data not in the AI input.
**Suggested revision:** Reframe `previous_event_summary` as an explicit template/placeholder, not AI-generated content. Make `attendance_note` a manual field, not AI-generated.

## Workflow & Failure-Path Defects

### WF-1: DebouncedTextarea stale state (SPEC-006, AB-008)
**Severity:** Medium | **Confidence:** High
DebouncedTextarea has a 300ms sync delay. AI generation and save read parent state, not live textarea state. Also, AI generation re-reads DB values for existing events, overriding unsaved form edits.
**Action:** Flush debounced fields before generation/save. Document or fix the DB-override behaviour.

### WF-2: Brief required but not enforced (SPEC-005)
**Severity:** Medium | **Confidence:** High
Spec says brief is required for generation but doesn't define behaviour when keywords exist and brief is empty. Current UI only blocks on missing `name`.
**Action:** Define: if brief is empty, show warning but allow generation with degraded output. Or require brief when keywords are present.

### WF-3: Single AI call token/quality risk (AB-009)
**Severity:** Medium | **Confidence:** Medium
Current AI uses `max_tokens: 1500` for 7 fields. Adding 6+ fields including multiple FAQ Q&A pairs may hit limits or degrade quality.
**Action:** Prototype with real data. May need `max_tokens: 3000-4000` or split into two calls.

## Security & Data Risks

### SEC-1: AI-generated legal/factual content (SEC-001)
**Severity:** High | **Confidence:** High
AI-generated `cancellation_policy` becomes the venue's apparent official refund policy if published unchanged. `attendance_note` makes social proof claims.
**Action:** Mark these as draft suggestions requiring explicit approval, or source cancellation policy from a canonical venue setting.

### SEC-2: Stored XSS vector (SEC-002)
**Severity:** Medium | **Confidence:** Medium
New TEXT fields exposed via API. If the brand site renders any unsafely (innerHTML, markdown), it's exploitable.
**Action:** Strip/deny HTML server-side for all new text fields. Document that brand site must escape on render.

### SEC-3: Prompt injection via keywords (SEC-003)
**Severity:** Medium | **Confidence:** Medium
Keywords are user-controlled strings passed into AI prompts. Can steer outputs into misleading copy.
**Action:** Clearly delimit keywords as data (not instructions) in the prompt. Add post-generation validation.

### SEC-4: Keyword array pollution (SEC-005)
**Severity:** Medium | **Confidence:** Medium
No per-item length cap, no HTML rejection, no array size cap. Could pollute API response and Schema.org output.
**Action:** Server-side normalisation: trim, reject control chars/HTML, cap item length (100), cap array size (10 per tier).

## SEO Health Score Gap (SPEC-009)

The spec defines scoring weights but not:
- Where it executes (client-side recommended — it's a UI indicator)
- When it recomputes (on every field change, debounced)
- Whether it's persisted or returned by API (recommend: no, client-only)

## Recommended Fix Order

1. **Fix FAQ persistence** — load FAQs on edit, add form state, fix RPC to not delete when unchanged (CR-1)
2. **Fix type file targeting** — use database.generated.ts + database.ts, not event.ts (CR-2)
3. **Resolve Facebook copy duplication** — repurpose existing fields or clearly separate domains (SD-1)
4. **Fix category cascading bugs** — repair field name mismatches before extending (SD-3)
5. **Revise spec** — address all SD and WF findings above
6. **Then proceed with implementation**

## Follow-Up Review Required

- Re-review FAQ persistence implementation after fix
- Re-review AI prompt with real keyword injection test cases
- Re-review token limits after prototype with full field set
- Re-review brand site rendering of new fields (separate codebase)
