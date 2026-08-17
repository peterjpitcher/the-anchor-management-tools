import { describe, expect, it, vi } from 'vitest'
import {
  buildRetainerProjectCode,
  buildRetainerProjectName,
  formatRetainerMonthLabel,
  resolveRetainerProject,
} from '@/lib/oj-projects/retainer-projects'

/** Built from its code point, because house style bans the literal character. */
const EM_DASH = String.fromCharCode(0x2014)

/**
 * Minimal chainable Supabase double. Each table gets a queue of responses so a
 * test can make the same table answer differently on successive calls, which is
 * what the lost-race path needs.
 */
function createMockSupabase(tables: Record<string, Array<{ data?: unknown; error?: unknown }>>) {
  const calls: Record<string, number> = {}
  const inserts: Array<Record<string, unknown>> = []

  const client = {
    inserts,
    from: vi.fn((table: string) => {
      const queue = tables[table] || [{ data: null, error: null }]
      const index = calls[table] ?? 0
      calls[table] = index + 1
      const response = queue[Math.min(index, queue.length - 1)]

      const chain: Record<string, unknown> = {}
      const methods = ['select', 'eq', 'is', 'order', 'limit', 'maybeSingle', 'single']
      for (const method of methods) {
        chain[method] = () => proxy
      }
      chain.insert = (payload: Record<string, unknown>) => {
        inserts.push(payload)
        return proxy
      }

      const proxy: any = new Proxy(chain, {
        get(target, prop) {
          if (prop === 'then') {
            return (resolve: (value: unknown) => void) =>
              resolve({ data: response.data ?? null, error: response.error ?? null })
          }
          return target[prop as string]
        },
      })
      return proxy
    }),
  }

  return client
}

describe('retainer project naming', () => {
  it('formats the month label without a leading zero month name', () => {
    expect(formatRetainerMonthLabel('2026-08')).toBe('Aug 2026')
    expect(formatRetainerMonthLabel('2026-01')).toBe('Jan 2026')
  })

  it('builds a deterministic code so both callers agree for the same month', () => {
    expect(buildRetainerProjectCode('BP', '2026-08')).toBe('OJP-BP-RET-202608')
  })

  it('builds one project name, with no em dash', () => {
    const name = buildRetainerProjectName('Barons Pubs', '2026-08')
    expect(name).toBe('Barons Pubs Retainer (Aug 2026)')
    expect(name.includes(EM_DASH)).toBe(false)
  })

  it('falls back to a generic client name rather than producing a blank', () => {
    expect(buildRetainerProjectName('  ', '2026-08')).toBe('Client Retainer (Aug 2026)')
  })
})

describe('resolveRetainerProject', () => {
  it('returns the existing project without creating or naming anything', async () => {
    const supabase = createMockSupabase({
      oj_projects: [{ data: { id: 'proj-1', project_code: 'OJP-BP-RET-202608', status: 'active' } }],
    })

    const result = await resolveRetainerProject(supabase as any, {
      vendorId: 'vendor-1',
      periodYyyymm: '2026-08',
      includedHours: 40,
    })

    expect(result).toEqual({ projectId: 'proj-1', projectCode: 'OJP-BP-RET-202608', created: false })
    expect(supabase.inserts).toHaveLength(0)
    // The happy path must not touch invoice_vendors: the closed-retainer check
    // has to come before any name lookup.
    expect(supabase.from).not.toHaveBeenCalledWith('invoice_vendors')
  })

  it('refuses to route work into a closed retainer', async () => {
    const supabase = createMockSupabase({
      oj_projects: [{ data: { id: 'proj-1', project_code: 'OJP-BP-RET-202608', status: 'completed' } }],
    })

    const result = await resolveRetainerProject(supabase as any, {
      vendorId: 'vendor-1',
      periodYyyymm: '2026-08',
      includedHours: 40,
    })

    expect(result).toEqual({ error: 'Cannot add entries to a closed retainer' })
    expect(supabase.inserts).toHaveLength(0)
  })

  it('creates the month bucket with the shared code, name and budget', async () => {
    const supabase = createMockSupabase({
      oj_projects: [
        { data: null },
        { data: { id: 'proj-new', project_code: 'OJP-BP-RET-202608' } },
      ],
      oj_vendor_billing_settings: [{ data: { client_code: 'BP' } }],
    })

    const result = await resolveRetainerProject(supabase as any, {
      vendorId: 'vendor-1',
      periodYyyymm: '2026-08',
      includedHours: 40,
      vendorName: 'Barons Pubs',
    })

    expect(result).toEqual({ projectId: 'proj-new', projectCode: 'OJP-BP-RET-202608', created: true })
    expect(supabase.inserts[0]).toMatchObject({
      vendor_id: 'vendor-1',
      project_code: 'OJP-BP-RET-202608',
      project_name: 'Barons Pubs Retainer (Aug 2026)',
      budget_hours: 40,
      is_retainer: true,
      retainer_period_yyyymm: '2026-08',
      status: 'active',
    })
  })

  it('returns the winner rather than duplicating when it loses the create race', async () => {
    const supabase = createMockSupabase({
      oj_projects: [
        // First lookup: nothing yet.
        { data: null },
        // Insert: the other request got there first.
        { error: { code: '23505', message: 'duplicate key value' } },
        // Re-lookup finds the winner's row.
        { data: { id: 'proj-winner', project_code: 'OJP-BP-RET-202608', status: 'active' } },
      ],
      oj_vendor_billing_settings: [{ data: { client_code: 'BP' } }],
    })

    const result = await resolveRetainerProject(supabase as any, {
      vendorId: 'vendor-1',
      periodYyyymm: '2026-08',
      includedHours: 40,
      vendorName: 'Barons Pubs',
    })

    // Before the unique index the loser inserted a second row, after which every
    // later .maybeSingle() threw and entry logging broke for the month.
    expect(result).toEqual({ projectId: 'proj-winner', projectCode: 'OJP-BP-RET-202608', created: false })
  })

  it('surfaces a real insert failure rather than retrying it as a race', async () => {
    const supabase = createMockSupabase({
      oj_projects: [
        { data: null },
        { error: { code: '42501', message: 'permission denied for table oj_projects' } },
      ],
      oj_vendor_billing_settings: [{ data: { client_code: 'BP' } }],
    })

    const result = await resolveRetainerProject(supabase as any, {
      vendorId: 'vendor-1',
      periodYyyymm: '2026-08',
      includedHours: 40,
      vendorName: 'Barons Pubs',
    })

    expect(result).toEqual({ error: 'permission denied for table oj_projects' })
  })

  it('looks the client name up only when it has to create', async () => {
    const supabase = createMockSupabase({
      oj_projects: [
        { data: null },
        { data: { id: 'proj-new', project_code: 'OJP-BP-RET-202608' } },
      ],
      oj_vendor_billing_settings: [{ data: { client_code: 'BP' } }],
      invoice_vendors: [{ data: { name: 'Barons Pubs' } }],
    })

    const result = await resolveRetainerProject(supabase as any, {
      vendorId: 'vendor-1',
      periodYyyymm: '2026-08',
      includedHours: 40,
    })

    expect(result).toMatchObject({ created: true })
    expect(supabase.inserts[0]).toMatchObject({
      project_name: 'Barons Pubs Retainer (Aug 2026)',
    })
  })
})
