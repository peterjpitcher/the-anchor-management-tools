import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanText } from '../mocks/emailRenderChecks'

/**
 * Staff emails that used to be built with an en or em dash, which the house style bans, rendered
 * with fixture data through the real route, sender or builder. Every part runs assertCleanText in
 * full, and the wording that replaced each dash is pinned so a dash cannot creep back in.
 */

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

// Idempotency claims are bookkeeping rows; every case is a first run.
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(() => 'request-hash'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/guest/tokens', () => ({ createGuestToken: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sendEmail } from '@/lib/email/emailService'
import { claimIdempotencyKey } from '@/lib/api/idempotency'
import { createGuestToken } from '@/lib/guest/tokens'
import { createAdminClient } from '@/lib/supabase/admin'
import { GET as runEventChecklistReminders } from '@/app/api/cron/event-checklist-reminders/route'
import { sendPrivateBookingOutcomeEmail } from '@/lib/private-bookings/manager-notifications'
import {
  buildEarningsAlertEmailHtml,
  buildHolidayDecisionEmailHtml,
  buildHolidaySubmittedEmailHtml,
  buildOpenShiftRequestManagerEmailHtml,
  buildPayrollEmailHtml,
  buildRotaChangeEmailHtml,
  buildShiftAutoAcceptWarningEmailHtml,
  buildShiftRejectedManagerEmailHtml,
  buildStaffRotaEmailHtml,
  type PortalShiftEmailSummary,
  type ShiftSummary,
} from '@/lib/rota/email-templates'

type Db = ReturnType<typeof createAdminClient>
type Row = Record<string, unknown>
type SentEmail = { subject: string; text?: string; html?: string }

const CHAIN_METHODS = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'or', 'contains', 'order', 'limit',
]

/**
 * A Supabase stand-in. A list read of a table answers with its fixture rows, a single read with
 * the first of them, and every write succeeds. Filters are ignored: each case seeds only the rows
 * its sender reads.
 */
function fixtureDb(tables: Record<string, Row | Row[] | null>): Db {
  return {
    from(table: string) {
      const seeded = tables[table] ?? null
      const rows = seeded === null ? [] : Array.isArray(seeded) ? seeded : [seeded]
      const builder: Record<string, unknown> = {
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      }
      for (const method of CHAIN_METHODS) builder[method] = () => builder
      return builder
    },
  } as unknown as Db
}

function onlyEmail(): SentEmail {
  const calls = vi.mocked(sendEmail).mock.calls
  expect(calls).toHaveLength(1)
  return calls[0][0] as SentEmail
}

/** Subject, text and html all pass the full render check, banned dashes included. */
function expectCleanEmail(email: SentEmail): void {
  assertCleanText(email.subject)
  for (const body of [email.text, email.html]) {
    if (body !== undefined) assertCleanText(body)
  }
}

// Thursday 1 October 2026, 11am in London.
const NOW = new Date('2026-10-01T10:00:00.000Z')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(NOW)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' } as never)
  vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as never)
})

describe('event checklist reminders cron', () => {
  it('subject and task lines use a colon, not an en dash', async () => {
    // A Sunday 4 October event: its launch tasks are overdue and the WhatsApp reminder is due today.
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        events: { id: 'event-1', name: 'Harvest Quiz Night', date: '2026-10-04' },
        event_checklist_statuses: null,
      })
    )

    const response = await runEventChecklistReminders(
      new Request('http://cron.internal/api/cron/event-checklist-reminders', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, sent: true, overdue: 7, dueToday: 1, events: 1 })
    const email = onlyEmail()
    expect(email.subject).toBe('Event checklist reminder: Thursday, 1 October 2026')
    expect(email.html).toContain('">: due since ')
    expect(email.html).toContain('">: due on ')
    expectCleanEmail(email)
  })
})

describe('post-event outcome email', () => {
  function issueTokens(): void {
    let issued = 0
    vi.mocked(createGuestToken).mockImplementation(async () => {
      issued += 1
      return { rawToken: `outcome-token-${issued}`, hashedToken: `outcome-hash-${issued}` } as never
    })
    vi.mocked(createAdminClient).mockReturnValue(fixtureDb({ private_bookings: { customer_id: 'customer-2' } }))
  }

  it('went-well option and subject date use a colon and brackets, not an em dash', async () => {
    issueTokens()

    const result = await sendPrivateBookingOutcomeEmail({
      bookingId: 'booking-1',
      customerName: 'Alex Smith',
      customerFirstName: 'Alex',
      eventDate: '14 November 2026',
      guestCount: 40,
    })

    expect(result.success).toBe(true)
    const email = onlyEmail()
    expect(email.subject).toBe("Did Alex's event go well? (14 November 2026)")
    expect(email.html).toContain('>Yes: went well (send the customer a Google review ask)</a>')
    expect(email.text).toContain('Yes (went well): https://example.com/api/private-bookings/outcome/went_well/outcome-token-1')
    expectCleanEmail(email)
  })

  it('leaves the brackets out of the subject when there is no event date', async () => {
    issueTokens()

    await sendPrivateBookingOutcomeEmail({
      bookingId: 'booking-1',
      customerName: 'Alex Smith',
      customerFirstName: 'Alex',
      eventDate: ' ',
      guestCount: 40,
    })

    const email = onlyEmail()
    expect(email.subject).toBe("Did Alex's event go well?")
    expectCleanEmail(email)
  })
})

