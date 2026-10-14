// Saving a table join group replaces its members: delete the old set, insert the new one.
// The delete runs on the session client, so RLS can refuse it. It used to be logged and
// ignored: the new set was inserted on top, staff were told it saved, and the old tables
// stayed in the group. A refused delete now stops the save with a 500.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/settings/api-auth', () => ({
  requireSettingsManagePermission: vi.fn(),
}))

import { requireSettingsManagePermission } from '@/lib/settings/api-auth'
import { PUT } from '@/app/api/settings/table-bookings/join-groups/route'

const GROUP_ID = '00000000-0000-4000-8000-0000000000a1'
const TABLE_A = '00000000-0000-4000-8000-0000000000b1'
const TABLE_B = '00000000-0000-4000-8000-0000000000b2'

type WriteResult = { error: { message: string; code: string } | null }
type QueryCall = { table: string; method: string; args: unknown[] }

/**
 * A session client whose query chains record their calls and resolve on await. Only the
 * delete of the old members is configurable; everything else succeeds with no rows.
 */
function sessionClient(deleteResult: WriteResult) {
  const calls: QueryCall[] = []

  function query(table: string) {
    const methods: string[] = []
    const chain: object = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          const result =
            table === 'table_join_group_members' && methods.includes('delete')
              ? { data: null, ...deleteResult }
              : { data: [], error: null }
          return (resolve: (value: unknown) => unknown) => resolve(result)
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(property), args })
          methods.push(String(property))
          return chain
        }
      },
    })
    return chain
  }

  return { client: { from: vi.fn((table: string) => query(table)) }, calls }
}

function putRequest(): NextRequest {
  return new Request('http://localhost/api/settings/table-bookings/join-groups', {
    method: 'PUT',
    body: JSON.stringify({ id: GROUP_ID, name: 'Window tables', table_ids: [TABLE_A, TABLE_B] }),
  }) as unknown as NextRequest
}

function memberInserts(calls: QueryCall[]) {
  return calls.filter(call => call.table === 'table_join_group_members' && call.method === 'insert')
}

describe('PUT /api/settings/table-bookings/join-groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a 500 and does not insert the new members when the old ones cannot be removed', async () => {
    const { client, calls } = sessionClient({
      error: { message: 'new row violates row-level security policy', code: '42501' },
    })
    ;(requireSettingsManagePermission as unknown as Mock).mockResolvedValue({ ok: true, supabase: client })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await PUT(putRequest())
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to update group members' })
    expect(memberInserts(calls)).toHaveLength(0)
    consoleError.mockRestore()
  })

  it('replaces the members and reports success when the delete works', async () => {
    const { client, calls } = sessionClient({ error: null })
    ;(requireSettingsManagePermission as unknown as Mock).mockResolvedValue({ ok: true, supabase: client })

    const response = await PUT(putRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ success: true, data: { groups: [] } })
    expect(memberInserts(calls).map(call => call.args[0])).toEqual([
      [
        { group_id: GROUP_ID, table_id: TABLE_A },
        { group_id: GROUP_ID, table_id: TABLE_B },
      ],
    ])
  })
})
