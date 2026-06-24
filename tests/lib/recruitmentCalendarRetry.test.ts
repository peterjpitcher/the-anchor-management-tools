import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphDelete = vi.fn()
const graphApi = vi.fn(() => ({
  delete: graphDelete,
  post: vi.fn(),
  patch: vi.fn(),
}))

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: vi.fn(() => ({
      api: graphApi,
    })),
  },
}))

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn(function ClientSecretCredential() {
    return {
    getToken: vi.fn().mockResolvedValue({ token: 'token' }),
    }
  }),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(() => true),
}))

import { retryRecruitmentCalendarSync } from '@/lib/recruitment/calendar'

function createBuilder(response: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<{ data: unknown; error: unknown }>['then']
  } = {} as any

  for (const method of ['select', 'in', 'eq', 'not', 'gte', 'order', 'limit', 'update']) {
    builder[method] = vi.fn(() => builder)
  }

  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  builder.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject)
  return builder
}

describe('recruitment calendar retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    graphDelete.mockResolvedValue(undefined)
  })

  it('retries Outlook deletion for cancelled appointments with a remaining calendar event', async () => {
    const scheduledRetryBuilder = createBuilder({ data: [], error: null })
    const cancelledRetryBuilder = createBuilder({ data: [{ id: 'appointment-1' }], error: null })
    const appointmentLoadBuilder = createBuilder({
      data: {
        id: 'appointment-1',
        status: 'cancelled',
        calendar_event_id: 'event-1',
      },
      error: null,
    })
    const appointmentUpdateBuilder = createBuilder({ data: null, error: null })
    const builders = [
      scheduledRetryBuilder,
      cancelledRetryBuilder,
      appointmentLoadBuilder,
      appointmentUpdateBuilder,
    ]
    const supabase = {
      from: vi.fn(() => {
        const next = builders.shift()
        if (!next) throw new Error('Unexpected query')
        return next
      }),
    }

    const result = await retryRecruitmentCalendarSync(25, supabase as any)

    expect(result).toMatchObject({
      processed: 0,
      deletionProcessed: 1,
      deleted: 1,
      deletionFailed: 0,
    })
    expect(cancelledRetryBuilder.eq).toHaveBeenCalledWith('status', 'cancelled')
    expect(cancelledRetryBuilder.not).toHaveBeenCalledWith('calendar_event_id', 'is', null)
    expect(graphApi).toHaveBeenCalledWith('/users/peter@orangejelly.co.uk/events/event-1')
    expect(graphDelete).toHaveBeenCalledTimes(1)
    expect(appointmentUpdateBuilder.update).toHaveBeenCalledWith({
      calendar_event_id: null,
      calendar_sync_status: 'pending',
      calendar_last_error: null,
    })
  })
})
