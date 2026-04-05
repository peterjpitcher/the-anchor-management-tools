# Technical Architect Report: Event Content Generation

**Section**: Event Content Generation (OpenAI integration)
**Severity scale**: Critical / High / Medium / Low / Info
**Date**: 2026-04-05

---

## 1. Failure-at-Step-N Analysis

### Flow: `generateEventPromotionContent`

| Step | Operation | Side Effects | What if this step fails? | Handled? |
|------|-----------|-------------|--------------------------|----------|
| 1 | `checkUserPermission('events', 'manage')` | Read-only | Returns `{ success: false }` cleanly | Yes |
| 2 | `getOpenAIConfig()` | DB read (cached) | **See Section 3 below** -- config loader has its own try/catch that swallows DB errors and returns partial config | Partially |
| 3 | API key guard (`if (!apiKey)`) | None | Returns `{ success: false }` cleanly | Yes |
| 4 | Supabase `.single()` fetch of event | Read-only | Returns `{ success: false, error: 'Event not found.' }` | Yes |
| 5 | Build prompt from event data | Compute only | No try/catch -- if `event` has unexpected shape, throws unhandled exception | **No** |
| 6 | `fetch()` to OpenAI API | **External call** | **See Critical findings below** -- no retry, no timeout, opaque error | **Partially** |
| 7 | Parse JSON response | Compute only | Caught by try/catch, returns generic error | Yes |
| 8 | Return result to client | None | N/A | N/A |

### Flow: `generateEventSeoContent`

Same pattern as above with one additional step: the merged-input logic (steps 4-5 in the SEO function) where `dbEvent` is merged with `input`. The merge uses `??` which is safe for nulls but not for unexpected types. Overall: same issues as the promotion flow.

### Flow: `getOpenAIConfig` (config loader)

| Step | Operation | What if it fails? | Handled? |
|------|-----------|-------------------|----------|
| 1 | Check in-memory cache | Returns cached value | Yes |
| 2 | Read `process.env` | Returns undefined/null | Yes (falls through) |
| 3 | Query `system_settings` via admin client | **Swallowed** -- `catch` returns `{}` so caller gets env-only config | Partially -- silent degradation |
| 4 | Merge and cache for 5 min | Module-level cache | **See finding on Vercel cold starts** |

**Verdict**: No multi-step write operations exist. These flows are read-only pipelines with an external API call. No compensation or rollback needed. The primary risk surface is Step 6 (the OpenAI API call).

---

## 2. Critical Findings

### CRIT-1: No retry logic on OpenAI calls (severity: Critical)

**What**: Both `generateEventSeoContent` and `generateEventPromotionContent` use bare `fetch()` to call OpenAI. No retry wrapper.

