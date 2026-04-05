# Consolidated Defect Log — Event Content Generation

## DEFECT-001: Opaque error messages for all OpenAI API failures
- **Severity**: CRITICAL
- **Business Impact**: Staff see "OpenAI request failed." for every failure mode (invalid key, rate limit, model not found, server error). They cannot diagnose or resolve the issue. This is the user-reported bug.
- **Root Cause Area**: `src/app/actions/event-content.ts` lines 478-480 (promotion), 234-236 (SEO) — no status code inspection
- **Source**: All 4 agents (Tier 1 confidence). QA DEF-001/DEF-006, Architect HIGH-1, Auditor P2.
- **Affected Files**: `src/app/actions/event-content.ts`
- **Test Case IDs**: TC-032, TC-033, TC-034, TC-035
- **Acceptance Criteria**: Non-200 responses produce status-specific messages: 401→"API key invalid", 429→"Rate limited, try again", 5xx→"Service temporarily unavailable", network→"Could not reach AI service"

## DEFECT-002: No try/catch around fetch() — unhandled network exceptions
- **Severity**: CRITICAL
- **Business Impact**: Network-level errors (DNS failure, connection refused) throw unhandled exceptions in the server action, producing a generic 500 error. No diagnostic information reaches the user.
- **Root Cause Area**: `src/app/actions/event-content.ts` lines 162, 457 — bare `fetch()` with no error boundary
- **Source**: Structural Mapper + QA (Tier 1). QA DEF-003, Architect MED-2.
- **Affected Files**: `src/app/actions/event-content.ts`
- **Test Case IDs**: TC-037
- **Acceptance Criteria**: Network errors caught and returned as `{ success: false, error: 'Could not reach the AI service. Please try again.' }`

## DEFECT-003: No retry logic for transient failures
- **Severity**: HIGH
- **Business Impact**: Transient OpenAI 5xx errors or network blips fail immediately. Users must manually retry. Receipt classification uses `retry()` — event content does not.
- **Root Cause Area**: `src/app/actions/event-content.ts` — missing `retry()` import and usage
- **Source**: All 4 agents (Tier 1). QA DEF-002, Architect CRIT-1.
- **Affected Files**: `src/app/actions/event-content.ts`
- **Test Case IDs**: TC-036, TC-080
- **Acceptance Criteria**: Both OpenAI calls wrapped in `retry()` with throw-on-5xx inside the callback so `RetryConfigs.api` actually retries server errors.

## DEFECT-004: No request timeout (AbortController)
- **Severity**: HIGH
- **Business Impact**: If OpenAI hangs, user sees spinner until Vercel kills the function. No actionable error, wasted function time.
- **Root Cause Area**: `src/app/actions/event-content.ts` lines 162, 457 — no `signal` on fetch
- **Source**: Architect CRIT-2, Auditor P6, QA DEF-004 (Tier 1).
- **Affected Files**: `src/app/actions/event-content.ts`
- **Test Case IDs**: TC-040, TC-082
- **Acceptance Criteria**: `AbortController` with 30s timeout on both fetch calls. Timeout produces clear error: "AI request timed out. Please try again."

## DEFECT-005: "AI unavailable" banner never clears
- **Severity**: HIGH
- **Business Impact**: Once shown, the Generate button is permanently disabled until page refresh. Users cannot retry even if the underlying issue is resolved.
- **Root Cause Area**: `src/components/features/events/EventPromotionContentCard.tsx` line 214 — `setAiUnavailableMessage()` is never reset to `null`
- **Source**: QA DEF-005 (Tier 2 — confirmed by code trace).
- **Affected Files**: `src/components/features/events/EventPromotionContentCard.tsx`
- **Test Case IDs**: TC-064
- **Acceptance Criteria**: `setAiUnavailableMessage(null)` called at the start of `handleGenerate` so users can retry.

## DEFECT-006: AI unavailable detection misses 401/expired key errors
- **Severity**: MEDIUM
- **Business Impact**: A 401 (invalid/revoked key) returns "OpenAI request failed." which doesn't match the "openai"+"configure" detection pattern. Users keep retrying a permanently broken state.
- **Root Cause Area**: `src/components/features/events/EventPromotionContentCard.tsx` lines 212-213 — detection only checks for "configure" keyword
- **Source**: Auditor P3 (Tier 2 — confirmed by code trace).
- **Affected Files**: `src/components/features/events/EventPromotionContentCard.tsx`, `src/app/actions/event-content.ts`
- **Test Case IDs**: TC-064
- **Acceptance Criteria**: Status-specific error messages from DEFECT-001 fix enable proper detection. UI shows appropriate banner for auth errors.

## DEFECT-007: SEO max_tokens too low, risks JSON truncation
- **Severity**: MEDIUM
- **Business Impact**: Intermittent "Unable to parse AI response" errors for events with complex descriptions. The SEO prompt requests 300+ words + 7 fields within 900 tokens.
- **Root Cause Area**: `src/app/actions/event-content.ts` line 230 — `max_tokens: 900`
- **Source**: Architect HIGH-3, Structural Mapper (Tier 1).
- **Affected Files**: `src/app/actions/event-content.ts`
- **Test Case IDs**: TC-042
- **Acceptance Criteria**: SEO `max_tokens` increased to 1500.
