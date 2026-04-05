# Business Rules Auditor Report: Event Content Generation

**Auditor**: Business Rules Auditor
**Section**: Event Content Generation (Promotion Copy)
**Files audited**:
- `src/app/actions/event-content.ts`
- `src/lib/openai/config.ts`
- `src/components/features/events/EventPromotionContentCard.tsx`
- `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` (parent, for context)

---

## 1. Rules Inventory

| # | Rule | Source | Code Location | Verdict |
|---|------|--------|---------------|---------|
| 1 | Only staff with `events:manage` permission can generate AI copy | Business rules | `event-content.ts:288-291` (server), UI has no gate | PARTIAL PASS -- see finding P1 |
| 2 | Two content types: Facebook Event and Google Business Profile | Business rules | `event-content.ts:63-66`, UI `CONTENT_TYPES` array | PASS |
| 3 | Generated copy uses event data from database | Business rules | `event-content.ts:300-328` fetches from DB | PASS |
| 4 | Copy must be UK English, no markdown, no URLs in output | Business rules | Prompt instructions at lines 381, 395-397, 427, 439-441 | PASS |
| 5 | Facebook Event name < 70 chars | Business rules | Prompt says "aim < 70 characters" (line 398) | SOFT PASS -- see finding V1 |
| 6 | GBP title < 80 chars | Business rules | Prompt says "aim < 80 characters" (line 444) | SOFT PASS -- see finding V1 |
| 7 | GBP description < 1500 chars | Business rules | Prompt says "under 1500 characters" (line 443) | SOFT PASS -- see finding V1 |
| 8 | OpenAI API key sourced from env var first, then system_settings DB | Business rules | `config.ts:147-152` -- env takes priority | PASS |
| 9 | Config cached 5 minutes | Business rules | `config.ts:158` -- `5 * 60 * 1000` | PASS |
| 10 | When AI is unavailable, staff should be informed clearly | Business rules | Multiple locations | FAIL -- see finding P2 |
| 11 | The venue is "The Anchor" -- always referenced correctly | Business rules / CLAUDE.md | `event-content.ts:342` "Venue: The Anchor", SEO prompt line 175 | PASS |
| 12 | Copy is generated fresh each time (not saved automatically) | Business rules | UI text at line 261, 381 | PASS |
| 13 | Server actions must re-verify auth server-side | CLAUDE.md | `event-content.ts:288-291` calls `checkUserPermission` | PASS |

---

## 2. Value Audit

| Value | Location | In Code | Expected | Match? |
|-------|----------|---------|----------|--------|
| Facebook name char limit | Prompt, line 398 | "aim < 70 characters" | < 70 chars | YES (soft -- "aim", not enforced) |
| GBP title char limit | Prompt, line 444 | "aim < 80 characters" | < 80 chars | YES (soft -- "aim", not enforced) |
| GBP description char limit | Prompt, line 443 | "under 1500 characters" | < 1500 chars | YES (soft -- prompt only, not enforced) |
| Facebook temperature | `event-content.ts:375` | 0.8 | Not specified externally | N/A |
| GBP temperature | `event-content.ts:419` | 0.7 | Not specified externally | N/A |
| Facebook max_tokens | `event-content.ts:376` | 700 | Not specified externally | N/A |
| GBP max_tokens | `event-content.ts:420` | 600 | Not specified externally | N/A |
| SEO max_tokens | `event-content.ts:230` | 900 | Not specified externally | N/A |
| SEO temperature | `event-content.ts:170` | 0.7 | Not specified externally | N/A |
| Config cache TTL | `config.ts:158` | 5 minutes (300,000ms) | 5 minutes | YES |
| Default model | `config.ts:14-15` | `gpt-4o-mini` | Not specified externally | N/A |
| Default base URL | `config.ts:12` | `https://api.openai.com/v1` | Standard OpenAI endpoint | YES |
| SEO highlights count | `event-content.ts:212-213` | min 3, max 6 | Prompt says "3-5" | MISMATCH -- schema allows 6, prompt says 5 |
| SEO keywords count | `event-content.ts:217-218` | min 6, max 12 | Prompt says "6-10" | MISMATCH -- schema allows 12, prompt says 10 |

---

## 3. Customer-Facing Language Audit

There is no customer-facing language in this section. All generated copy is presented to staff for manual copy/paste into Facebook and Google Business Profile. The AI-generated text itself is not directly published to customers from this code path.

