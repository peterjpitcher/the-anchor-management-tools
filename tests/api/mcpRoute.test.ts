import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import actions from '@/lib/mcp/generated/actions.json'
import routes from '@/lib/mcp/generated/routes.json'

/**
 * The agent bridge end to end: the real route, the real key guard, the real MCP server and
 * transport. Only the database behind the key lookup, the acting session and the action and
 * route modules are replaced.
 */

type KeyRow = { id: string; name: string; permissions: string[]; rate_limit: number; is_active: boolean; expires_at: string | null }

const state = vi.hoisted(() => ({
  keyRows: [] as KeyRow[],
  keyLookupError: null as { message: string } | null,
  usage: [] as Array<{ endpoint: string; status_code: number }>,
  actionModules: {} as Record<string, Record<string, unknown>>,
  routeModules: {} as Record<string, Record<string, unknown>>,
  actingUserEmail: 'owner@example.com',
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => undefined }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'api_keys') {
        const lookup: Record<string, unknown> = {}
        lookup.select = () => lookup
        lookup.eq = () => lookup
        lookup.then = (resolve: (value: unknown) => unknown) =>
          resolve({ data: state.keyLookupError ? null : state.keyRows, error: state.keyLookupError })
        const touch: Record<string, unknown> = {}
        touch.eq = () => touch
        touch.select = () => touch
        touch.maybeSingle = async () => ({ data: { id: 'key-1' }, error: null })
        return { select: () => lookup, update: () => touch }
      }
      if (table === 'api_usage') {
        const count: Record<string, unknown> = {}
        count.eq = () => count
        count.gte = () => count
        count.then = (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null })
        return {
          select: () => count,
          insert: async (row: { endpoint: string; status_code: number }) => {
            state.usage.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))
vi.mock('@/lib/mcp/acting-session', () => ({
  createActingClient: vi.fn(async (userId: string) => ({
    auth: { getUser: async () => ({ data: { user: { id: userId, email: state.actingUserEmail } }, error: null }) },
  })),
}))
vi.mock('@/lib/mcp/generated/loaders', () => ({
  ACTION_MODULES: new Proxy({}, { get: (_target, key) => async () => state.actionModules[String(key)] ?? {} }),
  ROUTE_MODULES: new Proxy({}, { get: (_target, key) => async () => state.routeModules[String(key)] ?? {} }),
}))

const ACTING_USER = '11111111-2222-4333-8444-555555555555'
const MCP_KEY: KeyRow = { id: 'key-1', name: 'claude', permissions: ['mcp:full'], rate_limit: 2000, is_active: true, expires_at: null }

let nextId = 1
function rpc(method: string, params: Record<string, unknown> = {}): Request {
  return new Request('https://management.example.com/api/mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret-key',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
}

async function post(request: Request): Promise<Response> {
  const { POST } = await import('@/app/api/mcp/route')
  return POST(request)
}

async function callTool(name: string, args: Record<string, unknown>) {
  const response = await post(rpc('tools/call', { name, arguments: args }))
  expect(response.status).toBe(200)
  const body = await response.json()
  return body.result as { content: Array<{ type: string; text?: string; resource?: { blob: string; mimeType: string } }>; isError?: boolean }
}

function parsed(result: { content: Array<{ text?: string }> }): any {
  return JSON.parse(result.content[0].text ?? 'null')
}

const readAction = actions.find((action) => action.readOnly && action.params.length === 0)!
const writeAction = actions.find((action) => !action.readOnly && action.params.some((param) => param.type === 'FormData'))!
const formIndex = writeAction.params.findIndex((param) => param.type === 'FormData')

beforeEach(() => {
  vi.stubEnv('MCP_ACTING_USER_ID', ACTING_USER)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  state.keyRows = [MCP_KEY]
  state.keyLookupError = null
  state.usage = []
  state.actionModules = {}
  state.routeModules = {}
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/api/mcp key guard', () => {
  it('refuses a request with no key', async () => {
    const request = new Request('https://management.example.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    state.keyRows = []
    expect((await post(request)).status).toBe(401)
  })

  it('refuses a key without agent access', async () => {
    state.keyRows = [{ ...MCP_KEY, permissions: ['read:events'] }]
    const response = await post(rpc('tools/list'))
    expect(response.status).toBe(403)
    expect(state.usage).toEqual([expect.objectContaining({ endpoint: '/api/mcp/tools/list', status_code: 403 })])
  })

  it('does not treat the * wildcard as agent access', async () => {
    state.keyRows = [{ ...MCP_KEY, permissions: ['*'] }]
    expect((await post(rpc('tools/list'))).status).toBe(403)
  })

  it('answers 503, not 401, when the key cannot be checked', async () => {
    state.keyLookupError = { message: 'connection refused' }
    expect((await post(rpc('tools/list'))).status).toBe(503)
  })

  it('refuses to act as anyone when the acting account is not configured', async () => {
    vi.stubEnv('MCP_ACTING_USER_ID', '')
    const response = await post(rpc('tools/list'))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'MCP_NOT_CONFIGURED' } })
  })

  it('answers 405 to GET', async () => {
    const { GET } = await import('@/app/api/mcp/route')
    expect(GET().status).toBe(405)
  })

  it('answers 400 to a body that is not JSON', async () => {
    const request = new Request('https://management.example.com/api/mcp', { method: 'POST', body: 'not json' })
    expect((await post(request)).status).toBe(400)
  })
})

