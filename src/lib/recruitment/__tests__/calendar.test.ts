import { describe, it, expect, vi, beforeEach } from 'vitest'

const { insertMock, updateMock, deleteMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: { calendar: () => ({ events: { insert: insertMock, update: updateMock, delete: deleteMock } }) },
}))
vi.mock('@/lib/google-calendar', () => ({ getOAuth2Client: vi.fn(async () => ({})) }))
vi.mock('@/lib/google-calendar-targets', () => ({ getSharedOperationsCalendarId: () => 'shared-cal' }))
vi.mock('@/lib/recruitment/contact', () => ({
  recruitmentSenderEmail: () => 'recruitment@example.com',
  RECRUITMENT_RIGHT_TO_WORK_WORDING: 'Bring right-to-work documents.',
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({}) }) }))
vi.mock('@/lib/errors', () => ({
  getErrorCode: (error: unknown) => (error && typeof error === 'object' ? (error as { code?: number }).code : undefined),
}))

import {
  buildRecruitmentCalendarEvent,
  syncRecruitmentAppointmentCalendar,
  deleteRecruitmentAppointmentCalendarEvent,
} from '../calendar'

function makeSupabase(appointment: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = []
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    update: vi.fn((payload: Record<string, unknown>) => { updates.push(payload); return builder }),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: appointment, error: null })),
  }
  ;(builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) => resolve({ error: null })
  const client = { from: vi.fn(() => builder) }
  return { client, updates }
}

const baseAppointment = {
  id: 'a1',
  type: 'interview',
  scheduled_start: '2026-07-02T17:00:00+00:00',
  scheduled_end: '2026-07-02T17:45:00+00:00',
  timezone: 'Europe/London',
  location: 'The Anchor',
  calendar_event_id: null as string | null,
  candidate: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
  application: { job_posting: { title: 'Bar Staff' } },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{"type":"service_account"}'
  insertMock.mockResolvedValue({ data: { id: 'new-evt' } })
  updateMock.mockResolvedValue({ data: { id: 'upd-evt' } })
  deleteMock.mockResolvedValue({})
})

describe('buildRecruitmentCalendarEvent', () => {
  it('builds an interview event in the appointment timezone with the interview colour', () => {
    const event = buildRecruitmentCalendarEvent(baseAppointment)
    expect(event.summary).toBe('Interview: Jane Doe')
    expect(event.start).toEqual({ dateTime: '2026-07-02T17:00:00+00:00', timeZone: 'Europe/London' })
    expect(event.end.dateTime).toBe('2026-07-02T17:45:00+00:00')
    expect(event.colorId).toBe('3')
    expect(event.location).toBe('The Anchor')
  })

  it('distinguishes trial shifts by label and colour', () => {
    const event = buildRecruitmentCalendarEvent({ ...baseAppointment, type: 'trial_shift' })
    expect(event.summary).toBe('Trial shift: Jane Doe')
    expect(event.colorId).toBe('5')
  })
})

describe('syncRecruitmentAppointmentCalendar', () => {
  it('inserts a new event when there is no stored event id', async () => {
    const { client, updates } = makeSupabase({ ...baseAppointment, calendar_event_id: null })
    const result = await syncRecruitmentAppointmentCalendar('a1', client as never)
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(updateMock).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'synced', eventId: 'new-evt' })
    expect(updates.at(-1)).toMatchObject({ calendar_event_id: 'new-evt', calendar_sync_status: 'synced', calendar_last_error: null })
  })

  it('updates the existing event when an id is stored', async () => {
    const { client } = makeSupabase({ ...baseAppointment, calendar_event_id: 'evt0' })
    const result = await syncRecruitmentAppointmentCalendar('a1', client as never)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0][0]).toMatchObject({ eventId: 'evt0', calendarId: 'shared-cal' })
    expect(insertMock).not.toHaveBeenCalled()
    expect(result.status).toBe('synced')
  })

  it('falls back to insert when the stored event is gone (404)', async () => {
    updateMock.mockRejectedValueOnce({ code: 404 })
    const { client } = makeSupabase({ ...baseAppointment, calendar_event_id: 'gone' })
    const result = await syncRecruitmentAppointmentCalendar('a1', client as never)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'synced', eventId: 'new-evt' })
  })

  it('records ics_fallback when Google is not configured', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    delete process.env.GOOGLE_CLIENT_ID
    const { client, updates } = makeSupabase({ ...baseAppointment })
    const result = await syncRecruitmentAppointmentCalendar('a1', client as never)
    expect(result.status).toBe('ics_fallback')
    expect(insertMock).not.toHaveBeenCalled()
    expect(updates.at(-1)).toMatchObject({ calendar_sync_status: 'ics_fallback' })
  })
})

describe('deleteRecruitmentAppointmentCalendarEvent', () => {
  it('deletes the event and clears the stored id', async () => {
    const { client, updates } = makeSupabase({ ...baseAppointment, calendar_event_id: 'evt0' })
    const result = await deleteRecruitmentAppointmentCalendarEvent('a1', client as never)
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ deleted: true })
    expect(updates.at(-1)).toMatchObject({ calendar_event_id: null })
  })

  it('treats an already-deleted event (404) as deleted', async () => {
    deleteMock.mockRejectedValueOnce({ code: 404 })
    const { client } = makeSupabase({ ...baseAppointment, calendar_event_id: 'gone' })
    const result = await deleteRecruitmentAppointmentCalendarEvent('a1', client as never)
    expect(result).toEqual({ deleted: true })
  })

  it('no-ops when nothing is synced', async () => {
    const { client } = makeSupabase({ ...baseAppointment, calendar_event_id: null })
    const result = await deleteRecruitmentAppointmentCalendarEvent('a1', client as never)
    expect(deleteMock).not.toHaveBeenCalled()
    expect(result).toEqual({ deleted: false, reason: 'not_synced' })
  })
})
