import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { eventsDelete } = vi.hoisted(() => ({
  eventsDelete: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        insert: vi.fn(),
        update: vi.fn(),
        delete: eventsDelete,
      },
    })),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  getOAuth2Client: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/google-calendar-targets', () => ({
  getSharedOperationsCalendarId: vi.fn(() => 'ops-calendar'),
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
  const originalServiceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const originalInterviewCalendarId = process.env.GOOGLE_CALENDAR_INTERVIEW_ID

  beforeEach(() => {
    vi.clearAllMocks()
    eventsDelete.mockResolvedValue({})
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'service-account-key'
    process.env.GOOGLE_CALENDAR_INTERVIEW_ID = 'interview-calendar'
  })

  afterEach(() => {
    if (originalServiceAccountKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    else process.env.GOOGLE_SERVICE_ACCOUNT_KEY = originalServiceAccountKey
    if (originalInterviewCalendarId === undefined) delete process.env.GOOGLE_CALENDAR_INTERVIEW_ID
    else process.env.GOOGLE_CALENDAR_INTERVIEW_ID = originalInterviewCalendarId
  })

  it('retries Google Calendar deletion for cancelled appointments with a remaining calendar event', async () => {
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
    expect(eventsDelete).toHaveBeenCalledTimes(1)
    expect(eventsDelete).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'interview-calendar',
      eventId: 'event-1',
    }))
    expect(appointmentUpdateBuilder.update).toHaveBeenCalledWith({
      calendar_event_id: null,
      calendar_sync_status: 'pending',
      calendar_last_error: null,
    })
  })

  it('keeps the event id and marks sync failed when the Google deletion errors', async () => {
    eventsDelete.mockRejectedValue(new Error('rate limited'))

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
      deleted: 0,
      deletionFailed: 1,
    })
    expect(appointmentUpdateBuilder.update).toHaveBeenCalledWith({
      calendar_sync_status: 'failed',
      calendar_last_error: 'rate limited',
    })
  })
})
