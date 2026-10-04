import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(),
}))

import { reportCronFailure } from '@/lib/cron/alerting'
import {
  finishBillingPass,
  loadBillingPassRecord,
  reportUnfinishedBillingPass,
  startBillingPass,
} from '@/lib/oj-projects/billing-pass-record'

type Query = {
  table: string
  action: 'select' | 'insert' | 'update'
  payload?: Record<string, unknown>
  filters: Array<[string, ...unknown[]]>
}
type Result = { data?: unknown; error?: { code?: string; message?: string } | null }

/**
 * A stand-in for the Supabase client: every chained call is recorded on the query, and awaiting
 * the chain asks `respond` what the database would have said.
 */
function fakeSupabase(respond: (query: Query) => Result) {
  const queries: Query[] = []
  const client = {
    from(table: string) {
      const query: Query = { table, action: 'select', filters: [] }
      queries.push(query)
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve()
                  .then(() => respond(query))
                  .then(resolve, reject)
            }
            return (...args: unknown[]) => {
              if (prop === 'insert' || prop === 'update') {
                query.action = prop
                query.payload = args[0] as Record<string, unknown>
              } else {
                query.filters.push([prop, ...args])
              }
              return builder
            }
          },
        }
      )
      return builder
    },
  }
  // The helpers only use `.from()`, so the stand-in is cast to the real client type.
  return { supabase: client as unknown as Parameters<typeof loadBillingPassRecord>[0], queries }
}

const writesTo = (queries: Query[], table: string) =>
  queries.filter((query) => query.table === table && query.action !== 'select')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('loadBillingPassRecord', () => {
  it('reads the one row for the billed month', async () => {
    const { supabase, queries } = fakeSupabase(() => ({ data: { id: 'pass-1', status: 'running' }, error: null }))

    await expect(loadBillingPassRecord(supabase, '2026-10')).resolves.toEqual({ id: 'pass-1', status: 'running' })
    expect(queries).toHaveLength(1)
    expect(queries[0].table).toBe('cron_job_runs')
    expect(queries[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'job_name', 'oj-projects-billing-pass'],
        ['eq', 'run_key', '2026-10'],
      ])
    )
  })

  it('returns null when the pass has not started', async () => {
    const { supabase } = fakeSupabase(() => ({ data: null, error: null }))
    await expect(loadBillingPassRecord(supabase, '2026-10')).resolves.toBeNull()
  })

  it('throws when the record cannot be read, so the caller does not bill on a guess', async () => {
    const { supabase } = fakeSupabase(() => ({ data: null, error: { message: 'connection reset' } }))
    await expect(loadBillingPassRecord(supabase, '2026-10')).rejects.toThrow('connection reset')
  })
})

describe('startBillingPass', () => {
  it('records the pass as running, keyed on the billed month', async () => {
    const { supabase, queries } = fakeSupabase(() => ({ error: null }))

    await startBillingPass(supabase, '2026-10')

    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({
      table: 'cron_job_runs',
      action: 'insert',
      payload: { job_name: 'oj-projects-billing-pass', run_key: '2026-10', status: 'running' },
    })
  })

  it('accepts that another invocation recorded the same pass a moment earlier', async () => {
    const { supabase } = fakeSupabase(() => ({ error: { code: '23505', message: 'duplicate key' } }))
    await expect(startBillingPass(supabase, '2026-10')).resolves.toBeUndefined()
  })

  it('throws on any other failure', async () => {
    const { supabase } = fakeSupabase(() => ({ error: { code: '42501', message: 'permission denied' } }))
    await expect(startBillingPass(supabase, '2026-10')).rejects.toThrow('permission denied')
  })
})

describe('finishBillingPass', () => {
  it('marks the pass completed when no client is left in flight', async () => {
    const { supabase, queries } = fakeSupabase((query) =>
      query.table === 'oj_billing_runs' ? { data: [], error: null } : { data: { id: 'pass-1' }, error: null }
    )

    await expect(finishBillingPass(supabase, '2026-10')).resolves.toBe('completed')

    expect(queries[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'period_yyyymm', '2026-10'],
        ['eq', 'status', 'processing'],
      ])
    )
    const [write] = writesTo(queries, 'cron_job_runs')
    expect(write.payload).toMatchObject({ status: 'completed', finished_at: expect.any(String) })
    expect(write.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'job_name', 'oj-projects-billing-pass'],
        ['eq', 'run_key', '2026-10'],
      ])
    )
  })

  it("leaves the pass open while a client's run is still processing", async () => {
    const { supabase, queries } = fakeSupabase((query) =>
      query.table === 'oj_billing_runs' ? { data: [{ id: 'run-9' }], error: null } : { data: { id: 'pass-1' }, error: null }
    )

    await expect(finishBillingPass(supabase, '2026-10')).resolves.toBe('still_running')
    expect(writesTo(queries, 'cron_job_runs')).toHaveLength(0)
  })

  it('throws when the record it should complete is missing', async () => {
    const { supabase } = fakeSupabase((query) =>
      query.table === 'oj_billing_runs' ? { data: [], error: null } : { data: null, error: null }
    )
    await expect(finishBillingPass(supabase, '2026-10')).rejects.toThrow('not found')
  })
})

