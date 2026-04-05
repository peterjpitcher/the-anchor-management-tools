# QA Specialist Report: Event Content Generation

**Date**: 2026-04-05
**Scope**: `src/app/actions/event-content.ts`, `src/lib/openai/config.ts`, `src/components/features/events/EventPromotionContentCard.tsx`
**Reference Pattern**: `src/lib/openai.ts` (receipt classification), `src/lib/retry.ts`

---

## Executive Summary

The event content generation feature has solid fundamentals -- permissions, config loading, prompt construction, and JSON parsing are all well-implemented. However, the feature has **significant gaps in error handling and resilience** compared to the working receipt classification pattern. The user-reported issue ("OpenAI request failed." error) is confirmed: every non-200 OpenAI response produces the same generic, non-actionable error message regardless of root cause (invalid key, quota exceeded, model unavailable, server error).

**Total test cases**: 46
- PASS: 33
- FAIL: 10
- WARN: 3

---

## Defect Log

### DEF-001: Generic error message for all OpenAI API failures

| Field | Value |
|-------|-------|
| **Severity** | P0 -- Critical |
| **Summary** | All non-200 OpenAI responses produce the same generic `'OpenAI request failed.'` error message |
| **Expected** | Actionable, status-code-specific error messages (e.g., "Invalid API key", "Rate limit exceeded", "Model not found") |
| **Actual** | Lines 478-480 and 234-236: `if (!response.ok)` logs the response body to `console.error` but returns the same hardcoded string for 401, 403, 404, 429, 500, 502, 503, etc. |
| **Business Impact** | Staff see "OpenAI request failed." with no guidance on how to fix it. They cannot distinguish between a misconfigured key, a quota issue, or an OpenAI outage. Support burden increases. |
| **Root Cause** | No status code inspection or response body parsing in the error path |
| **Affected Files** | `src/app/actions/event-content.ts` lines 478-480 (promotion), lines 234-236 (SEO) |
| **Test Case IDs** | TC-032, TC-033, TC-034, TC-035 |

### DEF-002: No retry logic for transient failures

| Field | Value |
|-------|-------|
| **Severity** | P1 -- High |
| **Summary** | Event content generation does not use the `retry()` utility for OpenAI API calls |
| **Expected** | Transient failures (5xx, network hiccups) are retried with exponential backoff, matching the receipt classification pattern |
| **Actual** | `fetch()` at lines 162 and 457 is called directly with no retry wrapper. A single transient failure immediately surfaces as an error to the user. |
| **Business Impact** | Intermittent OpenAI 500/502/503 errors or brief network blips cause immediate failure. Users must manually retry. |
| **Root Cause** | `retry()` from `src/lib/retry.ts` and `RetryConfigs.api` exist but are not imported or used in `event-content.ts` |
| **Affected Files** | `src/app/actions/event-content.ts` lines 162, 457 |
| **Test Case IDs** | TC-036, TC-080 |

### DEF-003: Unhandled fetch exceptions in server actions

| Field | Value |
|-------|-------|
| **Severity** | P0 -- Critical |
| **Summary** | Network-level errors (DNS failure, connection refused, timeout) from `fetch()` throw uncaught exceptions in the server action |
| **Expected** | Server action catches fetch errors and returns `{ success: false, error: '...' }` |
| **Actual** | The `fetch()` calls at lines 162 and 457 are NOT wrapped in try/catch. If `fetch()` itself throws (as opposed to returning a non-200 response), the exception propagates up as an unhandled server action error. The UI client catches this generically at line 234, but the server-side error is unstructured. |
| **Business Impact** | When OpenAI is unreachable, users see a generic "Failed to generate content" error from the UI catch-all, with no diagnostic information. Server logs may show an unhandled rejection. |
| **Root Cause** | Missing try/catch around the fetch call in both `generateEventSeoContent` and `generateEventPromotionContent` |
| **Affected Files** | `src/app/actions/event-content.ts` lines 162-232 (SEO), lines 457-476 (promotion) |
| **Test Case IDs** | TC-037 |

### DEF-004: No request timeout (AbortController)

| Field | Value |
|-------|-------|
| **Severity** | P1 -- High |
| **Summary** | OpenAI fetch requests have no explicit timeout |
| **Expected** | Requests should timeout after a reasonable period (e.g., 30s) and return a clear timeout error |
| **Actual** | No `AbortController` or `signal` passed to `fetch()`. Relies entirely on platform-level timeouts (Vercel serverless function timeout, typically 10s default). |
| **Business Impact** | If OpenAI hangs, the user sees a loading spinner until the platform kills the function, resulting in a cryptic timeout error rather than a clear message. |
| **Root Cause** | No timeout implementation |
| **Affected Files** | `src/app/actions/event-content.ts` lines 162, 457 |
| **Test Case IDs** | TC-040, TC-082 |

### DEF-005: "AI unavailable" banner never clears

