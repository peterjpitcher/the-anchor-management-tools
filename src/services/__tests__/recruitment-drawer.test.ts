import { describe, it, expect, vi } from 'vitest'
import { listRecruitmentAdminData } from '../recruitment'

// A minimal Supabase query-builder mock: every chain method returns the same
// builder, and the builder is thenable so `await`/`Promise.all` resolve to an
// empty result. We capture every `.select(...)` string so we can assert on the
// shape of the queries the loader issues.
function makeClient() {
  const selects: string[] = []
  const qb: Record<string, unknown> = {}
  const chainMethods = ['select', 'neq', 'eq', 'is', 'in', 'not', 'gte', 'lt', 'lte', 'order', 'range', 'limit']
  for (const method of chainMethods) {
    qb[method] = vi.fn((arg?: unknown) => {
      if (method === 'select' && typeof arg === 'string') selects.push(arg)
      return qb
    })
  }
  ;(qb as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: [], error: null, count: 0 })
  const client = { from: vi.fn(() => qb) }
  return { client, selects }
}

describe('listRecruitmentAdminData', () => {
  it('embeds the supervisor (interviewer) on the appointments query', async () => {
    const { client, selects } = makeClient()

    await listRecruitmentAdminData(client as never)

    const supervisorSelect = selects.find(select => select.includes('supervisor:employees!supervisor_staff_id'))
    expect(supervisorSelect).toBeTruthy()
    // The appointments select still pulls the candidate + application context.
    expect(supervisorSelect).toContain('candidate:recruitment_candidates')
    expect(supervisorSelect).toContain('application:recruitment_applications')
  })

  it('loads interview scorecards for the drawer', async () => {
    const { client } = makeClient()

    await listRecruitmentAdminData(client as never)

    expect(client.from).toHaveBeenCalledWith('recruitment_interview_scorecards')
  })
})
