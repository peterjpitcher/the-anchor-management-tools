import { STAFF } from '@/lib/brand/palette'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { formatDateInLondon, shiftIsoDate } from '@/lib/dateUtils'
import { TRAINING_MANAGER_TRIGGER_BADGE } from './labels'
import type { ManagerDailyItem, PlannedReminderStep } from './reminders'
import type { ManagerTrigger, StaffReminderStep } from './types'

/**
 * The two training emails (build contract 5.6; spec 8.1 and 8.3). Pure builders: they return
 * subject, text and HTML and send nothing, so every one is rendered with fixture data in a test
 * under London and UTC before it reaches a person.
 *
 * - The staff reminder: one email per person per London day, listing every step due for them
 *   today. A plain staff notice in the Orange Jelly STAFF palette, from Orange Jelly Limited.
 *   Every one says the training is paid working time and to do it on shift or ask for a training
 *   shift, and links to My Training in the staff portal (behind the portal sign-in, so the link
 *   carries no token). It is never copied to the manager mailbox.
 * - The manager email: only the problems the manager has not been told about yet, with links to
 *   each person's Training tab and the Training page in the management app.
 *
 * Dates arrive as London calendar dates (YYYY-MM-DD) and are printed on the London calendar.
 */

export interface TrainingEmail {
  subject: string
  text: string
  html: string
}

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

const SENDER = COMPANY_DETAILS.legalName

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** "Tuesday 3 November" for a London date in the same year as `today`, else with the year. */
export function formatTrainingEmailDate(isoDate: string, today: string): string {
  // Midday UTC is the same calendar date in London in every season, so the zone cannot move it.
  const instant = `${isoDate}T12:00:00Z`
  const year = isoDate.slice(0, 4)
  const dayAndMonth = formatDateInLondon(instant, { weekday: 'long', day: 'numeric', month: 'long' })
  // The year is appended by hand: en-GB adds a comma after the weekday when it formats a year.
  return year === today.slice(0, 4) ? dayAndMonth : `${dayAndMonth} ${year}`
}

