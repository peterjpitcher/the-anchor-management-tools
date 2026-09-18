import { rankActions } from '@/lib/insights/actions'
import { dedupeByEntity, orderSignals, sectionStatusOf } from '@/lib/insights/signals'
import { buildSummary } from '@/lib/insights/summary'
import { computeWindows } from '@/lib/insights/windows'
import { SECTION_KEYS } from '@/lib/insights/types'
import type { InsightAction, InsightSection, InsightSignal, InsightsReport, SectionBuildResult, SectionKey } from '@/lib/insights/types'

/**
 * A production-shaped report for renderer, page and preview tests. Names are fictional.
 * `heavy` multiplies the exceptions to prove the size and reading budgets hold.
 */

const ORIGIN = 'https://management.example.test'
const TITLES: Record<SectionKey, [string, string]> = {
  events: ['Hosted events', '/events'],
  customers: ['Customers', '/customers'],
  marketing: ['Marketing emails', '/marketing'],
  feedback: ['Customer feedback', '/feedback-inbox'],
  table_bookings: ['Table bookings', '/table-bookings/boh'],
  private_hire: ['Private hire', '/private-bookings'],
  parking: ['Parking', '/parking'],
  maintenance: ['Maintenance', '/maintenance'],
  employees: ['Employees and compliance', '/employees'],
  rota: ['Rota, shifts and leave', '/rota'],
  checklists: ['Checklists', '/checklists/manage/insights'],
  invoices: ['Invoices', '/invoices'],
  cashing_up: ['Cashing up', '/cashing-up/dashboard'],
  short_links: ['Short links', '/short-links/insights'],
  recruitment: ['Recruitment', '/recruitment'],
}

function action(text: string, path: string, overrides: Partial<InsightAction> = {}): InsightAction {
  return { text, href: `${ORIGIN}${path}`, target: 'record', impact: 'customer', ...overrides }
}

function issue(key: string, rag: 'red' | 'amber', text: string, extra: Partial<InsightSignal> = {}): InsightSignal {
  return { key, rag, kind: 'issue', text, emailSafe: true, ...extra }
}

function win(key: string, text: string, extra: Partial<InsightSignal> = {}): InsightSignal {
  return { key, rag: 'green', kind: 'win', text, emailSafe: true, ...extra }
}

