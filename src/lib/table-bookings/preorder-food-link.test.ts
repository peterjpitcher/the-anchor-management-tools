/**
 * The Christmas food link foundation (spec section 3.2): the seat completeness rule and its wording,
 * the save's new fields and who may make it, and the reminder ladder.
 *
 * The ladder cases run under both test zones (`npm test` is London, `npm run test:utc` is UTC), and
 * one booking sits on each side of the end of British Summer Time, so a rung that drifts by an hour
 * with the server's zone fails here.
 */

import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../../../tests/helpers/fakeSupabase'
import {
  PreorderCourseLimitError,
  PreorderSaveScopeError,
  decidePreorderChases,
  describeCoverMissingCourses,
  getPreorderCompleteness,
  getPreorderLadderStages,
  isCoverComplete,
  savePreorderCover,
  type PreorderChaseInput,
} from './preorder'
import type { PreorderCover, PreorderSelection } from '@/types/preorders'

function pick(course: PreorderSelection['course']): Pick<PreorderSelection, 'course'> {
  return { course }
}

const MAIN = pick('main')
const STARTER = pick('starter')
const DESSERT = pick('dessert')

describe('seat completeness on a Christmas booking (D4)', () => {
  it('asks for a name, their allergies and a main on an empty 1 course seat', () => {
    expect(describeCoverMissingCourses({ selections: [], courseCount: 1 })).toBe('a name, their allergies and a main')
  })

  it('asks for the number of courses on a seat still on 0, and nothing else once the line is filled', () => {
    expect(
      describeCoverMissingCourses({ selections: [MAIN], courseCount: 0, guestName: 'Sam', hasAllergies: false }),
    ).toBe('their number of courses')
    expect(describeCoverMissingCourses({ selections: [], courseCount: 0 })).toBe(
      'a name, their allergies, their number of courses and a main',
    )
    expect(isCoverComplete({ selections: [MAIN], courseCount: 0, guestName: 'Sam', hasAllergies: false })).toBe(false)
  })

  it('needs the detail when the guest has allergies, and none when they do not', () => {
    const base = { selections: [MAIN], courseCount: 1 as const, guestName: 'Sam' }
    expect(describeCoverMissingCourses({ ...base, hasAllergies: true })).toBe('details of their allergies')
    expect(describeCoverMissingCourses({ ...base, hasAllergies: true, allergyDetail: '  ' })).toBe(
      'details of their allergies',
    )
    expect(describeCoverMissingCourses({ ...base, hasAllergies: true, allergyDetail: 'Fixture allergy' })).toBeNull()
    expect(describeCoverMissingCourses({ ...base, hasAllergies: false })).toBeNull()
  })

  it('treats a blank name as no name', () => {
    expect(
      describeCoverMissingCourses({ selections: [MAIN], courseCount: 1, guestName: '   ', hasAllergies: false }),
    ).toBe('a name')
  })

  it('judges the dishes by the tier, a main on every tier', () => {
    const ready = { guestName: 'Sam', hasAllergies: false }
    expect(describeCoverMissingCourses({ ...ready, selections: [], courseCount: 1 })).toBe('a main')
    expect(describeCoverMissingCourses({ ...ready, selections: [MAIN, STARTER], courseCount: 2 })).toBeNull()
    expect(describeCoverMissingCourses({ ...ready, selections: [MAIN, STARTER, DESSERT], courseCount: 3 })).toBeNull()
    expect(describeCoverMissingCourses({ selections: [], courseCount: 2 })).toBe(
      'a name, their allergies and a main, plus a starter or a dessert',
    )
  })

  it('keeps the old main-only rule on a booking with no course list, whatever the name and allergies', () => {
    expect(describeCoverMissingCourses({ selections: [MAIN], courseCount: null })).toBeNull()
    expect(describeCoverMissingCourses({ selections: [], courseCount: null })).toBe('a main')
  })

  it('says who each gap belongs to, so a reminder can name them', () => {
    const seat: PreorderCover = {
      id: 'cover-1',
      tableBookingId: 'booking-1',
      ordinal: 1,
      guestName: ' Sam ',
      dietaryNote: null,
      hasAllergies: null,
      courseCount: 2,
      selections: [],
      createdAt: '2026-11-06T12:00:00Z',
      updatedAt: '2026-11-06T12:00:00Z',
    }
    const completeness = getPreorderCompleteness({ partySize: 1, courseCounts: [2], covers: [seat] })
    expect(completeness.seatsIncomplete).toEqual([
      { ordinal: 1, courseCount: 2, guestName: 'Sam', missing: 'their allergies and a main, plus a starter or a dessert' },
    ])
  })
})

