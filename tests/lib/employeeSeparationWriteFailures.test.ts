// Marking an employee as Former when a clean-up write before the status change fails.
//
// Two writes run before the status change: clearing the employee from rota shift templates,
// and expiring their open onboarding invite links. Both used to be logged and ignored, so the
// employee was marked Former while old templates could still put them back on generated rotas,
// or while a live onboarding link still worked. Either failure now stops before the status
// change, so the action can be retried.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { finalizeEmployeeSeparation } from '@/lib/employees/separation'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>
type QueryCall = { table: string; method: string; args: unknown[] }
type WriteResult = { error: { message: string; code: string } | null }

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'
const TODAY = '2026-10-14'
const REFUSED: WriteResult = { error: { message: 'permission denied for table', code: '42501' } }
const OK: WriteResult = { error: null }

/**
 * An admin client whose query chains record their calls and resolve on await. The employee
 * lookup returns an Active employee with no auth user, the status update returns one row, the
 * template and invite writes return the given results, and every check finds nothing blocking.
 */
function adminClientFor(writes: { templates: WriteResult; invites: WriteResult }) {
  const calls: QueryCall[] = []

  function query(table: string) {
    const methods: string[] = []
    const chain: object = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          let result: unknown = { data: [], error: null }
          if (table === 'employees' && methods.includes('maybeSingle')) {
            result = {
              data: { auth_user_id: null, email_address: 'alex@example.com', status: 'Active', employment_end_date: TODAY },
              error: null,
            }
          } else if (table === 'employees' && methods.includes('update') && methods.includes('select')) {
            result = { data: [{ employee_id: EMPLOYEE_ID }], error: null }
          } else if (table === 'rota_shift_templates' && methods.includes('update')) {
            result = { data: null, ...writes.templates }
          } else if (table === 'employee_invite_tokens' && methods.includes('update')) {
            result = { data: null, ...writes.invites }
          }
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

  const client = {
    from: vi.fn((table: string) => query(table)),
    auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) } },
  }
  return { client: client as unknown as AdminClient, calls }
}

function statusUpdates(calls: QueryCall[]) {
  return calls.filter(call =>
    call.table === 'employees'
    && call.method === 'update'
    && (call.args[0] as Record<string, unknown>).status === 'Former')
}

async function finalize(writes: { templates: WriteResult; invites: WriteResult }) {
  const { client, calls } = adminClientFor(writes)
  const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, {
    adminClient: client,
    source: 'manual',
    todayIso: TODAY,
  })
  return { result, calls }
}

describe('finalizeEmployeeSeparation clean-up write failures', () => {
  let consoleError: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('stops before the status change when the rota template unassign fails', async () => {
    const { result, calls } = await finalize({ templates: REFUSED, invites: OK })

    expect(result).toEqual({
      success: false,
      error: 'Could not remove this employee from the rota templates, so they have not been marked as Former. Please try again.',
      code: 'template_unassign_failed',
    })
    expect(statusUpdates(calls)).toHaveLength(0)
  })

  it('stops before the status change when the invite link expiry fails', async () => {
    const { result, calls } = await finalize({ templates: OK, invites: REFUSED })

    expect(result).toEqual({
      success: false,
      error: "Could not cancel this employee's open onboarding link, so they have not been marked as Former. Please try again.",
      code: 'invite_expiry_failed',
    })
    expect(statusUpdates(calls)).toHaveLength(0)
  })

  it('marks the employee as Former when both clean-up writes succeed', async () => {
    const { result, calls } = await finalize({ templates: OK, invites: OK })

    expect(result).toEqual({ success: true, employmentEndDate: TODAY, authUserDeleted: false })
    expect(statusUpdates(calls)).toHaveLength(1)
  })
})
