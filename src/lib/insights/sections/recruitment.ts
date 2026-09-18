import { fetchAllRows } from '@/lib/supabase/paged-read'
import { compare, describeChange, hasMinimumHistory, weeklyAverage } from '../compare'
import { clip, formatCount, formatDateWithYear, formatDayDate, formatLondonClock, plural } from '../format'
import { mergeSignals } from '../signals'
import { RECRUITMENT } from '../thresholds'
import { addDays, dateRange, daysBetween, isInRange, londonDateOf, rangeInstants } from '../windows'
import type {
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

/**
 * Recruitment (spec 5.15), the last section before Manager actions.
 *
 * Active applicants are applications that are not archived, not duplicates and not in an
 * inactive status (talent pool, rejected, withdrawn, duplicate, hired), as on the recruitment
 * dashboard. Each is put in exactly one stage group, so the group counts add up:
 * offered and on hold by status; awaiting review (new, AI screened); interview or trial
 * booked (a future booking); awaiting a decision (interviewed, trial completed, or a past
 * appointment still scheduled without an outcome); then to arrange (shortlisted, invited to
 * interview, offered a trial, or a scheduled status whose booking was cancelled or archived).
 *
 * Candidate names are page only (spec decision 13): a signal that names a candidate is not
 * email safe, and every action says which role and date instead. The app has no page per
 * application, so every link is the /recruitment list.
 *
 * Past appointments without an outcome are an issue for active applicants only. Those left on
 * candidates already hired or rejected are counted as a page-only information line.
 */

type Stage = 'review' | 'to_arrange' | 'booked' | 'decision' | 'offered' | 'on_hold'
type AppointmentKind = 'interview' | 'trial shift'

const REVIEW_STATUSES: readonly string[] = ['new', 'ai_screened']
const TO_ARRANGE_STATUSES: readonly string[] = ['shortlisted', 'interview_invited', 'trial_offered']
const BOOKED_STATUSES: readonly string[] = ['interview_scheduled', 'trial_scheduled']
const DECISION_STATUSES: readonly string[] = ['interviewed', 'trial_completed']
const DUPLICATE_STATUS = 'declined_duplicate'
const NAME_FALLBACK = 'Unnamed candidate'
const LIST_PATH = '/recruitment'

const TO_ARRANGE_WORDS: Record<string, string> = {
  shortlisted: 'shortlisted, no interview arranged',
  interview_invited: 'invited to interview, nothing booked',
  trial_offered: 'offered a trial shift, nothing booked',
  interview_scheduled: 'marked interview scheduled, but nothing booked',
  trial_scheduled: 'marked trial scheduled, but nothing booked',
}

interface NameEmbed {
  first_name: string | null
  last_name: string | null
}

interface TitleEmbed {
  title: string | null
}

interface ApplicationRow {
  id: string
  status: string
  job_posting_id: string | null
  created_at: string
  updated_at: string | null
  candidate: NameEmbed | NameEmbed[] | null
  job_posting: TitleEmbed | TitleEmbed[] | null
}

interface PostingRow {
  id: string
  title: string | null
  opened_at: string | null
  application_closing_date: string | null
}

interface ReceivedRow {
  id: string
  created_at: string
  is_general: boolean | null
}

interface AppointmentRow {
  id: string
  application_id: string
  type: string
  status: string
  scheduled_start: string
  scheduled_end: string
  outcome: string | null
}

interface StatusEventRow {
  id: string
  application_id: string
  to_status: string
  created_at: string
}

interface Applicant {
  id: string
  status: string
  /** Page only. */
  name: string
  /** Clipped role title; null for a general application. */
  role: string | null
  postingId: string | null
  appliedOn: string
  stage: Stage | null
  /** Earliest future booking still scheduled. */
  next: AppointmentRow | null
  /** Past appointments still scheduled with no outcome, earliest first. */
  unrecorded: AppointmentRow[]
  /** Awaiting a decision only: the London date of the interview or trial. */
  waitStart: string | null
  waitKind: AppointmentKind
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function candidateName(row: ApplicationRow): string {
  const candidate = first(row.candidate)
  const name = [candidate?.first_name, candidate?.last_name]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return name || NAME_FALLBACK
}

function roleTitle(value: string | null | undefined): string | null {
  const title = value?.trim()
  return title ? clip(title, RECRUITMENT.titleChars) : null
}

function kindOf(type: string): AppointmentKind {
  return type === 'trial_shift' ? 'trial shift' : 'interview'
}

/** "Thu 2 Jul", with the year once the date is more than about six months away. */
function dayLabel(isoDate: string, today: string): string {
  return Math.abs(daysBetween(today, isoDate)) > 180 ? formatDateWithYear(isoDate) : formatDayDate(isoDate)
}

/** "Jane Smith (Bar staff)" or "Jane Smith (general application)". Page only. */
function who(applicant: Applicant): string {
  return `${applicant.name} (${applicant.role ?? 'general application'})`
}

/** "the Bar staff" or "the general", for email-safe action text. */
function theRole(applicant: Applicant): string {
  return applicant.role ? `the ${applicant.role}` : 'the general'
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "no open roles" or "2 open roles". */
function countOf(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 0 ? `no ${pluralForm}` : plural(n, singular, pluralForm)
}

function stageOf(status: string, hasFuture: boolean, hasUnrecorded: boolean): Stage | null {
  if (status === 'offered') return 'offered'
  if (status === 'on_hold') return 'on_hold'
  if (REVIEW_STATUSES.includes(status)) return 'review'
  if (hasFuture) return 'booked'
  if (DECISION_STATUSES.includes(status) || hasUnrecorded) return 'decision'
  // A scheduled status with nothing booked: the booking was cancelled or archived (neither
  // changes the application status), so the interview or trial needs arranging again.
  if (BOOKED_STATUSES.includes(status) || TO_ARRANGE_STATUSES.includes(status)) return 'to_arrange'
  return null
}

async function readActiveApplications(ctx: SectionContext): Promise<ApplicationRow[]> {
  return fetchAllRows<ApplicationRow>(
    (from, to) => ctx.db
      .from('recruitment_applications')
      .select('id, status, job_posting_id, created_at, updated_at, candidate:recruitment_candidates(first_name, last_name), job_posting:recruitment_job_postings(title)')
      .is('archived_at', null)
      .is('duplicate_of_application_id', null)
      .not('status', 'in', `(${RECRUITMENT.inactiveStatuses.join(',')})`)
      .order('id')
      .range(from, to),
    { label: 'insights recruitment applications' },
  )
}

async function readOpenPostings(ctx: SectionContext): Promise<PostingRow[]> {
  return fetchAllRows<PostingRow>(
    (from, to) => ctx.db
      .from('recruitment_job_postings')
      .select('id, title, opened_at, application_closing_date')
      .eq('status', 'open')
      .order('id')
      .range(from, to),
    { label: 'insights recruitment postings' },
  )
}

/**
 * Applications received from the start of the 4-week baseline to the end of this week.
 * Received counts ignore later status, but duplicates are not new applications.
 */
async function readReceived(ctx: SectionContext): Promise<ReceivedRow[]> {
  const { from: start, toExclusive } = rangeInstants(dateRange(ctx.windows.previous4Weeks.start, ctx.windows.thisWeek.end))
  return fetchAllRows<ReceivedRow>(
    (from, to) => ctx.db
      .from('recruitment_applications')
      .select('id, created_at, is_general')
      .gte('created_at', start)
      .lt('created_at', toExclusive)
      .is('duplicate_of_application_id', null)
      .neq('status', DUPLICATE_STATUS)
      .order('id')
      .range(from, to),
    { label: 'insights recruitment received' },
  )
}

async function readAppointments(ctx: SectionContext, applicationIds: string[]): Promise<AppointmentRow[]> {
  const rows: AppointmentRow[] = []
  for (let start = 0; start < applicationIds.length; start += RECRUITMENT.idLookupChunk) {
    const chunk = applicationIds.slice(start, start + RECRUITMENT.idLookupChunk)
    rows.push(...await fetchAllRows<AppointmentRow>(
      (from, to) => ctx.db
        .from('recruitment_candidate_appointments')
        .select('id, application_id, type, status, scheduled_start, scheduled_end, outcome')
        .in('application_id', chunk)
        .is('archived_at', null)
        .in('status', ['scheduled', 'completed'])
        .order('id')
        .range(from, to),
      { label: 'insights recruitment appointments' },
    ))
  }
  return rows
}

/** Every past appointment still scheduled with no outcome, whoever it belongs to. */
async function countUnrecorded(ctx: SectionContext): Promise<number> {
  const { count, error } = await ctx.db
    .from('recruitment_candidate_appointments')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null)
    .eq('status', 'scheduled')
    .is('outcome', null)
    .lte('scheduled_end', ctx.now.toISOString())
  if (error) throw new Error(`insights recruitment unrecorded count failed: ${error.message}`)
  if (count === null || count === undefined) throw new Error('insights recruitment unrecorded count returned no count')
  return count
}

async function readDecisionEvents(ctx: SectionContext, applicationIds: string[]): Promise<StatusEventRow[]> {
  const rows: StatusEventRow[] = []
  for (let start = 0; start < applicationIds.length; start += RECRUITMENT.idLookupChunk) {
    const chunk = applicationIds.slice(start, start + RECRUITMENT.idLookupChunk)
    rows.push(...await fetchAllRows<StatusEventRow>(
      (from, to) => ctx.db
        .from('recruitment_application_status_events')
        .select('id, application_id, to_status, created_at')
        .in('application_id', chunk)
        .in('to_status', [...DECISION_STATUSES])
        .order('id')
        .range(from, to),
      { label: 'insights recruitment status events' },
    ))
  }
  return rows
}

function byStart(a: AppointmentRow, b: AppointmentRow): number {
  return Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start) || a.id.localeCompare(b.id)
}

export async function buildRecruitmentSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { today, thisWeek, previous4Weeks, next7 } = ctx.windows
  const nowMs = ctx.now.getTime()

  const [applicationRows, postings, received, unrecordedTotal] = await Promise.all([
    readActiveApplications(ctx),
    readOpenPostings(ctx),
    readReceived(ctx),
    countUnrecorded(ctx),
  ])
  const appointments = await readAppointments(ctx, applicationRows.map((row) => row.id))

  const byApplication = new Map<string, AppointmentRow[]>()
  for (const appointment of appointments) {
    byApplication.set(appointment.application_id, [...(byApplication.get(appointment.application_id) ?? []), appointment])
  }
  const ended = (appointment: AppointmentRow): boolean => Date.parse(appointment.scheduled_end) <= nowMs

  const applicants: Applicant[] = applicationRows.map((row) => {
    const own = [...(byApplication.get(row.id) ?? [])].sort(byStart)
    const scheduled = own.filter((appointment) => appointment.status === 'scheduled')
    const next = scheduled.find((appointment) => !ended(appointment)) ?? null
    const unrecorded = scheduled.filter((appointment) => ended(appointment) && appointment.outcome === null)
    return {
      id: row.id,
      status: row.status,
      name: candidateName(row),
      role: roleTitle(first(row.job_posting)?.title),
      postingId: row.job_posting_id,
      appliedOn: londonDateOf(row.created_at),
      stage: stageOf(row.status, next !== null, unrecorded.length > 0),
      next,
      unrecorded,
      waitStart: null,
      waitKind: row.status === 'trial_completed' ? 'trial shift' : 'interview',
    }
  })

  // When the decision wait began: the latest interview or trial that took place, else the
  // day the application moved into its decision status, else its last update.
  const decisions = applicants.filter((applicant) => applicant.stage === 'decision')
  const needEvents: Applicant[] = []
  for (const applicant of decisions) {
    const held = (byApplication.get(applicant.id) ?? [])
      .filter((appointment) => appointment.status === 'completed' || (ended(appointment) && appointment.outcome === null))
      .sort(byStart)
    const latest = held[held.length - 1]
    if (latest) {
      applicant.waitStart = londonDateOf(latest.scheduled_start)
      applicant.waitKind = kindOf(latest.type)
    } else {
      needEvents.push(applicant)
    }
  }
  if (needEvents.length > 0) {
    const events = await readDecisionEvents(ctx, needEvents.map((applicant) => applicant.id))
    for (const applicant of needEvents) {
      const entered = events
        .filter((event) => event.application_id === applicant.id && event.to_status === applicant.status)
        .map((event) => event.created_at)
        .sort((a, b) => Date.parse(a) - Date.parse(b))
      const row = applicationRows.find((candidate) => candidate.id === applicant.id)
      const fallback = row?.updated_at ?? row?.created_at ?? null
      const from = entered[entered.length - 1] ?? fallback
      applicant.waitStart = from ? londonDateOf(from) : null
    }
  }

  const inStage = (stage: Stage): Applicant[] => applicants.filter((applicant) => applicant.stage === stage)
  const waitDays = (applicant: Applicant): number => (applicant.waitStart ? daysBetween(applicant.waitStart, today) : 0)
  const reviewDays = (applicant: Applicant): number => daysBetween(applicant.appliedOn, today)

  const review = inStage('review').sort((a, b) => a.appliedOn.localeCompare(b.appliedOn) || a.id.localeCompare(b.id))
  const toArrange = inStage('to_arrange').sort((a, b) => a.appliedOn.localeCompare(b.appliedOn) || a.id.localeCompare(b.id))
  const booked = inStage('booked')
  const awaitingDecision = decisions.sort((a, b) => waitDays(b) - waitDays(a) || a.id.localeCompare(b.id))
  const offered = inStage('offered')
  const onHold = inStage('on_hold')
  const ungrouped = applicants.filter((applicant) => applicant.stage === null)

  const decisionOverdue = awaitingDecision.filter((applicant) => applicant.waitStart !== null && waitDays(applicant) > RECRUITMENT.decisionRedDays)
  const reviewOverdue = review.filter((applicant) => reviewDays(applicant) > RECRUITMENT.reviewAmberDays)
  const withUnrecorded = applicants
    .filter((applicant) => applicant.unrecorded.length > 0)
    .sort((a, b) => byStart(a.unrecorded[0], b.unrecorded[0]))
  const activeUnrecorded = withUnrecorded.reduce((total, applicant) => total + applicant.unrecorded.length, 0)
  const inactiveUnrecorded = Math.max(0, unrecordedTotal - activeUnrecorded)

  const activeByPosting = new Map<string, number>()
  for (const applicant of applicants) {
    if (applicant.postingId) activeByPosting.set(applicant.postingId, (activeByPosting.get(applicant.postingId) ?? 0) + 1)
  }
  const roles = postings
    .map((posting) => ({
      id: posting.id,
      title: roleTitle(posting.title) ?? 'Untitled role',
      openedOn: posting.opened_at ? londonDateOf(posting.opened_at) : null,
      closingDate: posting.application_closing_date ? posting.application_closing_date.slice(0, 10) : null,
      active: activeByPosting.get(posting.id) ?? 0,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'en-GB') || a.id.localeCompare(b.id))
  const emptyRoles = roles.filter((role) => role.active === 0)

  const upcoming = applicants
    .flatMap((applicant) => (byApplication.get(applicant.id) ?? [])
      .filter((appointment) => appointment.status === 'scheduled' && !ended(appointment) && isInRange(londonDateOf(appointment.scheduled_start), next7))
      .map((appointment) => ({ applicant, appointment })))
    .sort((a, b) => byStart(a.appointment, b.appointment))

  // New applications this week against the 4-week weekly average.
  const receivedThisWeek = received.filter((row) => isInRange(londonDateOf(row.created_at), thisWeek))
  const receivedBefore = received.filter((row) => isInRange(londonDateOf(row.created_at), previous4Weeks))
  const generalThisWeek = receivedThisWeek.filter((row) => row.is_general === true).length
  const enoughHistory = hasMinimumHistory(RECRUITMENT.collectionStart, previous4Weeks.start)
  const fourWeekAverage = enoughHistory ? weeklyAverage(receivedBefore.length, previous4Weeks) : null
  const newComparison = compare(receivedThisWeek.length, fourWeekAverage, RECRUITMENT.newApplicationsFloor)

  // Signals, in the order of the spec's signal table (red first, then the ambers in order),
  // so ties between rules for one application keep the earlier rule's action (spec 4.5).
  const decisionSignals = decisionOverdue.map((applicant): InsightSignal => {
    const start = applicant.waitStart as string
    const days = plural(waitDays(applicant), 'day')
    return {
      key: `recruitment.decision_overdue.${applicant.id}`,
      entity: `application:${applicant.id}`,
      rag: 'red',
      kind: 'issue',
      text: `${who(applicant)} has waited ${days} for a decision since the ${applicant.waitKind} on ${dayLabel(start, today)}.`,
      emailSafe: false,
      action: {
        text: `Decide on ${theRole(applicant)} applicant after the ${applicant.waitKind} on ${dayLabel(start, today)}, waiting ${days}`,
        href: ctx.link(LIST_PATH),
        target: 'list',
        dueDate: addDays(start, RECRUITMENT.decisionRedDays),
        impact: 'staffing',
      },
    }
  })
  const longestWait = decisionOverdue.length ? waitDays(decisionOverdue[0]) : 0
  const mergedDecisions = mergeSignals(decisionSignals, {
    above: RECRUITMENT.mergeAbove,
    key: 'recruitment.decisions_overdue',
    rag: 'red',
    text: (count) => `${plural(count, 'candidate')} have waited more than ${RECRUITMENT.decisionRedDays} days for a decision after an interview or trial, the longest ${plural(longestWait, 'day')}.`,
    action: {
      text: `Decide on ${plural(decisionOverdue.length, 'candidate')} waiting more than ${RECRUITMENT.decisionRedDays} days after an interview or trial`,
      href: ctx.link(LIST_PATH),
      impact: 'staffing',
    },
  })

  // A candidate already waiting too long for a decision keeps the decision as its one action;
  // the missing outcome stays as a supporting line (spec 4.5).
  const decisionIds = new Set(decisionOverdue.map((applicant) => applicant.id))
  const outcomeSignals = withUnrecorded.map((applicant): InsightSignal => {
    const latest = applicant.unrecorded[applicant.unrecorded.length - 1]
    const day = dayLabel(londonDateOf(latest.scheduled_start), today)
    const several = applicant.unrecorded.length > 1
    const signal: InsightSignal = {
      key: `recruitment.no_outcome.${applicant.id}`,
      entity: `application:${applicant.id}`,
      rag: 'amber',
      kind: 'issue',
      text: several
        ? `${who(applicant)} has no outcome recorded for ${plural(applicant.unrecorded.length, 'past interview or trial', 'past interviews or trials')}, the latest on ${day}.`
        : `${who(applicant)} has no outcome recorded for the ${kindOf(latest.type)} on ${day}.`,
      emailSafe: false,
    }
    if (decisionIds.has(applicant.id)) return signal
    return {
      ...signal,
      action: {
        text: several
          ? `Record the outcomes of ${plural(applicant.unrecorded.length, 'past interview or trial', 'past interviews or trials')} for ${theRole(applicant)} applicant, the latest on ${day}`
          : applicant.role
            ? `Record the outcome of the ${applicant.role} ${kindOf(latest.type)} on ${day}`
            : `Record the outcome of the ${kindOf(latest.type)} on ${day} for a general application`,
        href: ctx.link(LIST_PATH),
        target: 'list',
        impact: 'housekeeping',
      },
    }
  })
  const supportingOutcomes = outcomeSignals.filter((signal) => !signal.action)
  const actionableOutcomes = outcomeSignals.filter((signal) => signal.action)
  const mergedOutcomes = mergeSignals(actionableOutcomes, {
    above: RECRUITMENT.mergeAbove,
    key: 'recruitment.no_outcomes',
    rag: 'amber',
    text: (count) => `${plural(count, 'candidate')} have a past interview or trial with no outcome recorded.`,
    action: {
      text: `Record the outcomes of past interviews or trials for ${plural(actionableOutcomes.length, 'candidate')}`,
      href: ctx.link(LIST_PATH),
      impact: 'housekeeping',
    },
  })

  const reviewSignals = reviewOverdue.map((applicant): InsightSignal => {
    const days = plural(reviewDays(applicant), 'day')
    const applied = dayLabel(applicant.appliedOn, today)
    return {
      key: `recruitment.review_overdue.${applicant.id}`,
      entity: `application:${applicant.id}`,
      rag: 'amber',
      kind: 'issue',
      text: `${who(applicant)} applied on ${applied} and has waited ${days} for a review.`,
      emailSafe: false,
      action: {
        text: `Review ${theRole(applicant)} application received ${applied}, waiting ${days}`,
        href: ctx.link(LIST_PATH),
        target: 'list',
        dueDate: addDays(applicant.appliedOn, RECRUITMENT.reviewAmberDays),
        impact: 'staffing',
      },
    }
  })
  const oldestReview = review.length ? reviewDays(review[0]) : 0
  const mergedReviews = mergeSignals(reviewSignals, {
    above: RECRUITMENT.mergeAbove,
    key: 'recruitment.reviews_overdue',
    rag: 'amber',
    text: (count) => `${plural(count, 'application')} have waited more than ${RECRUITMENT.reviewAmberDays} days for a review, the oldest ${plural(oldestReview, 'day')}.`,
    action: {
      text: `Review ${plural(reviewOverdue.length, 'application')} waiting more than ${RECRUITMENT.reviewAmberDays} days`,
      href: ctx.link(LIST_PATH),
      impact: 'staffing',
    },
  })

  const roleSignals = emptyRoles.map((role): InsightSignal => ({
    key: `recruitment.role_no_applicants.${role.id}`,
    entity: `job_posting:${role.id}`,
    rag: 'amber',
    kind: 'issue',
    text: role.openedOn
      ? `The ${role.title} role has been open since ${dayLabel(role.openedOn, today)} with no active applicants.`
      : `The ${role.title} role is open with no active applicants.`,
    emailSafe: true,
    action: {
      text: `Advertise or close the ${role.title} role, which has no active applicants`,
      href: ctx.link(LIST_PATH),
      target: 'list',
      impact: 'staffing',
    },
  }))
  const mergedRoles = mergeSignals(roleSignals, {
    above: RECRUITMENT.mergeAbove,
    key: 'recruitment.roles_no_applicants',
    rag: 'amber',
    text: (count) => `${plural(count, 'open role')} have no active applicants.`,
    action: {
      text: `Advertise or close ${plural(emptyRoles.length, 'open role')} with no active applicants`,
      href: ctx.link(LIST_PATH),
      impact: 'staffing',
    },
  })

  const infoSignals: InsightSignal[] = inactiveUnrecorded > 0 ? [{
    key: 'recruitment.inactive_no_outcome',
    rag: 'green',
    kind: 'info',
    text: `${plural(inactiveUnrecorded, 'past interview or trial', 'past interviews or trials')} for candidates no longer active ${inactiveUnrecorded === 1 ? 'has' : 'have'} no outcome recorded.`,
    emailSafe: true,
  }] : []

  const signals: InsightSignal[] = [
    ...mergedDecisions,
    ...supportingOutcomes,
    ...mergedOutcomes,
    ...mergedReviews,
    ...mergedRoles,
    ...infoSignals,
  ]

  // Figures, most important first; the email shows the first four.
  const averageShown = fourWeekAverage !== null && ['up', 'down', 'steady'].includes(newComparison.kind)
  const newApplicationsComparison = [
    generalThisWeek > 0 ? `including ${plural(generalThisWeek, 'general application')}` : null,
    fourWeekAverage === null
      ? 'not enough history yet'
      : `${describeChange(newComparison, 'the 4-week average')}${averageShown ? ` (${formatCount(fourWeekAverage)} a week)` : ''}`,
  ].filter((part): part is string => part !== null).join('; ')

  const firstUpcoming = upcoming[0]
  const metrics: InsightMetric[] = [
    {
      label: 'Open roles',
      value: formatCount(roles.length),
      ...(emptyRoles.length ? { comparison: `${formatCount(emptyRoles.length)} with no active applicants` } : {}),
    },
    { label: 'New applications this week', value: formatCount(receivedThisWeek.length), comparison: newApplicationsComparison },
    {
      label: 'Awaiting review',
      value: formatCount(review.length),
      ...(review.length
        ? { comparison: `oldest ${plural(oldestReview, 'day')}${reviewOverdue.length ? `, ${formatCount(reviewOverdue.length)} waiting more than ${RECRUITMENT.reviewAmberDays} days` : ''}` }
        : {}),
    },
    {
      label: 'Awaiting a decision',
      value: formatCount(awaitingDecision.length),
      ...(awaitingDecision.length
        ? { comparison: decisionOverdue.length ? `${formatCount(decisionOverdue.length)} waiting more than ${RECRUITMENT.decisionRedDays} days` : `none waiting more than ${RECRUITMENT.decisionRedDays} days` }
        : {}),
    },
    {
      label: 'Interviews and trials, next 7 days',
      value: formatCount(upcoming.length),
      ...(firstUpcoming ? { comparison: `first ${formatDayDate(londonDateOf(firstUpcoming.appointment.scheduled_start))}` } : {}),
    },
    { label: 'Interview or trial to arrange', value: formatCount(toArrange.length) },
    { label: 'Interview or trial booked', value: formatCount(booked.length) },
    { label: 'Offered', value: formatCount(offered.length) },
    { label: 'On hold', value: formatCount(onHold.length) },
    { label: 'Active applicants', value: formatCount(applicants.length) },
  ]

  // Page-only lists: these name candidates.
  const link = ctx.link(LIST_PATH)
  const decisionItems = awaitingDecision.map((applicant): InsightListItem => {
    const since = applicant.waitStart
      ? `${applicant.waitKind} on ${dayLabel(applicant.waitStart, today)}, waiting ${plural(waitDays(applicant), 'day')}`
      : 'waiting for a decision'
    const tail = applicant.unrecorded.length ? ', no outcome recorded' : ''
    const rag = decisionIds.has(applicant.id) ? 'red' : applicant.unrecorded.length ? 'amber' : undefined
    return { text: `${who(applicant)}: ${since}${tail}.`, href: link, ...(rag ? { rag } : {}) }
  })
  const reviewItems = review.map((applicant): InsightListItem => ({
    text: `${who(applicant)}: applied ${dayLabel(applicant.appliedOn, today)}, ${plural(reviewDays(applicant), 'day')} ago${applicant.status === 'ai_screened' ? ', AI screened' : ''}.`,
    href: link,
    ...(reviewDays(applicant) > RECRUITMENT.reviewAmberDays ? { rag: 'amber' as const } : {}),
  }))
  const arrangeItems = toArrange.map((applicant): InsightListItem => ({
    text: `${who(applicant)}: ${TO_ARRANGE_WORDS[applicant.status] ?? 'nothing booked'}.`,
    href: link,
  }))
  const upcomingItems = upcoming.map(({ applicant, appointment }): InsightListItem => ({
    text: `${formatDayDate(londonDateOf(appointment.scheduled_start))} ${formatLondonClock(new Date(appointment.scheduled_start))}, ${kindOf(appointment.type)}: ${who(applicant)}.`,
    href: link,
  }))
  const roleItems = roles.map((role): InsightListItem => {
    const since = role.openedOn ? `, open since ${dayLabel(role.openedOn, today)}` : ''
    const closing = role.closingDate && role.closingDate < today ? `; the closing date (${dayLabel(role.closingDate, today)}) has passed` : ''
    return {
      text: `${role.title}: ${countOf(role.active, 'active applicant')}${since}${closing}.`,
      href: link,
      ...(role.active === 0 ? { rag: 'amber' as const } : {}),
    }
  })
  const simple = (list: Applicant[]): InsightListItem[] => list.map((applicant): InsightListItem => ({ text: `${who(applicant)}.`, href: link }))

  const lists: InsightList[] = [
    { title: 'Open roles', items: roleItems, emptyText: 'No open roles.' },
    { title: 'Awaiting a decision', items: decisionItems },
    { title: 'Awaiting review', items: reviewItems },
    { title: 'Interviews and trials in the next 7 days', items: upcomingItems, emptyText: 'None booked.' },
    { title: 'Interview or trial to arrange', items: arrangeItems },
    { title: 'Offered', items: simple(offered) },
    { title: 'On hold', items: simple(onHold) },
  ]

  const notes: string[] = []
  if (!enoughHistory) {
    notes.push(`Applications start on ${formatDateWithYear(RECRUITMENT.collectionStart)}, so there is not enough history yet to compare new applications with the 4-week average.`)
  }
  if (ungrouped.length > 0) {
    notes.push(`${plural(ungrouped.length, 'active applicant')} ${ungrouped.length === 1 ? 'has' : 'have'} a status the report does not recognise, so ${ungrouped.length === 1 ? 'it is' : 'they are'} counted as active but not in a stage.`)
  }

  const stages = [
    review.length ? `${formatCount(review.length)} awaiting review (oldest ${plural(oldestReview, 'day')})` : null,
    awaitingDecision.length ? `${formatCount(awaitingDecision.length)} awaiting a decision` : null,
    upcoming.length ? `${plural(upcoming.length, 'interview or trial', 'interviews or trials')} in the next 7 days` : null,
  ].filter((part): part is string => part !== null)
  const opening = `${capitalise(countOf(roles.length, 'open role'))} and ${countOf(applicants.length, 'active applicant')}`
  const newLine = receivedThisWeek.length
    ? `${plural(receivedThisWeek.length, 'new application')} this week.`
    : 'No new applications this week.'
  const headline = `${opening}${stages.length ? `: ${stages.join(', ')}` : ''}. ${newLine}`

  return { headline, metrics, lists, signals, notes }
}

export const recruitmentSection: SectionDefinition = {
  key: 'recruitment',
  title: 'Recruitment',
  path: '/recruitment',
  build: buildRecruitmentSection,
}