**Verdict**: N/A -- no direct customer-facing output.

---

## 4. Admin/Staff-Facing Language Audit

| Text | Location | Accurate? | Issue |
|------|----------|-----------|-------|
| "AI Event Copy Builder" | UI line 258 | YES | Clear heading |
| "Generate channel-specific event copy. Generated copy is not saved automatically." | UI line 259-261 | YES | Accurately describes behavior |
| "Brief snapshot" | UI line 266 | YES | Shows the event brief |
| "Content type" | UI line 274 | YES | Dropdown label |
| "Facebook Event" / "Event name + description formatted for Facebook Events." | UI lines 39-41 | YES | Accurate |
| "Google Business Profile Event" / "Title + description optimised for GBP Event posts." | UI lines 43-46 | YES | Accurate |
| "CTA link" | UI line 296 | YES | Clear |
| "Defaults to the best-fit UTM link for this channel. The URL is not included in the generated copy." | UI line 319 | YES | Accurate -- URLs are excluded from AI output |
| "No marketing links yet--refresh links above or enter a custom URL below." | UI line 324 | YES | Actionable |
| "Paste into the Facebook Event link field" | UI line 65 | YES | Clear instruction |
| "Paste into the GBP post button link field" | UI line 67 | YES | Clear instruction |
| "Generates fresh copy every time--run it again if you need a new angle." | UI line 381 | YES | Accurate |
| "Working..." | UI line 392 | YES | Loading state |
| "Generate [type] copy" | UI line 392 | YES | Dynamic button label |
| "Copy ready" | UI line 233 | YES | Success toast |
| "Copy all" / "Copy link" / "Copy event name" etc. | Various | YES | Clipboard actions |
| **"OpenAI request failed."** | `event-content.ts:480` | **NO** | **Non-actionable. Staff cannot diagnose.** See P2 |
| **"OpenAI returned no content."** | `event-content.ts:486` | **NO** | **Non-actionable. Staff cannot diagnose.** See P2 |
| **"Unable to parse AI response."** | `event-content.ts:494` | **NO** | **Non-actionable.** See P2 |
| "OpenAI is not configured. Add an API key in Settings." | `event-content.ts:298` | YES | Actionable for admins |
| "You do not have permission to generate content." | `event-content.ts:290` | YES | Clear |
| "Event not found." | `event-content.ts:327` | YES | Clear |
| "Failed to generate content" (client catch) | UI line 236 | Partially | Generic fallback, acceptable |
| "AI copy generation is disabled. Add an OpenAI API key on the settings page to enable it." | UI line 214 | YES | Actionable, but only shown for one specific error pattern. See P3 |
| Description char count: "Description (X chars)" | UI lines 441, 504 | YES | Helpful for staff checking limits |

---

## 5. Policy Drift Findings

### P1 -- UI Does Not Gate the Promotion Card by Permission (MEDIUM)

**Finding**: The `EventPromotionContentCard` is rendered for ALL users who can see the event detail page (`EventDetailClient.tsx` line 1220). There is no `canManageEvents` check wrapping it. The server action correctly rejects unauthorized users at line 288-291, but staff without `events:manage` permission will see the full UI, click "Generate", and only then receive a permission error toast.

**Impact**: Confusing UX. Staff see a feature they cannot use. The generate button should be hidden or the entire card should be conditionally rendered.

**Expected behavior**: The card (or at minimum the generate button) should only be visible to users with `events:manage` permission, matching how other features in this page are gated (e.g., line 1236 `canManageEvents && (`).

---

### P2 -- Error Messages Are Not Actionable (HIGH -- Known Problem)

**Finding**: Three error messages shown to staff are developer-oriented, not staff-oriented:

1. **"OpenAI request failed."** (line 480) -- This is the primary complaint. The HTTP response body is logged to `console.error` but the useful detail (rate limit? invalid key? model not found? network timeout?) is discarded. Staff see a dead-end message.

2. **"OpenAI returned no content."** (line 486) -- Could mean the model returned an empty response, a content filter triggered, or `max_tokens` was too low. Staff cannot act on this.

3. **"Unable to parse AI response."** (line 494) -- Means the model returned non-JSON despite `response_format: json_schema`. Staff cannot act on this.

