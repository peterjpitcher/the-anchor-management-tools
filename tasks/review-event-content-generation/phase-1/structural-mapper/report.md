# Structural Mapper Report: Event Content Generation

## 1. File Inventory

| # | File Path | Primary Concern | Key Exports | Flags |
|---|-----------|----------------|-------------|-------|
| 1 | `src/app/actions/event-content.ts` | Server action: OpenAI calls for event SEO + promotion copy | `generateEventSeoContent`, `generateEventPromotionContent`, `EventPromotionContentType`, `EventPromotionInput` | NO retry, NO try/catch around fetch, NO `strict: true` on json_schema, NO audit logging |
| 2 | `src/lib/openai/config.ts` | OpenAI config loader (env + system_settings DB) | `getOpenAIConfig`, `clearOpenAIConfigCache` | Marked `'use server'`; 5-min module-level cache; uses admin client |
| 3 | `src/components/features/events/EventPromotionContentCard.tsx` | Client component: UI for generating/displaying Facebook/GBP copy | `EventPromotionContentCard` | `'use client'`; no save-to-DB functionality; generated copy is ephemeral |
| 4 | `src/lib/openai.ts` | Receipt classification via OpenAI (WORKING reference) | `classifyReceiptTransaction`, `classifyReceiptTransactionsBatch` | Uses `retry(fn, RetryConfigs.api)`; extracts usage/cost; returns `null` on failure (not error object) |
| 5 | `src/lib/retry.ts` | Generic retry with backoff, circuit breaker | `retry`, `RetryConfigs`, `CircuitBreaker`, `Retryable` | `RetryConfigs.api`: 5 attempts, exponential backoff, retries on network + 5xx |
| 6 | `src/app/actions/rbac.ts` | Permission checking server actions | `checkUserPermission`, `getUserPermissions`, etc. | Used by event-content for `events:manage` check |
| 7 | `src/lib/supabase/server.ts` | Cookie-based auth Supabase client | `createClient` | Used by event-content for DB queries |
| 8 | `src/lib/supabase/admin.ts` | Service-role Supabase client | `createAdminClient` | Used by config loader for system_settings |
| 9 | `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` | Parent page: renders EventPromotionContentCard | (component) | Passes `eventId`, `eventName`, `brief`, `marketingLinks`, saved facebook/gbp fields |
| 10 | `src/types/database.ts` | Type definitions | `Event` type | Contains `facebook_event_name`, `facebook_event_description`, `gbp_event_title`, `gbp_event_description` |
| 11 | `src/app/actions/ai-menu-parsing.ts` | Menu ingredient parsing via OpenAI (WORKING reference) | `parseMenuIngredient` | Uses `retry()` AND `strict: true` in json_schema |
| 12 | `src/app/actions/calendar-notes.ts` | Calendar note generation via OpenAI (WORKING reference) | calendar note gen functions | Uses raw fetch (no retry), no `strict: true`, but same json_schema pattern |

---

## 2. Flow Map

### Flow A: Generate Promotion Content (Facebook / GBP)

**Entry**: `EventPromotionContentCard.handleGenerate()` (client) calls server action `generateEventPromotionContent()`

1. **Permission check** -- `checkUserPermission('events', 'manage')` via `rbac.ts` -> `PermissionService.checkUserPermission()` -> Supabase auth client -> `user_roles`/`role_permissions` tables
2. **Load OpenAI config** -- `getOpenAIConfig()` -> check module-level cache -> if expired: read `process.env.OPENAI_API_KEY` + query `system_settings` table via admin client -> merge env + DB values -> cache for 5 min
3. **Guard**: if `apiKey` is null, return `{ success: false, error: 'OpenAI is not configured...' }`
4. **Fetch event from DB** -- `supabase.from('events').select(...)` with join to `event_categories(name)` -> `.eq('id', eventId).single()`
5. **Build prompt** -- Assemble `detailLines[]` from event fields; select prompt variant via `switch(contentType)` for `facebook_event` or `google_business_profile_event`; configure `schemaName`, `schema`, `maxTokens`, `temperature`, `messages`
6. **Call OpenAI API** -- Raw `fetch()` to `${baseUrl}/chat/completions` with `json_schema` response_format. **NO retry wrapper. NO try/catch around fetch.**
7. **Check response** -- if `!response.ok`, log error text via `console.error`, return `{ success: false, error: 'OpenAI request failed.' }`
8. **Parse response** -- `payload.choices[0].message.content` -> `JSON.parse()` inside try/catch
9. **Normalize output** -- `normalizeString()` on each field
10. **Return** -- `{ success: true, data: { type, content } }`

