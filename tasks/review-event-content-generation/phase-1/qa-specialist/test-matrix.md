# Test Matrix: Event Content Generation

## Legend

- **Status**: PASS (code handles correctly), FAIL (defect found), WARN (minor issue / improvement needed)
- **Priority**: P0 (blocking), P1 (high), P2 (medium), P3 (low)

---

## 1. Permission Tests

| ID | Category | Scenario | Preconditions | Steps | Expected Result | Actual Result (from tracing) | Status | Priority |
|----|----------|----------|---------------|-------|-----------------|------------------------------|--------|----------|
| TC-001 | Permission | User without `events:manage` calls `generateEventPromotionContent` | User authenticated but lacks permission | Call server action | Returns `{ success: false, error: 'You do not have permission...' }` | Line 288-291: `checkUserPermission('events', 'manage')` called; returns error string on failure | PASS | P0 |
| TC-002 | Permission | User without `events:manage` calls `generateEventSeoContent` | User authenticated but lacks permission | Call server action | Returns permission error | Line 90-93: Same pattern as TC-001 | PASS | P0 |
| TC-003 | Permission | Unauthenticated user calls either action | No session | Call server action | Returns permission error | `checkUserPermission` internally calls `supabase.auth.getUser()`; returns false if no user | PASS | P0 |

---

## 2. Configuration Tests

| ID | Category | Scenario | Preconditions | Steps | Expected Result | Actual Result (from tracing) | Status | Priority |
|----|----------|----------|---------------|-------|-----------------|------------------------------|--------|----------|
| TC-010 | Config | No API key in env or DB | `OPENAI_API_KEY` unset, `system_settings` empty | Call action | Returns `'OpenAI is not configured. Add an API key in Settings.'` | Line 295-297 (promo) / 97-99 (SEO): checks `!apiKey`, returns config error | PASS | P0 |
| TC-011 | Config | API key in env only | `OPENAI_API_KEY` set | Call action | Uses env key, proceeds | `config.ts` line 152: `envApiKey ?? settingsOverrides.apiKey ?? null` -- env takes priority | PASS | P1 |
| TC-012 | Config | API key in DB only | `OPENAI_API_KEY` unset, key in `system_settings` | Call action | Uses DB key, proceeds | `config.ts` line 152: falls through to `settingsOverrides.apiKey` | PASS | P1 |
| TC-013 | Config | API key in both env and DB | Both set | Call action | Env key takes priority | `config.ts` line 152: `envApiKey ??` means env wins | PASS | P1 |
| TC-014 | Config | Config cache stale -- key changed but cache not expired | Key rotated in DB within 5-min cache window | Call action with old cached key | Uses stale key; OpenAI returns 401 | `config.ts` line 143: cache TTL is 5 minutes. Stale key would be used. No force-refresh path from event-content actions. | WARN | P2 |
| TC-015 | Config | `system_settings` row has `enabled: false` | Row exists with enabled=false | Call action | API key not loaded from that row | `config.ts` line 89: `enabledFlag === false` skips the row | PASS | P2 |
| TC-016 | Config | Custom base URL in DB settings | `base_url` property set in system_settings | Call action | Uses custom base URL | `config.ts` line 153: `envBaseUrl ?? settingsOverrides.baseUrl ?? DEFAULT_BASE_URL` | PASS | P2 |
| TC-017 | Config | Custom events model in DB settings | `events_model` property set | Call action | Uses custom model name | `config.ts` line 155: `settingsOverrides.eventsModel ?? DEFAULT_EVENTS_MODEL` | PASS | P2 |

---

## 3. Event Data Loading Tests