describe('reportUnfinishedBillingPass', () => {
  const respond = (query: Query): Result => {
    if (query.table === 'oj_billing_runs') {
      return {
        data: [
          { vendor_id: 'vendor-a', status: 'sent' },
          { vendor_id: 'vendor-c', status: 'failed' },
        ],
        error: null,
      }
    }
    if (query.table === 'invoice_vendors') {
      return {
        data: [
          { id: 'vendor-b', name: 'Bravo Ltd' },
          { id: 'vendor-c', name: 'Charlie Ltd' },
        ],
        error: null,
      }
    }
    return { data: null, error: null }
  }

  const input = {
    billedMonth: '2026-10',
    record: { id: 'pass-1', status: 'running' },
    candidateVendorIds: ['vendor-a', 'vendor-b', 'vendor-c'],
  }

  it('alerts once, naming the clients with no run and the ones left unfinished', async () => {
    const { supabase } = fakeSupabase(respond)

    const result = await reportUnfinishedBillingPass(supabase, input)

    expect(result).toEqual({ no_billing_run: ['Bravo Ltd'], unfinished_run: ['Charlie Ltd (failed)'] })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    const [job, error, context] = vi.mocked(reportCronFailure).mock.calls[0]
    expect(job).toBe('oj-projects-billing')
    expect((error as Error).message).toContain('The Orange Jelly billing pass for October 2026 did not finish')
    expect(context).toMatchObject({
      billed_month: 'October 2026',
      clients_with_no_billing_run: 'Bravo Ltd',
      clients_with_an_unfinished_run: 'Charlie Ltd (failed)',
    })
    // The client already billed is not named.
    expect(JSON.stringify(context)).not.toContain('vendor-a')
  })

  it('marks the existing record failed, which is what stops the alert repeating', async () => {
    const { supabase, queries } = fakeSupabase(respond)

    await reportUnfinishedBillingPass(supabase, input)

    const writes = writesTo(queries, 'cron_job_runs')
    expect(writes).toHaveLength(1)
    expect(writes[0].action).toBe('update')
    expect(writes[0].payload).toMatchObject({ status: 'failed', finished_at: expect.any(String) })
    expect(writes[0].filters).toEqual([['eq', 'id', 'pass-1']])
    // Billing nothing: no billing run is created or changed.
    expect(writesTo(queries, 'oj_billing_runs')).toHaveLength(0)
  })

  it('creates the record as failed when the pass never started at all', async () => {
    const { supabase, queries } = fakeSupabase(respond)

    await reportUnfinishedBillingPass(supabase, { ...input, record: null })

    const writes = writesTo(queries, 'cron_job_runs')
    expect(writes).toHaveLength(1)
    expect(writes[0].action).toBe('insert')
    expect(writes[0].payload).toMatchObject({
      job_name: 'oj-projects-billing-pass',
      run_key: '2026-10',
      status: 'failed',
    })
  })

  it('says "None" when every client turns out to have been billed', async () => {
    const { supabase } = fakeSupabase(respond)

    await reportUnfinishedBillingPass(supabase, { ...input, candidateVendorIds: ['vendor-a'] })

    expect(vi.mocked(reportCronFailure).mock.calls[0][2]).toMatchObject({
      clients_with_no_billing_run: 'None',
      clients_with_an_unfinished_run: 'None',
    })
  })

  it('still alerts when the clients cannot be listed', async () => {
    const { supabase, queries } = fakeSupabase((query) =>
      query.table === 'oj_billing_runs' ? { data: null, error: { message: 'timeout' } } : { data: null, error: null }
    )

    await expect(reportUnfinishedBillingPass(supabase, input)).resolves.toEqual({
      no_billing_run: [],
      unfinished_run: [],
    })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportCronFailure).mock.calls[0][2]).toMatchObject({
      clients_with_no_billing_run: 'Could not be listed, check the billing runs table',
    })
    expect(writesTo(queries, 'cron_job_runs')).toHaveLength(1)
  })

  it('does not throw when the record cannot be marked: the alert simply repeats', async () => {
    const { supabase } = fakeSupabase((query) =>
      query.table === 'cron_job_runs' ? { error: { message: 'write refused' } } : respond(query)
    )

    await expect(reportUnfinishedBillingPass(supabase, input)).resolves.toBeDefined()
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })
})