describe('rota and payroll email builders', () => {
  // Friday 9 October 2026, in the week Monday 5 to Sunday 11 October.
  const SHIFT: ShiftSummary = {
    date: '2026-10-09',
    startTime: '17:00',
    endTime: '23:00',
    department: 'bar',
    templateName: 'Evening bar',
  }
  const LATER_SHIFT: ShiftSummary = { ...SHIFT, startTime: '18:00' }
  const OPEN_SHIFT: ShiftSummary = {
    date: '2026-10-11',
    startTime: '12:00',
    endTime: '18:00',
    department: 'kitchen',
    templateName: 'Sunday lunch',
  }
  const PORTAL_SHIFT: PortalShiftEmailSummary = {
    employeeName: 'Sam Taylor',
    date: '2026-10-09',
    startTime: '17:00',
    endTime: '23:00',
    department: 'bar',
    templateName: 'Evening bar',
  }

  const TEMPLATES: Array<{ name: string; render: () => string; expected: string[] }> = [
    {
      name: 'weekly rota',
      render: () => buildStaffRotaEmailHtml('Sam', '2026-10-05', '2026-10-11', [SHIFT], [OPEN_SHIFT]),
      expected: ['Your shifts for 5 Oct to 11 Oct 2026', '>17:00 to 23:00</td>', '>12:00 to 18:00</td>'],
    },
    {
      name: 'rota change',
      render: () =>
        buildRotaChangeEmailHtml(
          'Sam',
          '2026-10-05',
          '2026-10-11',
          [
            { type: 'added', after: OPEN_SHIFT },
            { type: 'modified', before: SHIFT, after: LATER_SHIFT },
          ],
          [LATER_SHIFT, OPEN_SHIFT],
          [OPEN_SHIFT]
        ),
      expected: [
        'Your rota has been updated: 5 Oct to 11 Oct 2026',
        'Fri 9 Oct, 17:00 to 23:00 (bar)',
        'Fri 9 Oct, 18:00 to 23:00 (bar)',
        '>18:00 to 23:00</td>',
        '>12:00 to 18:00</td>',
      ],
    },
    {
      name: 'holiday request received',
      render: () => buildHolidaySubmittedEmailHtml('Sam', '2026-11-02', '2026-11-06'),
      expected: ['<strong>2 Nov 2026 to 6 Nov 2026</strong>'],
    },
    {
      name: 'holiday request approved',
      render: () => buildHolidayDecisionEmailHtml('Sam', '2026-11-02', '2026-11-06', 'approved', 'Enjoy the break'),
      expected: ['<strong>2 Nov 2026 to 6 Nov 2026</strong>'],
    },
    {
      name: 'shift rejected, to the manager',
      render: () => buildShiftRejectedManagerEmailHtml(PORTAL_SHIFT, 'Away that weekend'),
      expected: ['Fri 9 Oct 2026, 17:00 to 23:00 (bar): Evening bar'],
    },
    {
      name: 'open shift request with the day around it, to the manager',
      render: () =>
        buildOpenShiftRequestManagerEmailHtml(PORTAL_SHIFT, 'Happy to cover', {
          dayContext: [
            {
              date: '2026-10-09',
              shifts: [
                {
                  employeeName: 'Jo Bloggs',
                  jobTitle: 'Bar Supervisor',
                  startTime: '16:00',
                  endTime: '23:30',
                  department: 'bar',
                  templateName: 'Late bar',
                  isOpenShift: false,
                },
                {
                  employeeName: 'Open shift',
                  startTime: '17:00',
                  endTime: '23:00',
                  department: 'bar',
                  templateName: 'Evening bar',
                  isOpenShift: true,
                },
              ],
            },
          ],
        }),
      expected: [
        'Fri 9 Oct 2026, 17:00 to 23:00 (bar): Evening bar',
        '<strong>16:00 to 23:30</strong> Jo Bloggs, Bar Supervisor (bar): Late bar</li>',
        '<strong>17:00 to 23:00</strong> Open shift (bar): Evening bar <span',
      ],
    },
    {
      name: 'shift acceptance reminder',
      render: () => buildShiftAutoAcceptWarningEmailHtml('Sam', [PORTAL_SHIFT]),
      expected: ['>17:00 to 23:00</td>'],
    },
    {
      name: 'earnings limit alert',
      render: () => buildEarningsAlertEmailHtml(2026, 8, [{ name: 'Busy Bee', totalPay: 1040 }]),
      expected: ['Action Required: Earnings Limit Alert', 'The Anchor (sent via management tools)'],
    },
    {
      name: 'payroll with no premium hours and a leaver',
      render: () =>
        buildPayrollEmailHtml(
          2026,
          8,
          [{ name: 'Old Snapshot', plannedHours: 8, actualHours: 8, hourlyRate: 12, totalPay: 96 }],
          [{ name: 'Jo Bloggs', employmentEndDate: '2026-08-28' }]
        ),
      expected: [
        'Payroll Summary: August 2026',
        // The premium cell and its total read 0.00 when no premium applies, like the hours beside them.
        'text-align:right">8.00</td>',
        'text-align:right">0.00</td>',
        '<strong>0.00</strong>',
        'P45 Required: Employees Leaving This Period',
        'The Anchor (sent via management tools)',
      ],
    },
    {
      name: 'payroll with premium hours',
      render: () =>
        buildPayrollEmailHtml(2026, 8, [
          { name: 'Alex Example', plannedHours: 8, actualHours: 8, standardHours: 6, premiumHours: 2, hourlyRate: 12, totalPay: 120 },
        ]),
      expected: ['Payroll Summary: August 2026', 'text-align:right">2.00</td>', '<strong>2.00</strong>'],
    },
  ]

  it.each(TEMPLATES)('$name', ({ render, expected }) => {
    const html = render()

    for (const fragment of expected) expect(html).toContain(fragment)
    assertCleanText(html)
  })
})