function content(heavy: boolean): Record<SectionKey, SectionBuildResult> {
  const repeat = heavy ? 6 : 1
  const many = <T,>(make: (i: number) => T): T[] => Array.from({ length: repeat }, (_, i) => make(i))
  return {
    events: {
      headline: '3 hosted events in the next 14 days. Music Bingo is 6 days away and only 18% booked.',
      metrics: [{ label: 'Events in the next 14 days', value: '3' }, { label: 'Seats booked', value: '38 of 180', comparison: '21% filled' }],
      lists: [{ title: 'Next 14 days', items: [{ text: 'Music Bingo, Thu 1 Oct: 11 of 60 booked (18%)', href: `${ORIGIN}/events/e1`, rag: 'red' }] }],
      signals: [
        ...many((i) => issue(`events.low_fill.e1${i}`, 'red', 'Music Bingo (Thu 1 Oct) is 6 days away and only 18% booked.', { entity: `event:e1${i}`, action: action('Promote Music Bingo (Thu 1 Oct): 18% booked, 49 seats left', `/events/e1${i}`, { dueDate: '2026-10-01' }) })),
        issue('events.behind.e2', 'amber', 'Quiz night has 8 seats against 19 usually at this point.', { entity: 'event:e2', action: action('Push Quiz night (Wed 7 Oct): behind comparable nights', '/events/e2', { dueDate: '2026-10-07' }) }),
        win('events.sold_out.e3', 'Comedy night (Sat 3 Oct) is sold out.'),
      ],
      notes: [],
      upcoming: [{ date: '2026-10-01', text: 'Music Bingo, Thu 1 Oct: 18% booked', hasIssue: true, href: `${ORIGIN}/events/e1` }],
    },
    customers: {
      headline: '31 new customer records this week, in line with the 4-week average.',
      metrics: [{ label: 'New this week', value: '31', comparison: 'in line with the 4-week average' }, { label: '13 weeks', value: '385' }],
      lists: [],
      signals: [],
      notes: ['Counts new customer records, including imports, walk-ins and texts to new numbers.'],
    },
    marketing: {
      headline: '1 campaign sent this week: 52% opened, 4% clicked.',
      metrics: [{ label: 'Click rate', value: '4.1%', comparison: 'up 38% on the 13-week average' }],
      lists: [],
      signals: [win('marketing.best.c1', 'Friday\'s email had the highest click rate in 13 weeks.', { action: action('Reuse the format of Friday\'s email', '/marketing/campaigns/c1', { impact: 'customer' }) })],
      notes: ['Bookings from email: not measurable yet.'],
    },
    feedback: {
      headline: '2 unresolved comments, the oldest from 1 Aug.',
      metrics: [{ label: 'Unresolved', value: '2' }],
      lists: [{ title: 'Outstanding', items: [{ text: '1 Aug, 2 stars: "Food was cold and we waited an hour" (Jane Doe)', href: `${ORIGIN}/feedback-inbox`, rag: 'red' }] }],
      signals: [issue('feedback.old.f1', 'red', '2-star comment from 1 Aug about cold food is still unresolved after 55 days.', { entity: 'feedback:f1', action: action('Resolve the 2-star food complaint from 1 Aug', '/feedback-inbox', { target: 'list', dueDate: '2026-09-25' }) })],
      notes: [],
    },
    table_bookings: {
      headline: 'Covers are steady over 13 weeks. Tuesday and Wednesday look weak.',
      metrics: [{ label: 'Covers this week', value: '71', comparison: 'up 22% on the 4-week average' }, { label: 'Bookings received', value: '24' }, { label: 'Next 7 days on the books', value: '31 covers', comparison: 'in line with the same point 4 weeks ago' }],
      lists: [{ title: 'Next 7 days', items: [{ text: 'Fri 25 Sep: 4 bookings, 11 covers, 1 party of 15 or more' }] }],
      signals: [issue('table_bookings.weak_days', 'amber', 'Tuesday and Wednesday are at half or less of usual at this point.', { action: action('Concentrate this week\'s promotion on Tuesday and Wednesday', '/table-bookings/boh', { target: 'list', impact: 'customer' }) })],
      notes: [],
    },
    private_hire: {
      headline: '3 private events in the next 14 days; 1 needs action.',
      metrics: [{ label: 'Next 14 days', value: '3 events' }],
      lists: [{ title: 'Next 14 days', items: [{ text: 'Sat 26 Sep, Smith party, 40 guests: deposit outstanding, no contract', href: `${ORIGIN}/private-bookings/p1`, rag: 'red' }] }],
      signals: [
        issue('private_hire.deposit.p1', 'red', 'Smith party (Sat 26 Sep): £250 deposit not paid.', { entity: 'private_booking:p1', action: action('Chase deposit for the Smith party (Sat 26 Sep), £250', '/private-bookings/p1', { dueDate: '2026-09-26', impact: 'money' }) }),
        issue('private_hire.contract.p1', 'amber', 'Smith party (Sat 26 Sep): no contract generated.', { entity: 'private_booking:p1', action: action('Generate the contract for the Smith party', '/private-bookings/p1', { dueDate: '2026-09-26', impact: 'money' }) }),
      ],
      notes: ['Not tracked in the app: menu confirmed, dietary requirements, room set-up.'],
      upcoming: [{ date: '2026-09-26', text: 'Smith party, Sat 26 Sep', hasIssue: true, href: `${ORIGIN}/private-bookings/p1` }],
    },
    parking: {
      headline: 'Parking: no bookings in 13 weeks and none coming up.',
      metrics: [],
      lists: [],
      signals: [],
      notes: [],
    },
    maintenance: {
      headline: '31 open, 4 overdue (worst by 18 days), oldest open for 508 days.',
      metrics: [{ label: 'Open', value: '31' }, { label: 'Overdue', value: '4' }, { label: 'Critical or high', value: '5' }, { label: 'Closed this week', value: '0' }],
      lists: [{ title: 'Critical and high priority', items: [{ text: 'Soil pipe leak, Toilets (Gents), critical, reported 508 days ago, Greene King', href: `${ORIGIN}/maintenance/m1`, rag: 'red' }] }],
      signals: [
        ...many((i) => issue(`maintenance.critical.m1${i}`, 'red', 'Critical: soil pipe leak in the gents, open for 508 days.', { entity: `maintenance:m1${i}`, action: action('Chase Greene King on the soil pipe leak', `/maintenance/m1${i}`, { impact: 'safety' }) })),
        issue('maintenance.overdue', 'amber', '4 items are overdue, the worst by 18 days.', { action: action('Follow up 4 overdue maintenance items', '/maintenance?overdue=true', { target: 'list', impact: 'housekeeping', members: ['Replace bar fridge seal', 'Repaint exterior door', 'Fix garden light', 'Service extractor'] }) }),
      ],
      notes: [],
    },
    employees: {
      headline: '6 staff have no right-to-work record.',
      metrics: [{ label: 'Right-to-work records missing', value: '6' }],
      lists: [{ title: 'By person', items: [{ text: 'Alex Example: no right-to-work record', href: `${ORIGIN}/employees/x1` }] }],
      signals: [issue('employees.rtw_missing', 'red', '6 staff have no right-to-work record.', { action: action('Add right-to-work records for 6 staff', '/employees', { target: 'list', impact: 'safety' }) })],
      notes: [],
    },
    rota: {
      headline: 'Rota published to Sun 4 Oct. 2 open shifts in the next 14 days.',
      metrics: [{ label: 'Open shifts, next 14 days', value: '2' }, { label: 'Accepted by staff', value: '39%' }],
      lists: [],
      signals: [
        issue('rota.open_shifts', 'red', '2 open shifts in the next 14 days.', { action: action('Cover 2 open shifts', '/rota', { target: 'list', impact: 'staffing', dueDate: '2026-09-28', members: ['Mon 28 Sep, bar, 18:00 to 23:00', 'Sat 3 Oct, kitchen, 12:00 to 17:00'] }) }),
        issue('rota.leave.l1', 'amber', 'Holiday request from Sam Example (5 to 9 Oct) has waited 4 days.', { entity: 'leave:l1', action: action('Decide Sam Example\'s holiday request (5 to 9 Oct)', '/rota/leave#leave-l1', { dueDate: '2026-10-05', impact: 'staffing' }) }),
        issue('rota.rejected_by', 'amber', 'Jordan Example rejected 3 shifts this month.', { emailSafe: false }),
      ],
      notes: [],
    },
    checklists: {
      headline: '96% of checks done this week; all misses were bar tasks.',
      metrics: [{ label: 'Completion', value: '96%', comparison: 'in line with the 4-week average' }],
      lists: [{ title: 'People', items: [{ text: 'Amanda Example: 120 done, 4% late' }] }],
      signals: [
        issue('checklists.repeat_missers', 'red', 'Chris Example missed 4 checks this week.', { emailSafe: false, action: action('Review repeated missed checks with the staff involved', '/checklists/manage/problems', { target: 'list', impact: 'safety' }) }),
        issue('checklists.spot_checks', 'amber', '3 spot checks drawn, none recorded.', { action: action('Record this week\'s spot checks', '/checklists/manage/insights', { target: 'list', impact: 'safety' }) }),
      ],
      notes: [],
    },
    invoices: {
      headline: '£8,164 outstanding across 4 invoices; 3 overdue (£5,644).',
      metrics: [{ label: 'Outstanding', value: '£8,164' }, { label: 'Overdue', value: '£5,644' }],
      lists: [],
      signals: [issue('invoices.overdue', 'amber', '3 invoices are overdue, the oldest by 23 days.', { action: action('Chase 3 overdue invoices, £5,644 in total', '/invoices?status=overdue', { target: 'list', impact: 'money', members: ['INV-001 Example Ltd, £2,000, 23 days', 'INV-002 Sample plc, £1,644, 9 days', 'INV-003 Demo Co, £2,000, 2 days'] }) })],
      notes: [],
    },
    cashing_up: {
      headline: '3 of 7 trading days entered. Performance comparison not made: 4 trading days are missing.',
      metrics: [{ label: 'Days entered', value: '3 of 7' }, { label: 'Takings entered', value: '£1,691 over 3 days' }],
      lists: [],
      signals: [issue('cashing_up.missing', 'red', 'Cash-ups missing for Mon 21, Tue 22 and Wed 23 Sep.', { action: action('Enter the missing cash-ups for Mon 21, Tue 22 and Wed 23 Sep', '/cashing-up/daily?date=2026-09-21', { target: 'list', impact: 'money' }) })],
      notes: ['Performance comparison not made: 4 trading days are missing.'],
    },
    short_links: {
      headline: '774 tracked clicks this week; Sunday Lunch took 38%.',
      metrics: [{ label: 'Human clicks', value: '774', comparison: 'up 31% on the 4-week average' }],
      lists: [],
      signals: [win('short_links.share.sunday', 'Sunday Lunch generated 38% of tracked clicks this week.', { action: action('Keep promoting Sunday Lunch', '/short-links/insights', { target: 'list' }) })],
      notes: [],
    },
    recruitment: {
      headline: '39 active applicants; 35 are awaiting first review.',
      metrics: [{ label: 'Awaiting review', value: '35' }, { label: 'Open roles', value: '2' }],
      lists: [{ title: 'Awaiting a decision', items: [{ text: 'Pat Example, interviewed 10 Sep' }] }],
      signals: [
        issue('recruitment.review_backlog', 'amber', '35 applicants are awaiting first review, the oldest for 102 days.', { action: action('Review the recruitment backlog', '/recruitment', { target: 'list', impact: 'staffing' }) }),
        issue('recruitment.outcomes', 'amber', '9 past interviews or trials have no outcome recorded.', { action: action('Record outcomes for 9 past interviews and trials', '/recruitment', { target: 'list', impact: 'staffing' }) }),
      ],
      notes: [],
    },
  }
}