**Comparison**: `src/lib/openai.ts` (receipt classification) wraps the identical `fetch()` call in `retry(fn, RetryConfigs.api)`, which provides:
- 5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s)
- Retries on network errors (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`)
- Retries on 5xx server errors
- Does NOT retry on 4xx client errors

The event content functions have **none of this**. A single transient 500 or network blip from OpenAI causes immediate user-visible failure.

**Impact**: Users see "OpenAI request failed." on transient errors that would self-heal with retry.

**Fix**: Wrap both fetch calls in `retry(fn, RetryConfigs.api)`.

---

### CRIT-2: No timeout / AbortController on fetch (severity: Critical)

**What**: Neither event content function sets a timeout on the `fetch()` call. If OpenAI hangs (which happens during incidents), the Vercel function will run until its execution limit (default 10s for Hobby, 60s for Pro, up to 300s).

**Comparison**: The receipt classification in `src/lib/openai.ts` also lacks a timeout -- this is a shared gap. However, for event content generation the prompts request 300+ word long descriptions with `max_tokens: 900`, making the response time inherently longer and more vulnerable to hangs.

**Impact**: Vercel function timeout consumed silently. User sees a generic network error or timeout from the client side with no actionable message. The Vercel function invocation is billed for the full duration.

**Fix**: Add `AbortController` with a reasonable timeout (e.g., 30s):
```typescript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 30_000)
try {
  const response = await fetch(url, { ...options, signal: controller.signal })
} finally {
  clearTimeout(timeoutId)
}
```

---

### CRIT-3: `RetryConfigs.api.retryIf` does not trigger on fetch non-throw failures (severity: High)

**What**: The `retry()` utility only retries when the callback **throws**. However, `fetch()` does NOT throw on HTTP 500 responses -- it resolves with `response.ok === false`. The retry wrapper in `src/lib/openai.ts` therefore only retries on *network-level* failures (DNS, connection refused, etc.), **not** on OpenAI 500/502/503 responses.

This means even in the receipt classification code, HTTP 500s from OpenAI are NOT retried. They just fall through to the `if (!response.ok)` check and return `null`.

**Impact**: The retry wrapper provides less protection than it appears. 5xx responses from OpenAI (which are the most common transient failure mode) are not retried in either code path.

**Fix**: Either (a) throw inside the retry callback when `!response.ok && response.status >= 500`, or (b) use a response-aware retry wrapper.

---

## 3. High Findings

### HIGH-1: Opaque error messages to the user (severity: High)

**What**: When OpenAI returns a non-200 response, the user sees: `"OpenAI request failed."` The actual error (rate limit 429, invalid model 404, auth error 401, content filter 400, server error 500) is logged server-side only.

**Comparison**: The receipt classification code returns `null` on failure (handled upstream as "classification unavailable"), which is a softer failure mode. Event content returns a hard error toast.

**Specific error classes that should be distinguished**:
- **401**: API key invalid or expired -- user should see "API key is invalid. Check Settings."
- **429**: Rate limited -- user should see "Rate limit reached. Try again in a moment."
- **400**: Often means the `response_format` schema is invalid or the model doesn't support it -- user should see "Configuration error."
- **500/502/503**: Transient -- "OpenAI is temporarily unavailable. Try again."
- **404**: Model not found -- "The configured model is not available."

**Fix**: Inspect `response.status` and return targeted error messages.

---

### HIGH-2: JSON schema validity concerns (severity: High)

**What**: The `response_format.json_schema` schemas in event content use `type: 'string'` (single type), while receipt classification uses `type: ['string', 'null']` (union type). Neither uses `strict: true`.

Specific issues:

1. **Facebook/GBP schemas** (`event-content.ts` lines 366-373, 411-418): Properties use `type: 'string'` (not nullable). This is valid JSON Schema, but without `strict: true` the model may not always comply. If the model returns `null` for a required string field, `normalizeString()` would return `''` -- functionally safe but semantically wrong.

2. **SEO schema** (`event-content.ts` lines 200-229): Uses `type: ['string', 'null']` for nullable fields and `minItems`/`maxItems` on arrays. The `minItems`/`maxItems` constraints are only enforced when `strict: true` is set. Without it, the model may return fewer or more items.

3. **`strict: true` is absent everywhere**: OpenAI's structured outputs feature requires `strict: true` in the `json_schema` to guarantee schema compliance. Without it, the model makes a "best effort" but can produce non-conforming output. This applies to both event content AND receipt classification.

**Impact**: Non-deterministic schema compliance. Most of the time it works, but edge cases produce malformed responses that hit the JSON parse catch block.

**Fix**: Add `strict: true` to all `json_schema` definitions. Note: `strict: true` requires all properties to be listed in `required` and does not support `minItems`/`maxItems` -- those constraints would need to move to the prompt text.

---

### HIGH-3: `max_tokens: 900` may truncate long descriptions (severity: High)

**What**: The SEO content function requests a "300+ word" long description plus meta title, meta description, short description, highlights array, keywords array, and slug -- all within `max_tokens: 900`.

A 300-word paragraph alone is roughly 400-500 tokens. Add the JSON structure, other fields, and arrays, and 900 tokens is tight. If the model hits the limit, the JSON output is truncated mid-stream, causing a parse failure.

**Impact**: Intermittent "Unable to parse AI response" errors, especially for events with longer names or more complex descriptions.

**Fix**: Increase `max_tokens` to at least 1500-2000 for the SEO function. For promotion content (700/600 tokens), the risk is lower but still present for verbose descriptions.

---

### HIGH-4: Module-level cache in a `'use server'` file on Vercel (severity: High)

**What**: `src/lib/openai/config.ts` uses module-level variables (`cachedConfig`, `cacheExpiresAt`) for in-memory caching. This file has `'use server'` directive.

On Vercel serverless functions:
- Each cold start gets a fresh module scope -- cache is empty
- Warm invocations on the **same instance** share the cache -- this works
- Different instances (horizontal scaling) have independent caches -- this is fine (just redundant DB reads)
- **Risk**: The cache is per-instance and per-isolate. Under Vercel's function bundling, if `getOpenAIConfig` is called from different server actions that end up in different bundles, each bundle gets its own module scope and its own cache. This means the "5-minute cache" may not actually reduce DB calls as much as expected.

**Impact**: Not a correctness bug, but the caching is less effective than it appears. More importantly, `clearOpenAIConfigCache()` only clears the cache for the current instance -- other running instances retain stale config until their 5-minute TTL expires. If an admin changes the API key via settings, the change may take up to 5 minutes to propagate.

**Fix**: Document this behaviour. Consider reducing TTL to 1-2 minutes, or use a more explicit cache invalidation pattern (e.g., revalidateTag if using Next.js cache).

---

## 4. Medium Findings

### MED-1: Double response body consumption risk (severity: Medium)

**What**: In the error path (e.g., line 479):
```typescript
console.error('OpenAI promotion generation failed', await response.text())
return { success: false, error: 'OpenAI request failed.' }
```

The `response.text()` call consumes the response body. This is fine here because the function returns immediately after. However, if someone refactors this to also read `response.json()` in the error path, it will throw "body already consumed." The pattern is fragile.

**Impact**: No current bug, but a maintenance hazard.

**Fix**: Store the body in a variable: `const body = await response.text(); console.error(..., body);`

---

### MED-2: No top-level try/catch in server actions (severity: Medium)

**What**: Neither `generateEventSeoContent` nor `generateEventPromotionContent` has a top-level try/catch. If any unexpected error occurs (e.g., Supabase client creation fails, `createClient()` throws, network error on fetch without retry), the error propagates as an unhandled server action error.

**Comparison**: The client component (`EventPromotionContentCard.tsx`) does have a try/catch around `handleGenerate()` (line 204-239), but it catches the error generically as "Failed to generate content." The actual error details are lost.

**Impact**: Unhandled exceptions in server actions produce opaque "Server Error" responses to the client. The client's catch block shows a generic toast, losing diagnostic information.

**Fix**: Wrap each server action body in try/catch, log the full error server-side, return `{ success: false, error: 'An unexpected error occurred.' }`.

---

### MED-3: `any` type casts in data access (severity: Medium)

**What**: Lines 131-133 of `event-content.ts`:
```typescript
categoryName: Array.isArray((data as any).category_details)
  ? (data as any).category_details[0]?.name
  : (data as any).category_details?.name,
