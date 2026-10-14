import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { publicSchemaColumns } from '../helpers/generatedSchema'

/**
 * The Twilio webhook's log rows, written through a client that knows which columns
 * `webhook_logs` really has and refuses an insert that names any other, the way PostgREST does.
 *
 * From 22 June to 14 October 2026 the log helper spread its last argument straight into the
 * row. Four call sites passed keys that are not columns (`channel`, `unmatched_communication_id`,
 * `candidate_customer_ids`, `messageSid`), PostgREST answered PGRST204, and the whole row was
 * lost: none of the 86 inbound texts handled in that time has a log row. An ordinary mocked
 * insert accepts anything, so no test noticed.
 */

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('twilio', () => ({ default: { validateRequest: vi.fn(() => true) } }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/sms/reply-to-book', () => ({
  handleReplyToBook: vi.fn().mockResolvedValue({ handled: false }),
}))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/communications/capture', () => ({
  isCommunicationBodyMediaCaptureEnabled: vi.fn(() => false),
}))
vi.mock('@/lib/communications/unmatched', () => ({
  captureTwilioMedia: vi.fn().mockResolvedValue([]),
  findCustomerByPhone: vi.fn(),
  findUnmatchedByTwilioSid: vi.fn(),
  recordUnmatchedCommunication: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  findCustomerByPhone,
  findUnmatchedByTwilioSid,
  recordUnmatchedCommunication,
} from '@/lib/communications/unmatched'
import { POST } from '@/app/api/webhooks/twilio/route'

type Row = Record<string, unknown>
type InsertResult = { error: { code: string; message: string } | null }

const CUSTOMER_ID = '0b7c1f2e-0000-4000-8000-000000000001'
const MESSAGE_ID = '0b7c1f2e-0000-4000-8000-000000000002'
const UNMATCHED_ID = '0b7c1f2e-0000-4000-8000-000000000003'
const CANDIDATE_IDS = ['0b7c1f2e-0000-4000-8000-000000000004', '0b7c1f2e-0000-4000-8000-000000000005']
const FROM = '+447700900123'
const TO = '+447700900999'

/**
 * Inserts a webhook_logs row the way PostgREST does: a key the table has no column for refuses
 * the whole row with PGRST204. Undefined values are left out, as JSON serialisation drops them.
 */
function insertWebhookLog(row: Row, accepted: Row[]): InsertResult {
  const columns = publicSchemaColumns().get('webhook_logs')
  if (!columns) throw new Error('webhook_logs is missing from the generated types')
  const unknown = Object.keys(row).find((key) => row[key] !== undefined && !columns.has(key))
  if (unknown) {
    return {
      error: {
        code: 'PGRST204',
        message: `Could not find the '${unknown}' column of 'webhook_logs' in the schema cache`,
      },
    }
  }
  accepted.push(row)
  return { error: null }
}

interface StandIn {
  /** The message the SID lookup finds, for status callbacks and duplicate checks. */
  existingMessage?: Row | null
  /** What the status update returns: null is the no-op path. */
  updatedMessage?: Row | null
}

/** A stand-in admin client: real column checks for webhook_logs, fixed answers elsewhere. */
function useClient(standIn: StandIn = {}): { logs: Row[]; refused: InsertResult[] } {
  const state = { logs: [] as Row[], refused: [] as InsertResult[] }
  const lookup = { data: standIn.existingMessage ?? null, error: null }

  ;(createAdminClient as unknown as Mock).mockReturnValue({
    from(table: string) {
      if (table === 'webhook_logs') {
        return {
          insert: async (row: Row) => {
            const result = insertWebhookLog(row, state.logs)
            if (result.error) state.refused.push(result)
            return result
          },
        }
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => lookup }) }) }),
          }),
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: MESSAGE_ID }, error: null }) }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: standIn.updatedMessage ?? null, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      return { insert: async () => ({ error: null }) }
    },
  })

  return state
}

function post(params: Record<string, string>) {
  const request = new Request('https://example.com/api/webhooks/twilio', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'sig_test',
    },
    body: new URLSearchParams(params).toString(),
  })
  // justified: the route only reads the Request members a NextRequest shares with it
  return POST(Object.assign(request, { nextUrl: new URL(request.url) }) as any)
}