export function buildFixtureReport(options: { notChecked?: SectionKey[]; heavy?: boolean; now?: Date } = {}): InsightsReport {
  const now = options.now ?? new Date('2026-09-25T05:00:00Z')
  const windows = computeWindows(now)
  const data = content(options.heavy ?? false)
  const sections: InsightSection[] = SECTION_KEYS.map((key) => {
    const [title, path] = TITLES[key]
    if (options.notChecked?.includes(key)) {
      return {
        key, title, href: `${ORIGIN}${path}`, status: 'not_checked' as const,
        headline: `Not checked: ${title.toLowerCase()} data could not be loaded.`,
        metrics: [], lists: [], signals: [], notes: ['Open the section in the app to see the current position.'],
        failure: { reason: 'error' as const, elapsedMs: 120 },
      }
    }
    const result = data[key]
    const signals = orderSignals(dedupeByEntity(result.signals))
    return { ...result, signals, key, title, href: `${ORIGIN}${path}`, status: sectionStatusOf(signals) }
  })
  const { actions, moreRedActions } = rankActions(sections, windows.today)
  return {
    generatedAt: now.toISOString(),
    windows,
    sections,
    summary: buildSummary(sections, actions, windows),
    actions,
    moreRedActions,
    notChecked: sections.filter((section) => section.status === 'not_checked').map((section) => section.key),
  }
}

export const FIXTURE_APP_URL = ORIGIN
