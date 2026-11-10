import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The acting switch must only ever apply inside /api/mcp's own async chain. A browser request
 * served by the same instance at the same moment must keep its own cookie session, and the audit
 * trail must mark changes made by an agent.
 */

const state = vi.hoisted(() => ({ inserted: [] as Array<Record<string, unknown>> }))

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
  headers: async () => new Headers({ 'user-agent': 'test' }),
}))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ kind: 'cookie-client' }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@example.com' } }, error: null }) } },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push(row)
        return { error: null }
      },
    }),
  }),
}))

import { createClient } from '@/lib/supabase/server'
import { runAsMcpActor } from '@/lib/mcp/acting-context'
import { AuditService } from '@/services/audit'

function context(keyName: string) {
  return { userId: 'user-1', keyName, getClient: async () => ({ kind: `acting-${keyName}` }) as never }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  state.inserted = []
})

describe('createClient and the MCP acting context', () => {
  it('uses the cookie session outside an MCP request', async () => {
    expect(await createClient()).toEqual({ kind: 'cookie-client' })
  })

  it('uses the acting client inside an MCP request', async () => {
    const client = await runAsMcpActor(context('claude'), () => createClient())
    expect(client).toEqual({ kind: 'acting-claude' })
  })

  it('keeps overlapping requests apart', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const agent = runAsMcpActor(context('claude'), async () => {
      await gate
      return createClient()
    })
    const browser = (async () => {
      const client = await createClient()
      release()
      return client
    })()

    expect(await browser).toEqual({ kind: 'cookie-client' })
    expect(await agent).toEqual({ kind: 'acting-claude' })
  })
})

describe('audit entries written by an agent', () => {
  it('carry the key name inside an MCP request', async () => {
    await runAsMcpActor(context('claude'), () =>
      AuditService.logAuditEvent({ user_id: 'user-1', operation_type: 'update', resource_type: 'invoice', operation_status: 'success', additional_info: { field: 'due_date' } }),
    )
    expect(state.inserted[0].additional_info).toEqual({ field: 'due_date', via_mcp: { key: 'claude' } })
  })

  it('are unchanged outside one', async () => {
    await AuditService.logAuditEvent({ user_id: 'user-1', operation_type: 'update', resource_type: 'invoice', operation_status: 'success' })
    expect(state.inserted[0].additional_info).toBeNull()
  })
})