function inbound(sid: string) {
  return post({ MessageSid: sid, From: FROM, To: TO, Body: 'Table for 4 on Friday please' })
}

describe('Twilio webhook log rows', () => {
  const originalAuthToken = process.env.TWILIO_AUTH_TOKEN

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_AUTH_TOKEN = 'twilio_test_token'
    ;(findUnmatchedByTwilioSid as unknown as Mock).mockResolvedValue(null)
    ;(findCustomerByPhone as unknown as Mock).mockResolvedValue({
      customer: { id: CUSTOMER_ID, mobile_e164: FROM },
      candidates: [],
      canonicalPhone: FROM,
    })
  })

  afterEach(() => {
    if (originalAuthToken === undefined) delete process.env.TWILIO_AUTH_TOKEN
    else process.env.TWILIO_AUTH_TOKEN = originalAuthToken
    expect(logger.warn).not.toHaveBeenCalledWith('Failed to log Twilio webhook attempt', expect.anything())
  })

  it('refuses a row with a key that is not a column, as PostgREST did in production', () => {
    const accepted: Row[] = []
    const result = insertWebhookLog({ webhook_type: 'twilio', status: 'success', channel: 'sms' }, accepted)

    expect(result.error).toEqual({
      code: 'PGRST204',
      message: "Could not find the 'channel' column of 'webhook_logs' in the schema cache",
    })
    expect(accepted).toEqual([])
  })

  it('keeps the success row for a handled inbound text, with its customer and message', async () => {
    const client = useClient()

    const response = await inbound('SM_LOG_SUCCESS')

    expect(response.status).toBe(200)
    expect(client.refused).toEqual([])
    expect(client.logs.map((row) => row.status)).toEqual(['received', 'success'])
    expect(client.logs[1]).toMatchObject({
      status: 'success',
      message_sid: 'SM_LOG_SUCCESS',
      customer_id: CUSTOMER_ID,
      message_id: MESSAGE_ID,
      error_details: { channel: 'sms' },
    })
  })

  it('keeps the row for a repeated text that was already held as unmatched', async () => {
    const client = useClient()
    ;(findUnmatchedByTwilioSid as unknown as Mock).mockResolvedValue({ id: UNMATCHED_ID })

    const response = await inbound('SM_LOG_DUPLICATE_UNMATCHED')

    expect(response.status).toBe(200)
    expect(client.refused).toEqual([])
    expect(client.logs[1]).toMatchObject({
      status: 'duplicate_unmatched_inbound',
      error_details: { unmatched_communication_id: UNMATCHED_ID },
    })
  })

  it('keeps the row for a text from a number that matches no customer', async () => {
    const client = useClient()
    ;(findCustomerByPhone as unknown as Mock).mockResolvedValue({
      customer: null,
      candidates: CANDIDATE_IDS,
      canonicalPhone: FROM,
    })
    ;(recordUnmatchedCommunication as unknown as Mock).mockResolvedValue(UNMATCHED_ID)

    const response = await inbound('SM_LOG_UNMATCHED')

    expect(response.status).toBe(200)
    expect(client.refused).toEqual([])
    expect(client.logs[1]).toMatchObject({
      status: 'unmatched_inbound',
      error_details: { unmatched_communication_id: UNMATCHED_ID, candidate_customer_ids: CANDIDATE_IDS },
    })
  })

  it('keeps the row for a status update that changes nothing, under its own status', async () => {
    const client = useClient({
      existingMessage: {
        id: MESSAGE_ID,
        status: 'queued',
        twilio_status: 'queued',
        direction: 'outbound',
        customer_id: CUSTOMER_ID,
        sent_at: null,
        message_type: 'sms',
      },
      updatedMessage: null,
    })

    const response = await post({ MessageSid: 'SM_LOG_NOOP', MessageStatus: 'delivered' })

    expect(response.status).toBe(200)
    expect(client.refused).toEqual([])
    expect(client.logs[1]).toMatchObject({
      status: 'status_update_noop',
      message_id: MESSAGE_ID,
      error_details: { messageSid: 'SM_LOG_NOOP', status: 'delivered' },
    })
  })
})
