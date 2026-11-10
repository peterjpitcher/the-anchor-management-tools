# Spec: Claude on the web and phone connecting to the agent bridge (OAuth for `/api/mcp`)

Date: 10 November 2026. Status: PARKED. Peter's claude.ai account offers "Request headers", so he connects Claude on the web and phone with a second API key (section 4) and nothing here is being built. This spec is kept for the day a sign-in with expiring tokens and a PIN is wanted. Reviewed the same day by an independent adversarial pass against the code, the live schema and the live site (1 blocker, 10 should-fix, 11 minor points); every finding is folded in below. Peter's answers of 10 November 2026 (section 21) are folded in throughout: the connect-time check is a PIN he sets himself, a connection lasts 90 days at most, and access is full. Nothing in this file is waiting on a decision.

## 1. Summary

`POST /api/mcp` (PR 334, live as `dpl_4XtSwve9ZQWK8MZDqS3MH9Unpj3c`) lets Claude Code on Peter's Mac use the whole app as Peter, authenticated by an API key with the `mcp:full` scope. Claude on the web, the desktop app's chat and the phone apps (claude.ai "custom connectors") run from Anthropic's cloud and cannot read a key file on the Mac. Their documented, generally available route is an OAuth 2.1 sign-in.

This spec makes the management app its own small OAuth authorisation server for exactly one client (Claude's hosted apps) and exactly one person (Peter). Peter adds the connector once at claude.ai, signs in with his normal email and password, confirms with his password and a PIN he has set himself, and Claude then holds a short-lived access token and a rotating refresh token. Every MCP call is checked against the database, so disconnecting in Settings stops Claude on the next call. The Mac's API key keeps working unchanged.

Peter uses the no-build route in section 4 today: a second API key sent as a request header from a claude.ai custom connector. Build the rest of this spec only if he asks for a sign-in with expiring tokens and a connect-time PIN.

## 2. Current state (read on 10 November 2026)

- `src/app/api/mcp/route.ts`: POST only (GET and DELETE answer 405), stateless Streamable HTTP with JSON responses. Wraps everything in `withMcpAuth(request, usageLabel(body), handler)`, then refuses with 503 `MCP_NOT_CONFIGURED` unless `MCP_ACTING_USER_ID` is a UUID, then runs the request inside `runAsMcpActor({ userId, keyName, getClient })`.
- `src/lib/api/auth.ts` `withMcpAuth`: reads `Authorization: Bearer` or `x-api-key`, hashes with SHA-256, looks it up in `api_keys` (active, unexpired). 503 when the lookup or the rate limit cannot be checked, 401 for no or bad key (JSON body, no `WWW-Authenticate` header), 403 unless `mcp:full` is held by name (the `*` wildcard never grants it), 429 over the key's hourly limit (counted from `api_usage`). Each call is logged to `api_usage` with the label `/api/mcp/<tool>:<target>`.
- `src/lib/mcp/acting-session.ts`: makes a real Supabase session for the acting account (admin-generated sign-in link verified on the server, no email sent), cached per server instance and refreshed. `src/lib/mcp/acting-context.ts`: `AsyncLocalStorage` context that makes `createClient()` return that session inside an MCP request only.
- `api_usage.api_key_id` is `uuid NOT NULL` with a cascading FK to `api_keys`; no view depends on `api_usage` or `api_keys` (checked live).
- The only `mcp:full` key in production is named `claude`, rate limit 2,000 an hour, no expiry.
- New tables in `public` created by `postgres` get full privileges for `authenticated` and `service_role` by default (live `pg_default_acl`); new functions get EXECUTE for `authenticated`. Anything here that must be service-role only needs explicit revokes.
- `src/middleware.ts`: `/api` is public at middleware level; `/.well-known` is not on `PUBLIC_PATH_PREFIXES`, so a well-known request today is redirected to `/auth/login`. Signed-out page requests go to `/auth/login` with the path and query kept in the `post_login_redirect` cookie (15 minutes), and the login screen honours it through `safeRelativePath` (`src/lib/portal/next-path.ts`, 2,048 characters, no whitespace).
- `next.config.mjs` CSP: `form-action 'self'`, `frame-ancestors 'none'`, applied to every path (`source: '/:path*'`).
- The MCP manifest (`src/lib/mcp/manifest/build.ts`) scans server actions under `src/app/actions/` only and routes under `src/app/api/` except `api/cron/`, `api/webhooks/`, `api/stripe/`, `api/jobs/`, `api/mcp/`. Page-local actions (for example `settings/api-keys/actions.ts`) are not exposed to agents.
- Auth standard (`/Users/peterpitcher/Cursor/.claude/docs/auth-standard.md`, v2.3): email and password only, no OAuth or SSO sign-in methods, no 2FA (owner decision 3; section 5 says reintroducing 2FA needs the standard amended first), no step-up for business actions. The app's login (`src/services/auth.ts`) does not use Turnstile today.

## 3. What Claude and the MCP specification require (checked 10 November 2026)

Sources: MCP authorisation spec, latest version dated 2026-07-28 (`modelcontextprotocol.io/specification/2026-07-28/basic/authorization` and its discovery, registration and security pages; the draft differs only in the CIMD draft number); Anthropic's connector docs (`claude.com/docs/connectors/building`, `.../authentication.md`, `.../lazy-authentication.md`, `.../troubleshooting.md`, `claude.com/docs/connectors/custom/add-unlisted.md`, support article 11175166); Supabase OAuth server docs (`supabase.com/docs/guides/auth/oauth-server`). The older support article 11503834 now returns 404.

MCP spec (2026-07-28):
- The server MUST serve OAuth Protected Resource Metadata (RFC 9728), either via `resource_metadata` in the `WWW-Authenticate` header of a 401 or at `/.well-known/oauth-protected-resource/<mcp path>` then `/.well-known/oauth-protected-resource`. The document MUST list `authorization_servers`.
- The authorisation server MUST publish RFC 8414 or OpenID discovery metadata; for an issuer with no path, clients try `/.well-known/oauth-authorization-server` then `/.well-known/openid-configuration`. `issuer` must match exactly.
- PKCE is mandatory; clients refuse to proceed when `code_challenge_methods_supported` is absent. S256.
- Clients send the RFC 8707 `resource` parameter on authorise and token requests; the server MUST only accept tokens issued for itself (audience).
- Bearer token in the `Authorization` header on every request, never in the query string. Invalid or expired tokens get 401.
- Refresh tokens MUST be rotated for public clients. Access tokens SHOULD be short-lived.
- Redirect URIs matched exactly; HTTPS or localhost only. The consent screen MUST show the redirect host and MUST NOT be frameable.
- Insufficient scope: 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope=..., resource_metadata=...`.
- Client registration preference: pre-registered client, then Client ID Metadata Documents (CIMD, SHOULD), then Dynamic Client Registration (MAY, described as superseded by CIMD).
- The authorisation server may share the resource server's origin.
- If the server sends `iss` in the authorisation response it MUST advertise `authorization_response_iss_parameter_supported: true`.
- Token passthrough is forbidden; the MCP server must not forward the token it receives.

Claude (claude.ai web, desktop chat, iOS and Android):
- Follows the 2025-03-26, 2025-06-18 and 2025-11-25 authorisation specs.
- All connector traffic, including from the phone apps, comes from Anthropic's cloud. Egress ranges: `160.79.104.0/21`, `153.61.208.0/20`. IPv4 only; the host must resolve to public addresses.
- Redirect URI for every hosted app: exactly `https://claude.ai/api/mcp/auth_callback`. (Claude Code uses loopback redirects and its own CIMD document instead.)
- When adding a custom connector the person chooses "Use Claude's published identity (Recommended)" (CIMD hosted by Anthropic; used only if the server's metadata advertises `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`), "Register automatically" (DCR), or "Use your own OAuth client" (a client ID registered with the server; secret optional, blank means public client). Authentication settings cannot be changed later; the connector is removed and re-added.
- PKCE S256 on every request; sends `resource` set to the canonical MCP URL (lowercase scheme and host, no trailing slash) on authorise and token requests. The protected resource metadata's `resource` must equal the URL as typed into Claude, path included.
- Scope: takes `scope` from the 401 header, otherwise `scopes_supported`; appends `offline_access` only if the metadata lists it.
- Token endpoint must accept `application/x-www-form-urlencoded`; 10 second timeout for discovery, registration and token calls, 30 seconds for refresh.
- Refreshes reactively on 401 and proactively up to five minutes before expiry. A dead refresh token must get `invalid_grant`. When rotating, the new refresh token comes back in the same response that invalidates the old one.
- A 301/302/307/308 to another host drops the `Authorization` header. A WAF or bot challenge in front of the MCP or OAuth paths breaks sign-in.
- Tools with `destructiveHint: true` prompt before each call unless the person has set that tool to "Always allow"; read-only tools may run without asking. In Research mode Claude can call connector tools without asking. Tool results are capped at about 150,000 characters and 240 seconds.
- A connector is added to one claude.ai account and then works on web, desktop and phone for that account. There is no per-user restriction on a personal plan; anyone signed in to that claude.ai account can use it.
- A POST-only, stateless JSON server (no GET stream) is what Anthropic's own example uses.

## 4. The no-build route to check first: request headers

Anthropic documents a `static_headers` connection: "No sign-in" plus up to four request headers, with `authorization`, `x-api-key` and `x-auth-token` pre-approved, values stored encrypted and never shown again, sent from Anthropic's cloud on every request. It is labelled "beta, for a limited set of organizations", yet the Pro and Max steps in support article 11175166 include a "Request headers" step, and Peter's own account has it (he checked on 10 November 2026).

How Peter connects today:
- Create a second key on Settings, API keys, named `claude.ai`, with only Agent Access (MCP) ticked. Keep it separate from the Mac's `claude` key so each can be switched off alone.
- In claude.ai: Customize, Connectors, Add custom connector, URL `https://management.orangejelly.co.uk/api/mcp`, authentication "No sign-in", request header `x-api-key` with the key as the value.
- Works today with no code, no migration and no deploy. Switching the key off on Settings stops it on the next call.
- What it does not give, compared with sections 5 onwards: no password or PIN check when connecting, a credential that never expires on its own (the API keys screen cannot set an expiry), no rotation, and no reuse detection. The credential's protection is the same as the Mac key's, except that it is held by Anthropic and usable by anyone signed in to Peter's claude.ai account, which is also true of the OAuth tokens below.

The rest of this spec is built only if Peter asks for a sign-in with expiring tokens and a connect-time PIN (section 21). Live check on 10 November 2026: `POST /api/mcp` answers 401 from the public internet with no key and with a bad `x-api-key`, and `extractApiKey` in `src/lib/api/auth.ts` reads `x-api-key` before `Authorization`.

## 5. Design decisions

| # | Decision | Why |
|---|---|---|
| D1 | The app is its own authorisation server, on the same origin. Issuer `https://management.orangejelly.co.uk` (from `getAppUrl()`). | The MCP spec allows it; it keeps tokens opaque, audience-bound and checked against our database on every call. |
| D2 | Do not use Supabase Auth's OAuth 2.1 server. | It is in beta; its access tokens are ordinary Supabase user JWTs (`aud: authenticated`) usable directly against the database API, not bound to `/api/mcp` as the MCP spec requires; RFC 8707 `resource` and CIMD support are not documented; custom scopes are not supported; issued JWTs live up to an hour after revocation; switching it on, and DCR in particular ("allows any MCP client to register with your project"), is a project-wide Supabase Auth change. |
| D3 | One pre-registered public client, defined in code: `client_id = anchor-management-claude`, redirect URI exactly `https://claude.ai/api/mcp/auth_callback`, `token_endpoint_auth_method = none`. Peter picks "Use your own OAuth client" in claude.ai and leaves the secret blank. | No registration endpoint, no fetching of outside documents (no server-side request forgery surface), no dependency on Anthropic's hosted CIMD client ID, which is not published. A client secret was considered and dropped: it would sit in the same Anthropic store, and travel in the same token request, as the refresh token it was meant to protect. |
| D4 | No DCR and no CIMD. The metadata omits `registration_endpoint` and `client_id_metadata_document_supported`. | Section 3: Claude then uses the pre-registered client. If Peter picks a different option by mistake, sign-in fails and he re-adds the connector; nothing unsafe happens. |
| D5 | Claude Code is not an OAuth client here. Loopback redirects are refused. | Claude Code on the Mac already uses the API key. |
| D6 | Opaque random tokens, stored only as SHA-256 hashes. Access tokens last 60 minutes; refresh tokens rotate on every use, with a 60-second window in which a just-spent refresh token or code still works (section 8.3); codes last 5 minutes. | Revocation is immediate because every call looks the token up. 60 minutes rather than the 15-minute JWT figure in the auth standard because the lookup, not the lifetime, is the revocation boundary, and fewer refreshes means fewer rotation races. Claude does not promise to refresh one request at a time, and one connector serves web, desktop and phone at once, so strict single use would cut Peter off and raise false alarms. |
| D7 | One scope, `mcp:full`, the same name as the API key scope. Full access; there is no read-only level. | Owner decision of 10 November 2026: everything in the app, because the point is to have agents make changes, update details and review them for day-to-day management. |
| D8 | One live connection at a time. When a new connection completes (its code is exchanged), the previous grant is revoked (reason `replaced`). | One claude.ai connector already covers web, desktop and phone. If anyone else ever completes a connection as Peter, Peter's own connector stops working, which he will notice. |
| D9 | Owner only: the person approving must be signed in as `MCP_ACTING_USER_ID`, and every token use re-checks that the grant belongs to the current `MCP_ACTING_USER_ID`. | The owner wants this for himself alone. |
| D10 | Peter re-enters his password and a PIN he has set himself on the consent screen (section 10). No code is emailed. | Owner decision of 10 November 2026. Sessions here never time out (auth standard decision 2), so a browser left signed in at the pub must not be enough to hand Claude his whole account, and nor must a password reused elsewhere. |
| D11 | A grant lasts 90 days at most, and ends sooner after 30 days with no MCP call (owner decision, 10 November 2026). "Live" is defined once (section 8.5) and used everywhere. | Bounds how long a connection held by Anthropic can live without Peter confirming it again. |
| D12 | The whole OAuth path is behind `MCP_OAUTH_ENABLED` (off unless `true`). Off: the well-known documents and OAuth endpoints answer 404, `/api/mcp` answers 401 exactly as today with no `WWW-Authenticate`, every OAuth token is refused, and a refresh attempt gets `invalid_grant` and marks the grant `oauth_disabled`. So a connection survives a short switch-off only if Claude did not try to refresh meanwhile; otherwise Peter connects again after switching back on. API keys are unaffected. | Ship dark, switch on to connect, switch off as an instant kill switch. |
| D13 | Approval, Disconnect and setting the PIN are page-local server actions (outside `src/app/actions/`), and the OAuth routes are excluded from the MCP manifest. | An agent must never be able to approve, list or manage its own credentials, the same reasoning that keeps the API keys screen page-local today. |
| D14 | Anyone with `settings` `manage` can see the connection's dates and press Disconnect; only Peter can connect. | A manager can cut access in an emergency; seeing dates exposes nothing. |

## 6. End-to-end walk-through

1. Peter, at claude.ai: Customize, Connectors, Add custom connector. Name "Anchor management", URL `https://management.orangejelly.co.uk/api/mcp`, authentication "Sign in now" (not "Sign in when needed" or "No sign-in"; labels as on Anthropic's add-unlisted page, confirm on the day), OAuth client "Use your own OAuth client", client ID `anchor-management-claude`, secret blank. Add, then Connect.
2. Claude POSTs `initialize` to `/api/mcp` with no token and gets 401 with `WWW-Authenticate: Bearer resource_metadata="https://management.orangejelly.co.uk/.well-known/oauth-protected-resource/api/mcp", scope="mcp:full"`.
3. Claude reads that document (`resource` = `https://management.orangejelly.co.uk/api/mcp`, `authorization_servers` = the issuer), then `/.well-known/oauth-authorization-server`.
4. Claude opens a browser (on the phone, an in-app sign-in sheet) at `/oauth/authorize?response_type=code&client_id=anchor-management-claude&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=...&code_challenge_method=S256&state=...&resource=https%3A%2F%2Fmanagement.orangejelly.co.uk%2Fapi%2Fmcp&scope=mcp%3Afull`.
5. Signed out: middleware sends Peter to `/auth/login` with the authorise URL in `post_login_redirect`; after his normal email and password sign-in he lands back on the authorise page. Signed in already: straight to the consent screen.
6. The page validates the request (section 7.4). Peter sees the consent screen (section 9.3), enters his password and his PIN, and presses Connect. If he has not set a PIN yet, the screen sends him to his profile page first (section 10) and Connect stays disabled.
7. The approve action re-validates everything, records a code row, and returns `https://claude.ai/api/mcp/auth_callback?code=...&state=...&iss=https%3A%2F%2Fmanagement.orangejelly.co.uk`; the page navigates there.
8. Claude's backend POSTs the code, `code_verifier`, `redirect_uri`, `client_id` and `resource` to `/api/oauth/token`, and gets an access token (60 minutes) and a refresh token. The grant is created at this moment and any older grant is revoked as `replaced`.
9. Every MCP call carries `Authorization: Bearer anch-oat-...`; `withMcpAuth` resolves it, the call runs as Peter exactly as an API-key call does, and `api_usage` records it against the grant.
10. About every 55 minutes in use, Claude refreshes; the old refresh token is spent and a new pair comes back. Two refreshes with the same token inside 60 seconds (web and phone at once) both succeed. On the phone the same connector works, because the tokens live in Peter's claude.ai account.
11. The connection ends when Peter presses Disconnect in Settings, approves a newer connection, changes or resets his password (by any route, section 11), after 30 days with no MCP call or 90 days in all, on reuse of a spent refresh token or code more than 60 seconds later, when `MCP_OAUTH_ENABLED` is switched off, or when `MCP_ACTING_USER_ID` is changed to another account. Claude then gets 401 on its next call, its refresh gets `invalid_grant`, and it asks Peter to connect again. If `MCP_ACTING_USER_ID` is unset or malformed, every caller gets 503 `MCP_NOT_CONFIGURED` instead and the connection survives the mistake.

## 7. Endpoints

| Method | Path | Purpose | Who can call |
|---|---|---|---|
| GET | `/.well-known/oauth-protected-resource/api/mcp` | Protected resource metadata (RFC 9728) | Anyone |
| GET | `/.well-known/oauth-protected-resource` | The same document (root fallback) | Anyone |
| GET | `/.well-known/oauth-authorization-server` | Authorisation server metadata (RFC 8414) | Anyone |
| GET | `/oauth/authorize` | Validate the request, show the consent screen | Signed-in staff session (middleware); approval only by Peter |
| Server action | `src/app/oauth/authorize/actions.ts`: `approveConnection`, `denyConnection` | Password and PIN check, approve or deny | Peter's session only |
| Server action | `src/app/(authenticated)/profile/connect-pin/actions.ts`: `setConnectPin` | Set or change the connect PIN (section 10) | Peter's session only |
| POST | `/api/oauth/token` | Code exchange and refresh | The registered client, proved by PKCE or a refresh token |
| POST | `/api/oauth/revoke` | Token revocation (RFC 7009) | Holder of a token |
| POST | `/api/mcp` | Existing bridge; now also accepts OAuth access tokens | API key or access token |

Not built: a registration endpoint, `/.well-known/openid-configuration` (404 is correct; Claude tries `oauth-authorization-server` first), userinfo, JWKS (tokens are opaque).

Route files: `src/app/.well-known/oauth-protected-resource/route.ts`, `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts` (the `.well-known` folder name works in the App Router; verify in the first build), `src/app/oauth/authorize/page.tsx` and `actions.ts`, `src/app/(authenticated)/profile/connect-pin/actions.ts` and its card on the profile page, `src/app/api/oauth/token/route.ts`, `src/app/api/oauth/revoke/route.ts`. Shared logic in `src/lib/mcp/oauth/` (config, client registry, token issue and resolve, validation, metadata builders).

### 7.1 Protected resource metadata

```json
{
  "resource": "https://management.orangejelly.co.uk/api/mcp",
  "authorization_servers": ["https://management.orangejelly.co.uk"],
  "scopes_supported": ["mcp:full"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Anchor management app"
}
```

Built from `getAppUrl()`. `Cache-Control: public, max-age=300`. `offline_access` is not listed (MCP spec: SHOULD NOT); refresh tokens are always issued to this client anyway.

Headers: in this app the `next.config.mjs` header rules win over headers a route handler sets (Next only adds a handler's header when config has not set it), and the global rule already sends `Access-Control-Allow-Origin: <app origin>`. So `Access-Control-Allow-Origin: *` for the metadata documents (public, non-secret; lets the MCP Inspector test them from a browser) is set by a `/.well-known/:path*` rule placed after the global one (a later rule overwrites an earlier one). Confirm with `curl -I` on a preview. Claude itself calls from its servers and needs no CORS.

### 7.2 Authorisation server metadata

```json
{
  "issuer": "https://management.orangejelly.co.uk",
  "authorization_endpoint": "https://management.orangejelly.co.uk/oauth/authorize",
  "token_endpoint": "https://management.orangejelly.co.uk/api/oauth/token",
  "revocation_endpoint": "https://management.orangejelly.co.uk/api/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["mcp:full"],
  "authorization_response_iss_parameter_supported": true
}
```

### 7.3 Client registry

A constant in `src/lib/mcp/oauth/clients.ts`:

```ts
{ clientId: 'anchor-management-claude', name: 'Claude (claude.ai)', redirectUris: ['https://claude.ai/api/mcp/auth_callback'], public: true }
```

No table. A second client would be a code change. If Anthropic ever moves the callback (for example to claude.com), sign-in fails closed and the list is updated after checking Anthropic's docs.

### 7.4 `GET /oauth/authorize`

Validation order (RFC 6749 section 4.1.2.1):
1. `MCP_OAUTH_ENABLED` off, or `MCP_ACTING_USER_ID` unset or not a UUID: 404 page. Checked first.
2. `client_id` unknown, or `redirect_uri` not an exact match for that client: show an error page; never redirect.
3. Everything else redirects to the validated `redirect_uri` with `error`, `state` and `iss`, built with `URL.searchParams` so every value is encoded:
   - `response_type` not `code`: `unsupported_response_type`.
   - `code_challenge` missing or not 43 to 128 base64url characters, or `code_challenge_method` not `S256`: `invalid_request`.
   - `resource` present and not exactly the canonical resource string: `invalid_target`. Absent: treated as the canonical resource.
   - `scope` containing anything other than `mcp:full` (and `offline_access`, accepted and ignored): `invalid_scope`. Absent: `mcp:full`.
   - `state` is passed back unchanged; missing `state` is allowed (Claude sends PKCE, which protects the code).
4. Signed in as anyone other than `MCP_ACTING_USER_ID`: "This connection is for the owner's account only", with a "Sign out and sign in as the owner" button that returns to the same authorise URL. Nothing is written and no alert is sent on GET (server rendering can run twice, and the auth standard forbids state changes on GET); the approve action refuses the same person, audits `mcp_oauth_refused_not_owner` and raises the alert if they submit.
5. Otherwise render the consent screen. The page writes nothing on GET.

Re-validation (section 7.5) works on the canonical request: the fields `client_id`, `redirect_uri`, `response_type`, `code_challenge`, `code_challenge_method`, `resource`, `scope` and `state`, after defaults are applied (`resource` canonical, `scope` `mcp:full`, missing `state` as an empty string).

Headers on `/oauth/:path*` (a `next.config.mjs` rule after the global one, so it overwrites): `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. The page loads no third-party resources.

### 7.5 Approve and deny actions

Both re-run section 7.4's validation from the submitted fields; nothing the browser sends is trusted beyond that. Server actions give the Origin check the auth standard asks for (section 6), so no new origin guard is needed.

- `approveConnection`: requires Peter's session; verifies the password, then the PIN (below); writes a `mcp_oauth_codes` row (code hash, user, client, redirect URI, scope, resource, code challenge, expiry 5 minutes, and the browser's first `x-forwarded-for` address and user agent as text); audits `mcp_oauth_connect_approved`; returns `{ redirectTo }` and the page calls `window.location.assign(redirectTo)`.
- PIN check, only once the password has passed (so a wrong PIN means someone has the password): first one call to `public.mcp_oauth_reserve_pin_attempt(p_user_id)` (section 8.3), which counts the attempt in one conditional update before the PIN is checked, so parallel guesses cannot get past the limits. `no_pin`: the screen says "Set your connection PIN on your profile page first" with a link, and nothing is issued. `locked` or `blocked`: the screen says connecting is locked, with no further detail. `ok`: the app computes scrypt over the typed PIN with the stored salt and parameters and compares with `crypto.timingSafeEqual`. Right: `failed_attempts` and `locked_until` are cleared. Wrong: generic "That password or PIN is not right", audit `mcp_oauth_pin_failed`. The fifth wrong PIN in a row locks connecting for 15 minutes (audit `mcp_oauth_pin_locked`, problem alert); the tenth in a row blocks it until a database change Peter has approved clears the count (audit `mcp_oauth_pin_blocked`, problem alert).
- `denyConnection`: returns the redirect with `error=access_denied`, `state`, `iss`; audits `mcp_oauth_connect_denied`.
- Password check: a throwaway Supabase client with `persistSession: false` calls `signInWithPassword` for Peter's email, then signs that throwaway session out (`scope: 'local'`), so neither the cookie session nor a stray refresh token is left behind. (`changePassword` in `src/app/actions/profile.ts` re-signs-in the cookie session instead; do not copy that.) If Supabase CAPTCHA is ever switched on, as the auth standard intends, this check and `changePassword` both need a Turnstile token; note it beside the code. Failures: generic "That password or PIN is not right". Lockout counts `mcp_oauth_password_failed` audit rows for Peter in the last 15 minutes (the distributed limiter needs a `NextRequest`, counts every call rather than failures, and falls back to per-instance memory, so it does not fit); at five, connecting is locked for 15 minutes, `mcp_oauth_password_locked` is audited and a problem alert raised. If the audit rows cannot be read, connecting is refused (fails closed).
- No Turnstile: the app's own login has none today, and adding one here alone buys little behind a password the attacker would also need.

### 7.6 `POST /api/oauth/token`

- `application/x-www-form-urlencoded` only (anything else: 400 `invalid_request`). Responses JSON with `Cache-Control: no-store` and `Pragma: no-cache`. Errors use the standard OAuth shape `{ "error": "...", "error_description": "..." }`, not the app's `createErrorResponse` envelope. The global `Access-Control-Allow-Origin: <app origin>` header from `next.config.mjs` also appears here; it is harmless because Claude calls from its servers.
- Client: `client_id` must be `anchor-management-claude`. Anthropic does not document exactly what Claude sends for a public client with a blank secret, so an empty `client_secret`, or `Authorization: Basic` carrying the right client id and an empty password, is treated as no authentication. A non-empty secret gets 401 `invalid_client`, so a secret typed by mistake fails loudly. On refresh, `client_id` is optional but must match if sent.
- `grant_type=authorization_code`: needs `code`, `redirect_uri`, `code_verifier` (43 to 128 characters), `resource` optional. The handler computes `BASE64URL(SHA256(code_verifier))` and calls `mcp_oauth_redeem_code` (section 8.3) in one transaction. Outcomes: issued; code unknown or expired, or challenge or redirect mismatch: 400 `invalid_grant`; resource mismatch: 400 `invalid_target`; code already used within the last 60 seconds with the same verifier (Claude retrying after a slow first answer): a fresh token pair on the grant that code created; used longer ago: 400 `invalid_grant`, that grant revoked (`code_reuse`), problem alert.
- `grant_type=refresh_token`: needs `refresh_token`; `resource` and `scope` optional and, if present, must match the grant. Calls `mcp_oauth_rotate_refresh_token` with the current `MCP_ACTING_USER_ID`. Outcomes: rotated; spent within the last 60 seconds: a fresh pair on the same grant, no revocation, no alert; unknown, expired, revoked, grant not live (section 8.5) or grant belonging to another account: 400 `invalid_grant`; spent longer ago: 400 `invalid_grant`, grant revoked (`refresh_reuse`), problem alert.
- Success body: `{ "access_token": "anch-oat-...", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "anch-ort-...", "scope": "mcp:full" }`.
- Other `grant_type`: 400 `unsupported_grant_type`. `MCP_OAUTH_ENABLED` off: 400 `invalid_grant` for refresh (the grant is marked `oauth_disabled`, Claude asks to reconnect) and 404 otherwise. `MCP_ACTING_USER_ID` unset or malformed: 503. Database unreachable: 503 with no body detail; never an `invalid_grant` that would make Claude throw away a good refresh token.
- No rate limiter: tokens are 256-bit, so guessing is pointless, Anthropic's egress is shared by every Claude user, and the app's distributed limiter cannot count failures only. Failures are logged (no token values) for investigation.
- Must answer well inside Claude's 10 second limit: two indexed queries and one function call.

### 7.7 `POST /api/oauth/revoke`

RFC 7009: form body `token` (and optional `token_type_hint`, `client_id`). Revoking either token revokes the whole grant (reason `client_revoked`). Always 200 for a well-formed request, including unknown tokens. Whether Claude calls it when a connector is removed is not documented; Disconnect in Settings is the reliable path.

## 8. Tokens and storage

### 8.1 Format

- Access token `anch-oat-` + 43 base64url characters (32 random bytes); refresh token `anch-ort-` + the same; authorisation code 32 random bytes base64url.
- The hyphen keeps them apart from API keys (`anch_` + base64url), so `withMcpAuth` routes by prefix and never looks a token up in the wrong table.
- Tokens and authorisation codes are stored only as SHA-256 hex (high-entropy values, so a plain hash is enough, as for API keys). Never logged; `api_usage` stores the grant id, not the token.
- The connect PIN is low-entropy, so a fast hash of it could be reversed by anyone who read the table. It is stored only as an scrypt hash with a per-user random salt (section 10), in a service-role-only table.

### 8.2 Tables (all service-role only)

```sql
-- Migration 1 (transactional): new tables, functions, policies and the password trigger
create table public.mcp_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  client_id text not null,
  scope text not null,
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,          -- created_at + 90 days (owner decision)
  last_used_at timestamptz,                 -- last MCP call, written with after()
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason in (
    'owner_disconnected','replaced','password_changed','refresh_reuse','code_reuse',
    'client_revoked','idle_expired','expired','oauth_disabled','acting_user_changed')),
  revoked_by uuid,
  created_ip text,                          -- Peter's browser at approval, copied from the code row
  created_user_agent text
);

create table public.mcp_oauth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  client_id text not null,
  redirect_uri text not null,
  scope text not null,
  resource text not null,
  code_challenge text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,          -- created_at + 5 minutes
  used_at timestamptz,
  grant_id uuid references public.mcp_oauth_grants(id) on delete restrict,
  approved_ip text,
  approved_user_agent text
);

create table public.mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.mcp_oauth_grants(id) on delete restrict,
  kind text not null check (kind in ('access','refresh')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,          -- access: +60 minutes; refresh: the grant's expires_at
  used_at timestamptz,                      -- refresh only: when it was first spent
  revoked_at timestamptz
);

create table public.mcp_oauth_owner_pins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  pin_salt text not null,                   -- 16 random bytes, hex
  pin_hash text not null,                   -- scrypt(PIN, pin_salt), hex, see section 10
  scrypt_params jsonb not null,             -- {"N":16384,"r":8,"p":1,"keylen":64}, kept so they can be raised later
  failed_attempts int not null default 0,   -- wrong PINs in a row since the last right one
  locked_until timestamptz,                 -- set by the fifth wrong PIN in a row
  set_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

The `api_usage` change is a separate migration, because the table is large and on the website's hot path: about 710,000 rows and 170 MB live, read by `checkRateLimit` and written on every website API call. A plain `ADD CONSTRAINT ... CHECK` scans the whole table under an exclusive lock and would stall the website's bookings while it runs.

```sql
-- Migration 2 (transactional)
set local lock_timeout = '3s';
alter table public.api_usage alter column api_key_id drop not null;
alter table public.api_usage add column mcp_oauth_grant_id uuid;
alter table public.api_usage add constraint api_usage_mcp_oauth_grant_fkey
  foreign key (mcp_oauth_grant_id) references public.mcp_oauth_grants(id) on delete restrict not valid;
alter table public.api_usage add constraint api_usage_one_caller
  check (num_nonnulls(api_key_id, mcp_oauth_grant_id) = 1) not valid;

-- Migration 3 (separate apply): validate without the exclusive lock
alter table public.api_usage validate constraint api_usage_mcp_oauth_grant_fkey;
alter table public.api_usage validate constraint api_usage_one_caller;

-- Migration 4 (its own non-transactional apply)
create index concurrently idx_api_usage_oauth_grant_time
  on public.api_usage (mcp_oauth_grant_id, created_at desc) where mcp_oauth_grant_id is not null;
```

If the 3-second lock timeout trips, the apply fails cleanly and is retried at a quiet hour; nothing is half-applied. The `prod-migrate` packet states the timings, and whether the migration tool can run the concurrent index outside a transaction is checked before applying (if not, a plain index at a quiet hour, timed first on a copy).

Plus, for the four new tables: RLS enabled; an explicit restrictive `using (false)` policy for `anon` and `authenticated` (the auth standard prohibits RLS with no policies; `signing_events` already does that in production, but there is no reason to copy it); `revoke all ... from public, anon, authenticated` on each (the live default ACL grants `authenticated` everything); indexes on `mcp_oauth_tokens (grant_id)` and `mcp_oauth_grants (user_id) where revoked_at is null` (the PIN table is keyed by `user_id`). Only one live grant per user is enforced in the redeem function under an advisory lock, not by a partial unique index (the repo's note on partial unique indexes firing late applies). The `api_usage` change is backwards compatible: every existing insert sets `api_key_id`, which satisfies the check; its only SQL reader, `website_booking_funnel`, filters by key ids. The app never deletes grants, codes or tokens: the foreign keys are `on delete restrict`, so the owner's auth user cannot be deleted while his connection history exists (the auth standard's retention rule wins; deleting the owner's login is not a real case).

Password changes by any route (the profile screen, the reset page, which calls `updateUser` in the browser, the Supabase dashboard or the admin API) are caught by a trigger rather than by app code, so a failed follow-up call can never leave a grant alive:

```sql
create function public.mcp_oauth_revoke_on_password_change() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  update public.mcp_oauth_grants
     set revoked_at = now(), revoked_reason = 'password_changed'
   where user_id = new.id and revoked_at is null;
  update public.mcp_oauth_tokens t
     set revoked_at = now()
    from public.mcp_oauth_grants g
   where t.grant_id = g.id and g.user_id = new.id and t.revoked_at is null;
  return new;
end $$;
revoke execute on function public.mcp_oauth_revoke_on_password_change() from public, anon, authenticated;
create trigger mcp_oauth_revoke_on_password_change
  after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.mcp_oauth_revoke_on_password_change();
```

Validate inside `BEGIN ... ROLLBACK` first (a trigger on `auth.users` must be creatable by the migration role, as the common "new user" trigger pattern is). `changePassword` still writes its audit entry; the trigger needs none of the app.

### 8.3 Functions (atomic steps)

All `security invoker` (the service role bypasses RLS), `set search_path = ''`, fully qualified names, `revoke execute ... from public, anon, authenticated` (the live default ACL grants `authenticated` EXECUTE on new functions), `grant execute ... to service_role`. Smoke-tested with a real `select` after applying, and covered by the Postgres harness (section 18).

- `public.mcp_oauth_redeem_code(p_code_hash, p_computed_challenge, p_redirect_uri, p_resource, p_access_hash, p_refresh_hash, p_access_expires, p_grant_expires)` returns `(outcome text, grant_id uuid)`. Order: look up the code; if it is unknown or expired, `invalid`; if the challenge or redirect URI differ, `invalid`; if the resource differs, `invalid_target`. Then take `pg_advisory_xact_lock(hashtextextended(user_id::text, 0))`, so two redemptions for Peter cannot both leave a live grant. Claim the code with one conditional `update ... set used_at = now() where id = ... and used_at is null returning`. Won: create the grant (copying `approved_ip` and `approved_user_agent`), revoke the user's other live grants and their tokens (`replaced`), insert both tokens, return `issued`. Lost because the code was spent less than 60 seconds ago: insert a fresh pair on the grant that code created, return `issued`. Spent longer ago: revoke that grant (`code_reuse`), return `reused`.
- `public.mcp_oauth_rotate_refresh_token(p_refresh_hash, p_acting_user_id, p_new_access_hash, p_new_refresh_hash, p_access_expires)` returns `(outcome text, grant_id uuid, scope text)`. Order: look up the token and its grant; unknown, revoked or expired: `invalid`. Grant not live (section 8.5): mark it with the matching reason (`expired`, `idle_expired`) if not already revoked, return `invalid`. Grant's `user_id` differs from `p_acting_user_id`: revoke it (`acting_user_changed`), return `invalid`. Then `update ... set used_at = now() where id = ... and used_at is null returning`. Won, or lost but first spent less than 60 seconds ago: insert the new pair, return `rotated` (the refresh token's expiry is the grant's `expires_at`; idleness is measured on use, section 8.5). Spent longer ago: revoke the grant (`refresh_reuse`), return `reused`.
- `public.mcp_oauth_reserve_pin_attempt(p_user_id)` returns `(outcome text, failed_attempts int)`. No row for the user: `no_pin`. Otherwise one conditional update: `set failed_attempts = failed_attempts + 1, locked_until = case when failed_attempts + 1 = 5 then now() + interval '15 minutes' else locked_until end, updated_at = now() where user_id = p_user_id and failed_attempts < 10 and (locked_until is null or locked_until <= now()) returning failed_attempts`. A row returned: `ok`, with the new count. None: `blocked` once `failed_attempts` has reached 10, otherwise `locked`. The attempt is counted before the PIN is checked; a right PIN is followed by a reset of the count and the lock, so a right fifth attempt does not leave Peter locked.
- `public.mcp_oauth_grant_is_live(g public.mcp_oauth_grants)` returns `boolean`, `stable`: the one definition in section 8.5, called by the functions above and mirrored in the TypeScript check, with a parity test.

The 60-second window exists because Claude does not promise one refresh at a time, and web, desktop and phone can all be busy at once (review finding, 10 November 2026). Outside the window a second use is treated as theft. Accepted: a thief who uses a stolen refresh token within 60 seconds of Peter's own use is not caught by reuse detection.

### 8.4 Resolving an access token (every MCP call)

Before any token is looked up, `MCP_ACTING_USER_ID` must be set and a UUID; otherwise every caller gets the existing 503 `MCP_NOT_CONFIGURED`, so a configuration slip never burns a good connection. Then one query: the token row by hash with its grant embedded. Accept only when all hold: `kind = 'access'`; token unrevoked and unexpired; the grant is live (section 8.5); `grant.resource` equals the canonical resource; `grant.user_id` equals `MCP_ACTING_USER_ID`; `grant.scope` includes `mcp:full`; `MCP_OAUTH_ENABLED` is on. Then update `grant.last_used_at` using `after()` from `next/server`, so Vercel does not drop the write when the response ends. A database error is `unavailable` (503), never `anonymous`.

### 8.5 When a grant is live

One definition, used by the token check, both functions, the Settings list and the consent screen's "This replaces your connection made on ..." line: `revoked_at is null and expires_at > now() and coalesce(last_used_at, created_at) > now() - interval '30 days'`. `last_used_at` moves only on MCP calls, never on refreshes, so a connector that refreshes in the background but is never used still ends after 30 days.

## 9. Owner-only, consent and the screen

### 9.1 Layers that keep it to Peter

1. Approval requires a session for `MCP_ACTING_USER_ID`; any other signed-in account is refused, audited and alerted.
2. Approval requires Peter's password again and the PIN he set himself (section 10).
3. Tokens are bound to the grant's `user_id`, re-checked against `MCP_ACTING_USER_ID` on every call, so changing that variable ends every grant.
4. Only the one client and the one Claude callback are accepted.
5. One live connection at a time (D8).
6. Settings shows the connection with its date and last use.

### 9.2 Where the tokens live, and what that means

- Our side: hashes only, in the tables above.
- Claude's side: Anthropic stores the access and refresh tokens, encrypted, in Peter's claude.ai account and uses them for web, desktop and phone. Anyone who can sign in to Peter's claude.ai account can use the connection. From the day this is switched on, Peter's claude.ai sign-in protects the management app too.

### 9.3 Consent screen wording (plain English, checked against SSOT voice rules for staff, not guest copy)

- Title: "Connect Claude to the management app".
- "Claude (claude.ai) is asking to use the management app as you, Peter: to see everything, and to create, change, send, refund and delete anything you can. Claude asks you before each change unless you have told it to always allow that tool, or you are using Research mode."
- "It will work in Claude on the web, the desktop app and your phone. It stops when you disconnect it in Settings, API keys, when you change your password, after 30 days without use, or after 90 days at most."
- "Only continue if you started this yourself in Claude a moment ago. Never approve a link someone has sent you."
- If a connection exists: "This replaces your connection made on <date>."
- Shows "Returns to: claude.ai" (the MCP spec requires the redirect host to be shown).
- Password field, then the PIN field, then "Connect" and "Cancel". With no PIN set, the PIN field is replaced by "Set your connection PIN on your profile page first" and a link, and Connect is disabled.
- WCAG 2.2 AA; design-system components only (`@/ds`), no raw colours (the design-token guard applies).

## 10. The connect-time PIN

The auth standard has no 2FA (owner decision 3), and normal sign-in is unchanged. The only extra check is at the moment of handing Claude a long-lived credential: Peter's password again plus a PIN he has chosen himself (owner decision, 10 November 2026). A PIN is something Peter knows, like the password, so it is not a second factor in the strict sense. What it does: a browser left signed in, or a password reused elsewhere and stolen, is not enough on its own to connect Claude, because the PIN can only be changed with the current PIN. No email is sent at any point, so the email kill switches do not affect connecting.

Setting and changing it, on the profile page (`src/app/(authenticated)/profile/connect-pin/actions.ts`, page-local so no agent can reach it, D13):
- The "Claude connection PIN" card shows only to `MCP_ACTING_USER_ID`, whether or not `MCP_OAUTH_ENABLED` is on; `setConnectPin` refuses anyone else.
- First time: Peter re-enters his password (the same throwaway check and lockout as section 7.5) and types the PIN twice. He sets it before `MCP_OAUTH_ENABLED` is switched on (section 19), so there is never a window in which someone with only his password could set the first one.
- Change: the current PIN as well as the password, the PIN checked through the same reservation as section 7.5, so the change form cannot be used to guess it.
- Rules: 6 to 12 digits, digits only; all-same digits and straight runs (`000000`, `123456`, `987654`) refused. Never shown again, never logged, never in an audit entry.
- Stored with Node's `crypto.scrypt` at its defaults (N 16384, r 8, p 1), a 64-byte key and a fresh 16-byte random salt, the parameters kept beside the hash so they can be raised later. Compared with `crypto.timingSafeEqual`.
- Audited `mcp_oauth_pin_set` or `mcp_oauth_pin_changed`. Changing the PIN does not end a live connection; it guards the next one.
- Forgotten PIN, or connecting blocked after ten wrong PINs in a row: Peter approves a one-row database change through `prod-migrate` (delete his `mcp_oauth_owner_pins` row for a forgotten PIN, or clear `failed_attempts` and `locked_until` for a block), then sets a new PIN straight away. There is deliberately no self-service reset: one that needed only the password would give the PIN no value.

Record two deviations in this repo's `CLAUDE.md`, so a later audit does not flag them: the connect-time PIN (a step-up check, which the workspace auth standard otherwise rules out; its section 5 gets one line permitting it for agent-credential issuance only), and the app as an OAuth token issuer (the standard's "no OAuth or SSO" decision is about how people sign in; here Peter still signs in with email and password, and the app issues tokens to Claude).

## 11. Revocation

| Trigger | Effect | Where |
|---|---|---|
| Disconnect in Settings, API keys, "Claude on the web and phone" | Grant and tokens revoked (`owner_disconnected`, `revoked_by`); next call 401 | Page-local action beside the API key actions; needs `settings` `manage` like the key actions |
| A newer connection approved | Older grant revoked (`replaced`) | `mcp_oauth_redeem_code` |
| Password changed or reset, by any route | All his grants and tokens revoked (`password_changed`) | Trigger on `auth.users` (section 8.2); covers the browser-side reset form (`src/app/auth/reset/reset-password-form.tsx`), the profile screen, the Supabase dashboard and the admin API alike |
| Refresh token or code reused more than 60 seconds after first use | Grant revoked, problem alert | Token endpoint functions |
| No MCP call for 30 days | Refused at the next call or refresh; marked `idle_expired` at the next refresh; shown as ended in Settings at once | Section 8.5 |
| 90 days old | Refused; marked `expired` at the next refresh | `expires_at` |
| `MCP_OAUTH_ENABLED` off | All OAuth tokens refused at once; the next refresh gets `invalid_grant` and marks the grant `oauth_disabled`. After switching back on, the connection works again only if no refresh was attempted meanwhile; otherwise Peter connects again | Config check |
| `MCP_ACTING_USER_ID` changed to another account | Calls refused; the next refresh revokes the grant (`acting_user_changed`) | Sections 8.3 and 8.4 |
| `MCP_ACTING_USER_ID` unset or malformed | 503 `MCP_NOT_CONFIGURED` for every caller; grants untouched, so fixing the variable restores them | Section 8.4 |
| Claude calls `/api/oauth/revoke` | Grant revoked (`client_revoked`) | RFC 7009 route |
| Peter's account banned | Acting session cannot be made, every call fails | Existing behaviour |

The Settings list shows the live grant (section 8.5): client name, connected on (London date), last used, ends on (the earlier of `expires_at` and 30 days after last use), and a Disconnect button. When `MCP_OAUTH_ENABLED` is off it says "Claude on the web and phone is switched off". Ended grants are hidden from the list but kept.

## 12. Changes to `/api/mcp` and `withMcpAuth`

- `withMcpAuth` resolves the bearer value by prefix: `anch-oat-` goes to section 8.4; everything else stays on the API key path, unchanged (including the `*` wildcard refusal and 403 for a key without `mcp:full`).
- The handler receives a caller `{ kind: 'api_key' | 'oauth', id, name }` instead of an `ApiKey`. The OAuth name is "Claude on the web and phone (connected 10 Nov 2026)". It flows into `runAsMcpActor` as `keyName`, so audit entries carry `via_mcp.key` as today and `get_status` shows which connection is in use (`key` in its output; rename the field to `connection` only if the tests and `docs/agent-mcp.md` change with it).
- Rate limit for OAuth callers: 2,000 calls an hour per grant (the same as the existing `claude` key), counted from `api_usage.mcp_oauth_grant_id`. `checkRateLimit` and `logApiUsage` take the caller rather than an API key id.
- 401 responses when `MCP_OAUTH_ENABLED` is on: add `WWW-Authenticate: Bearer resource_metadata="<appUrl>/.well-known/oauth-protected-resource/api/mcp", scope="mcp:full"`, plus `error="invalid_token"` when a token was presented. The JSON body is unchanged. 403 and 503 unchanged. `createErrorResponse` has no headers parameter today; add an optional one rather than building a second response helper.
- The `MCP_ACTING_USER_ID` check moves ahead of OAuth token resolution (section 8.4); for API keys the order stays as it is. Note: if the Mac's key is ever switched off, Claude Code will see this header and may try to sign in through a browser; the authorise page refuses its client, so it fails with a clear error and nothing else changes.
- No lazy authentication: `initialize` and `tools/list` need a token like everything else, because every tool acts as Peter.
- Tools, annotations and the 405 on GET and DELETE are unchanged. `run_action` and `call_app_route` keep `destructiveHint: true`, which makes Claude ask before each call.

## 13. Audit, usage and alerts

- Audit (`logAuditEvent`, `resource_type: 'mcp_connection'`, `operation_status` success or failure, which is the only check constraint on `audit_logs`): `mcp_oauth_connect_approved`, `mcp_oauth_connect_denied`, `mcp_oauth_refused_not_owner`, `mcp_oauth_password_failed`, `mcp_oauth_password_locked`, `mcp_oauth_pin_failed`, `mcp_oauth_pin_locked`, `mcp_oauth_pin_blocked`, `mcp_oauth_pin_set`, `mcp_oauth_pin_changed`, `mcp_oauth_disconnected`, `mcp_oauth_replaced`, `mcp_oauth_refresh_reuse`, `mcp_oauth_code_reuse`, `mcp_oauth_revoked_password_change`. Each with IP and user agent; never a token, code, PIN or password.
- Usage: every MCP call through OAuth is an `api_usage` row with `mcp_oauth_grant_id` and the same endpoint label as today. Token endpoint calls are not logged there.
- Problem alerts (Peter's rule of 2 November 2026: email only when something is wrong), through the existing alert address `CRON_ALERT_EMAIL` as the money alerts use (`src/lib/money-alerts.ts`): someone other than Peter tried to approve; the password lockout, the PIN lock or the PIN block tripped; a refresh token or code was reused outside the 60-second window. No email for Peter's own successful connection or disconnection, nor for a reuse inside the window. While `SUSPEND_ALL_EMAIL` or `SUSPEND_ALL_COMMS` is on the email cannot go, so every alert is also a `logger.error` line and an audit entry.

## 14. Middleware, headers and the CSP

- `src/middleware.ts`: add `/.well-known` to `PUBLIC_PATH_PREFIXES` with a comment (public metadata only; anything not built there must 404, not bounce to the login page). Today `/.well-known/openid-configuration` answers 307 to `/auth/login` and sets `post_login_redirect` (checked live); after the change it is a plain 404, which is what OAuth clients expect. Segment-bounded matching covers the `/api/mcp` suffix. `/oauth` stays protected so signed-out visitors go through the normal login and come back via `post_login_redirect`; a real authorise URL (about 400 characters, no literal spaces) survives `sanitizeRedirectTarget` and `safeRelativePath` (traced in review; keep a test). `/api/oauth/*` is already public at middleware level and does its own checks.
- `src/lib/short-links/routing.ts`: add `oauth` and `.well-known` to `RESERVED_TOP_LEVEL_ROUTES`, so neither can ever be taken as a short-link code.
- CSP: no change expected. The consent action returns the Claude URL and the page navigates with `window.location.assign`, which `form-action` does not govern; a plain form POST answered by a 303 to claude.ai would be blocked by `form-action 'self'` in some browsers. Verify on desktop Chrome, iPhone Safari (Claude's sign-in sheet) and Android Chrome. Only if one blocks: add a `next.config.mjs` rule for `/oauth/:path*` after the global one carrying the whole policy with `form-action 'self' https://claude.ai` (a later rule overwrites the same header, so this replaces the global CSP on that path only). `frame-ancestors 'none'` and `X-Frame-Options: DENY` already meet the anti-framing rule for consent screens (confirmed on the live site).
- `connect-src` is unchanged: nothing on our pages calls Claude; the server makes no outbound OAuth calls at all (D3, D4).
- New `next.config.mjs` rules after the global one: `/oauth/:path*` gets `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; `/.well-known/:path*` gets `Access-Control-Allow-Origin: *`. Config headers win over route-handler headers in this app, so these cannot be set from the handlers. Check each with `curl -I` on a preview.
- Vercel: confirm no firewall rule, bot protection or attack challenge mode applies to `/api/mcp`, `/api/oauth/*`, `/oauth/*` or `/.well-known/*` for Anthropic's egress ranges, and that nothing redirects those paths (a redirect drops the token).

## 15. Agent access rule (MCP manifest)

- Add `api/oauth/` to `EXCLUDED_ROUTE_PREFIXES` in `src/lib/mcp/manifest/build.ts`.
- Exclude the four `mcp_oauth_*` tables from the generated table list (they are unreadable through RLS anyway; listing them invites failed queries). `buildTables` in `build.ts` has no exclusion mechanism yet; add a small named list with a comment.
- The consent, Disconnect and PIN actions are page-local, so they never enter `actions.json`. Add a guard to `tests/guards/mcp-manifest.test.ts` that nothing under `src/app/oauth/`, the Disconnect action or `setConnectPin` appears in the manifest.
- Run `npm run mcp:manifest` and commit `src/lib/mcp/generated/` (the `api_usage` column and the new tables change `tables.json` and the types).
- Update `docs/agent-mcp.md`: an OAuth section (how Claude on the web and phone connects, what Peter types at claude.ai, revocation, the kill switch), and add the OAuth routes and connection management to "Not exposed".

## 16. Failure behaviour

| Failure | Result |
|---|---|
| Database down during a call | 503; Claude retries later; token not discarded |
| Claude refreshes twice at once, or retries a code exchange | Both succeed inside 60 seconds; no alert |
| `MCP_ACTING_USER_ID` unset by mistake | 503 for everyone; connection survives once fixed |
| Database down during refresh | 503; Claude keeps its refresh token |
| No PIN set yet | Consent screen sends Peter to his profile page; nothing issued |
| Five or ten wrong PINs in a row | Connecting locked for 15 minutes, or blocked until an approved database change; problem alert; nothing issued |
| `MCP_OAUTH_ENABLED` off | Well-known and OAuth routes 404; `/api/mcp` 401 without the OAuth header; API keys work |
| `MCP_ACTING_USER_ID` unset | Existing 503 `MCP_NOT_CONFIGURED` for every caller |
| Wrong account signed in | Refusal page, audit, alert |
| Peter picked the wrong client option at claude.ai | Claude's sign-in fails; remove and re-add the connector |

## 17. Residual risks (accepted unless Peter says otherwise)

1. Anyone signed in to Peter's claude.ai account can use the connection on any device. Peter should make sure that account has strong sign-in protection.
2. Consent phishing: someone who starts a connection from their own claude.ai account and gets Peter to approve their link would receive his access. Mitigated by the screen's warning, replacement of the earlier connection (D8), and the Settings list. claude.ai does not tell us which Claude account is asking. Optional hardening if Peter's account offers "Request headers" (section 4): Anthropic allows request headers alongside OAuth with your own client (not `Authorization`), so a secret `x-auth-token` value set only on Peter's connector and checked by `/api/mcp` for OAuth callers would make an attacker's tokens useless. Not in the base build.
3. Claude asks before each change only while Peter has not chosen "Always allow" for `run_action` or `call_app_route`, and not in Research mode.
4. A refresh token taken from Anthropic's store works until it is used a second time more than 60 seconds apart, or is revoked (public client, no secret). Rotation turns a theft into a visible failure for one side.
5. No Turnstile on the consent password check, matching the current login.
6. Tokens held by a third party for up to 90 days.
7. The PIN is something Peter knows. Someone with both his password and his PIN can connect Claude from their own claude.ai account; the replacement of Peter's own connection (D8), the problem alerts and the Settings list are what would show it.
8. A forgotten PIN, or a block after ten wrong PINs, needs a database change Peter approves; there is no self-service reset.

## 18. Tests

Unit (Vitest, Supabase and email mocked; both `npm test` and `npm run test:utc`):
- Metadata: exact documents at all three paths; issuer and resource from `getAppUrl()`; CORS only on metadata; 404 when the switch is off.
- `/api/mcp`: 401 with the right `WWW-Authenticate` (with and without `error="invalid_token"`); unchanged 401 when the switch is off; every existing `tests/api/mcpRoute.test.ts` case still green (403 without `mcp:full`, `*` refused, 429, 503, `MCP_NOT_CONFIGURED`).
- Access token resolution: each refusal in 8.4 (expired, revoked token, revoked grant, expired grant, wrong resource, user not `MCP_ACTING_USER_ID`, switch off) gives 401; database error gives 503; per-grant 429; usage row carries `mcp_oauth_grant_id`; acting context `keyName` is the connection name.
- Authorise validation table: unknown client and bad redirect show an error page with no redirect; each other error redirects with `error`, `state`, `iss`; owner check refuses another account and audits; nothing is written on GET.
- Approve and deny: wrong password gives the generic error; password lockout at five failures in 15 minutes counted from audit rows, and refusal when they cannot be read; no PIN set refuses and the screen links to the profile page; the PIN is checked only after the password passes; a wrong PIN gives the generic error and an audit row; the fifth wrong PIN in a row locks for 15 minutes and alerts, the tenth blocks and alerts, and a right PIN resets the count (including a right fifth attempt); neither value appears in logs or audit entries; deny returns `access_denied`; a non-owner submitting is refused, audited and alerted, while a non-owner viewing the page writes nothing.
- Setting the PIN: the card and `setConnectPin` are refused to anyone but `MCP_ACTING_USER_ID`; the password is required; a change also needs the current PIN through the same reservation; 6 to 12 digits only, and mismatched entries, all-same digits and straight runs are refused; stored as scrypt with a fresh salt and its parameters, never the PIN or a plain SHA-256; a live connection survives a PIN change.
- Token endpoint: form encoding only; happy code exchange; PKCE mismatch, expired code, wrong redirect, wrong resource (`invalid_target`); code retried within 60 seconds gets a fresh pair, later reuse revokes the grant; refresh happy path rotates; spent refresh token inside 60 seconds rotates, outside revokes; expired, idle or other-account grant gives `invalid_grant`; empty secret and `Basic` with an empty password accepted, non-empty secret `invalid_client`; refresh without `client_id` accepted; OAuth error shape; unknown grant type; `no-store` headers; 503 on database error and on a missing `MCP_ACTING_USER_ID`.
- Live predicate parity: the TypeScript check and `mcp_oauth_grant_is_live` agree on a table of cases (revoked, expired, idle by `last_used_at`, idle by `created_at` with no use, live).
- Revocation endpoint: 200 for unknown tokens; revokes the grant.
- Revocation triggers: Disconnect needs `settings` `manage`; a new connection revokes the old; the kill switch marks `oauth_disabled` on refresh; a changed `MCP_ACTING_USER_ID` marks `acting_user_changed`; a missing one gives 503 and touches nothing. (Password changes are proven in the Postgres harness, because the trigger does the work.)
- Middleware: the two well-known prefixes are public and segment-bounded; `/oauth/authorize` signed out redirects to login and the full query survives into `post_login_redirect` and back.
- Manifest guard: OAuth routes, tables and actions absent.

Postgres harness (`scripts/testing/mcp-oauth-postgres.py`, run by `npm run test:pg`): two concurrent refreshes with one token both succeed and leave one live grant; a third use after 60 seconds revokes; two concurrent redemptions for Peter leave exactly one live grant (advisory lock); a second connection revokes the first; concurrent PIN attempts cannot reserve past the fifth before the lock or the tenth before the block; changing `encrypted_password` on the user revokes every grant and token, and an update that leaves the password alone revokes nothing; `anon` and `authenticated` cannot select, insert or execute anything new (`has_table_privilege`, `has_function_privilege`); `api_usage_one_caller` accepts existing-style rows and refuses both or neither; the `NOT VALID` constraints validate on a table seeded with existing-style rows.

After the migration: `npx tsx scripts/security/assert-anon-surface.ts`; the proconfig-null check from the workspace Supabase rule returns 0; regenerate `src/types/database.generated.ts` (the query-columns guard covers the new column).

Live, after switching on (the exact path Peter will use): Peter has set his PIN on the profile page; add the connector at claude.ai on the web as in section 6; approve with password and PIN; ask Claude to run `get_status` and a read on the web and on the phone; confirm `run_action` prompts; check the `api_usage` rows carry the grant; wait past an hour of use and confirm a refresh rotated the tokens (rows, not guesswork); press Disconnect and confirm the next call fails and Claude asks to reconnect; reconnect and confirm the old grant is `replaced`. The refusal of a non-owner account is proven by tests only; no other staff account is used on the live system.

## 19. Rollout

Independently deployable pieces (four or more files and a schema change):

1. Migrations through `prod-migrate`, before the code that uses them: migration 1 (tables, functions, policies, password trigger), then the three `api_usage` steps (section 8.2) at a quiet hour with the lock timeout, then types and manifest regenerated. Nothing reads the tables yet, and the trigger only revokes grants, of which there are none.
2. Code: metadata routes, authorise page and actions, token and revoke routes, `withMcpAuth` branch, middleware, headers, manifest exclusions, tests, `docs/agent-mcp.md`, `.env.example` (`MCP_OAUTH_ENABLED`, documented as off by default). Merged with the switch off: production behaves exactly as today.
3. Settings "Claude on the web and phone" list and Disconnect, the PIN card on the profile page, `CLAUDE.md` deviations (connect-time PIN, the app as a token issuer), auth standard line.
4. Peter sets his PIN on the profile page. Then set `MCP_OAUTH_ENABLED=true` in Vercel production, redeploy, run the live checks in section 18 with Peter connecting from claude.ai.

Rollback: switch off (immediate refusal of every OAuth token, API keys untouched), or Disconnect, or revert. The migration is additive and stays.

## 20. Files expected to change

New: `src/app/.well-known/oauth-protected-resource/route.ts`, `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`, `src/app/oauth/authorize/page.tsx`, `src/app/oauth/authorize/actions.ts`, `src/app/oauth/authorize/_components/*`, `src/app/api/oauth/token/route.ts`, `src/app/api/oauth/revoke/route.ts`, `src/app/(authenticated)/profile/connect-pin/actions.ts`, `src/app/(authenticated)/profile/_components/ConnectPinCard.tsx`, `src/lib/mcp/oauth/*`, a migration, `scripts/testing/mcp-oauth-postgres.py`, tests under `tests/api/` and `tests/lib/mcp/`.

Changed: `src/lib/api/auth.ts` (including an optional headers parameter on `createErrorResponse`), `src/app/api/mcp/route.ts`, `src/lib/mcp/server.ts` (status output only), `src/middleware.ts`, `next.config.mjs` (headers), `src/lib/short-links/routing.ts`, `src/lib/mcp/manifest/build.ts`, `src/lib/mcp/generated/*`, `src/types/database.generated.ts`, `src/app/(authenticated)/settings/api-keys/*`, `src/app/(authenticated)/profile/page.tsx` (the PIN card), `docs/agent-mcp.md`, `.env.example`, `CLAUDE.md`, `/Users/peterpitcher/Cursor/.claude/docs/auth-standard.md` (one line, workspace repo).

Deliberately unchanged: the tools and their annotations, `acting-session.ts`, `acting-context.ts`, the API key screen's key handling, `src/app/actions/profile.ts` and the reset flow (the password trigger covers them), the distributed rate limiter, the website repository (the website does not call `/api/mcp`, so no counterpart change).

## 21. Owner decisions (Peter, in chat, 10 November 2026)

Each is folded into the sections named; this table is a record, not an addendum.

| # | Topic | Decision | Where it lives |
|---|---|---|---|
| 1 | Request headers instead of building | Peter's account has "Request headers" and he connects that way. This build is PARKED: not started, built only if he asks. | Status line, sections 1 and 4 |
| 2 | Connect-time check | "I'll set a pin number myself." A PIN he chooses, not an emailed code. It does not apply to the request-header route, which has no connect step. | D10; sections 6, 7, 8.1 to 8.3, 9, 10, 13, 15 to 20 |
| 3 | Longest a connection lasts | 90 days, ending sooner after 30 days unused. | D11; sections 8.5, 9.3, 11 |
| 4 | Full access or read only | Full access: "The whole point of this is that I can ask agents to make changes, update details, and review details for the application for day-to-day management of the business." | D7 |