describe('savePreorderCover, the food link fields', () => {
  const BOOKING = 'booking-link'

  function db(courseCounts: number[] | null = [0, 0]) {
    const fake = createFakeSupabase({
      table_bookings: [{ id: BOOKING, booking_period_id: 'period-1', christmas_course_counts: courseCounts }],
      booking_preorder_covers: [
        { id: 'cover-1', table_booking_id: BOOKING, ordinal: 1, guest_name: null, dietary_note: null, created_at: 'x', updated_at: 'x' },
        { id: 'cover-2', table_booking_id: BOOKING, ordinal: 2, guest_name: null, dietary_note: null, created_at: 'x', updated_at: 'x' },
      ],
      booking_preorder_selections: [],
      booking_period_menu_items: [
        { id: 'starter-1', period_id: 'period-1', name: 'Fixture starter', course: 'starter', price_gbp: 10, is_active: true, is_child_option: false },
        { id: 'main-1', period_id: 'period-1', name: 'Fixture main', course: 'main', price_gbp: 24, is_active: true, is_child_option: false },
        { id: 'kids-1', period_id: 'period-1', name: 'Fixture kids main', course: 'main', price_gbp: 12, is_active: true, is_child_option: true },
      ],
    })
    // The seat-course function, as the database runs it: one seat's tier, atomically.
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name !== 'set_christmas_seat_course_v01') return { data: null, error: { message: `unexpected ${name}` } }
      const booking = fake.tables.table_bookings.find((row) => row.id === args.p_table_booking_id)
      const counts = [...(booking?.christmas_course_counts ?? [])]
      counts[(args.p_ordinal as number) - 1] = args.p_course_count
      if (booking) booking.christmas_course_counts = counts
      return { data: { christmas_course_counts: counts }, error: null }
    })
    return Object.assign(fake, { rpc })
  }

  function coverRow(fake: ReturnType<typeof db>, id: string) {
    return fake.tables.booking_preorder_covers.find((row) => row.id === id) as Record<string, unknown>
  }

  it('saves the name, allergies and tier, and records an organiser save without the override', async () => {
    const fake = db()

    const saved = await savePreorderCover(fake as never, {
      coverId: 'cover-1',
      actor: { savedBy: 'organiser' },
      tableBookingId: BOOKING,
      guestName: '  Sam  ',
      hasAllergies: true,
      allergyDetail: ' Fixture allergy ',
      courseCount: 2,
      selections: [
        { course: 'main', menuItemId: 'main-1' },
        { course: 'starter', menuItemId: 'starter-1' },
      ],
    })

    expect(fake.rpc).toHaveBeenCalledWith('set_christmas_seat_course_v01', {
      p_table_booking_id: BOOKING,
      p_ordinal: 1,
      p_course_count: 2,
      p_staff_override: false,
    })
    const row = coverRow(fake, 'cover-1')
    expect(row.guest_name).toBe('Sam')
    expect(row.has_allergies).toBe(true)
    expect(row.allergy_detail).toBe('Fixture allergy')
    expect(row.last_saved_by).toBe('organiser')
    expect(Number.isFinite(Date.parse(String(row.last_saved_at)))).toBe(true)
    expect(saved.courseCount).toBe(2)
    expect(saved.hasAllergies).toBe(true)
    expect(saved.lastSavedBy).toBe('organiser')
  })

  it('passes the deadline override for a staff save only', async () => {
    const fake = db()
    await savePreorderCover(fake as never, { coverId: 'cover-2', actor: { savedBy: 'staff' }, courseCount: 3 })
    expect(fake.rpc).toHaveBeenCalledWith('set_christmas_seat_course_v01', expect.objectContaining({ p_staff_override: true }))
    expect(coverRow(fake, 'cover-2').last_saved_by).toBe('staff')
  })

  it('lets a guest save their own seat, recorded as a guest save', async () => {
    const fake = db()
    await savePreorderCover(fake as never, {
      coverId: 'cover-2',
      actor: { savedBy: 'guest', coverId: 'cover-2' },
      tableBookingId: BOOKING,
      guestName: 'Alex',
      hasAllergies: false,
      courseCount: 1,
      selections: [{ course: 'main', menuItemId: 'main-1' }],
    })
    expect(fake.rpc).toHaveBeenCalledWith('set_christmas_seat_course_v01', expect.objectContaining({ p_staff_override: false }))
    expect(coverRow(fake, 'cover-2').last_saved_by).toBe('guest')
    expect(fake.tables.booking_preorder_selections.map((row) => row.cover_id)).toEqual(['cover-2'])
  })

  it("refuses a guest save to anyone else's seat, and writes nothing", async () => {
    const fake = db()
    await expect(
      savePreorderCover(fake as never, {
        coverId: 'cover-1',
        actor: { savedBy: 'guest', coverId: 'cover-2' },
        guestName: 'Not mine',
        courseCount: 3,
      }),
    ).rejects.toBeInstanceOf(PreorderSaveScopeError)
    expect(fake.rpc).not.toHaveBeenCalled()
    expect(coverRow(fake, 'cover-1').guest_name).toBeNull()
  })

  it('refuses a guest changing who is sent a link', async () => {
    const fake = db()
    await expect(
      savePreorderCover(fake as never, {
        coverId: 'cover-2',
        actor: { savedBy: 'guest', coverId: 'cover-2' },
        inviteEmail: 'guest@example.com',
      }),
    ).rejects.toThrow('Only the organiser can change who is sent a link.')
  })

  it('refuses a seat on another booking', async () => {
    const fake = db()
    await expect(
      savePreorderCover(fake as never, { coverId: 'cover-1', actor: { savedBy: 'staff' }, tableBookingId: 'other' }),
    ).rejects.toBeInstanceOf(PreorderSaveScopeError)
  })

  it('refuses a save that does not say who is saving', async () => {
    const fake = db()
    await expect(savePreorderCover(fake as never, { coverId: 'cover-1' } as never)).rejects.toThrow(
      'A pre-order save must say who is saving it.',
    )
  })

  it("stores the organiser's invite address trimmed and in lower case, and refuses a bad one", async () => {
    const fake = db()
    await savePreorderCover(fake as never, {
      coverId: 'cover-1',
      actor: { savedBy: 'organiser' },
      inviteEmail: '  Guest.One@Example.COM ',
    })
    expect(coverRow(fake, 'cover-1').invite_email).toBe('guest.one@example.com')

    await expect(
      savePreorderCover(fake as never, { coverId: 'cover-1', actor: { savedBy: 'organiser' }, inviteEmail: 'not-an-email' }),
    ).rejects.toBeInstanceOf(PreorderSaveScopeError)
    expect(coverRow(fake, 'cover-1').invite_email).toBe('guest.one@example.com')
  })

  it('clears the allergy detail when the guest has no allergies', async () => {
    const fake = db()
    await savePreorderCover(fake as never, {
      coverId: 'cover-1',
      actor: { savedBy: 'organiser' },
      hasAllergies: true,
      allergyDetail: 'Fixture allergy',
    })
    await savePreorderCover(fake as never, {
      coverId: 'cover-1',
      actor: { savedBy: 'organiser' },
      hasAllergies: false,
      allergyDetail: 'Ignored',
    })
    const row = coverRow(fake, 'cover-1')
    expect(row.has_allergies).toBe(false)
    expect(row.allergy_detail).toBeNull()
  })

  it('refuses a starter on a seat that has not chosen its courses yet', async () => {
    const fake = db([0, 0])
    await expect(
      savePreorderCover(fake as never, {
        coverId: 'cover-1',
        actor: { savedBy: 'organiser' },
        selections: [{ course: 'starter', menuItemId: 'starter-1' }],
      }),
    ).rejects.toThrow('Choose how many courses seat 1 is having before choosing a starter or a dessert.')
    expect(fake.tables.booking_preorder_selections).toEqual([])
  })

  it('refuses a kids main on 2 courses, and takes it on 1', async () => {
    const fake = db([2, 1])
    const refused = savePreorderCover(fake as never, {
      coverId: 'cover-1',
      actor: { savedBy: 'organiser' },
      selections: [{ course: 'main', menuItemId: 'kids-1' }],
    })
    await expect(refused).rejects.toBeInstanceOf(PreorderCourseLimitError)
    await expect(refused).rejects.toThrow('Kids Christmas dinners are 1 course only.')

    await savePreorderCover(fake as never, {
      coverId: 'cover-2',
      actor: { savedBy: 'organiser' },
      selections: [{ course: 'main', menuItemId: 'kids-1' }],
    })
    expect(fake.tables.booking_preorder_selections.map((row) => row.menu_item_id)).toEqual(['kids-1'])
  })

  it('refuses a tier outside 0 to 3 before calling the database', async () => {
    const fake = db()
    await expect(
      savePreorderCover(fake as never, { coverId: 'cover-1', actor: { savedBy: 'staff' }, courseCount: 4 as never }),
    ).rejects.toThrow('Choose 1, 2 or 3 courses.')
    expect(fake.rpc).not.toHaveBeenCalled()
  })
})

