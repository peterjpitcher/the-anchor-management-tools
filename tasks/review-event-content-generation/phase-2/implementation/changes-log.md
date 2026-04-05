# Phase 2 Implementation Changes Log

## Files Modified

1. `src/app/actions/event-content.ts`
2. `src/components/features/events/EventPromotionContentCard.tsx`

## Fix C-001: Server Action Resilience (event-content.ts)

### DEFECT-001: Opaque error messages (CRITICAL) — FIXED
- Added `openAIErrorMessage()` helper that returns status-specific messages:
  - 401 → API key invalid/expired
  - 403 → access denied
  - 404 → model not found (includes detail from response body)
  - 429 → rate limit
  - 5xx → service temporarily unavailable
  - Other → generic with status code and detail
- Both `generateEventSeoContent` and `generateEventPromotionContent` now surface these messages in the `{ success: false, error }` return.

### DEFECT-002: No try/catch around fetch() (CRITICAL) — FIXED
- Both server actions now wrap the OpenAI call in try/catch.
- Network errors (DNS failure, connection refused) return `{ success: false, error: 'Unable to reach the AI service...' }`.
- AbortError (timeout) returns a specific timeout message.
- 5xx errors thrown by the retry callback are caught and mapped through `openAIErrorMessage()`.

### DEFECT-003: No retry logic (HIGH) — FIXED
- Added `import { retry, RetryConfigs } from '@/lib/retry'`.
- Created `callOpenAI()` helper that wraps fetch in `retry(..., RetryConfigs.api)`.
- Inside the retry callback, 5xx responses throw (with `.status` and `.responseBody` attached) so the retry utility can catch and retry them.
- 4xx responses are NOT retried (they pass through as a non-ok Response).

### DEFECT-004: No request timeout (HIGH) — FIXED
- `callOpenAI()` creates an `AbortController` with a 30-second timeout (`OPENAI_TIMEOUT_MS = 30_000`).
- Timeout is cleaned up in a `finally` block.
- AbortError is caught in the server action and returns a clear timeout message.

### DEFECT-007: SEO max_tokens too low (MEDIUM) — FIXED
- Increased `max_tokens` from 900 to 1500 in `generateEventSeoContent`.

## Fix S-001: UI Component Fix (EventPromotionContentCard.tsx)

### DEFECT-005: AI unavailable banner never clears (HIGH) — FIXED
- Added `setAiUnavailableMessage(null)` as the first line of `handleGenerate`, before `setIsGenerating(true)`.
- Banner now resets on every retry attempt.

### DEFECT-006: AI unavailable detection misses auth errors (MEDIUM) — FIXED
- Expanded the detection logic from just `openai + configure` to also match:
  - `api key` + (`invalid` or `expired`) — matches the new 401 message
  - `not configured` — matches the existing "not configured" error
- Updated the banner message to: "AI copy generation is unavailable. Check the OpenAI API key on the Settings page."

## Verification

- TypeScript compilation: clean (`npx tsc --noEmit` — zero errors)
- No files created or deleted
- No modifications to `retry.ts`, `openai.ts`, or `config.ts`