function dayWord(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

function firstName(name: string): string {
  const trimmed = name.trim()
  return trimmed.split(/\s+/)[0] || trimmed || 'there'
}

function paragraphHtml(html: string): string {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:${STAFF.text}">${html}</p>`
}

function listHtml(items: string[]): string {
  const lines = items
    .map((item) => `<li style="margin:0 0 8px;font-size:16px;line-height:1.5;color:${STAFF.text}">${item}</li>`)
    .join('\n')
  return `<ul style="margin:0 0 14px;padding-left:20px">\n${lines}\n</ul>`
}

function buttonHtml(label: string, url: string): string {
  return `<p style="margin:22px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:${STAFF.primary};color:${STAFF.primaryFg};font-size:16px;font-weight:bold;text-decoration:none">${escapeHtml(label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:${STAFF.textMuted}">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(url)}</span></p>`
}

function layout(blocks: string[], footer: { contactLine: string }): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:16px;background:${STAFF.surface}">
${blocks.join('\n')}
<p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:${STAFF.textMuted}">${escapeHtml(footer.contactLine)}</p>
<p style="margin:14px 0 0;font-size:16px;line-height:1.5;color:${STAFF.text}">${escapeHtml(SENDER)}</p>
</div>`
}

// ---------------------------------------------------------------------------------------------
// Staff reminder
// ---------------------------------------------------------------------------------------------

/** Which step sets the subject when one email lists several: the most pressing. */
const STEP_URGENCY: Record<StaffReminderStep, number> = {
  overdue: 5,
  weekly: 4,
  due_soon: 3,
  nudge: 2,
  assigned: 1,
}

const STAFF_SUBJECTS: Record<StaffReminderStep, string> = {
  assigned: 'New training for you',
  nudge: 'Reminder: your training',
  due_soon: 'Your training is due soon',
  overdue: 'Your training is overdue',
  weekly: 'Your training is still not done',
}

export const PAID_TIME_LINE =
  'Training is paid working time. Please do it during a shift, or ask your manager for a training shift on the rota.'

export const STAFF_CONTACT_LINE = 'Any questions, ask your manager.'

export interface StaffReminderEmailInput {
  /** First or preferred name, for the greeting. */
  name: string
  /** London date of the send. */
  today: string
  /** Every step due for this person today (at least one). */
  steps: readonly PlannedReminderStep[]
  /** `${appUrl}/portal/training`. */
  portalUrl: string
}

function progressSentence(step: PlannedReminderStep): string {
  const { sectionsPassed, sectionsTotal, currentSectionTitle } = step.progress
  if (sectionsTotal > 0 && sectionsPassed >= sectionsTotal) {
    return 'You have passed every part. You just need to confirm it.'
  }
  if (sectionsPassed <= 0) return 'You have not started it yet.'
  const done = `You have passed ${sectionsPassed} of ${sectionsTotal} parts.`
  return currentSectionTitle ? `${done} Next is "${currentSectionTitle}".` : done
}

/** One line per step, in plain words. */
export function describeStaffStep(step: PlannedReminderStep, today: string): string {
  const due = formatTrainingEmailDate(step.dueOn, today)
  const title = step.courseTitle
  switch (step.step) {
    case 'assigned':
      return `New: ${title}. Please finish it by ${due}.`
    case 'nudge':
      return `${title}: please finish it by ${due}. ${progressSentence(step)}`
    case 'due_soon': {
      const when = step.dueOn === today
        ? 'today'
        : step.dueOn === shiftIsoDate(today, 1) ? `tomorrow, ${due}` : `on ${due}`
      return `${title}: this is due ${when}. ${progressSentence(step)}`
    }
    case 'overdue':
      return `${title}: this was due on ${due} and is now overdue. ${progressSentence(step)}`
    case 'weekly': {
      const late = typeof step.daysOverdue === 'number' && step.daysOverdue > 0 ? ` (${dayWord(step.daysOverdue)} ago)` : ''
      return `${title}: this is still not done. It was due on ${due}${late}. ${progressSentence(step)}`
    }
  }
}

export function buildStaffReminderEmail(input: StaffReminderEmailInput): TrainingEmail {
  if (input.steps.length === 0) {
    throw new Error('A training reminder needs at least one step')
  }
  // Courses in the order they are due, then by title, so the most pressing comes first.
  const steps = [...input.steps].sort(
    (a, b) => a.dueOn.localeCompare(b.dueOn) || a.courseTitle.localeCompare(b.courseTitle, 'en-GB')
  )
  const lead = steps.reduce((top, step) => (STEP_URGENCY[step.step] > STEP_URGENCY[top.step] ? step : top), steps[0])
  const subject = STAFF_SUBJECTS[lead.step]
  const name = firstName(input.name)
  const intro = steps.length === 1 ? 'This is about your training at work:' : 'This is about your training at work. You have:'
  const lines = steps.map((step) => describeStaffStep(step, input.today))
  const how = 'Sign in to the staff portal and open My Training. It works on a phone.'

  const text = [
    `Hi ${name},`,
    '',
    intro,
    '',
    ...lines.map((line) => `- ${line}`),
    '',
    PAID_TIME_LINE,
    '',
    how,
    input.portalUrl,
    '',
    STAFF_CONTACT_LINE,
    '',
    SENDER,
  ].join('\n')

  const html = layout(
    [
      paragraphHtml(`Hi ${escapeHtml(name)},`),
      paragraphHtml(escapeHtml(intro)),
      listHtml(lines.map(escapeHtml)),
      paragraphHtml(`<strong>${escapeHtml(PAID_TIME_LINE)}</strong>`),
      paragraphHtml(escapeHtml(how)),
      buttonHtml('Open My Training', input.portalUrl),
    ],
    { contactLine: STAFF_CONTACT_LINE }
  )

  return { subject, text, html }
}

// ---------------------------------------------------------------------------------------------
// Manager email
// ---------------------------------------------------------------------------------------------

/** The order problems are listed in: the most serious first. */
const TRIGGER_ORDER: readonly ManagerTrigger[] = [
  'essentials_overdue',
  'overdue_7_days',
  'locked',
  'declined',
  'certificate_failed',
  'no_login',
  'undeliverable',
]

/** What to do about each kind of problem. */
const TRIGGER_ACTION: Record<ManagerTrigger, string> = {
  essentials_overdue: 'Make time on their next shift for them to do it.',
  overdue_7_days: 'Make time on a shift for them to do it, or move the due date with a reason.',
  locked: 'Go through the section with them, then unlock it on their Training tab.',
  declined: 'Talk to them about why, then prepare the confirmation again on their Training tab.',
  certificate_failed: 'The app will try again tomorrow. If it still fails, report it as a bug.',
  no_login: 'Give them a staff portal login so they can do their training.',
  undeliverable: 'Check their email address on their record.',
}

export const MANAGER_CONTACT_LINE = 'You get this email only when something new needs you.'

export interface ManagerTrainingEmailInput {
  today: string
  /** New problems only (at least one). */
  items: readonly ManagerDailyItem[]
  /** `${appUrl}/employees/training`. */
  trainingUrl: string
  /** `${appUrl}/employees/<id>?tab=training`. */
  recordUrl: (employeeId: string) => string
}

function managerItemLine(item: ManagerDailyItem, today: string): string {
  const course = item.courseTitle ? `: ${item.courseTitle}` : ''
  const parts: string[] = []
  if (item.dueOn && (item.trigger === 'essentials_overdue' || item.trigger === 'overdue_7_days')) {
    const late = typeof item.daysOverdue === 'number' && item.daysOverdue > 0 ? `, ${dayWord(item.daysOverdue)} overdue` : ''
    parts.push(`due ${formatTrainingEmailDate(item.dueOn, today)}${late}`)
  }
  return `${item.employeeName}${course}${parts.length ? ` (${parts.join('; ')})` : ''}`
}

export function buildManagerTrainingEmail(input: ManagerTrainingEmailInput): TrainingEmail {
  if (input.items.length === 0) {
    throw new Error('The manager training email needs at least one problem')
  }
  const count = input.items.length
  const subject = count === 1 ? 'Training: 1 new problem needs you' : `Training: ${count} new problems need you`
  const groups = TRIGGER_ORDER
    .map((trigger) => ({
      trigger,
      items: input.items
        .filter((item) => item.trigger === trigger)
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'en-GB') || (a.courseTitle ?? '').localeCompare(b.courseTitle ?? '', 'en-GB')),
    }))
    .filter((group) => group.items.length > 0)

  const intro = count === 1
    ? 'One new training problem needs a manager:'
    : `${count} new training problems need a manager:`

  const textBlocks = groups.map((group) => [
    `${TRAINING_MANAGER_TRIGGER_BADGE[group.trigger].label}`,
    ...group.items.map((item) => `- ${managerItemLine(item, input.today)}: ${input.recordUrl(item.employeeId)}`),
    TRIGGER_ACTION[group.trigger],
  ].join('\n'))

  const text = [
    intro,
    '',
    textBlocks.join('\n\n'),
    '',
    'Open the training page:',
    input.trainingUrl,
    '',
    MANAGER_CONTACT_LINE,
  ].join('\n')

  const htmlBlocks = groups.flatMap((group) => [
    paragraphHtml(`<strong>${escapeHtml(TRAINING_MANAGER_TRIGGER_BADGE[group.trigger].label)}</strong>`),
    listHtml(group.items.map((item) =>
      `<a href="${escapeHtml(input.recordUrl(item.employeeId))}" style="color:${STAFF.primary}">${escapeHtml(managerItemLine(item, input.today))}</a>`
    )),
    paragraphHtml(escapeHtml(TRIGGER_ACTION[group.trigger])),
  ])

  const html = layout(
    [paragraphHtml(escapeHtml(intro)), ...htmlBlocks, buttonHtml('Open the training page', input.trainingUrl)],
    { contactLine: MANAGER_CONTACT_LINE }
  )

  return { subject, text, html }
}
