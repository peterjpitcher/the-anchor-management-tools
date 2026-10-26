import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-218: the events CSV worked out price and payment mode itself, so four priced events marked
 * 'free' showed 'How Paid: Free', and it carried no booking or money columns. It now follows the
 * shared pricing rule and adds seats, who came and the money for each event.
 */

const state = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/audit-helpers', () => ({ getCurrentUser: vi.fn(async () => ({ user_id: 'manager-1', user_email: 'boss@example.test' })) }))

import { GET } from '@/app/api/events/export/route'

function get(query: string) {
  const url = `https://management.example.test/api/events/export${query}`
  const built = new Request(url)
  return GET(Object.assign(built, { nextUrl: new URL(url) }) as never)
}

function parse(csv: string): Array<Record<string, string>> {
  const [header, ...lines] = csv.replace(/^﻿/, '').split('\n')
  const cells = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1].replaceAll('""', '"'))
  const names = cells(header)
  return lines.map((line) => Object.fromEntries(cells(line).map((value, index) => [names[index], value])))
}

beforeEach(() => {
  state.db = createFakeSupabase({
    events: [
      // A quiz night priced at £3 but saved as 'free': the shared rule makes it cash on arrival.
      { id: 'quiz', name: '=Quiz night', date: '2026-10-07', time: '19:30:00', price: 3, price_per_seat: null, is_free: false, payment_mode: 'free', performer_name: 'Host', brief: null },
      { id: 'tinsel', name: 'Tinsel and Tipples', date: '2026-10-20', time: '19:00:00', price: 45, price_per_seat: null, is_free: false, payment_mode: 'prepaid', performer_name: null, brief: 'Christmas cocktails' },
    ],
    bookings: [
      { id: 'q1', event_id: 'quiz', customer_id: 'c1', seats: 4, status: 'confirmed', is_reminder_only: false },
      { id: 'q2', event_id: 'quiz', customer_id: 'c2', seats: 2, status: 'no_show', is_reminder_only: false },
      { id: 'q3', event_id: 'quiz', customer_id: 'c3', seats: 3, status: 'completed', is_reminder_only: false },
      { id: 'q4', event_id: 'quiz', customer_id: 'c4', seats: 1, status: 'confirmed', is_reminder_only: true },
      { id: 'q5', event_id: 'quiz', customer_id: 'c5', seats: 5, status: 'cancelled', is_reminder_only: false },
      { id: 't1', event_id: 'tinsel', customer_id: 'c6', seats: 2, status: 'confirmed', is_reminder_only: false },
      { id: 't2', event_id: 'tinsel', customer_id: 'c7', seats: 2, status: 'confirmed', is_reminder_only: false },
      { id: 't3', event_id: 'tinsel', customer_id: 'c8', seats: 1, status: 'confirmed', is_reminder_only: false },
    ],
    event_check_ins: [
      { event_id: 'quiz', booking_id: 'q1', customer_id: 'c1' },
      { event_id: 'tinsel', booking_id: 't1', customer_id: 'c6' },
    ],
    event_door_takings: [{ event_id: 'quiz', till_total: 18, free_entries: 1 }],
    payments: [
      { event_booking_id: 't2', amount: 90, status: 'succeeded', payment_method: 'cash', payment_provider: 'manual', charge_type: 'prepaid_event' },
      { event_booking_id: 't3', amount: 0, status: 'succeeded', payment_method: 'comp', payment_provider: 'manual', charge_type: 'prepaid_event' },
      { event_booking_id: 't1', amount: 90, status: 'succeeded', payment_method: 'paypal', payment_provider: 'paypal', charge_type: 'prepaid_event' },
    ],
    online_income_movements: [
      { source: 'event_ticket', source_id: 't1', gross: 90, refunded: 15, net: 75 },
    ],
  })
})

describe('events export (BK-218)', () => {
  it('follows the shared pricing rule and adds bookings and money for each event', async () => {
    const response = await get('?start_date=2026-10-01&end_date=2026-10-31')
    expect(response.status).toBe(200)
    const rows = parse(await response.text())
    const quiz = rows.find((row) => row['Event Name'].includes('Quiz'))
    const tinsel = rows.find((row) => row['Event Name'] === 'Tinsel and Tipples')

    expect(quiz).toMatchObject({
      'Event Name': '\t=Quiz night',
      Price: '£3.00',
      'How Paid': 'Cash on arrival',
      'Seats Booked': '9',
      'Seats Came': '4',
      'Seats Did Not Come': '2',
      'Online Tickets (net)': '0.00',
      'Door Payments Recorded': '0.00',
      'Door Till Total': '18.00',
      Comps: '1',
      'Total Taken (net)': '18.00',
    })
    expect(tinsel).toMatchObject({
      'Event Name': 'Tinsel and Tipples',
      Price: '£45.00',
      'How Paid': 'Prepaid online',
      'Seats Booked': '5',
      'Seats Came': '2',
      'Online Tickets (net)': '75.00',
      'Online Refunds': '15.00',
      'Door Payments Recorded': '90.00',
      'Door Till Total': '',
      Comps: '1',
      'Total Taken (net)': '165.00',
      Brief: 'Christmas cocktails',
    })
  })

  it('reports a failed read instead of a file with missing money', async () => {
    ;(state.db as { failures: unknown[] }).failures.push({ table: 'event_door_takings', op: 'select', error: { message: 'boom' } })
    const response = await get('?start_date=2026-10-01&end_date=2026-10-31')
    expect(response.status).toBe(500)
  })
})
