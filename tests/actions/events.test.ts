import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/services/events', () => ({
  EventService: {
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    getEventById: vi.fn(),
    getEvents: vi.fn(),
    getEventFAQs: vi.fn(),
  },
  eventSchema: {
    safeParse: vi.fn(),
    partial: vi.fn().mockReturnValue({ safeParse: vi.fn() }),
  },
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((p: string) => p),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn(),
  updateEventBookingSeatsById: vi.fn(),
}))

vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn(),
  sendEventBookingSeatUpdateSms: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/google-calendar-events', () => ({
  syncPubOpsEventCalendarByEventId: vi.fn().mockResolvedValue({
    state: 'updated',
    eventId: 'event-1',
    googleEventId: 'google-event-id',
  }),
  deletePubOpsEventCalendarEntryByEventId: vi.fn().mockResolvedValue({
    state: 'deleted',
    eventId: 'event-1',
    googleEventId: 'google-event-id',
  }),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn(),
}))

vi.mock('@/lib/sms/bulk', () => ({
  getSmartFirstName: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { EventService, eventSchema } from '@/services/events'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import {
  createEvent,
  deleteEvent,
  getEventById,
  getEvents,
  updateEvent,
} from '@/app/actions/events'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock
const mockedEventSchema = eventSchema as unknown as { safeParse: Mock; partial: Mock }
const mockedSyncPubOpsEventCalendarByEventId = syncPubOpsEventCalendarByEventId as unknown as Mock

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSupabaseClientForEvents() {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'staff@example.com' } },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }
  mockedCreateClient.mockResolvedValue(client)
  return client
}

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v)
  }
  return fd
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Events actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // createEvent
  // -----------------------------------------------------------------------

  describe('createEvent', () => {
    it('should return error when user lacks events manage permission', async () => {
      mockedPermission.mockResolvedValue(false)
      mockSupabaseClientForEvents()

      const formData = buildFormData({ name: 'Quiz Night', date: '2026-04-10' })
      const result = await createEvent(formData)

      expect(result).toEqual({ error: 'Insufficient permissions to create events' })
    })

    it('should return error when user is not authenticated', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockSupabaseClientForEvents()
      client.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      })

      const formData = buildFormData({ name: 'Quiz Night', date: '2026-04-10' })
      const result = await createEvent(formData)

      expect(result).toEqual({ error: 'Unauthorized' })
    })

    it('should return validation error when schema fails', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClientForEvents()

      mockedEventSchema.safeParse.mockReturnValue({
        success: false,
        error: { errors: [{ message: 'Name is required' }] },
      })

      const formData = buildFormData({ date: '2026-04-10' })
      const result = await createEvent(formData)

      expect(result).toEqual({ error: 'Name is required' })
    })

    it('should create event successfully and log audit', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClientForEvents()

      const createdEvent = {
        id: 'event-1',
        name: 'Quiz Night',
        date: '2026-04-10',
        slug: 'quiz-night',
      }

      mockedEventSchema.safeParse.mockReturnValue({
        success: true,
        data: { name: 'Quiz Night', date: '2026-04-10' },
      })

      ;(EventService.createEvent as Mock).mockResolvedValue(createdEvent)

      const formData = buildFormData({ name: 'Quiz Night', date: '2026-04-10' })
      const result = await createEvent(formData)

      expect(result).toEqual({ success: true, data: createdEvent })
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'create',
          resource_type: 'event',
          resource_id: 'event-1',
        }),
      )
    })

    it('should catch service errors and return error message', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClientForEvents()

      mockedEventSchema.safeParse.mockReturnValue({
        success: true,
        data: { name: 'Quiz Night', date: '2026-04-10' },
      })

      ;(EventService.createEvent as Mock).mockRejectedValue(new Error('DB unavailable'))

      const formData = buildFormData({ name: 'Quiz Night', date: '2026-04-10' })
      const result = await createEvent(formData)

      expect(result).toEqual({ error: 'DB unavailable' })
    })
  })

  // -----------------------------------------------------------------------
  // updateEvent
  // -----------------------------------------------------------------------

  describe('updateEvent', () => {
    it('syncs the Pub Ops aggregate calendar entry after an event reschedule', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClientForEvents()

      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)

      const partialSafeParse = vi.fn().mockReturnValue({
        success: true,
        data: {
          name: 'Quiz Night',
          date: '2026-04-11',
          time: '20:00:00',
          event_status: 'scheduled',
        },
      })
      mockedEventSchema.partial.mockReturnValue({ safeParse: partialSafeParse })

      ;(EventService.updateEvent as Mock).mockResolvedValue({
        id: 'event-1',
        name: 'Quiz Night',
        date: '2026-04-11',
        time: '20:00:00',
        slug: 'quiz-night',
        _oldDate: '2026-04-10',
        _oldTime: '19:00:00',
        _oldName: 'Quiz Night',
        _oldStatus: 'scheduled',
        marketingLinksWarning: null,
      })

      const result = await updateEvent('event-1', buildFormData({
        name: 'Quiz Night',
        date: '2026-04-11',
        time: '20:00:00',
        event_status: 'scheduled',
      }))

      expect(result).toHaveProperty('success', true)
      expect(mockedSyncPubOpsEventCalendarByEventId).toHaveBeenCalledWith(
        adminClient,
        'event-1',
        { context: 'event_updated' },
      )
    })
  })

  // -----------------------------------------------------------------------
  // deleteEvent
  // -----------------------------------------------------------------------

  describe('deleteEvent', () => {
    it('should return error when user lacks events manage permission', async () => {
      mockedPermission.mockResolvedValue(false)
      mockSupabaseClientForEvents()

      const result = await deleteEvent('event-1')
      expect(result).toEqual({ error: 'Insufficient permissions to delete events' })
    })

    it('should return error when user is not authenticated', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockSupabaseClientForEvents()
      client.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      })

      const result = await deleteEvent('event-1')
      expect(result).toEqual({ error: 'Unauthorized' })
    })

    it('should delete event successfully and log audit', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClientForEvents()

      const deletedEvent = { id: 'event-1', name: 'Old Event' }
      ;(EventService.deleteEvent as Mock).mockResolvedValue(deletedEvent)

      const result = await deleteEvent('event-1')

      expect(result).toHaveProperty('success', true)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'delete',
          resource_type: 'event',
          resource_id: 'event-1',
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // getEventById
  // -----------------------------------------------------------------------

  describe('getEventById', () => {
    it('should return event data on success', async () => {
      const event = { id: 'event-1', name: 'Quiz Night', date: '2026-04-10' }
      ;(EventService.getEventById as Mock).mockResolvedValue(event)

      const result = await getEventById('event-1')
      expect(result).toEqual({ data: event })
    })

    it('should return error when service throws', async () => {
      ;(EventService.getEventById as Mock).mockRejectedValue(new Error('Not found'))

      const result = await getEventById('event-999')
      expect(result).toEqual({ error: 'Not found' })
    })
  })

  // -----------------------------------------------------------------------
  // getEvents
  // -----------------------------------------------------------------------

  describe('getEvents', () => {
    it('should return events list with pagination', async () => {
      const events = [{ id: 'e1' }, { id: 'e2' }]
      const pagination = { totalCount: 2, currentPage: 1, pageSize: 20, totalPages: 1 }

      ;(EventService.getEvents as Mock).mockResolvedValue({ events, pagination })

      const result = await getEvents({ status: 'scheduled' })
      expect(result).toEqual({ data: events, pagination })
    })

    it('should return error when service throws', async () => {
      ;(EventService.getEvents as Mock).mockRejectedValue(new Error('Query timeout'))

      const result = await getEvents()
      expect(result).toEqual({ error: 'Query timeout' })
    })
  })
})