/** Noon on a London date, as the instant it is. */
function iso(value: string): Date {
  return new Date(value)
}

describe('getPreorderLadderStages', () => {
  it('puts each rung on its London time for a December booking (GMT)', () => {
    const stages = getPreorderLadderStages({ bookingDate: '2026-12-12', preorderCutoffDays: 7 })
    expect(stages.map((stage) => [stage.kind, stage.audience, stage.channels, stage.dueAt.toISOString()])).toEqual([
      ['booker_21d', 'organiser', ['email'], '2026-11-21T12:00:00.000Z'],
      ['booker_14d', 'organiser', ['email'], '2026-11-28T12:00:00.000Z'],
      ['booker_10d', 'organiser', ['email'], '2026-12-02T12:00:00.000Z'],
      ['booker_day_before', 'organiser', ['email', 'sms'], '2026-12-04T12:00:00.000Z'],
      ['manager_day_before', 'manager', ['email'], '2026-12-04T12:00:00.000Z'],
      ['booker_cutoff_morning', 'organiser', ['email', 'sms'], '2026-12-05T09:00:00.000Z'],
    ])
  })

  it('keeps noon London on a rung that falls in British Summer Time', () => {
    // 10 November less 21 days is 20 October, before the clocks go back on 25 October 2026.
    const [first] = getPreorderLadderStages({ bookingDate: '2026-11-10', preorderCutoffDays: 7 })
    expect(first.kind).toBe('booker_21d')
    expect(first.dueAt.toISOString()).toBe('2026-10-20T11:00:00.000Z')
  })

  it('has no rungs without a cutoff', () => {
    expect(getPreorderLadderStages({ bookingDate: '2026-12-12', preorderCutoffDays: null })).toEqual([])
    expect(getPreorderLadderStages({ bookingDate: 'not-a-date', preorderCutoffDays: 7 })).toEqual([])
  })
})

