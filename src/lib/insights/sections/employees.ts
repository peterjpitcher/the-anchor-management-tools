import { displayNameWithLegal } from '@/lib/employees/display-name'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { formatCount, formatDateWithYear, formatDayDate, joinWithAnd, plural } from '../format'
import { ragRank } from '../signals'
import { EMPLOYEES } from '../thresholds'
import { addDays, daysBetween, londonDateOf } from '../windows'
import type {
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  Rag,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

/**
 * Employees and compliance (spec 5.9).
 *
 * Current staff (Active, or working their notice) are checked for a right-to-work record,
 * its expiry and follow-up dates, an emergency contact and payroll details. A leaver whose
 * last day has passed is not current: the morning separation cron finalises them.
 *
 * The two onboarding checks (unfinished after the start date, invite expired unused) apply
 * to new starters in the 'Onboarding' status only. The app can resend an invite and finish
 * onboarding only for them, so on Active staff those flags could never clear; Active staff
 * who skipped the form are caught by the record checks above instead.
 *
 * Names are page only (spec decision 13): each check is one signal with a count and a list
 * action on /employees, and the per-person lines sit in a page list linked to each record.
 * Sensitive values are never read: contacts and payroll are fetched as employee ids only.
 */

interface EmployeeRow {
  employee_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  status: string
  onboarding_completed_at: string | null
  employment_start_date: string | null
  employment_end_date: string | null
  first_shift_date: string | null
}

interface RightToWorkRow {
  employee_id: string
  document_expiry_date: string | null
  follow_up_date: string | null
}

interface EmployeeIdRow {
  employee_id: string
}

interface InviteRow {
  id: string
  employee_id: string
  created_at: string
  expires_at: string
  completed_at: string | null
}

type CheckKey =
  | 'no_right_to_work'
  | 'right_to_work_expired'
  | 'right_to_work_expiring_soon'
  | 'right_to_work_expiring'
  | 'right_to_work_follow_up'
  | 'onboarding_incomplete'
  | 'invite_expired'
  | 'no_emergency_contact'
  | 'no_payroll_details'

interface Gap {
  check: CheckKey
  /** Page-only phrase for the person's line, e.g. "no emergency contact". */
  detail: string
  /** The date the gap matters by, where it has one. */
  date?: string
}

interface CheckRule {
  key: CheckKey
  rag: Rag
  /** True when the earliest date among the hits is the action's due date. */
  dated: boolean
  /** Email-safe sentence; `first` is the formatted earliest date for dated checks. */
  text(count: number, first: string): string
  action(count: number, first: string): string
  /** Headline fragment after "including". */
  fragment(count: number): string
}

const EMPLOYEE_COLUMNS = 'employee_id, first_name, last_name, preferred_name, status, onboarding_completed_at, employment_start_date, employment_end_date, first_shift_date'
const NAME_FALLBACK = 'Name not entered yet'

function staff(n: number): string {
  return n === 1 ? '1 member of staff' : `${formatCount(n)} staff`
}

function has(n: number): string {
  return n === 1 ? 'has' : 'have'
}

/** The signal table of spec 5.9, in precedence order (red first). */
function checkRules(): CheckRule[] {
  const soon = EMPLOYEES.rightToWorkRedDays
  const later = EMPLOYEES.rightToWorkAmberDays
  const grace = EMPLOYEES.onboardingGraceDays
  return [
    {
      key: 'no_right_to_work',
      rag: 'red',
      dated: false,
      text: (n) => `${staff(n)} ${has(n)} no right-to-work record.`,
      action: (n) => `Record right-to-work checks for ${staff(n)}`,
      fragment: (n) => `${formatCount(n)} with no right-to-work record`,
    },
    {
      key: 'right_to_work_expired',
      rag: 'red',
      dated: true,
      text: (n, first) => n === 1
        ? `1 right-to-work document expired on ${first}.`
        : `${formatCount(n)} right-to-work documents have expired, the earliest on ${first}.`,
      action: (n) => n === 1
        ? 'Recheck right to work for 1 member of staff whose document has expired'
        : `Recheck right to work for ${formatCount(n)} staff whose documents have expired`,
      fragment: (n) => `${formatCount(n)} whose right to work has expired`,
    },
    {
      key: 'right_to_work_expiring_soon',
      rag: 'red',
      dated: true,
      text: (n, first) => n === 1
        ? `1 right-to-work document expires within ${soon} days, on ${first}.`
        : `${formatCount(n)} right-to-work documents expire within ${soon} days, the first on ${first}.`,
      action: (n, first) => `Recheck right to work for ${staff(n)} before ${first}`,
      fragment: (n) => `${formatCount(n)} whose right to work expires within ${soon} days`,
    },
    {
      key: 'right_to_work_expiring',
      rag: 'amber',
      dated: true,
      text: (n, first) => n === 1
        ? `1 right-to-work document expires within ${later} days, on ${first}.`
        : `${formatCount(n)} right-to-work documents expire within ${later} days, the first on ${first}.`,
      action: (n, first) => n === 1
        ? `Plan a right-to-work recheck for 1 member of staff before ${first}`
        : `Plan right-to-work rechecks for ${formatCount(n)} staff, the first before ${first}`,
      fragment: (n) => `${formatCount(n)} whose right to work expires within ${later} days`,
    },
    {
      key: 'right_to_work_follow_up',
      rag: 'amber',
      dated: true,
      text: (n, first) => n === 1
        ? `1 right-to-work follow-up date has been reached (${first}).`
        : `${formatCount(n)} right-to-work follow-up dates have been reached, the earliest ${first}.`,
      action: (n) => `Complete ${plural(n, 'right-to-work follow-up')}`,
      fragment: (n) => `${formatCount(n)} with a right-to-work follow-up due`,
    },
    {
      key: 'onboarding_incomplete',
      rag: 'amber',
      dated: false,
      text: (n) => `${plural(n, 'new starter')} ${has(n)} not finished onboarding more than ${grace} days after starting.`,
      action: (n) => `Get onboarding finished for ${plural(n, 'new starter')}`,
      fragment: (n) => `${formatCount(n)} who ${has(n)} not finished onboarding`,
    },
    {
      key: 'invite_expired',
      rag: 'amber',
      dated: false,
      text: (n) => `${plural(n, 'onboarding invite')} expired without being used.`,
      action: (n) => `Resend ${plural(n, 'expired onboarding invite')}`,
      fragment: (n) => `${formatCount(n)} with an expired onboarding invite`,
    },
    {
      key: 'no_emergency_contact',
      rag: 'amber',
      dated: false,
      text: (n) => `${staff(n)} ${has(n)} no emergency contact.`,
      action: (n) => n === 1 ? 'Add an emergency contact for 1 member of staff' : `Add emergency contacts for ${formatCount(n)} staff`,
      fragment: (n) => `${formatCount(n)} with no emergency contact`,
    },
    {
      key: 'no_payroll_details',
      rag: 'amber',
      dated: false,
      text: (n) => `${staff(n)} ${has(n)} no payroll details.`,
      action: (n) => `Add payroll details for ${staff(n)}`,
      fragment: (n) => `${formatCount(n)} with no payroll details`,
    },
  ]
}

/** Reads rows for a set of employees, or nothing when the set is empty. */
function readForEmployees<T>(ids: string[], read: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  return ids.length === 0 ? Promise.resolve([]) : read(ids)
}

function worstRag(gaps: Gap[], rules: Map<CheckKey, CheckRule>): Rag {
  return gaps.reduce<Rag>((worst, gap) => {
    const rag = rules.get(gap.check)?.rag ?? 'amber'
    return ragRank(rag) > ragRank(worst) ? rag : worst
  }, 'green')
}

export async function buildEmployeesSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { today } = ctx.windows
  const nowMs = ctx.now.getTime()
  const currentStatuses: readonly string[] = EMPLOYEES.statuses
  const onboardingStatuses: readonly string[] = EMPLOYEES.onboardingStatuses
  // A date this year reads "Thu 1 Oct"; any other year carries the year.
  const label = (isoDate: string): string =>
    isoDate.slice(0, 4) === today.slice(0, 4) ? formatDayDate(isoDate) : formatDateWithYear(isoDate)

  const employees = await fetchAllRows<EmployeeRow>(
    (from, to) => ctx.db
      .from('employees')
      .select(EMPLOYEE_COLUMNS)
      .in('status', [...EMPLOYEES.statuses, ...EMPLOYEES.onboardingStatuses])
      .order('employee_id')
      .range(from, to),
    { label: 'insights employees' },
  )

  const notes = [
    'Not tracked in the app: training and licence expiry, contract documents.',
    'Right-to-work documents without an expiry date are not checked for expiry.',
  ]

  // Someone working their notice whose last day has passed has left. The separation cron
  // finalises them each morning, but in summer it runs after this report, so without this
  // anyone who left on Thursday would still be checked as current staff.
  const isPastLeaver = (row: EmployeeRow): boolean =>
    row.status === 'Started Separation' && Boolean(row.employment_end_date && row.employment_end_date < today)
  const pastLeavers = employees.filter(isPastLeaver).length
  const leaverNote = pastLeavers === 0
    ? null
    : `${plural(pastLeavers, 'leaver')} whose last day has passed ${pastLeavers === 1 ? 'is' : 'are'} left out until their leaving is finalised.`
  const inScope = employees.filter((row) => !isPastLeaver(row))

  const current = inScope.filter((row) => currentStatuses.includes(row.status))
  if (inScope.length === 0) {
    return {
      headline: 'No current staff records to check.',
      metrics: [{ label: 'Current staff', value: '0' }],
      lists: [],
      signals: [],
      notes: [leaverNote ?? 'No employees are marked Active or Started Separation.', ...notes],
    }
  }

  const currentIds = current.map((row) => row.employee_id)
  const unfinishedIds = inScope
    .filter((row) => onboardingStatuses.includes(row.status) && !row.onboarding_completed_at)
    .map((row) => row.employee_id)

  const [rightToWork, contacts, payroll, invites] = await Promise.all([
    readForEmployees(currentIds, (ids) => fetchAllRows<RightToWorkRow>(
      (from, to) => ctx.db
        .from('employee_right_to_work')
        .select('employee_id, document_expiry_date, follow_up_date')
        .in('employee_id', ids)
        .order('employee_id')
        .range(from, to),
      { label: 'insights right to work' },
    )),
    readForEmployees(currentIds, (ids) => fetchAllRows<EmployeeIdRow & { id: string }>(
      (from, to) => ctx.db
        .from('employee_emergency_contacts')
        .select('id, employee_id')
        .in('employee_id', ids)
        .order('id')
        .range(from, to),
      { label: 'insights emergency contacts' },
    )),
    // Payroll details exist when any of the fields payroll needs is set; an empty row counts
    // as none. Only the id comes back, never the NI number or bank details.
    readForEmployees(currentIds, (ids) => fetchAllRows<EmployeeIdRow>(
      (from, to) => ctx.db
        .from('employee_financial_details')
        .select('employee_id')
        .in('employee_id', ids)
        .or('ni_number.not.is.null,bank_account_number.not.is.null,bank_sort_code.not.is.null')
        .order('employee_id')
        .range(from, to),
      { label: 'insights payroll details' },
    )),
    readForEmployees(unfinishedIds, (ids) => fetchAllRows<InviteRow>(
      (from, to) => ctx.db
        .from('employee_invite_tokens')
        .select('id, employee_id, created_at, expires_at, completed_at')
        .eq('invite_type', 'onboarding')
        .in('employee_id', ids)
        .order('id')
        .range(from, to),
      { label: 'insights onboarding invites' },
    )),
  ])

  const rightToWorkBy = new Map(rightToWork.map((row) => [row.employee_id, row]))
  const withContact = new Set(contacts.map((row) => row.employee_id))
  const withPayroll = new Set(payroll.map((row) => row.employee_id))
  // Only the latest invite counts: a newer invite replaces an expired one.
  const latestInvite = new Map<string, InviteRow>()
  for (const invite of invites) {
    const held = latestInvite.get(invite.employee_id)
    const newer = !held
      || Date.parse(invite.created_at) > Date.parse(held.created_at)
      || (Date.parse(invite.created_at) === Date.parse(held.created_at) && invite.id > held.id)
    if (newer) latestInvite.set(invite.employee_id, invite)
  }

  const soonEnd = addDays(today, EMPLOYEES.rightToWorkRedDays)
  const laterEnd = addDays(today, EMPLOYEES.rightToWorkAmberDays)
  const people: Array<{ row: EmployeeRow; newStarter: boolean; gaps: Gap[] }> = []
  let unknownStart = 0

  for (const row of inScope) {
    const gaps: Gap[] = []
    const isCurrent = currentStatuses.includes(row.status)
    const isNewStarter = onboardingStatuses.includes(row.status)

    if (isCurrent) {
      const record = rightToWorkBy.get(row.employee_id)
      if (!record) {
        gaps.push({ check: 'no_right_to_work', detail: 'no right-to-work record' })
      } else {
        const expiry = record.document_expiry_date
        // Someone working their notice who leaves before the document expires needs no recheck.
        const leavesFirst = Boolean(expiry && row.employment_end_date && row.employment_end_date < expiry)
        if (expiry && !leavesFirst) {
          if (expiry < today) {
            gaps.push({ check: 'right_to_work_expired', detail: `right to work expired ${label(expiry)}`, date: expiry })
          } else if (expiry <= soonEnd) {
            gaps.push({ check: 'right_to_work_expiring_soon', detail: `right to work expires ${label(expiry)}`, date: expiry })
          } else if (expiry <= laterEnd) {
            gaps.push({ check: 'right_to_work_expiring', detail: `right to work expires ${label(expiry)}`, date: expiry })
          }
        }
        if (record.follow_up_date && record.follow_up_date <= today) {
          gaps.push({ check: 'right_to_work_follow_up', detail: `right-to-work follow-up due ${label(record.follow_up_date)}`, date: record.follow_up_date })
        }
      }
    }

    if (isNewStarter && !row.onboarding_completed_at) {
      const start = row.employment_start_date ?? row.first_shift_date
      if (!start) {
        unknownStart += 1
      } else if (daysBetween(start, today) > EMPLOYEES.onboardingGraceDays) {
        gaps.push({ check: 'onboarding_incomplete', detail: `onboarding not finished (started ${label(start)})` })
      }
      const invite = latestInvite.get(row.employee_id)
      if (invite && !invite.completed_at && Date.parse(invite.expires_at) <= nowMs) {
        gaps.push({ check: 'invite_expired', detail: `onboarding invite expired ${label(londonDateOf(invite.expires_at))}` })
      }
    }

    if (isCurrent) {
      if (!withContact.has(row.employee_id)) gaps.push({ check: 'no_emergency_contact', detail: 'no emergency contact' })
      if (!withPayroll.has(row.employee_id)) gaps.push({ check: 'no_payroll_details', detail: 'no payroll details' })
    }

    if (gaps.length > 0) people.push({ row, newStarter: isNewStarter, gaps })
  }

  const rules = checkRules()
  const rulesByKey = new Map(rules.map((rule) => [rule.key, rule]))
  const hitsFor = (key: CheckKey): Gap[] => people.flatMap((person) => person.gaps.filter((gap) => gap.check === key))
  const earliest = (gaps: Gap[]): string | undefined =>
    gaps.map((gap) => gap.date).filter((date): date is string => Boolean(date)).sort()[0]

  const signals: InsightSignal[] = []
  const fired: Array<{ rule: CheckRule; count: number }> = []
  for (const rule of rules) {
    const hits = hitsFor(rule.key)
    if (hits.length === 0) continue
    const first = earliest(hits)
    const firstLabel = first ? label(first) : ''
    fired.push({ rule, count: hits.length })
    signals.push({
      key: `employees.${rule.key}`,
      rag: rule.rag,
      kind: 'issue',
      text: rule.text(hits.length, firstLabel),
      emailSafe: true,
      action: {
        text: rule.action(hits.length, firstLabel),
        href: ctx.link('/employees'),
        target: 'list',
        impact: 'staffing',
        ...(rule.dated && first ? { dueDate: first } : {}),
      },
    })
  }

  let headline = 'No employee compliance issues need attention.'
  if (current.length === 0 && people.length === 0) {
    headline = 'No current staff records to check.'
  } else if (fired.length === 1) {
    headline = signals[0].text
  } else if (fired.length > 1) {
    headline = `${staff(people.length)} ${has(people.length)} something missing, including ${fired[0].rule.fragment(fired[0].count)}.`
  }

  const separating = current.filter((row) => row.status === 'Started Separation').length
  const newStarters = inScope.filter((row) => onboardingStatuses.includes(row.status)).length
  const staffContext = [
    separating > 0 ? `including ${formatCount(separating)} working their notice` : null,
    newStarters > 0 ? `plus ${plural(newStarters, 'new starter')} onboarding` : null,
  ].filter((part): part is string => part !== null)
  const expiryHits = [
    ...hitsFor('right_to_work_expired'),
    ...hitsFor('right_to_work_expiring_soon'),
    ...hitsFor('right_to_work_expiring'),
  ]
  const firstExpiry = earliest(expiryHits)
  const followUps = hitsFor('right_to_work_follow_up')
  const firstFollowUp = earliest(followUps)

  const metrics: InsightMetric[] = [
    { label: 'Current staff', value: formatCount(current.length), ...(staffContext.length ? { comparison: staffContext.join(', ') } : {}) },
    { label: 'Staff with something missing', value: formatCount(people.length) },
    { label: 'No right-to-work record', value: formatCount(hitsFor('no_right_to_work').length) },
    {
      label: `Right to work expired or expiring within ${EMPLOYEES.rightToWorkAmberDays} days`,
      value: formatCount(expiryHits.length),
      ...(firstExpiry ? { comparison: `earliest ${label(firstExpiry)}` } : {}),
    },
    {
      label: 'Right-to-work follow-ups due',
      value: formatCount(followUps.length),
      ...(firstFollowUp ? { comparison: `earliest ${label(firstFollowUp)}` } : {}),
    },
    { label: `Onboarding unfinished after ${EMPLOYEES.onboardingGraceDays} days`, value: formatCount(hitsFor('onboarding_incomplete').length) },
    { label: 'Onboarding invites expired unused', value: formatCount(hitsFor('invite_expired').length) },
    { label: 'No emergency contact', value: formatCount(hitsFor('no_emergency_contact').length) },
    { label: 'No payroll details', value: formatCount(hitsFor('no_payroll_details').length) },
  ]

  const items: Array<InsightListItem & { rank: number; name: string }> = people.map((person) => {
    const rag = worstRag(person.gaps, rulesByKey)
    const name = `${displayNameWithLegal(person.row, NAME_FALLBACK)}${person.newStarter ? ' (new starter)' : ''}`
    return {
      text: `${name}: ${joinWithAnd(person.gaps.map((gap) => gap.detail))}`,
      href: ctx.link(`/employees/${encodeURIComponent(person.row.employee_id)}`),
      rag,
      rank: ragRank(rag),
      name,
    }
  })
  items.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, 'en-GB'))
  const lists: InsightList[] = items.length === 0 ? [] : [{
    title: 'Staff with something missing',
    items: items.map(({ text, href, rag }) => ({ text, href, rag })),
  }]

  if (leaverNote) notes.push(leaverNote)
  if (unknownStart > 0) {
    notes.push(`${plural(unknownStart, 'new starter')} ${has(unknownStart)} no start date, so late onboarding cannot be judged.`)
  }

  return { headline, metrics, lists, signals, notes }
}

export const employeesSection: SectionDefinition = {
  key: 'employees',
  title: 'Employees and compliance',
  path: '/employees',
  build: buildEmployeesSection,
}
