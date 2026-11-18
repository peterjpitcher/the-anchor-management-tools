import { describe, it, expect, vi } from 'vitest'
import { getRecruitmentDashboard, getRecruitmentCandidatesPage, listRecruitmentAdminData } from '../recruitment'

type Call = { table: string; select?: string; options?: Record<string, unknown>; filters: Array<[string, unknown[]]>; limit?: number }

// A Supabase query-builder mock that records, per `.from()` call, the select
// string, its options and every filter. Each builder is thenable and resolves
// to `{ data, error, count }` from the supplied resolver.
function makeClient(resolve: (call: Call) => { data: unknown; count: number | null }) {
  const calls: Call[] = []
  const client = {
    from: vi.fn((table: string) => {
      const call: Call = { table, filters: [] }
      calls.push(call)
      const qb: Record<string, unknown> = {}
      for (const method of ['neq', 'eq', 'is', 'in', 'not', 'gte', 'lt', 'lte', 'or', 'order', 'range']) {
        qb[method] = vi.fn((...args: unknown[]) => {
          call.filters.push([method, args])
          return qb
        })
      }
      qb.select = vi.fn((select: string, options?: Record<string, unknown>) => {
        call.select = select
        call.options = options
        return qb
      })
      qb.limit = vi.fn((n: number) => {
        call.limit = n
        return qb
      })
      ;(qb as { then: unknown }).then = (done: (value: unknown) => unknown) => {
        const { data, count } = resolve(call)
        return done({ data, error: null, count })
      }
      return qb
    }),
  }
  return { client, calls }
}

const emptyResolver = () => ({ data: [], count: 0 })

describe('recruitment overview payload', () => {
  it('reads only the AI run columns the screen shows, never the raw model output', async () => {
    const { client, calls } = makeClient(emptyResolver)
    await listRecruitmentAdminData(client as never)

    const aiRuns = calls.find(call => call.table === 'recruitment_ai_runs')
    expect(aiRuns?.select).toBe('id, application_id, candidate_id, cost, created_at, model, operation, status')
    expect(aiRuns?.select).not.toContain('raw_response')
    expect(aiRuns?.select).not.toContain('structured_output')
    expect(aiRuns?.limit).toBe(300)
  })

  it('leaves cv_text out of the application list embed and the talent pool page', async () => {
    const { client, calls } = makeClient(emptyResolver)
    await listRecruitmentAdminData(client as never)

    const applications = calls.find(call => call.table === 'recruitment_applications')
    expect(applications?.select).toContain('candidate:recruitment_candidates(')
    expect(applications?.select).not.toContain('recruitment_candidates(*)')
    expect(applications?.select).not.toContain('cv_text')
    expect(applications?.select).toContain('cv_extraction_status')
    expect(applications?.select).toContain('extracted_data')

    const candidatePageData = calls.find(call => call.table === 'recruitment_candidates' && !call.options?.head)
    expect(candidatePageData?.select).not.toBe('*')
    expect(candidatePageData?.select).not.toContain('cv_text')
    expect(candidatePageData?.select).toContain('first_name')
    expect(candidatePageData?.select).toContain('converted_employee_id')
  })

  it('talent pool page still returns the rows and total count', async () => {
    const rows = [{ id: 'c1', first_name: 'Ann' }]
    const { client } = makeClient(call => (call.options?.head ? { data: null, count: 41 } : { data: rows, count: null }))
    const result = await getRecruitmentCandidatesPage(client as never, { page: 1, pageSize: 25 })
    expect(result.candidates).toEqual(rows)
    expect(result.totalCount).toBe(41)
  })

  it('counts upcoming appointments with a head count under the same filters and fetches no recent applications', async () => {
    const { client, calls } = makeClient(call =>
      call.table === 'recruitment_candidate_appointments' ? { data: null, count: 7 } : { data: null, count: 3 },
    )
    const dashboard = await getRecruitmentDashboard(client as never)

    // Every dashboard query is now a head count: nothing returns rows.
    for (const call of calls) {
      expect(call.select).toBe('id')
      expect(call.options).toEqual({ count: 'exact', head: true })
    }

    const appointments = calls.filter(call => call.table === 'recruitment_candidate_appointments')
    expect(appointments).toHaveLength(1)
    const filters = appointments[0].filters
    expect(filters).toContainEqual(['is', ['archived_at', null]])
    expect(filters).toContainEqual(['eq', ['status', 'scheduled']])
    expect(filters.some(([method, args]) => method === 'gte' && args[0] === 'scheduled_start')).toBe(true)

    expect(dashboard.counts.upcomingAppointments).toBe(7)
    expect(dashboard.actionItems.find(item => item.id === 'appointments')?.count).toBe(7)
    expect(dashboard.counts.newApplications).toBe(3)
    expect(dashboard).not.toHaveProperty('recentApplications')
    expect(dashboard).not.toHaveProperty('upcomingAppointments')
    expect(dashboard.actionItems.map(item => item.id)).toEqual([
      'new', 'fast_track', 'manual_review', 'awaiting_booking', 'appointments', 'offers', 'retention',
    ])
  })
})
