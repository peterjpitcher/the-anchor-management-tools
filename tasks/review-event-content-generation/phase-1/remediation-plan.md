# Remediation Plan — Event Content Generation

## Approach
Minimal, focused fixes. No shared utility extraction (that's a larger refactor). Fix the reported bug and the critical reliability gaps in `event-content.ts` and the UI component.

## Fix Order (dependency-aware)

### Critical Fixes (actively blocking users)

**Fix C-001**: Add status-specific error handling + try/catch + retry + timeout to `generateEventPromotionContent` and `generateEventSeoContent`
- Addresses: DEFECT-001, DEFECT-002, DEFECT-003, DEFECT-004, DEFECT-007
- Approach:
  1. Wrap fetch in try/catch for network errors
  2. Add AbortController with 30s timeout
  3. Wrap in retry() with throw-on-5xx inside callback so RetryConfigs.api works
  4. Replace `'OpenAI request failed.'` with status-specific messages
  5. Increase SEO max_tokens from 900 to 1500
- Files: `src/app/actions/event-content.ts`

### Structural Fixes

**Fix S-001**: Clear AI unavailable banner on retry + improve detection
- Addresses: DEFECT-005, DEFECT-006
- Approach:
  1. Add `setAiUnavailableMessage(null)` at the start of `handleGenerate`
  2. Update detection to match new status-specific error messages (auth errors, not just "configure")
- Files: `src/components/features/events/EventPromotionContentCard.tsx`

## Out of Scope (logged for future)
- Extract shared `callOpenAI()` utility (larger refactor affecting receipt classification and other consumers)
- Fix the same retry-doesn't-retry-5xx bug in receipt classification (`src/lib/openai.ts`)
- Add usage/cost tracking
- Add `strict: true` to JSON schemas (requires schema adjustments)
- Permission gating on the promotion card UI
- Character limit validation