describe('decidePreorderChases, the reminder ladder (D6, D7)', () => {
  const base: PreorderChaseInput = {
    now: iso('2026-11-21T12:00:00Z'),
    bookingDate: '2026-12-12',
    preorderCutoffDays: 7,
    bookingCreatedAt: '2026-10-01T10:00:00Z',
    complete: false,
    sent: [],
  }

  function kinds(input: Partial<PreorderChaseInput>): string[] {
    return decidePreorderChases({ ...base, ...input }).due.map((chase) => chase.kind)
  }

  it('sends nothing before the first rung', () => {
    expect(kinds({ now: iso('2026-11-21T11:59:00Z') })).toEqual([])
  })

  it('sends each rung on its day', () => {
    expect(kinds({ now: iso('2026-11-21T12:00:00Z') })).toEqual(['booker_21d'])
    expect(kinds({ now: iso('2026-11-28T12:00:00Z'), sent: [{ kind: 'booker_21d' }] })).toEqual(['booker_14d'])
    expect(
      kinds({ now: iso('2026-12-02T12:00:00Z'), sent: [{ kind: 'booker_21d' }, { kind: 'booker_14d' }] }),
    ).toEqual(['booker_10d'])
  })

  it('sends the day before rung by email and text, and the manager call list with it', () => {
    const decision = decidePreorderChases({
      ...base,
      now: iso('2026-12-04T12:00:00Z'),
      sent: [{ kind: 'booker_21d' }, { kind: 'booker_14d' }, { kind: 'booker_10d' }],
    })
    expect(decision.due).toEqual([
      { audience: 'organiser', kind: 'booker_day_before', channels: ['email', 'sms'], dueAt: iso('2026-12-04T12:00:00Z') },
      { audience: 'manager', kind: 'manager_day_before', channels: ['email'], dueAt: iso('2026-12-04T12:00:00Z') },
    ])
    expect(decision.locked).toBe(false)
    expect(decision.cutoffAt?.toISOString()).toBe('2026-12-05T12:00:00.000Z')
  })

  it('sends the cutoff morning rung at 09:00 on cutoff day', () => {
    const sent = ['booker_21d', 'booker_14d', 'booker_10d', 'booker_day_before', 'manager_day_before'].map((kind) => ({ kind }))
    expect(kinds({ now: iso('2026-12-05T08:59:00Z'), sent })).toEqual([])
    expect(kinds({ now: iso('2026-12-05T09:00:00Z'), sent })).toEqual(['booker_cutoff_morning'])
  })

  it('sends only the latest rung after missed runs, never a burst', () => {
    expect(kinds({ now: iso('2026-12-03T12:00:00Z') })).toEqual(['booker_10d'])
  })

  it('sends nothing when the latest due rung has already gone, even if an earlier one did not', () => {
    expect(kinds({ now: iso('2026-12-03T12:00:00Z'), sent: [{ kind: 'booker_10d' }] })).toEqual([])
  })

  it('skips the rungs that fell due before the booking was made', () => {
    // Made on 30 November: the 21 and 14 day rungs had gone, so the first message is the 10 day one.
    const made = { bookingCreatedAt: '2026-11-30T15:00:00Z' }
    expect(kinds({ ...made, now: iso('2026-12-01T12:00:00Z') })).toEqual([])
    expect(kinds({ ...made, now: iso('2026-12-02T12:00:00Z') })).toEqual(['booker_10d'])
  })

  it('does not send the manager call list for a booking made after it fell due', () => {
    expect(
      kinds({ bookingCreatedAt: '2026-12-04T15:00:00Z', now: iso('2026-12-05T09:00:00Z') }),
    ).toEqual(['booker_cutoff_morning'])
  })

  it('sends nothing to the organiser or the manager once the order is complete', () => {
    expect(kinds({ complete: true, now: iso('2026-12-04T12:00:00Z') })).toEqual([])
  })

  it('sends nothing at all once the form has locked', () => {
    const decision = decidePreorderChases({
      ...base,
      now: iso('2026-12-05T12:00:00Z'),
      seats: [{ coverId: 'cover-1', ordinal: 1, inviteSentAt: '2026-11-25T10:00:00Z', complete: false }],
    })
    expect(decision).toEqual({ due: [], cutoffAt: iso('2026-12-05T12:00:00Z'), locked: true })
  })

  it('sends nothing for a booking with no cutoff', () => {
    expect(decidePreorderChases({ ...base, preorderCutoffDays: null })).toEqual({ due: [], cutoffAt: null, locked: false })
  })

  it('ignores the legacy ledger kinds', () => {
    expect(kinds({ sent: [{ kind: 'booker_reminder' }, { kind: 'manager_escalation' }] })).toEqual(['booker_21d'])
  })

  describe('guest reminders', () => {
    const seats = [
      { coverId: 'cover-3', ordinal: 3, inviteSentAt: '2026-11-25T10:00:00Z', complete: false },
      { coverId: 'cover-1', ordinal: 1, inviteSentAt: '2026-11-22T10:00:00Z', complete: false },
      { coverId: 'cover-2', ordinal: 2, inviteSentAt: '2026-11-22T10:00:00Z', complete: true },
      { coverId: 'cover-4', ordinal: 4, inviteSentAt: null, complete: false },
      // Invited after the day before rung: too late for a reminder.
      { coverId: 'cover-5', ordinal: 5, inviteSentAt: '2026-12-04T13:00:00Z', complete: false },
    ]

    function guests(input: Partial<PreorderChaseInput>) {
      return decidePreorderChases({ ...base, seats, ...input }).due.filter((chase) => chase.audience === 'guest')
    }

    it('reminds each invited, incomplete guest at the day before time, in seat order', () => {
      expect(guests({ now: iso('2026-12-04T11:59:00Z') })).toEqual([])
      expect(guests({ now: iso('2026-12-04T12:00:00Z') })).toEqual([
        { audience: 'guest', kind: 'guest_reminder', coverId: 'cover-1', ordinal: 1, channels: ['email'], dueAt: iso('2026-12-04T12:00:00Z') },
        { audience: 'guest', kind: 'guest_reminder', coverId: 'cover-3', ordinal: 3, channels: ['email'], dueAt: iso('2026-12-04T12:00:00Z') },
      ])
    })

    it('reminds each guest once, and still after the organiser has finished their own chasing', () => {
      const due = guests({
        now: iso('2026-12-05T09:30:00Z'),
        complete: true,
        sent: [{ kind: 'guest_reminder', coverId: 'cover-1' }],
      })
      expect(due.map((chase) => chase.kind === 'guest_reminder' && chase.coverId)).toEqual(['cover-3'])
    })

    it('does not count a guest row as an organiser rung', () => {
      expect(
        decidePreorderChases({
          ...base,
          now: iso('2026-12-04T12:00:00Z'),
          sent: [{ kind: 'booker_day_before', coverId: 'cover-1' }],
        }).due.map((chase) => chase.kind),
      ).toEqual(['booker_day_before', 'manager_day_before'])
    })
  })
})