| ID | Category | Scenario | Preconditions | Steps | Expected Result | Actual Result (from tracing) | Status | Priority |
|----|----------|----------|---------------|-------|-----------------|------------------------------|--------|----------|
| TC-020 | Data | Event exists in DB with full data | Valid eventId | Call `generateEventPromotionContent` | Event loaded, all fields used in prompt | Line 300-322: selects all needed fields. Line 325: checks `error \|\| !event`. Uses `.single()` which errors if 0 or 2+ rows. | PASS | P0 |
| TC-021 | Data | Event not found in DB | Invalid/deleted eventId | Call `generateEventPromotionContent` | Returns `'Event not found.'` | Line 323 uses `.single()` which returns error if no rows; line 325 catches `error \|\| !event` | PASS | P0 |
| TC-022 | Data | Event with minimal data (only name) | Event row with only `name` populated | Call `generateEventPromotionContent` | Generates with available data; no crash | Line 341-358: all fields use conditional checks (`event.date ?`, `typeof event.capacity === 'number'`, etc.). Null fields omitted from prompt. | PASS | P1 |
| TC-023 | Data | SEO action with eventId -- event exists | Valid eventId in input | Call `generateEventSeoContent` | Loads event from DB, merges with input | Line 104-142: uses `.maybeSingle()` -- no error if missing. DB data merged via `??` operator. | PASS | P1 |
| TC-024 | Data | SEO action with eventId -- event NOT found | Invalid eventId | Call `generateEventSeoContent` | Silently uses input data only (no DB enrichment) | Line 123: `.maybeSingle()` returns null data without error. Line 125: `if (data)` check skips merge. Falls through to use `input` only. | WARN | P2 |
| TC-025 | Data | SEO action without eventId | `eventId` is null/undefined | Call `generateEventSeoContent` | Uses input data directly | Line 104: `if (input.eventId)` guard skips DB query entirely | PASS | P1 |
| TC-026 | Data | Category join returns array vs object | Different Supabase join behavior | Load event | Category name extracted correctly | Line 330-335 (promo) handles both array and non-array. Line 131-133 (SEO) also handles both. | PASS | P2 |

---

## 4. OpenAI API Call Tests

| ID | Category | Scenario | Preconditions | Steps | Expected Result | Actual Result (from tracing) | Status | Priority |
|----|----------|----------|---------------|-------|-----------------|------------------------------|--------|----------|
| TC-030 | API | Happy path -- Facebook Event generation | Valid key, event exists | Generate facebook_event | Returns `{ success: true, data: { type: 'facebook_event', content: { name, description } } }` | Line 362-407: builds FB-specific prompt, schema with `name` + `description` keys. Line 497-503: extracts and normalizes. | PASS | P0 |
| TC-031 | API | Happy path -- GBP Event generation | Valid key, event exists | Generate google_business_profile_event | Returns `{ success: true, data: { type: 'google_business_profile_event', content: { title, description } } }` | Line 408-454: builds GBP-specific prompt, schema with `title` + `description` keys. Line 504-508: extracts and normalizes. | PASS | P0 |
| TC-032 | API | Invalid API key (401) | Wrong key configured | Call action | Returns actionable error explaining the key is invalid | Line 478-480: `if (!response.ok)` logs `response.text()` to console, returns `'OpenAI request failed.'` | **FAIL** | **P0** |
| TC-033 | API | Quota exceeded / rate limited (429) | Key over quota | Call action | Returns actionable error about quota | Same as TC-032: generic `'OpenAI request failed.'` | **FAIL** | **P0** |
| TC-034 | API | Model not available (404) | Invalid model name configured | Call action | Returns actionable error about model | Same as TC-032: generic `'OpenAI request failed.'` | **FAIL** | **P1** |
| TC-035 | API | Bad request (400) -- schema or payload issue | Malformed request | Call action | Returns actionable error | Same as TC-032: generic `'OpenAI request failed.'` | **FAIL** | **P1** |
| TC-036 | API | Server error (500/502/503) | OpenAI outage | Call action | Returns error; ideally retries | Generic error returned. No retry logic used (unlike receipt classification which uses `retry()` wrapper). | **FAIL** | **P1** |
| TC-037 | API | Network error (fetch throws) | DNS failure, timeout, connection refused | Call action | Graceful error returned to user | `fetch()` at line 457 is NOT wrapped in try/catch. The `handleGenerate` in the UI component catches at line 234, but the server action itself will throw an unhandled exception. | **FAIL** | **P0** |
| TC-038 | API | OpenAI returns empty content | `choices[0].message.content` is null/empty | Call action | Returns informative error | Line 484-486: checks `!content`, returns `'OpenAI returned no content.'` | PASS | P1 |
| TC-039 | API | OpenAI returns malformed JSON | Content is not valid JSON | Call action | Returns parse error | Line 490-494: try/catch on `JSON.parse`, returns `'Unable to parse AI response.'` | PASS | P1 |
| TC-040 | API | OpenAI hangs (timeout) | Response never arrives | Call action | Request eventually times out with error | No explicit timeout set on `fetch()`. Server-side fetch has no `AbortController` or `signal`. Will hang until platform timeout (Vercel default 10s for serverless, 60s for streaming). | **FAIL** | **P1** |
| TC-041 | API | SEO: Happy path generation | Valid key, event data | Generate SEO content | Returns structured SEO data with all fields | Line 162-232: sends prompt, line 239-272: parses and returns. Schema enforced via `response_format`. | PASS | P0 |
| TC-042 | API | SEO: max_tokens too low (900) for long description | Complex event with many details | Generate SEO content | Long description may be truncated | Line 230: `max_tokens: 900`. Prompt asks for "300+ words" long description plus meta, highlights, keywords. 900 tokens is roughly 675 words -- borderline. | WARN | P2 |