| Field | Value |
|-------|-------|
| **Severity** | P1 -- High |
| **Summary** | Once the AI unavailable banner is shown, the Generate button is permanently disabled for that component instance |
| **Expected** | If the underlying issue is resolved (e.g., API key added), the user should be able to retry without refreshing the page |
| **Actual** | `aiUnavailableMessage` state is set at line 214 but is NEVER cleared back to `null`. The `handleGenerate` function's success path (lines 220-233) does not reset the state. The `disabled` prop at line 388 checks `Boolean(aiUnavailableMessage)`. |
| **Business Impact** | If a user sees the banner (even due to a transient config-loading failure), they cannot retry generation without a full page refresh. |
| **Root Cause** | Missing `setAiUnavailableMessage(null)` in the success path or at the start of `handleGenerate` |
| **Affected Files** | `src/components/features/events/EventPromotionContentCard.tsx` lines 202-239 |
| **Test Case IDs** | TC-064 |

### DEF-006: Error message not actionable for status-specific failures (SEO path)

| Field | Value |
|-------|-------|
| **Severity** | P1 -- High |
| **Summary** | `generateEventSeoContent` has the same generic error handling as the promotion path |
| **Expected** | Status-specific error messages |
| **Actual** | Line 234-236: same `'OpenAI request failed.'` pattern |
| **Business Impact** | Same as DEF-001, affecting SEO content generation |
| **Root Cause** | Same as DEF-001 |
| **Affected Files** | `src/app/actions/event-content.ts` lines 234-236 |
| **Test Case IDs** | TC-032, TC-033, TC-034, TC-035 (apply to both functions) |

---

## Coverage Assessment

### Well-Covered Areas (no action needed)

1. **Permission checks** -- Both actions check `events:manage` before proceeding. Server-side enforcement is solid.
2. **Config loading** -- The `getOpenAIConfig()` function is thorough: env fallback, DB lookup with multiple key candidates, caching, enable/disable flags.
3. **Prompt construction** -- Detailed, well-structured prompts with clear constraints. Different schemas per content type.
4. **JSON parsing** -- Both actions handle `JSON.parse` failures gracefully with try/catch.
5. **Empty content detection** -- Both actions check for `!content` after extracting from the OpenAI response.
6. **UI loading states** -- Button disabled during generation, spinner shown, `finally` block ensures cleanup.
7. **Copy functionality** -- Individual field and "copy all" buttons work correctly with proper disabled states.
8. **Content type switching** -- Results preserved per content type in a map.
9. **Existing saved content** -- Pre-populated from props on mount without overwriting fresh generations.

### Gaps Requiring Fixes

| Gap | Severity | Description |
|-----|----------|-------------|
| Error specificity | P0 | Generic error message for all failure modes |
| Resilience (retry) | P1 | No retry on transient failures |
| Resilience (try/catch) | P0 | Unhandled fetch exceptions |
| Resilience (timeout) | P1 | No request timeout |
| UI state management | P1 | AI unavailable banner never clears |

### Improvement Opportunities (not defects)

| Area | Priority | Description |
|------|----------|-------------|
| Usage tracking | P3 | OpenAI token usage and cost are not extracted or logged (receipt classification does this) |
| Config cache bypass | P2 | No way to force-refresh config from the event-content actions (stale key scenario) |
| SEO max_tokens | P2 | 900 tokens may truncate long descriptions for complex events (prompt asks for 300+ words) |
| Silent event-not-found in SEO | P2 | `generateEventSeoContent` silently falls back to input data when eventId is invalid rather than warning the user |

---

## Recommended Fix Priority

### Phase 1 (Must fix -- blocking)

1. **DEF-001 / DEF-006**: Add status-code-specific error messages in both `generateEventPromotionContent` and `generateEventSeoContent`. At minimum, distinguish: 401 (invalid key), 403 (forbidden), 404 (model not found), 429 (rate limited / quota exceeded), 5xx (OpenAI issue, retry later).
2. **DEF-003**: Wrap both `fetch()` calls in try/catch blocks that return `{ success: false, error: '...' }` for network-level failures.
3. **DEF-005**: Clear `aiUnavailableMessage` at the start of `handleGenerate` so users can retry.

### Phase 2 (Should fix -- high value)

4. **DEF-002**: Import and use `retry()` with `RetryConfigs.api` around both fetch calls, matching the receipt classification pattern.
5. **DEF-004**: Add `AbortController` with a 30-second timeout to both fetch calls.

### Phase 3 (Nice to have)

6. Extract and log OpenAI usage/cost data for monitoring.
7. Consider `forceRefresh: true` on config load after a 401 error (stale cache scenario).
8. Increase SEO `max_tokens` from 900 to 1200 to avoid long description truncation.

---

## Comparison: Event Content vs Receipt Classification

| Aspect | Receipt Classification | Event Content | Gap? |
|--------|----------------------|---------------|------|
| Retry wrapper | `retry(fn, RetryConfigs.api)` | Bare `fetch()` | YES |
| Error on non-200 | Returns `null` (caller handles) | Returns generic `'OpenAI request failed.'` | YES -- worse UX |
| fetch() try/catch | Retry wrapper catches throws | No try/catch | YES |
| Timeout | No explicit (retry provides partial protection) | No explicit | Partial |
| Usage tracking | Extracts tokens + calculates cost | Discarded | Minor |
| JSON parse error | Returns `null` | Returns `'Unable to parse AI response.'` | Event is better |
| Empty content check | Returns `null` with warning | Returns `'OpenAI returned no content.'` | Event is better |
| Content normalization | Detailed normalizers per field | `normalizeString()` for strings | Adequate |