**Client receives response**:
11. If `!response.success` -> `toast.error(errorMessage)` + check for "openai"+"configure" to set `aiUnavailableMessage`
12. If success -> `setResultsByType()` updates state -> renders in read-only fields
13. User must manually copy/paste generated content (no auto-save)

### Flow B: Generate SEO Content

**Entry**: Not rendered in EventPromotionContentCard. Called from elsewhere (or unused).

1. **Permission check** -- same as Flow A
2. **Load OpenAI config** -- same as Flow A
3. **Guard** -- same as Flow A
4. **Optionally fetch event from DB** -- only if `input.eventId` provided; uses `.maybeSingle()` (not `.single()`)
5. **Merge input** -- DB event overrides caller-supplied fields
6. **Build prompt** -- `buildEventSummary()` creates JSON payload; system prompt for SEO; user prompt with priorities
7. **Call OpenAI API** -- Raw `fetch()`, `max_tokens: 900`. **NO retry. NO try/catch around fetch.**
8. **Check + parse** -- same pattern as Flow A
9. **Return** -- `{ success: true, data: { metaTitle, metaDescription, shortDescription, longDescription, highlights, keywords, slug } }`

### Flow C: OpenAI Config Loading

1. Check module-level `cachedConfig` and `cacheExpiresAt`
2. If cache valid and `forceRefresh` not set -> return cached
3. Read `process.env.OPENAI_API_KEY` and `process.env.OPENAI_BASE_URL`
4. Call `loadConfigFromSettings()` -> `createAdminClient()` -> query `system_settings` table for keys in `SETTINGS_CANDIDATES`
5. Iterate candidates in priority order; check `enabled`/`disabled` flags; extract `apiKey`, `baseUrl`, `receiptsModel`, `eventsModel` via `pickString()`
6. Merge: env vars take precedence over DB settings; DB settings override defaults
7. Cache result for 5 minutes
8. Return `{ apiKey, baseUrl, receiptsModel, eventsModel }`

---

## 3. Data Model Map

### `events` table (relevant fields)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `name` | text | Required |
| `date` | date | Nullable |
| `time` | time | Nullable |
| `end_time` | time | Nullable |
| `doors_time` | time | Nullable |
| `last_entry_time` | time | Nullable |
| `duration_minutes` | integer | Nullable |
| `capacity` | integer | Nullable |
| `price` | numeric | Nullable |
| `is_free` | boolean | Nullable |
| `brief` | text | Nullable |
| `short_description` | text | Nullable |
| `long_description` | text | Nullable |
| `booking_url` | text | Nullable |
| `performer_name` | text | Nullable |
| `performer_type` | text | Nullable |
| `category_id` | uuid | FK -> event_categories |
| `facebook_event_name` | text | Nullable; pre-saved copy |
| `facebook_event_description` | text | Nullable; pre-saved copy |
| `gbp_event_title` | text | Nullable; pre-saved copy |
| `gbp_event_description` | text | Nullable; pre-saved copy |

### `event_categories` table

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `name` | text | Joined via `category:event_categories(name)` |

### `system_settings` table

| Field | Type | Notes |
|-------|------|-------|
| `key` | text | PK or unique; searched for OpenAI config candidates |
| `value` | jsonb | Holds API key, base URL, model overrides, enabled/disabled flags |

---

## 4. External Dependency Map

### OpenAI API

| Aspect | Detail |
|--------|--------|
| Service | OpenAI Chat Completions (`/chat/completions`) |
| How called | Raw `fetch()` -- no SDK, no retry wrapper |
| Auth | `Authorization: Bearer ${apiKey}` header |
| Used in Flow A | Step 6 -- facebook_event or google_business_profile_event copy generation |
| Used in Flow B | Step 7 -- SEO content generation |
| Response format | `json_schema` structured output (NOT using `strict: true`) |
| Models | Default `gpt-4o-mini`; configurable via env or system_settings |

### Supabase (PostgreSQL)

| Aspect | Detail |
|--------|--------|
| Auth client | Cookie-based via `createClient()` from `server.ts` -- used for event lookup + permission check |
| Admin client | Service-role via `createAdminClient()` from `admin.ts` -- used by config loader for `system_settings` |
| Tables read | `events`, `event_categories`, `system_settings`, `user_roles`, `role_permissions` |
| Tables written | NONE -- generated content is not saved |

---

## 5. Critical Differences: Event Content vs Working Patterns

### Event Content (`event-content.ts`) vs Receipt Classification (`openai.ts`)