---

## 5. Response Processing Tests

| ID | Category | Scenario | Preconditions | Steps | Expected Result | Actual Result (from tracing) | Status | Priority |
|----|----------|----------|---------------|-------|-----------------|------------------------------|--------|----------|
| TC-050 | Parse | Promotion: parsed content has empty name/title | OpenAI returns `{ name: "", description: "..." }` | Process response | Normalized to empty string, displayed to user | Line 280-282: `normalizeString` trims but returns empty string. UI line 429: disabled copy button when `content.name.trim().length === 0`. | PASS | P2 |
| TC-051 | Parse | Promotion: parsed content has unexpected extra fields | OpenAI returns extra keys | Process response | Extra keys ignored | `additionalProperties: false` in schema should prevent this. `normalizeString` only reads expected keys. | PASS | P3 |
| TC-052 | Parse | Content is already object (not string) | OpenAI returns parsed object instead of JSON string | Process response | Handled correctly | Line 491: `typeof content === 'string' ? content : JSON.stringify(content)` -- re-serializes then parses. Works but double-encodes. | PASS | P2 |
| TC-053 | Parse | SEO: highlights/keywords arrays empty | OpenAI returns empty arrays | Process response | Returns empty arrays | Line 268-269: `Array.isArray(parsed.highlights) ? parsed.highlights.filter(Boolean) : []` | PASS | P2 |
| TC-054 | Parse | SEO: highlights/keywords are not arrays | Malformed response | Process response | Falls back to empty arrays | Line 268-269: `Array.isArray()` check with `[]` fallback | PASS | P2 |

---

## 6. UI Component Tests

