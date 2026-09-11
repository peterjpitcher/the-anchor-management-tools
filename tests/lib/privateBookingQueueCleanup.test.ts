import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/logger'
import { cancelPendingQueuedSms } from '@/lib/private-bookings/queue-cleanup'

/**
 * The columns `private_booking_sms_queue` really has (src/types/database.generated.ts, confirmed
 * against the live schema on 11 September 2026). There is no `updated_at`.
 */
const QUEUE_COLUMNS = new Set([
  'approved_at', 'approved_by', 'booking_id', 'created_at', 'created_by', 'customer_name',
  'customer_phone', 'error_message', 'id', 'message_body', 'metadata', 'priority',
  'recipient_phone', 'scheduled_for', 'sent_at', 'skip_conditions', 'status', 'template_key',
  'trigger_type', 'twilio_message_sid',
])

type QueueRow = { id: string; booking_id: string; status: string }

/**
 * A queue table that behaves like PostgREST: an update naming a column the table does not have
 * is rejected whole (PGRST204) and changes nothing.
 */
function makeQueueTable(rows: QueueRow[]) {
  const updatePayloads: Array<Record<string, unknown>> = []
  const client = {
    from: vi.fn((table: string) => {
      if (table !== 'private_booking_sms_queue') throw new Error(`Unexpected table ${table}`)
      return {
        update: (payload: Record<string, unknown>) => {
          updatePayloads.push(payload)
          const filters: { bookingId?: string; statuses?: string[] } = {}
          const builder = {
            eq: (column: string, value: string) => {
              if (column === 'booking_id') filters.bookingId = value
              return builder
            },
            in: (column: string, values: string[]) => {
              if (column === 'status') filters.statuses = values
              const unknown = Object.keys(payload).filter((key) => !QUEUE_COLUMNS.has(key))
              if (unknown.length > 0) {
                return Promise.resolve({
                  error: {
                    code: 'PGRST204',
                    message: `Could not find the '${unknown[0]}' column of 'private_booking_sms_queue' in the schema cache`,
                    details: null,
                    hint: null,
                  },
                })
              }
              for (const row of rows) {
                if (row.booking_id === filters.bookingId && filters.statuses?.includes(row.status)) {
                  Object.assign(row, payload)
                }
              }
              return Promise.resolve({ error: null })
            },
          }
          return builder
        },
      }
    }),
  }
  return { client, updatePayloads, rows }
}

function queueRows(): QueueRow[] {
  return [
    { id: 'q-pending', booking_id: 'booking-1', status: 'pending' },
    { id: 'q-approved', booking_id: 'booking-1', status: 'approved' },
    { id: 'q-sent', booking_id: 'booking-1', status: 'sent' },
    { id: 'q-other-booking', booking_id: 'booking-2', status: 'pending' },
  ]
}

describe('cancelPendingQueuedSms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reproduces the bug: the old payload with updated_at is rejected and leaves the texts pending', async () => {
    const table = makeQueueTable(queueRows())
    const { error } = await table.client
      .from('private_booking_sms_queue')
      .update({ status: 'cancelled', updated_at: '2026-09-11T10:00:00.000Z' })
      .eq('booking_id', 'booking-1')
      .in('status', ['pending', 'approved'])

    expect(error?.code).toBe('PGRST204')
    expect(table.rows.find((row) => row.id === 'q-pending')?.status).toBe('pending')
    expect(table.rows.find((row) => row.id === 'q-approved')?.status).toBe('approved')
  })

  it('cancels the pending and approved texts for that booking only, writing status alone', async () => {
    const table = makeQueueTable(queueRows())

    const result = await cancelPendingQueuedSms(table.client, 'booking-1', 'test')

    expect(result).toEqual({ ok: true })
    expect(table.updatePayloads).toEqual([{ status: 'cancelled' }])
    expect(table.rows.map((row) => [row.id, row.status])).toEqual([
      ['q-pending', 'cancelled'],
      ['q-approved', 'cancelled'],
      ['q-sent', 'sent'],
      ['q-other-booking', 'pending'],
    ])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('reads the returned error, logs every field of it and reports the failure', async () => {
    const client = {
      from: vi.fn(() => ({
        update: () => ({
          eq: () => ({
            in: () => Promise.resolve({
              error: { code: '57014', message: 'canceling statement due to statement timeout', details: 'd', hint: 'h' },
            }),
          }),
        }),
      })),
    }

    const result = await cancelPendingQueuedSms(client, 'booking-1', 'booking_cancellation')

    expect(result).toEqual({ ok: false, error: 'canceling statement due to statement timeout' })
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to cancel queued texts for a cancelled private booking',
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: 'booking-1',
          context: 'booking_cancellation',
          code: '57014',
          message: 'canceling statement due to statement timeout',
          details: 'd',
          hint: 'h',
        }),
      })
    )
  })
})

describe('queue bulk-cancel source guard', () => {
  function listSourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        out.push(...listSourceFiles(full))
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('database.generated.ts')) {
        out.push(full)
      }
    }
    return out
  }

  it('never writes updated_at to private_booking_sms_queue anywhere in src', () => {
    const offenders: string[] = []
    for (const file of listSourceFiles(resolve(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8')
      const pattern = /from\(\s*['"]private_booking_sms_queue['"]\s*\)([\s\S]{0,400})/g
      for (const match of source.matchAll(pattern)) {
        const window = match[1]
        const updateCall = /\.update\(\s*\{([^}]*)\}/.exec(window)
        if (updateCall && /updated_at/.test(updateCall[1])) {
          offenders.push(file.replace(process.cwd() + '/', ''))
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('routes every cancellation path through the checked helper', () => {
    const mutations = readFileSync(resolve(process.cwd(), 'src/services/private-bookings/mutations.ts'), 'utf8')
    const cron = readFileSync(resolve(process.cwd(), 'src/app/api/cron/private-bookings-expire-holds/route.ts'), 'utf8')

    expect(mutations.match(/cancelPendingQueuedSms\(/g)?.length).toBe(3)
    expect(cron).toContain('cancelPendingQueuedSms(supabase, id')
  })
})