**Recommendation**: Parse the HTTP status code and surface category-specific messages:
- 401/403: "AI API key is invalid or expired. Contact your admin."
- 429: "AI service is rate-limited. Try again in a minute."
- 500/502/503: "AI service is temporarily unavailable. Try again shortly."
- Network error: "Could not reach the AI service. Check your internet connection."
- Empty/parse failure: "The AI returned an unexpected response. Try generating again."

---

### P3 -- AI Unavailable Detection Is Incomplete (MEDIUM)

**Finding**: The UI sets `aiUnavailableMessage` (which permanently disables the generate button) only when the error message contains both "openai" AND "configure" (line 212-213). This correctly catches the "OpenAI is not configured" error from line 298.

However, if the API key becomes invalid after initial load (e.g., revoked, expired), the error returned is "OpenAI request failed." which does NOT match the detection pattern. The button remains enabled, and staff will get the same unhelpful error repeatedly.

Additionally, if the `system_settings` row has `enabled: false` or `disabled: true`, the config loader returns `apiKey: null` (config.ts lines 89, 122), which correctly triggers the "not configured" message. This path works.

**Missing detection**:
- 401 response (invalid/revoked key) -- should disable the button or show a different banner
- Persistent failures (e.g., 3 consecutive failures) -- no circuit breaker

---

### P4 -- Character Limits Are Prompt-Only, Not Validated (LOW)

**Finding**: The Facebook Event name limit (< 70 chars), GBP title limit (< 80 chars), and GBP description limit (< 1500 chars) are communicated to the AI via prompt text only. There is no server-side or client-side validation that the returned content actually respects these limits. LLMs routinely exceed prompted character limits.

The UI helpfully shows the character count for descriptions (lines 441, 504), but does not show it for the Facebook Event name or GBP title. There is no visual warning when a limit is exceeded.

**Impact**: Staff may paste content into Facebook/GBP that gets silently truncated, creating broken-looking posts.

**Recommendation**: Add client-side character count display for name/title fields, and show a warning badge when the limit is exceeded.

---

### P5 -- SEO Schema Min/Max Mismatches with Prompt (LOW)

**Finding**: The SEO generation prompt says "3-5 punchy highlights" and "6-10 targeted keyword phrases" but the JSON schema allows `minItems: 3, maxItems: 6` for highlights and `minItems: 6, maxItems: 12` for keywords. The schema is more permissive than the prompt text.

**Impact**: Minor inconsistency. The model may return 6 highlights or 12 keywords, which is fine functionally but contradicts the written specification.

---

### P6 -- No Timeout on OpenAI Fetch Calls (MEDIUM)

**Finding**: The `fetch()` calls to OpenAI at lines 162 and 457 have no `AbortSignal` timeout. If OpenAI is slow or unresponsive, the server action will hang until the platform's default timeout (Vercel: 10s for hobby, 60s/300s for pro/enterprise). During this time the UI shows "Working..." with no way to cancel.

**Impact**: Staff may wait a long time with no feedback, then get a generic timeout error. No retry mechanism exists.

---

### P7 -- Config Cache Is Module-Level, Not Per-Request (LOW)

**Finding**: `config.ts` uses module-level variables (`cachedConfig`, `cacheExpiresAt`) for caching. In a serverless environment (Vercel), this cache lives per-isolate and is not shared across instances. This is generally fine for a 5-minute TTL, but means:
- Different concurrent requests may hit the DB or not, depending on which isolate serves them
- After a deployment, all caches are cold simultaneously

This is acceptable behavior but worth noting -- it is not a bug.

---

### P8 -- Promotion Card Visible Even for Cancelled/Draft Events (LOW)

**Finding**: The `EventPromotionContentCard` is rendered regardless of event status. Staff can generate promotional copy for cancelled or draft events. This may be intentional (preparing copy in advance), but there is no visual indicator that generating copy for a cancelled event is unusual.

---

## Summary of Findings by Severity

| Severity | Finding | Description |
|----------|---------|-------------|
| HIGH | P2 | Error messages are non-actionable ("OpenAI request failed.") |
| MEDIUM | P1 | UI shows promotion card to users without `events:manage` permission |
| MEDIUM | P3 | AI unavailable detection misses 401/revoked key scenarios |
| MEDIUM | P6 | No timeout on OpenAI fetch calls |
| LOW | P4 | Character limits not validated, only prompted |
| LOW | P5 | SEO schema min/max mismatches with prompt text |
| LOW | P7 | Module-level cache is per-isolate (acceptable) |
| LOW | P8 | Card shown for cancelled/draft events with no warning |