| Aspect | Receipt Classification (WORKS) | Event Content (BROKEN) |
|--------|-------------------------------|----------------------|
| **Retry** | `retry(fn, RetryConfigs.api)` -- 5 attempts, exponential backoff | **NONE** -- bare `fetch()`, single attempt |
| **Error on !ok** | Returns `null` (silent degradation) | Returns `{ success: false, error: 'OpenAI request failed.' }` (opaque) |
| **try/catch around fetch** | Implicit via retry wrapper (catches thrown errors) | **NONE** -- network error = unhandled rejection = 500 to client |
| **Content extraction** | `extractContent()` handles string and array content | Direct `payload?.choices?.[0]?.message?.content` -- no array handling |
| **Usage tracking** | Extracts `promptTokens`, `completionTokens`, calculates cost | **NONE** |
| **strict mode** | Not used (but schema has `enum` constraints) | Not used |

### Event Content vs Menu Parsing (`ai-menu-parsing.ts`)

| Aspect | Menu Parsing (WORKS) | Event Content (BROKEN) |
|--------|---------------------|----------------------|
| **Retry** | `retry(fn, RetryConfigs.api)` | **NONE** |
| **`strict: true`** | **YES** -- `json_schema.strict = true` | **NO** |

### Event Content vs Calendar Notes (`calendar-notes.ts`)

| Aspect | Calendar Notes | Event Content |
|--------|---------------|---------------|
| **Retry** | NONE (same gap) | NONE |
| **`strict: true`** | NO | NO |
| **Error handling** | Same pattern: `console.error` + return error string | Same |

---

## 6. Missing Pieces Inventory

### Critical (likely causes of the reported bug)

1. **No try/catch around `fetch()`** -- If the OpenAI API is unreachable or the fetch throws (DNS, timeout, TLS), the server action throws an unhandled error. The client `catch` block in `handleGenerate` catches this as a generic "Failed to generate content" but the real error is lost. This is the most likely failure mode.

2. **No retry logic** -- Every other working OpenAI integration in this codebase uses `retry(fn, RetryConfigs.api)`. Event content does not. Transient 5xx errors, rate limits (429), or network blips will fail immediately with no recovery.

3. **No `strict: true` on json_schema** -- The `ai-menu-parsing.ts` pattern (which works) sets `strict: true` in the `json_schema` object. Without it, the model may not reliably conform to the schema, potentially causing parse failures.

4. **max_tokens potentially too low for SEO** -- `generateEventSeoContent` sets `max_tokens: 900` but requests a 300+ word long description plus meta fields, highlights, keywords, and a slug. This could cause truncated JSON that fails to parse.

### Important (quality/reliability gaps)

5. **No audit logging** -- Both `generateEventSeoContent` and `generateEventPromotionContent` skip `logAuditEvent()`. Every other mutation in the codebase audits.

6. **No usage/cost tracking** -- Receipt classification extracts and returns token usage and cost. Event content discards this data entirely.

7. **Generated content not auto-saved** -- DB has `facebook_event_name`, `facebook_event_description`, `gbp_event_title`, `gbp_event_description` columns. The UI shows "Generated copy is not saved automatically" -- but there's no save button either. The existing saved values are loaded as initial state but there's no write path.

8. **No content extraction helper** -- Receipt classification uses `extractContent()` which handles both string and array content formats. Event content assumes `content` is always a string.

9. **`generateEventSeoContent` appears unused from the promotion card** -- The card only calls `generateEventPromotionContent`. No UI was found that calls `generateEventSeoContent`. It may be called from the event edit form or be dead code.

### Minor

10. **Opaque error messages** -- User sees "OpenAI request failed." with no detail. The actual API error (e.g., invalid model name, quota exceeded, malformed schema) is only in server logs.

11. **Config `'use server'` directive on config.ts** -- `src/lib/openai/config.ts` has `'use server'` at the top. This is a library file, not a server action file. The directive is unnecessary (it's only imported by other server files) but harmless.

12. **Module-level cache in serverless** -- `cachedConfig` is a module-level variable. In serverless (Vercel), each cold start resets it. The 5-min TTL only benefits within a single warm instance. Not a bug but may cause unexpected config staleness or freshness.

---

## 7. Architecture Diagram

```
EventDetailClient.tsx (client)
    |
    | calls server action
    v
generateEventPromotionContent() [event-content.ts]
    |
    +--> checkUserPermission('events', 'manage') [rbac.ts]
    |       |
    |       +--> PermissionService -> Supabase (user_roles, role_permissions)
    |
    +--> getOpenAIConfig() [openai/config.ts]
    |       |
    |       +--> process.env.OPENAI_API_KEY
    |       +--> createAdminClient() -> Supabase (system_settings)
    |
    +--> supabase.from('events').select(...) -> Supabase (events, event_categories)
    |
    +--> fetch('https://api.openai.com/v1/chat/completions')  <-- NO RETRY, NO TRY/CATCH
    |
    +--> JSON.parse(response) -> normalize -> return { success, data }
```
