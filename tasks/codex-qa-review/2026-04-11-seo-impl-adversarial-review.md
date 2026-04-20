# Adversarial Review: Event SEO Keyword Engine Implementation

**Date:** 2026-04-11
**Mode:** Code Review + Spec Compliance (Mode B+C)
**Engines:** Claude + Codex (4 reviewers)
**Scope:** All commits d94c816..ae4260d (15 files changed)
**Spec:** `docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md`

## Executive Summary

The implementation is **structurally sound** — database, migration, RPCs, new components, Zod validation, and API routes are all correct. However, there are **3 critical wiring gaps** where the form doesn't connect to the server action properly: (1) keywords aren't sent to AI generation, (2) new AI outputs aren't applied to form state, and (3) category default fields aren't persisted by the category actions. These are integration bugs, not architectural problems — straightforward fixes.

## What Appears Solid

- **Database migration + RPCs:** All columns correct, RPCs include all ~50 columns, FAQ preservation works correctly (null = preserve, array = replace)
- **FAQ persistence fix:** Full lifecycle working — load, track modifications, conditional save
- **Keyword parsing utility:** Clean, tested pattern for comma/newline parsing, dedup, validation
- **New components:** KeywordStrategyCard, FaqEditor, SeoHealthIndicator all correctly implemented and wired to form state
- **Zod validation:** keywordArraySchema enforces 10 items, 100 chars, no HTML
- **API routes:** All 9 new fields exposed in both routes
- **Schema.org:** accessibilityFeature and refundPolicy correctly added
- **SEO Health Indicator:** Scoring weights match spec exactly
- **Form restructure:** 4 groups correctly implemented, manual fields properly separated from AI fields
- **Legacy keyword migration:** Client-side pre-population of secondary_keywords from flat keywords works

## Critical Implementation Defects

### CR-1: handleGenerateSeo doesn't send keywords to AI (All 3 reviewers flagged)
**Severity:** Critical | **Confidence:** High
**File:** `src/components/features/events/EventFormGrouped.tsx:343`

The form's `handleGenerateSeo` calls `generateEventSeoContent()` but never passes `primaryKeywords`, `secondaryKeywords`, or `localSeoKeywords`. The server action has the keyword placement logic ready, but receives empty keyword arrays. **The entire keyword engine is bypassed during generation.**

**Fix:** Add to the generateEventSeoContent call:
```typescript
primaryKeywords: parseKeywords(primaryKeywords),
secondaryKeywords: parseKeywords(secondaryKeywords),
localSeoKeywords: parseKeywords(localSeoKeywords),
```

### CR-2: handleGenerateSeo doesn't apply new AI outputs (All 3 reviewers flagged)
**Severity:** Critical | **Confidence:** High
**File:** `src/components/features/events/EventFormGrouped.tsx:369`

After AI generation returns, the form only applies the legacy fields (metaTitle, metaDescription, shortDescription, longDescription, highlights, keywords, slug). It ignores: `imageAltText`, `faqs`, `facebookEventName`, `facebookEventDescription`, `socialCopyWhatsapp`, `cancellationPolicy`. **Generated content is thrown away.**

**Fix:** Add after the existing field applications:
```typescript
if (result.data.imageAltText) setImageAltText(result.data.imageAltText)
if (result.data.faqs?.length) {
  setFaqs(result.data.faqs.map((faq, i) => ({ ...faq, sort_order: i })))
  setFaqsModified(true)
}
if (result.data.facebookEventName) setFacebookEventName(result.data.facebookEventName)
if (result.data.facebookEventDescription) setFacebookEventDescription(result.data.facebookEventDescription)
if (result.data.socialCopyWhatsapp) setSocialCopyWhatsapp(result.data.socialCopyWhatsapp)
if (result.data.cancellationPolicy) setCancellationPolicy(result.data.cancellationPolicy)
```

### CR-3: Category actions don't persist new default fields (All 3 reviewers flagged)
**Severity:** High | **Confidence:** High
**Files:** `src/app/actions/event-categories.ts:32, :601, :664` and `src/types/event-categories.ts:85`

The category form (`EventCategoryFormGrouped.tsx`) submits the 6 new fields, but the category server actions and Zod schema strip them. The fields are silently dropped on save. **Category defaults appear to save but don't persist.**

**Fix:** Update `src/app/actions/event-categories.ts` and `src/types/event-categories.ts` to include the new fields in the Zod schema, FormData parsing, and the database write path.

## Medium Implementation Defects

### MD-1: Legacy keywords still cascade in client-side form
**Severity:** Medium | **Confidence:** High
**File:** `src/components/features/events/EventFormGrouped.tsx:274`

The spec says to remove `keywords` from cascade sources (it's now derived). But `handleCategoryChange` still cascades the flat `keywords` field from the category.

**Fix:** Remove the keywords cascade line from handleCategoryChange.

### MD-2: Dead `categoryDefaults.brief` fallback
**Severity:** Low | **Confidence:** High
**File:** `src/app/actions/events.ts:148`

The category select no longer queries `brief`, but the data object still references `categoryDefaults.brief` as a fallback. This is harmless dead code (always undefined), but should be cleaned up.

### MD-3: DebouncedTextarea flush timing
**Severity:** Low | **Confidence:** Medium
**File:** `src/components/features/events/EventFormGrouped.tsx:324`

`flush()` calls React state setters, but the AI generation reads state values in the same tick. In practice React batches state updates, so the read may get stale values. This is a pre-existing architectural issue (the AI action also re-reads from DB for existing events), and the impact is low since the brief is typically saved before generating.

## Security Observations (Advisory)

- **SEC-1 (Medium):** New text fields have no server-side HTML stripping. Zod only enforces length. Not exploitable via JSON API, but could be a stored-XSS vector if the brand site renders unsafely. Brand site uses React text rendering (safe by default).
- **SEC-2 (Medium):** Keywords interpolated as prose in AI prompt, not clearly delimited as data. Prompt injection risk is low (structured output constrains response shape) but should be hardened.
- **SEC-3 (Low):** No server-side review gate for cancellation policy. The UI shows a "Draft" label but nothing prevents publishing AI-generated legal text. Acceptable for now since the feature doesn't auto-publish.

## Recommended Fix Order

1. **CR-1 + CR-2:** Fix handleGenerateSeo in EventFormGrouped.tsx (send keywords, apply outputs) — single commit
2. **CR-3:** Fix category actions to persist new default fields — single commit
3. **MD-1 + MD-2:** Remove legacy keywords cascade + dead brief fallback — single commit
4. **Verify:** Build, lint, typecheck
