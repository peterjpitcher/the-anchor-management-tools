# Agent access (MCP)

`POST /api/mcp` is an MCP server that lets Peter's agents (Jordan, scheduled routines, coding sessions, any Claude agent on his Mac) use the whole app as Peter: view, create, change, send, refund, delete. Owner decision, 10 November 2026: everything in the app, contact details included, for his use only. Spec: `tasks/spec-2026-11-10-agent-mcp-endpoint.md` in the primary checkout.

## How it works

- **It is a bridge, not a set of hand-written tools.** It runs the app's own server actions (`src/app/actions/`) and staff API routes (`src/app/api/`), so every rule the app enforces applies to an agent exactly as it does to Peter in the browser: Zod validation, `checkUserPermission`, deposit rules, SMS quiet hours and limits, the comms kill switches, audit logging, revalidation and calendar sync.
- **It acts as Peter's own account** (`MCP_ACTING_USER_ID`). `src/lib/mcp/acting-session.ts` gets a real Supabase session for that account (an admin-generated sign-in link, verified on the server; no email is sent) and keeps it for the life of the server instance. Inside an MCP request, `createClient()` in `src/lib/supabase/server.ts` returns that session's client instead of reading cookies. The switch is an `AsyncLocalStorage` context (`src/lib/mcp/acting-context.ts`) that only `/api/mcp` sets.
- **Audit:** entries written through the shared audit service (`src/services/audit.ts`) during an MCP call carry `additional_info.via_mcp.key`. A few writers insert into `audit_logs` directly and do not add the marker; their entries still name Peter. Every MCP call is also a row in `api_usage`, with the endpoint `/api/mcp/<tool>:<action, route or table>`. Arguments and results are not logged.
- **Transport:** Streamable HTTP, stateless, JSON responses (`@modelcontextprotocol/sdk`, `WebStandardStreamableHTTPServerTransport`). No session store; every call carries its key.

## Authentication

- `Authorization: Bearer <key>` (or `x-api-key`), from the `api_keys` table.
- The key needs the scope `mcp:full`, ticked by name on Settings, API keys. **The `*` wildcard does not grant it.**
- `withMcpAuth` in `src/lib/api/auth.ts`: 503 when the key or rate limit cannot be checked, 401 bad key, 403 no `mcp:full`, 429 over the key's hourly limit. 503 `MCP_NOT_CONFIGURED` when `MCP_ACTING_USER_ID` is unset or not a UUID.
- Switching the key off on the API keys screen stops it on the next call.

## Tools

| Tool | Use |
|---|---|
| `get_status` | Acting account, key name, kill switch states, coverage counts, London time |
| `find_actions` | Search server actions by words, area or read-only |
| `describe_action` | Parameters, the declarations of the types and Zod schemas they use, and the doc comment |
| `run_read_action` | Run an action classed read only (refuses anything else) |
| `run_action` | Run any action. Marked destructive, so Claude asks before each call unless allowed |
| `find_app_routes` | Staff API routes and their methods |
| `call_app_route` | Call one as Peter; JSON as data, PDFs, CSVs and images as files (10 MB max). Marked destructive |
| `describe_data` | Tables and views, or one table's columns |
| `query_records` | Read rows from any table or view (row level security applies), up to 1,000 a call |

There is no raw table write on purpose: every change the app can make is an action or a staff route.

Not exposed: cron routes, webhooks, `/api/jobs`, `/api/mcp` itself, and routes that only take an API key (the website's).

## Keeping it in step

The lists of actions, routes and tables are generated from the code:

```bash
npm run mcp:manifest
```

writes `src/lib/mcp/generated/` (`actions.json`, `routes.json`, `tables.json`, `loaders.ts`). `tests/guards/mcp-manifest.test.ts` regenerates them in memory and fails when the committed files differ, so a change that adds, renames or removes an action, a route or a table cannot merge until the manifest is regenerated.

Read-only classing is worked out in `src/lib/mcp/manifest/build.ts`. An action is read only when its name starts `get`, `list`, `fetch`, `search`, `find`, `count`, `lookup`, `preview` or `describe`, and nothing it calls writes: the check follows its calls into the app's own services and helpers, so a `get` that syncs or saves on the way (the training records do) is classed as a write. A Supabase insert, update, upsert or delete, a storage upload, a `fetch` that is not a GET, a call into a package named send, notify, queue, capture, refund, create, sync or ensure, and any `.rpc()` not on the checked list of read-only Postgres functions (`READ_ONLY_RPCS`) all count as writes. `npm run mcp:manifest -- --why <module.action>` prints the call chain behind a write. A new read-only Postgres function counts as a write until it is checked against production and added to that list. Correct a misclassification in `src/lib/mcp/action-overrides.ts` and regenerate. The classing only decides which run tool may call an action; the key holds Peter's full access either way.

## Connecting an agent

1. Create a key on Settings, API keys with only **Agent Access (MCP)** ticked. Copy it once.
2. Save it to `~/.claude/secrets/anchor-management/claude.key`, mode 0600.
3. Claude Code, user scope (every session, desktop routine and terminal on the Mac), reading the key at connect time so it is not written into `~/.claude.json`:

```bash
claude mcp add-json --scope user anchor-management '{"type":"http","url":"https://management.orangejelly.co.uk/api/mcp","headersHelper":"/Users/peterpitcher/.claude/secrets/anchor-management/headers.sh"}'
```

where `headers.sh` prints `{"Authorization":"Bearer <contents of claude.key>"}`. Give `headersHelper` the full path (the set-up was proven with it).
4. Jordan's runtime (`1 My Agents/desks/jordan/runtime/.claude/settings.json`) allows the seven read tools so a scheduled run is never held on a prompt; `run_action` and `call_app_route` still ask.

### Claude on the web, the desktop chat and the phone (claude.ai)

A claude.ai custom connector with a request header (Anthropic's "Request headers", a beta feature; Peter's account has it, checked 10 November 2026). Every call comes from Anthropic's cloud, whichever device Peter is on.

1. Settings, API keys: create a separate key named `claude.ai` with only **Agent Access (MCP)** ticked, rate limit 2,000 an hour like the Mac key. Copy it once. Keeping it separate means either key can be switched off without touching the other.
2. claude.ai: Customize, Connectors, Add custom connector. Name `Anchor management`, server URL `https://management.orangejelly.co.uk/api/mcp`, authentication **No sign-in**, request header `x-api-key` with the key as its value. Leave Advanced, Transport as it is.
3. The connector then works in Claude on the web, the desktop app and the phone apps for that claude.ai account, and for anyone signed in to it.
4. `run_action` and `call_app_route` are marked destructive, so Claude asks before each call unless "Always allow" has been set for that tool; in Research mode Claude can call tools without asking.
5. To stop it, switch the `claude.ai` key off on Settings, API keys. claude.ai cannot edit a saved header, so a new key means removing the connector and adding it again.
6. The key does not expire on its own: the API keys screen cannot set an expiry.

An OAuth sign-in for claude.ai (expiring tokens and a PIN at connect time) is specified and parked in `tasks/spec-2026-11-10-mcp-oauth.md`; it is built only if Peter asks.

## Rollback

Switch the key off (immediate), or unset `MCP_ACTING_USER_ID` and redeploy (the endpoint then refuses everything), or revert the PR.
