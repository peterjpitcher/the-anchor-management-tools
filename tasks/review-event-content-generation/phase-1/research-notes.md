# Research Notes

## OpenAI API Findings

### `response_format: { type: 'json_schema' }` behaviour
- **Without `strict: true`**: Model makes "best effort" to conform to the schema. Not guaranteed. This is what event-content.ts uses.
- **With `strict: true`**: Full structured output validation. Model output is guaranteed to match the schema. Requires `additionalProperties: false` on every nested object and all properties listed in `required`. Does NOT support `minItems`/`maxItems`.
- **Source**: OpenAI Structured Outputs documentation.
- **Impact**: The current schemas work most of the time but can produce non-conforming output, causing parse failures.

### Common HTTP error codes from `/chat/completions`
- **400**: Invalid request — often schema issues, unsupported model features, or invalid `response_format`
- **401**: Invalid/expired API key
- **403**: Permission denied (e.g., model access restricted)
- **404**: Model not found
- **429**: Rate limit or quota exceeded (includes `Retry-After` header)
- **500/502/503**: OpenAI server issues (transient, should retry)
- The response body is JSON with `error.message` and `error.type` fields.

## `fetch()` Behaviour
- `fetch()` does NOT throw on HTTP 4xx/5xx. It resolves normally with `response.ok === false`.
- `fetch()` ONLY throws on network-level failures (DNS, connection refused, abort signal, etc.).
- **Critical implication**: The `retry()` utility in `src/lib/retry.ts` only catches thrown errors. The `retryIf` check for `error.status >= 500` (line 129) is dead code for fetch-based callers, because fetch never throws with a `status` property.

## Project Convention Findings
- **Receipt classification** (`src/lib/openai.ts`) uses `retry()` wrapper — but due to the fetch/throw issue, it only retries network errors, not HTTP 5xx. This is a latent bug in the "working" code too.
- **Menu parsing** (`src/app/actions/ai-menu-parsing.ts`) uses both `retry()` AND `strict: true` — the most robust pattern in the codebase.
- **Calendar notes** (`src/app/actions/calendar-notes.ts`) uses neither retry nor strict — same gaps as event content.
- The event content code was likely written independently of the receipt classification pattern.

## Key Correction for Remediation
To make retry actually work for HTTP 5xx, the fetch callback must **throw** when it gets a 5xx response:
```typescript
const response = await fetch(url, options)
if (!response.ok && response.status >= 500) {
  throw Object.assign(new Error(`OpenAI ${response.status}`), { status: response.status })
}
return response
```
This allows the existing `RetryConfigs.api.retryIf` to work as intended.
