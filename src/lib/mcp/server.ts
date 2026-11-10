import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isTruthyFlag } from '@/lib/sms/suspension'
import {
  ACTIONS,
  ROUTES,
  callRoute,
  describeAction,
  errorResult,
  findActions,
  findRoutes,
  runAction,
  textResult,
} from '@/lib/mcp/bridge'
import { FILTER_OPERATORS, MAX_QUERY_ROWS, TABLES, describeData, queryRecords } from '@/lib/mcp/records'

/**
 * The tools an agent sees at /api/mcp. Built per request; the request already runs inside
 * runAsMcpActor, so every tool acts as the configured account.
 */

const SERVER_INSTRUCTIONS = `This is The Anchor management app (management.orangejelly.co.uk): bookings, customers, events, parking, private hire, invoices, receipts, rota, payroll, messaging and the rest. Every call acts as Peter's own account, with his full permissions, through the same code the staff screens use, so the app's own rules apply: validation, permissions, deposit rules, SMS quiet hours and limits, the comms kill switches and the audit log.

How to work:
1. find_actions to search the server actions by words (for example "invoice overdue", "parking booking", "no show"). describe_action shows the parameters.
2. run_read_action for anything that only reads; run_action for anything that creates, changes, sends, refunds or deletes.
3. find_app_routes and call_app_route for screens backed by an API route instead of an action, including PDF and CSV downloads.
4. query_records reads any table or view directly when no action fits (describe_data lists them). Prefer actions: raw rows skip business rules (for example, a paid deposit is recorded on the booking, not in the payments table).

Rules:
- Dates and times are Europe/London. Work out a weekday from a date with care, and say the date beside it.
- Sending a message, taking or refunding money and deleting are real and immediate for real customers and staff. Follow Peter's approval rules for the agent you are running as before you do any of them.
- get_status says which comms kill switches are on.`

const argsSchema = z.array(z.unknown()).optional().describe('Arguments in parameter order, as a JSON array.')

export function buildMcpServer(options: { keyName: string; userId: string; origin: string }): McpServer {
  const server = new McpServer(
    { name: 'anchor-management', version: '1.0.0' },
    { instructions: SERVER_INSTRUCTIONS },
  )

  server.registerTool(
    'get_status',
    {
      title: 'Who am I acting as',
      description: 'The account every call acts as, the key in use, which comms kill switches are on, and how much the bridge covers.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const client = await createClient()
      const { data } = await client.auth.getUser()
      return textResult({
        actingAs: { userId: options.userId, email: data.user?.email ?? null },
        key: options.keyName,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
        // On means that channel is stopped. Read at call time, as the senders read them.
        killSwitches: {
          SUSPEND_ALL_COMMS: isTruthyFlag(process.env.SUSPEND_ALL_COMMS),
          SUSPEND_ALL_SMS: isTruthyFlag(process.env.SUSPEND_ALL_SMS),
          SUSPEND_EVENT_SMS: isTruthyFlag(process.env.SUSPEND_EVENT_SMS),
          SUSPEND_ALL_EMAIL: isTruthyFlag(process.env.SUSPEND_ALL_EMAIL),
        },
        coverage: {
          actions: ACTIONS.length,
          readOnlyActions: ACTIONS.filter((action) => action.readOnly).length,
          routes: ROUTES.length,
          tables: TABLES.length,
        },
        timeZone: 'Europe/London',
        nowLondon: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' }),
      })
    },
  )

  server.registerTool(
    'find_actions',
    {
      title: 'Search the app actions',
      description:
        'Search the server actions (every button and form in the app) by words in their name or description. Leave query empty to list the areas.',
      inputSchema: {
        query: z.string().optional().describe('Words to match, for example "parking refund".'),
        area: z.string().optional().describe('Limit to one area (module), for example "invoices" or "oj-projects".'),
        read_only: z.boolean().optional().describe('Only actions that just read.'),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, area, read_only, limit }) => findActions({ query, area, readOnly: read_only, limit }),
  )

  server.registerTool(
    'describe_action',
    {
      title: 'Describe an action',
      description: 'The parameters of one action, with the declarations of the types and schemas they use, and its documentation.',
      inputSchema: { name: z.string().describe('For example "invoices.getInvoices".') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name }) => describeAction(name),
  )

  server.registerTool(
    'run_read_action',
    {
      title: 'Run a read-only action',
      description: 'Runs an action that only reads data. Refuses any action that can change something; use run_action for those.',
      inputSchema: { name: z.string(), args: argsSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name, args }) => runAction(name, args, { readOnlyOnly: true }),
  )

  server.registerTool(
    'run_action',
    {
      title: 'Run any action',
      description:
        'Runs any server action as Peter: create, edit, send, refund, cancel, delete. Real and immediate. The action applies its own validation, permissions and the comms kill switches.',
      inputSchema: { name: z.string(), args: argsSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ name, args }) => runAction(name, args, { readOnlyOnly: false }),
  )

  server.registerTool(
    'find_app_routes',
    {
      title: 'List staff API routes',
      description: 'The API routes behind staff screens (lists, exports, PDFs), with their methods. Cron and webhook routes are not included.',
      inputSchema: { query: z.string().optional().describe('Words that must appear in the path, for example "invoices pdf".') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) => findRoutes(query),
  )

  server.registerTool(
    'call_app_route',
    {
      title: 'Call a staff API route',
      description:
        'Calls a staff API route as Peter. JSON comes back as data; a PDF, CSV or image comes back as a file (10 MB at most). A POST, PUT, PATCH or DELETE changes real data.',
      inputSchema: {
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string().describe('The real path, with ids filled in, for example "/api/invoices/9a1.../pdf".'),
        query: z.record(z.string()).optional().describe('Query string parameters.'),
        body: z.unknown().optional().describe('JSON body for POST, PUT, PATCH or DELETE.'),
        form: z.record(z.unknown()).optional().describe('Send a multipart form instead of JSON; a file is { filename, mimeType, base64 }.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (input) => callRoute(input, options.origin),
  )

  server.registerTool(
    'describe_data',
    {
      title: 'List tables and columns',
      description: 'Lists every table and view, or the columns of one.',
      inputSchema: { table: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ table }) => describeData(table),
  )

  server.registerTool(
    'query_records',
    {
      title: 'Read rows from a table',
      description: `Reads rows from any table or view as Peter. Filters are ANDed. At most ${MAX_QUERY_ROWS} rows a call; page with offset. Read only.`,
      inputSchema: {
        table: z.string(),
        select: z.string().optional().describe('PostgREST select, for example "id,status,customers(first_name,last_name,mobile_number)". Default all columns.'),
        filters: z
          .array(z.object({ column: z.string(), op: z.enum(FILTER_OPERATORS), value: z.unknown().optional() }))
          .optional(),
        order: z.array(z.object({ column: z.string(), ascending: z.boolean().optional() })).optional(),
        limit: z.number().int().min(1).max(MAX_QUERY_ROWS).optional(),
        offset: z.number().int().min(0).optional(),
        count: z.boolean().optional().describe('Also return the total number of matching rows.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return await queryRecords(await createClient(), input)
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  return server
}
