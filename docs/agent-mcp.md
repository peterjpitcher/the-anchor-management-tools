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

Read-only classing is a name and body heuristic in `src/lib/mcp/manifest/build.ts`: names starting `get`, `list`, `fetch`, `search`, `find`, `count`, `lookup`, `preview` or `describe`, with no write or send call in the body. Correct a misclassification in `src/lib/mcp/action-overrides.ts` and regenerate. The classing only decides which run tool may call an action; the key holds Peter's full access either way.

## Connecting an agent

1. Create a key on Settings, API keys with only **Agent Access (MCP)** ticked. Copy it once.
2. Save it to `~/.claude/secrets/anchor-management/claude.key`, mode 0600.
3. Claude Code, user scope (every session, desktop routine and terminal on the Mac), reading the key at connect time so it is not written into `~/.claude.json`:

```bash
claude mcp add-json --scope user anchor-management '{"type":"http","url":"https://management.orangejelly.co.uk/api/mcp","headersHelper":"~/.claude/secrets/anchor-management/headers.sh"}'
```

where `headers.sh` prints `{"Authorization":"Bearer <contents of claude.key>"}`.

Claude on the web and phone (claude.ai connectors) is not covered: those need an OAuth sign-in flow.

## Rollback

Switch the key off (immediate), or unset `MCP_ACTING_USER_ID` and redeploy (the endpoint then refuses everything), or revert the PR.
