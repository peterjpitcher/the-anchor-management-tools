import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('googleapis', () => {
  const mockCalendar = {
    events: {
      update: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    },
    calendars: {
      get: vi.fn(),
    },
  }

  class OAuth2 {
    constructor() {}
    setCredentials() {}
  }

  return {
    google: {
      calendar: () => mockCalendar,
      auth: {
        OAuth2,
        JWT: class {
          async authorize() {}
        },
        GoogleAuth: class {
          async getClient() {
            return {}
          }
        },
      },
    },
  }
})

import { google } from 'googleapis'
import { syncCalendarEvent } from '@/lib/google-calendar'

const calendar = google.calendar('v3') as unknown as {
  events: {
    update: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
  }
}

describe('google calendar sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh'
    delete process.env.GOOGLE_CALENDAR_ID
  })

  it('recreates the event if the stored event id no longer exists', async () => {
    calendar.events.update.mockRejectedValueOnce({ code: 404, message: 'Not Found' })
    calendar.events.insert.mockResolvedValueOnce({
      data: { id: 'new-event-id', htmlLink: 'https://calendar.google.com/event?eid=new' },
    })

    const booking = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      customer_name: 'Jane Doe',
      event_date: '2026-01-10',
      start_time: '18:00',
      end_time: '20:00',
      end_time_next_day: false,
      status: 'confirmed',
      deposit_amount: 250,
      total_amount: 0,
      contract_version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      calendar_event_id: 'missing-event-id',
    } as any

    const eventId = await syncCalendarEvent(booking)
    expect(eventId).toBe('new-event-id')
    expect(calendar.events.update).toHaveBeenCalledTimes(1)
    expect(calendar.events.insert).toHaveBeenCalledTimes(1)
  })

  it('guards against end time before start time', async () => {
    let requestBody: any | undefined

    calendar.events.insert.mockImplementationOnce(async (options: any) => {
      requestBody = options.requestBody
      return {
        data: { id: 'created-event', htmlLink: 'https://calendar.google.com/event?eid=created' },
      }
    })

    const booking = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      customer_name: 'Jane Doe',
      event_date: '2026-01-10',
      start_time: '18:00',
      end_time: '17:00',
      end_time_next_day: false,
      status: 'draft',
      deposit_amount: 250,
      total_amount: 0,
      contract_version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as any

    const eventId = await syncCalendarEvent(booking)
    expect(eventId).toBe('created-event')
    expect(requestBody?.start?.dateTime).toBeTruthy()
    expect(requestBody?.end?.dateTime).toBeTruthy()

    const start = new Date(requestBody.start.dateTime).getTime()
    const end = new Date(requestBody.end.dateTime).getTime()
    expect(end).toBeGreaterThan(start)
  })
})

