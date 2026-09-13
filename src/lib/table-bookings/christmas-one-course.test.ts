import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordOneCourseInsideCutoff } from './christmas-one-course'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

type Filters = Array<[string, string, unknown]>

function fakeSupabase(options: {
  policy?: unknown
  policyError?: { message: string } | null
  updatedRows?: Array<{ id: string }>
  updateError?: { message: string } | null
}) {
  const calls: { rpc: Array<[string, unknown]>; update: Array<{ values: unknown; filters: Filters }> } = {
    rpc: [],
    update: [],
  }
  const client = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc.push([name, args])
      return { data: options.policy ?? null, error: options.policyError ?? null }
    }),
    from: vi.fn((table: string) => {
      const record = { values: undefined as unknown, filters: [] as Filters }
      const chain = {
        update(values: unknown) {
          record.values = values
          return chain
        },
        eq(column: string, value: unknown) {
          record.filters.push(['eq', column, value])
          return chain
        },
        is(column: string, value: unknown) {
          record.filters.push(['is', column, value])
          return chain
        },
        async select() {
          expect(table).toBe('table_bookings')
          calls.update.push(record)
          return { data: options.updateError ? null : options.updatedRows ?? [], error: options.updateError ?? null }
        },
      }
      return chain
    }),
  }
  return { client: client as unknown as SupabaseClient<any, 'public', any>, calls }
}

const BOOKING = { id: 'booking-1', bookingDate: '2026-12-01', partySize: 6 }

describe('recordOneCourseInsideCutoff', () => {
  it('records every guest as one course once the pre-order deadline has passed', async () => {
    const { client, calls } = fakeSupabase({
      policy: { version: 1, multiple_courses_available: false },
      updatedRows: [{ id: 'booking-1' }],
    })

    await expect(recordOneCourseInsideCutoff(client, BOOKING)).resolves.toBe('recorded')
    expect(calls.rpc).toEqual([['christmas_course_policy_v01', { p_booking_date: '2026-12-01' }]])
    expect(calls.update).toEqual([
      {
        values: { christmas_course_counts: [1, 1, 1, 1, 1, 1] },
        // Only a Christmas booking with nothing recorded yet: a guest's real choices are never overwritten.
        filters: [
          ['eq', 'id', 'booking-1'],
          ['eq', 'booking_type', 'christmas'],
          ['is', 'christmas_course_counts', null],
        ],
      },
    ])
  })

  it('leaves the booking alone while two and three courses can still be chosen', async () => {
    const { client, calls } = fakeSupabase({ policy: { version: 1, multiple_courses_available: true } })
    await expect(recordOneCourseInsideCutoff(client, BOOKING)).resolves.toBe('not_needed')
    expect(calls.update).toEqual([])
  })

  it('leaves the booking alone when the date has no Christmas course policy', async () => {
    const { client, calls } = fakeSupabase({ policy: null })
    await expect(recordOneCourseInsideCutoff(client, BOOKING)).resolves.toBe('not_needed')
    expect(calls.update).toEqual([])
  })

  it('says not needed when the booking already had courses, or was not a Christmas booking', async () => {
    const { client } = fakeSupabase({ policy: { multiple_courses_available: false }, updatedRows: [] })
    await expect(recordOneCourseInsideCutoff(client, BOOKING)).resolves.toBe('not_needed')
  })

  it('reports a failure rather than throwing, because the booking itself already exists', async () => {
    const policyFails = fakeSupabase({ policyError: { message: 'boom' } })
    await expect(recordOneCourseInsideCutoff(policyFails.client, BOOKING)).resolves.toBe('failed')

    const updateFails = fakeSupabase({
      policy: { multiple_courses_available: false },
      updateError: { message: 'trigger said no' },
    })
    await expect(recordOneCourseInsideCutoff(updateFails.client, BOOKING)).resolves.toBe('failed')
  })
})