| ID | Category | Scenario | Preconditions | Steps | Expected Result | Actual Result (from tracing) | Status | Priority |
|----|----------|----------|---------------|-------|-----------------|------------------------------|--------|----------|
| TC-060 | UI | Button disabled during generation | User clicks Generate | Observe button state | Button shows "Working..." and is disabled | Line 388: `disabled={isGenerating \|\| Boolean(aiUnavailableMessage)}`. Line 203: `setIsGenerating(true)`. Line 237: `finally { setIsGenerating(false) }`. | PASS | P0 |
| TC-061 | UI | Loading spinner shown during generation | Generation in progress | Observe UI | Spinner icon replaces arrow icon | Line 389: `isGenerating ? <Spinner size="sm" color="gray" /> : <ArrowPathIcon ...>` | PASS | P1 |
| TC-062 | UI | "AI unavailable" message shown when OpenAI not configured | Server returns config error with "configure" keyword | Generate content, get error | Amber banner shown, button permanently disabled | Line 212-215: checks for `'openai'` AND `'configure'` in lowercase error. The actual error is `'OpenAI is not configured. Add an API key in Settings.'` which contains both. Sets `aiUnavailableMessage`. Line 388: button disabled when message set. | PASS | P1 |
| TC-063 | UI | "AI unavailable" detection for non-config errors | Server returns `'OpenAI request failed.'` | Generate content, get error | Should NOT show AI unavailable banner | Line 213: `lowerCase.includes('openai') && lowerCase.includes('configure')` -- `'openai request failed.'` contains `'openai'` but NOT `'configure'`. Banner NOT shown. | PASS | P1 |
| TC-064 | UI | "AI unavailable" banner is permanent (never clears) | AI unavailable was set, then key is added | Navigate away and back, or retry | Banner should clear on successful generation | Line 105: `aiUnavailableMessage` state is initialized to `null`, but there is NO code to clear it back to `null` after a successful generation. Once set, the banner persists and the button stays disabled for the entire component lifecycle. | **FAIL** | **P1** |
| TC-065 | UI | Error toast shown on failure | Server returns error | Observe UI | Toast with error message | Line 216: `toast.error(errorMessage)` | PASS | P1 |
| TC-066 | UI | Success toast on generation | Server returns success | Observe UI | Toast with "Copy ready" | Line 233: `toast.success('Copy ready')` | PASS | P2 |
| TC-067 | UI | Copy individual field (Facebook name) | Content generated | Click copy button on name field | Clipboard updated, toast shown | Line 430: `onClick={() => handleCopy(content.name.trim(), 'Event name')}`. `handleCopy` at line 242 uses `navigator.clipboard.writeText`. | PASS | P1 |
| TC-068 | UI | Copy all (Facebook) | Content generated | Click "Copy all" | Both name and description copied | Line 413: `handleCopy(\`${content.name}\n\n${content.description}\`.trim(), 'Facebook copy')` | PASS | P1 |
| TC-069 | UI | Copy individual field (GBP title) | GBP content generated | Click copy button on title | Clipboard updated | Line 494: `onClick={() => handleCopy(content.title.trim(), 'Title')}` | PASS | P1 |
| TC-070 | UI | Copy all (GBP) | GBP content generated | Click "Copy all" | Both title and description copied | Line 477: `handleCopy(\`${content.title}\n\n${content.description}\`.trim(), copyLabel)` | PASS | P1 |
| TC-071 | UI | Copy button disabled when field empty | Generated content has empty name | Observe copy button | Disabled | Line 429: `disabled={content.name.trim().length === 0}` | PASS | P2 |
| TC-072 | UI | Clipboard API fails | Browser denies clipboard access | Click copy | Error toast shown | Line 247-249: catch block calls `toast.error('Unable to copy')` | PASS | P2 |
| TC-073 | UI | Content type switching preserves results | Generate FB, switch to GBP, switch back | Observe | FB results still visible | `resultsByType` is a map by content type. Switching `contentType` state reads from the map. Previous results preserved. | PASS | P2 |
| TC-074 | UI | Existing saved content loaded on mount | Props `facebookName`, `facebookDescription` provided | Component mounts | Results pre-populated | Line 107-122: `existingSavedResults` memo. Line 124-139: useEffect merges into `resultsByType` only if slot is empty. | PASS | P2 |
| TC-075 | UI | Server action throws (network error) | Fetch throws in server action | Click Generate | Generic error toast shown, loading state cleared | Line 234-238: catch block in `handleGenerate` calls `toast.error('Failed to generate content')` and `finally` clears `isGenerating`. | PASS | P1 |
| TC-076 | UI | "AI unavailable" message persists but could be wrong | Key added after initial failure | User refreshes page | Banner gone (component remounts with fresh state) | State resets on unmount/remount. Only persists within same component instance. Acceptable for page-level component. | PASS | P3 |

---

## 7. Comparison with Receipt Classification (reference pattern)

| ID | Category | Scenario | Preconditions | Steps | Expected Result | Actual Result (from tracing) | Status | Priority |
|----|----------|----------|---------------|-------|-----------------|------------------------------|--------|----------|
| TC-080 | Pattern | Retry on transient failures | Network hiccup during OpenAI call | Call action | Retries with exponential backoff | Receipt classification uses `retry(async () => fetch(...), RetryConfigs.api)`. Event content uses bare `fetch()` with no retry wrapper. | **FAIL** | **P1** |
| TC-081 | Pattern | Error handling granularity | OpenAI returns non-200 | Check error message | Specific error based on status code | Receipt classification returns `null` (caller handles). Event content returns generic `'OpenAI request failed.'` with no status-code-specific messaging. | **FAIL** | **P1** |
| TC-082 | Pattern | Timeout protection | OpenAI hangs | Wait | Controlled timeout | Receipt classification: no explicit timeout either, but retry wrapper will eventually abort after max attempts if fetch throws. Event content: no timeout, no retry. | **FAIL** | **P1** |
| TC-083 | Pattern | Usage/cost tracking | Successful generation | Check response | Token usage and cost reported | Receipt classification extracts `payload.usage` and calculates cost. Event content discards usage entirely. | WARN | P3 |