```

This casts to `any` three times to access `category_details` from the Supabase join. This bypasses TypeScript's type safety entirely.

**Impact**: If the Supabase schema or join changes, TypeScript won't catch the breakage. Also violates project convention ("No `any` types unless absolutely justified with a comment").

**Fix**: Type the Supabase query response properly, or at minimum add a comment justifying the cast.

---

### MED-4: No usage tracking / cost tracking (severity: Medium)

**What**: Receipt classification tracks token usage and calculates cost (`ClassificationUsage` type with `promptTokens`, `completionTokens`, `cost`). Event content generation discards the `usage` object from the OpenAI response entirely.

**Impact**: No visibility into event content generation costs. For a pub generating content for dozens of events, this is a blind spot.

**Fix**: Extract `payload.usage` and either return it to the caller or log it for monitoring.

---

## 5. Low / Info Findings

### LOW-1: Model default may not support `json_schema` response format (severity: Low)

**What**: Default model is `gpt-4o-mini`. This model does support `response_format: { type: 'json_schema' }` (structured outputs). However, if the admin configures a different model via `system_settings` (e.g., an older model like `gpt-3.5-turbo`), it may not support this feature and will return a 400 error.

**Fix**: Validate model compatibility or document supported models in settings UI.

---

### LOW-2: SEO `max_tokens` vs promotion `max_tokens` inconsistency (severity: Low)

**What**: SEO function uses `max_tokens: 900` for a much larger output (7 fields including 300+ word description), while promotion functions use 600-700 for just 2 fields. The SEO function should have a higher limit.

---

### LOW-3: No rate limiting on content generation (severity: Low)

**What**: A user can spam the "Generate" button rapidly, triggering multiple concurrent OpenAI API calls. The client disables the button during generation (`isGenerating` state), but a determined user or a stuck UI state could cause excessive API usage.

**Fix**: Consider server-side rate limiting per user for content generation endpoints.

---

### INFO-1: Promotion content not auto-saved (severity: Info)

**What**: The UI explicitly states "Generated copy is not saved automatically" and the component receives `facebookName`, `facebookDescription`, `googleTitle`, `googleDescription` props for pre-populating from saved data. This is a deliberate design choice, not a bug. However, there is no save action visible in the reviewed code -- saving must happen elsewhere (likely in a parent form).

---

## 6. Architecture Assessment

### Strengths
- Clean separation: server action -> config loader -> external API -> parse -> return
- No write side effects -- these are pure read+compute operations
- Permission check at entry point of every action
- Config caching reduces DB round-trips
- Client component properly handles loading, error, and success states
- Existing saved results are hydrated via props (server-rendered)

### Weaknesses
- **Inconsistent patterns across OpenAI consumers**: Receipt classification uses `retry()`, extracts usage, has `extractContent()` helper. Event content uses none of these. This suggests the event content code was written independently without referencing the established pattern.
- **No shared OpenAI client abstraction**: Both consumers duplicate the fetch-to-OpenAI pattern. A shared `callOpenAI()` function could enforce retry, timeout, error handling, and usage tracking consistently.
- **Config loader in `'use server'` file**: Mixing config loading (which could be a plain module) with the `'use server'` directive adds unnecessary constraints on bundling and caching.

---

## 7. Technical Debt

| Item | Effort | Impact |
|------|--------|--------|
| Extract shared `callOpenAI()` utility with retry, timeout, error mapping | M | High -- eliminates CRIT-1, CRIT-2, HIGH-1 in one change |
| Add `strict: true` to all JSON schemas | S | Medium -- prevents non-conforming responses |
| Increase SEO `max_tokens` to 1500+ | XS | Medium -- prevents truncation failures |
| Add top-level try/catch to both server actions | S | Medium -- prevents unhandled error propagation |
| Type the Supabase query response properly (remove `any` casts) | S | Low -- type safety |
| Add usage/cost tracking to event content | S | Low -- operational visibility |

---

## 8. Summary of Findings by Severity

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 3 | CRIT-1 (no retry), CRIT-2 (no timeout), CRIT-3 (retry doesn't cover HTTP 5xx) |
| High | 4 | HIGH-1 (opaque errors), HIGH-2 (schema validity), HIGH-3 (token truncation), HIGH-4 (cache semantics) |
| Medium | 4 | MED-1 (body consumption), MED-2 (no top-level try/catch), MED-3 (any casts), MED-4 (no cost tracking) |
| Low | 3 | LOW-1 (model compatibility), LOW-2 (token limit inconsistency), LOW-3 (no rate limiting) |
| Info | 1 | INFO-1 (no auto-save by design) |

**Recommended priority**: Extract a shared `callOpenAI()` utility that wraps retry (with throw-on-5xx inside the retry loop), AbortController timeout, status-specific error messages, and usage extraction. Apply it to both event content and receipt classification. This single change resolves or mitigates 5 of the 7 Critical/High findings.
