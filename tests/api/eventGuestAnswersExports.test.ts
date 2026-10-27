import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * BK-015 and BK-017: the kitchen summary and the answers CSV. Both hold guests' answers, which
 * can be health data, so each download is recorded (ids and counts only), and the CSV is for
 * managers.
 */

const state = vi.hoisted(() => ({ permissions: new Set<string>(['events:view', 'events:manage']) }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'staff-1', email: 'staff@example.com' } } })) } })),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async (module: string, action: string) => state.permissions.has(`${module}:${action}`)) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/pdf/anchor-logo', () => ({ getAnchorLogoDataUri: () => undefined, ANCHOR_LOGO_ASPECT_RATIO: 2 }))

import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { GET as guestAnswersCsv } from '@/app/api/events/[id]/guest-answers/route'
import { GET as kitchenSummary } from '@/app/api/events/[id]/kitchen-summary/route'
import { FakeDb } from '../lib/insights/helpers/fake-db'

const EVENT_ID = 'e0000000-0000-4000-8000-000000000002'
const QUESTION = { id: '55555555-5555-4555-8555-555555555555', label: 'Any allergies?', type: 'text', required: true }
const attendee = (name: string, value: string) => ({
  id: `g-${name}`, name, ticket_type_id: null,
  answers: [{ question_id: QUESTION.id, label: QUESTION.label, type: 'text', required: true, value }],
})

beforeEach(() => {
  vi.clearAllMocks()
  state.permissions = new Set(['events:view', 'events:manage'])
  const db = new FakeDb({
    events: [{ id: EVENT_ID, name: 'Tasting night', date: '2099-11-20', time: '19:00', slug: 'tasting', booking_questions: [QUESTION] }],
    bookings: [
      { id: 'a1b2c3d4-0000', event_id: EVENT_ID, seats: 2, status: 'confirmed', notes: null, is_reminder_only: false, created_at: '2026-10-01T10:00:00Z',
        attendees: [attendee('Ann Guest', 'Peanuts'), attendee('=HYPERLINK("x")', 'None')], customer: { first_name: 'Pat', last_name: 'Booker' } },
      { id: 'ffffffff-0000', event_id: EVENT_ID, seats: 1, status: 'expired', notes: null, is_reminder_only: false, created_at: '2026-10-02T10:00:00Z',
        attendees: [attendee('Lapsed Guest', 'Shellfish')], customer: { first_name: 'Lapsed', last_name: 'Booker' } },
    ],
  })
  vi.mocked(createAdminClient).mockReturnValue(db.asDb() as never)
})

const context = { params: Promise.resolve({ id: EVENT_ID }) }
const request = (path: string) => new NextRequest(`https://management.orangejelly.co.uk/api/events/${EVENT_ID}/${path}`)

describe('guest answers CSV', () => {
  it('gives one row per ticket on the door list, one column per question', async () => {
    const response = await guestAnswersCsv(request('guest-answers'), context)
    expect(response.status).toBe(200)
    const text = (await response.text()).replace(/^﻿/, '')
    const lines = text.split('\n')
    expect(lines[0]).toBe('Booking reference,Booked by,Guest,Guest mobile,Any allergies?')
    expect(lines[1]).toBe('ANC-A1B2C3D4,Pat Booker,Ann Guest,,Peanuts')
    expect(text).not.toContain('Lapsed Guest')
  })

  it('stops a guest name being read as a spreadsheet formula', async () => {
    const text = await (await guestAnswersCsv(request('guest-answers'), context)).text()
    expect(text).toContain('"\t=HYPERLINK(""x"")"')
  })

  it('is for managers only', async () => {
    state.permissions = new Set(['events:view'])
    expect((await guestAnswersCsv(request('guest-answers'), context)).status).toBe(403)
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('records each download, with counts and no guest details', async () => {
    await guestAnswersCsv(request('guest-answers'), context)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'export', resource_type: 'event', resource_id: EVENT_ID,
      additional_info: { document: 'guest_answers_csv', tickets: 2 },
    }))
    expect(JSON.stringify(vi.mocked(logAuditEvent).mock.calls)).not.toMatch(/Peanuts|Ann Guest/)
  })
})

describe('kitchen summary', () => {
  it('prints for anyone who can see the event, and records the download', async () => {
    state.permissions = new Set(['events:view'])
    const response = await kitchenSummary(request('kitchen-summary'), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ additional_info: { document: 'kitchen_summary', guests: 2 } }))
  })

  it('is refused without permission to see events', async () => {
    state.permissions = new Set()
    expect((await kitchenSummary(request('kitchen-summary'), context)).status).toBe(403)
  })
})