describe('/api/mcp tools', () => {
  it('initialises and lists the nine tools', async () => {
    const init = await post(rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    }))
    expect(init.status).toBe(200)
    expect((await init.json()).result.serverInfo.name).toBe('anchor-management')

    const list = await post(rpc('tools/list'))
    const tools = (await list.json()).result.tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'call_app_route', 'describe_action', 'describe_data', 'find_actions', 'find_app_routes',
      'get_status', 'query_records', 'run_action', 'run_read_action',
    ])
    expect(tools.find((tool) => tool.name === 'run_action')?.annotations?.destructiveHint).toBe(true)
    expect(tools.find((tool) => tool.name === 'run_read_action')?.annotations?.readOnlyHint).toBe(true)
  })

  it('get_status reports the acting account, the key and the kill switches', async () => {
    vi.stubEnv('SUSPEND_ALL_SMS', 'true')
    const status = parsed(await callTool('get_status', {}))
    expect(status.actingAs).toEqual({ userId: ACTING_USER, email: 'owner@example.com' })
    expect(status.key).toBe('claude')
    expect(status.killSwitches).toMatchObject({ SUSPEND_ALL_SMS: true, SUSPEND_ALL_EMAIL: false })
    expect(status.coverage.actions).toBe(actions.length)
  })

  it('records the tool and the action it ran in the usage log', async () => {
    state.actionModules[readAction.module] = { [readAction.export]: async () => ({ success: true }) }
    await callTool('run_read_action', { name: readAction.name })
    expect(state.usage.at(-1)).toMatchObject({ endpoint: `/api/mcp/run_read_action:${readAction.name}`, status_code: 200 })
  })

  it('runs an action inside the acting context, as the configured account', async () => {
    const { getMcpActingContext } = await import('@/lib/mcp/acting-context')
    state.actionModules[readAction.module] = {
      [readAction.export]: async () => {
        const context = getMcpActingContext()
        return { userId: context?.userId, key: context?.keyName }
      },
    }
    const result = await callTool('run_read_action', { name: readAction.name })
    expect(result.isError).toBeUndefined()
    expect(parsed(result)).toEqual({ userId: ACTING_USER, key: 'claude' })
  })

  it('run_read_action refuses an action that can change data', async () => {
    const spy = vi.fn()
    state.actionModules[writeAction.module] = { [writeAction.export]: spy }
    const result = await callTool('run_read_action', { name: writeAction.name, args: [] })
    expect(result.isError).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('run_action builds FormData from an object and reports { error } as a failure', async () => {
    const spy = vi.fn(async (..._args: unknown[]) => ({ error: 'Insufficient permissions' }))
    state.actionModules[writeAction.module] = { [writeAction.export]: spy }
    const args: unknown[] = writeAction.params.map(() => undefined)
    args[formIndex] = { name: 'Quiz night', tags: ['a', 'b'] }
    const result = await callTool('run_action', { name: writeAction.name, args: args.slice(0, formIndex + 1) })
    expect(result.isError).toBe(true)
    const form = spy.mock.calls[0][formIndex] as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('name')).toBe('Quiz night')
    expect(form.getAll('tags')).toEqual(['a', 'b'])
  })

  it('run_action turns a thrown error into a tool error, never an empty success', async () => {
    state.actionModules[writeAction.module] = {
      [writeAction.export]: async () => {
        throw Object.assign(new Error('duplicate key value'), { code: '23505' })
      },
    }
    const result = await callTool('run_action', { name: writeAction.name })
    expect(result.isError).toBe(true)
    expect(parsed(result).error).toContain('duplicate key value; code 23505')
  })

  it('refuses an action name that does not exist', async () => {
    const result = await callTool('run_action', { name: 'invoices.doesNotExist' })
    expect(result.isError).toBe(true)
  })

  it('call_app_route passes ids as route params and returns JSON', async () => {
    const route = routes.find((entry) => /\[[a-z]+\]/i.test(entry.path) && entry.methods.includes('GET'))!
    const handler = vi.fn(async (request: Request, context: { params: Promise<Record<string, string>> }) =>
      Response.json({ url: request.url, params: await context.params }),
    )
    state.routeModules[route.module] = { GET: handler }
    const concrete = route.path.replace(/\[([a-z]+)\]/gi, 'abc-123')
    const result = await callTool('call_app_route', { method: 'GET', path: concrete, query: { page: '2' } })
    const data = parsed(result).data
    expect(data.url).toBe(`https://management.example.com${concrete}?page=2`)
    expect(Object.values(data.params)).toContain('abc-123')
  })

  it('call_app_route returns a PDF as a file', async () => {
    const route = routes.find((entry) => entry.methods.includes('GET'))!
    state.routeModules[route.module] = {
      GET: async () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'content-type': 'application/pdf' } }),
    }
    const result = await callTool('call_app_route', { method: 'GET', path: route.path.replace(/\[[^\]]+\]/g, 'x') })
    const file = result.content.find((item) => item.type === 'resource')
    expect(file?.resource?.mimeType).toBe('application/pdf')
    expect(Buffer.from(file!.resource!.blob, 'base64').toString()).toBe('%PDF')
  })

  it('query_records refuses a table that does not exist', async () => {
    const result = await callTool('query_records', { table: 'no_such_table' })
    expect(result.isError).toBe(true)
  })
})
