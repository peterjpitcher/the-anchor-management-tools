import { sendEmail } from '@/lib/email/emailService'
import { currentEmailSuspensionReason, type EmailSuspensionReason } from '@/lib/email/suspension'
import { redactPii } from '@/lib/cron/alerting'
import { createRunDeadline, type RunDeadlineSummary } from '@/lib/cron/run-deadline'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { getAppUrl } from '@/lib/env'
import { TrainingService } from '@/services/training'
import { buildManagerTrainingEmail, buildStaffReminderEmail } from './emails'
import {
  managerDayClaimKey,
  noLoginClaimKey,
  planManagerDaily,
  planStaffReminders,
  undeliverableClaimKey,
  type ManagerDailyItem,
  type PlannedStaffEmail,
} from './reminders'
import { readTrainingEmailsSetting, type TrainingEmailsSetting } from './settings'
import { onTrainingSigningCompleted, onTrainingSigningDeclined, prepareTrainingCertificate } from './signing'
import { SYSTEM_ACTOR, type SyncResult } from './types'

/**
 * The staff training daily job (build contract 5.6; spec 8.4), run by
 * /api/cron/training-daily at 09:00 UTC. Four stages, each in its own error boundary so one
 * failing stage never stops the others:
 *
 *   1. sweep: `syncAssignments` for everyone (new cycles, refreshers, redo cycles, leavers);
 *   2. finalise: records any training signing document that completed or was declined while the
 *      record did not catch up, then retries every certificate pack that could not be prepared;
 *   3. staff reminders: one email per person per London day listing every step due;
 *   4. manager email: at most one a day, and only with problems not told before.
 *
 * Stages 3 and 4 run only while `training_emails_enabled` is on (off by default). With it off,
 * or unreadable, they read nothing and send nothing.
 *
 * THE LEDGER IS THE IDEMPOTENCY. Every step, the per-person day cap, the manager day and every
 * manager problem has its own `training_reminders` claim, inserted BEFORE the send; a held claim
 * means it was done. After the send:
 *   - accepted: every claim is kept and marked sent;
 *   - uncertain (the provider may have it, or the send threw): every claim is kept and marked
 *     uncertain, and the run reports it. It is never resent: a person has to check;
 *   - suspended by a kill switch, or definitely refused: every claim is released (deleted) so the
 *     next run tries again, and no later email this run is attempted once a kill switch is seen.
 * A definite refusal is about the recipient (`refused`: the address is on the suppression list or
 * the provider rejected it) or about the provider (`provider_refused`: a rate limit, a revoked or
 * wrong key, an unverified sender, no provider configured). Only a recipient refusal puts that
 * person in today's manager email as undeliverable. A provider refusal says nothing about the
 * address, so it raises one run-level error line instead, and one that refuses every send (rate
 * limit, key, configuration) stops the run's remaining emails, the manager email included.
 */

/** Stages, as named in the run record. */
const TRAINING_DAILY_STAGES = ['settings', 'sweep', 'finalise', 'certificates', 'staff_reminders', 'manager_email'] as const
type TrainingDailyStage = (typeof TRAINING_DAILY_STAGES)[number]

/** The run stops starting certificate packs (each may start a browser) after this long. */
const CERTIFICATE_BUDGET_MS = 150_000
/** The run stops starting emails after this long, well inside the route's 300 seconds. */
const SEND_BUDGET_MS = 250_000

/** The shared manager mailbox, as the other manager notices use. */
function trainingManagerEmail(): string {
  return (process.env.MANAGER_EMAIL || 'manager@the-anchor.pub').trim()
}

type SendResult = Awaited<ReturnType<typeof sendEmail>>
export type SendClass = 'sent' | 'uncertain' | 'suspended' | 'refused' | 'provider_refused'

/**
 * The parts of a send result the classifier reads. `code` is read as any string so the recipient
 * codes (`recipient_suppressed`, `recipient_rejected`), the set-up codes (`email_not_configured`,
 * `email_sign_in_failed`) and `providerStatus` are understood once `sendEmail` gives them. A result
 * without them is read safely: its refusal counts as the provider's, so nobody is wrongly called
 * undeliverable, and a suppressed address is still told through the manager snapshot, which
 * reads the suppression list itself.
 */
export interface SendOutcome {
  success: boolean
  error?: string
  code?: string
  uncertain?: boolean
  /** The provider's HTTP status on a refusal it answered. */
  providerStatus?: number
}

/** Refusals about the recipient, not the provider: the only ones that make a person undeliverable. */
const RECIPIENT_REFUSAL_CODES: ReadonlySet<string> = new Set(['recipient_suppressed', 'recipient_rejected'])
/** Provider answers that refuse every send alike: the key, the sender, or a rate limit. */
const RUN_WIDE_REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 429])
/** Our own set-up refusing every send: no provider configured, or it could not sign in. */
const RUN_WIDE_REFUSAL_CODES: ReadonlySet<string> = new Set(['email_not_configured', 'email_sign_in_failed'])

/** What a send result means for its claims. A thrown send is uncertain: it may have gone. */
export function classifySend(result: SendOutcome | null): SendClass {
  if (!result) return 'uncertain'
  if (result.success) return 'sent'
  if (result.code === 'email_suspended') return 'suspended'
  if (result.uncertain === true) return 'uncertain'
  if (result.code && RECIPIENT_REFUSAL_CODES.has(result.code)) return 'refused'
  // Anything else definite came from the provider or our set-up, never from the address.
  return 'provider_refused'
}

/** Whether a provider refusal will refuse every other send this run too, so none should be tried. */
export function refusesEverySend(result: SendOutcome | null): boolean {
  if (!result || classifySend(result) !== 'provider_refused') return false
  if (result.code && RUN_WIDE_REFUSAL_CODES.has(result.code)) return true
  return typeof result.providerStatus === 'number' && RUN_WIDE_REFUSAL_STATUSES.has(result.providerStatus)
}

export interface TrainingDailyDeps {
  now: () => Date
  today: () => string
  readEmailsSetting: () => Promise<TrainingEmailsSetting>
  suspensionReason: () => EmailSuspensionReason
  appUrl: () => string
  managerEmail: () => string
  sendEmail: typeof sendEmail
  syncAssignments: typeof TrainingService.syncAssignments
  listConfirmationsToFinalise: typeof TrainingService.listConfirmationsToFinalise
  listCertificateRetries: typeof TrainingService.listCertificateRetries
  getStaffReminderPeople: typeof TrainingService.getStaffReminderPeople
  getManagerDailySnapshot: typeof TrainingService.getManagerDailySnapshot
  listReminderClaimKeys: typeof TrainingService.listReminderClaimKeys
  claimReminder: typeof TrainingService.claimReminder
  setReminderStatus: typeof TrainingService.setReminderStatus
  releaseReminders: typeof TrainingService.releaseReminders
  writeEvent: typeof TrainingService.writeEvent
  onSigningCompleted: typeof onTrainingSigningCompleted
  onSigningDeclined: typeof onTrainingSigningDeclined
  prepareCertificate: typeof prepareTrainingCertificate
  planStaffReminders: typeof planStaffReminders
  planManagerDaily: typeof planManagerDaily
}

function defaultDeps(): TrainingDailyDeps {
  return {
    now: () => new Date(),
    today: () => getTodayIsoDate(),
    readEmailsSetting: () => readTrainingEmailsSetting(),
    suspensionReason: () => currentEmailSuspensionReason(),
    appUrl: () => getAppUrl(),
    managerEmail: () => trainingManagerEmail(),
    sendEmail: (options) => sendEmail(options),
    syncAssignments: (opts) => TrainingService.syncAssignments(opts),
    listConfirmationsToFinalise: () => TrainingService.listConfirmationsToFinalise(),
    listCertificateRetries: () => TrainingService.listCertificateRetries(),
    getStaffReminderPeople: (today) => TrainingService.getStaffReminderPeople(today),
    getManagerDailySnapshot: (today) => TrainingService.getManagerDailySnapshot(today),
    listReminderClaimKeys: (filter) => TrainingService.listReminderClaimKeys(filter),
    claimReminder: (claim) => TrainingService.claimReminder(claim),
    setReminderStatus: (key, status, detail) => TrainingService.setReminderStatus(key, status, detail),
    releaseReminders: (keys) => TrainingService.releaseReminders(keys),
    writeEvent: (event) => TrainingService.writeEvent(event),
    onSigningCompleted: (documentId) => onTrainingSigningCompleted(documentId),
    onSigningDeclined: (documentId) => onTrainingSigningDeclined(documentId),
    prepareCertificate: (assignmentId) => prepareTrainingCertificate(assignmentId),
    planStaffReminders: (input) => planStaffReminders(input),
    planManagerDaily: (input) => planManagerDaily(input),
  }
}

export interface TrainingDailyRun {
  today: string
  emailsEnabled: boolean
  /** A kill switch was on when the run planned its emails. */
  suspended: boolean
  sweep: SyncResult | null
  /** Signing documents that had completed or been declined and are now recorded. */
  finalised: number
  certificatesPrepared: number
  certificatesFailed: number
  /** People whose staff reminder was accepted by the provider. */
  staffEmailsSent: number
  /** Staff reminders whose outcome is unknown: kept, reported, never resent. */
  staffEmailsUncertain: number
  /** Staff reminders refused by a kill switch: claims released for the next run. */
  staffEmailsSuspended: number
  /** Staff reminders refused because of the recipient: claims released, manager told. */
  staffEmailsRefused: number
  /** Staff reminders the provider refused (not the address): claims released, nobody flagged. */
  staffEmailsProviderRefused: number
  /** People skipped because another run had already claimed them today. */
  staffEmailsAlreadyClaimed: number
  managerEmailSent: boolean
  managerItems: number
  /** `provider_refused` also when the provider refused every staff email, so it was not tried. */
  managerOutcome: SendClass | 'quiet' | 'already_sent' | 'off' | 'not_run'
  /** Stages that failed as a whole. */
  failedStages: TrainingDailyStage[]
  /** One line per failure: stage failures and items. Ids only, never names or addresses. */
  errors: string[]
  deadline: RunDeadlineSummary | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runTrainingDaily(options: { deps?: Partial<TrainingDailyDeps> } = {}): Promise<TrainingDailyRun> {
  const deps: TrainingDailyDeps = { ...defaultDeps(), ...options.deps }
  const startedAt = deps.now().getTime()
  const clock = () => deps.now().getTime()
  const certificateDeadline = createRunDeadline(startedAt + CERTIFICATE_BUDGET_MS, clock)
  const sendDeadline = createRunDeadline(startedAt + SEND_BUDGET_MS, clock)
  const today = deps.today()

  const run: TrainingDailyRun = {
    today,
    emailsEnabled: false,
    suspended: false,
    sweep: null,
    finalised: 0,
    certificatesPrepared: 0,
    certificatesFailed: 0,
    staffEmailsSent: 0,
    staffEmailsUncertain: 0,
    staffEmailsSuspended: 0,
    staffEmailsRefused: 0,
    staffEmailsProviderRefused: 0,
    staffEmailsAlreadyClaimed: 0,
    managerEmailSent: false,
    managerItems: 0,
    managerOutcome: 'not_run',
    failedStages: [],
    errors: [],
    deadline: null,
  }

  const stageFailed = (stage: TrainingDailyStage, error: unknown) => {
    run.failedStages.push(stage)
    run.errors.push(`${stage}: ${messageOf(error)}`)
  }
  const itemFailed = (what: string, error: unknown) => {
    run.errors.push(`${what}: ${messageOf(error)}`)
  }

  // The setting first: not knowing it is not a reason to email anyone, so unreadable is off.
  try {
    const setting = await deps.readEmailsSetting()
    if (setting.readable) {
      run.emailsEnabled = setting.enabled
    } else {
      stageFailed('settings', new Error(`could not read training_emails_enabled, emails treated as off (${setting.error})`))
    }
  } catch (error) {
    stageFailed('settings', error)
  }

  // 1. Sweep.
  try {
    run.sweep = await deps.syncAssignments({ today, actor: SYSTEM_ACTOR })
  } catch (error) {
    stageFailed('sweep', error)
  }

  // 2a. Finish confirmations the signing feature completed or declined but the record missed.
  try {
    const pending = await deps.listConfirmationsToFinalise()
    for (const { assignment, documentStatus } of pending) {
      const documentId = assignment.signingDocumentId
      if (!documentId) continue
      try {
        if (documentStatus === 'completed') {
          await deps.onSigningCompleted(documentId)
          run.finalised += 1
        } else if (documentStatus === 'declined') {
          await deps.onSigningDeclined(documentId)
          run.finalised += 1
        }
      } catch (error) {
        itemFailed(`finalise assignment ${assignment.id}`, error)
      }
    }
  } catch (error) {
    stageFailed('finalise', error)
  }

  // 2b. Retry certificate packs that could not be prepared. Only a failure seen here goes to the
  // manager, so a pack the deadline stopped us retrying is not reported as failed.
  const certificateFailedIds = new Set<string>()
  try {
    const retries = await deps.listCertificateRetries()
    for (let index = 0; index < retries.length; index += 1) {
      if (certificateDeadline.timeIsUp('certificates', retries.length - index)) break
      const assignment = retries[index]
      try {
        await deps.prepareCertificate(assignment.id)
        run.certificatesPrepared += 1
      } catch (error) {
        run.certificatesFailed += 1
        certificateFailedIds.add(assignment.id)
        itemFailed(`certificate for assignment ${assignment.id}`, error)
      }
    }
  } catch (error) {
    stageFailed('certificates', error)
  }

  if (!run.emailsEnabled) {
    // The quiet path: the switch is off (the default), so nothing is read and nothing is sent.
    run.managerOutcome = 'off'
    run.deadline = certificateDeadline.summary()
    return run
  }

  run.suspended = deps.suspensionReason() !== null
  const undeliverableNow = new Set<string>()
  let suspendedSeen = run.suspended
  // Set when the provider refused a send in a way that refuses every send (key, sender, rate limit).
  let providerBlocked = false

  // 3. Staff reminders. With a kill switch on, nothing is planned or claimed at all.
  if (!run.suspended) {
    try {
      const people = await deps.getStaffReminderPeople(today)
      const existingClaims = people.length === 0
        ? new Set<string>()
        : await deps.listReminderClaimKeys({
            assignmentIds: people.flatMap((person) => person.items.map((item) => item.assignmentId)),
            employeeIds: people.map((person) => person.employeeId),
          })
      const plan = deps.planStaffReminders({ today, emailsEnabled: true, suspended: false, people, existingClaims })

      let lastProviderReason: string | null = null
      let notTried = 0
      for (let index = 0; index < plan.emails.length; index += 1) {
        if (suspendedSeen) break
        if (providerBlocked) {
          notTried = plan.emails.length - index
          break
        }
        if (sendDeadline.timeIsUp('staff_reminders', plan.emails.length - index)) break
        const planned = plan.emails[index]
        const sent = await sendStaffEmail(deps, run, planned, existingClaims, today)
        if (sent.outcome === 'suspended') suspendedSeen = true
        if (sent.outcome === 'refused') undeliverableNow.add(planned.employeeId)
        if (sent.outcome === 'provider_refused') {
          lastProviderReason = sent.reason
          if (sent.refusesEverySend) providerBlocked = true
        }
      }
      if (run.staffEmailsProviderRefused > 0) {
        // One line for the run, not one per person: nothing is wrong with their addresses.
        const refused = run.staffEmailsProviderRefused
        const skipped = notTried > 0
          ? `${notTried} more staff ${notTried === 1 ? 'reminder' : 'reminders'} and the manager email were`
          : 'the manager email was'
        const stopped = providerBlocked ? `; it refuses every send, so ${skipped} not tried` : ''
        run.errors.push(
          `staff reminders: the email provider refused ${refused} ${refused === 1 ? 'send' : 'sends'}, claims released for the next run${stopped} (${lastProviderReason ?? 'no reason given'})`
        )
      }
    } catch (error) {
      stageFailed('staff_reminders', error)
    }
  }

  // 4. Manager email.
  try {
    if (suspendedSeen) {
      run.managerOutcome = 'suspended'
    } else if (providerBlocked) {
      // The same provider would refuse it; its problems are told on the next run.
      run.managerOutcome = 'provider_refused'
    } else if (sendDeadline.timeIsUp('manager_email')) {
      run.managerOutcome = 'not_run'
    } else {
      await sendManagerEmail(deps, run, { today, undeliverableNow, certificateFailedIds })
    }
  } catch (error) {
    stageFailed('manager_email', error)
  }

  run.deadline = mergeDeadlines(certificateDeadline.summary(), sendDeadline.summary())
  return run
}

function mergeDeadlines(a: RunDeadlineSummary | null, b: RunDeadlineSummary | null): RunDeadlineSummary | null {
  if (!a) return b
  if (!b) return a
  return { stoppedIn: a.stoppedIn, skipped: [...a.skipped, ...b.skipped] }
}

/** Gives claims back for the next run. A failure here is reported; the claims then stay held. */
async function releaseQuietly(deps: TrainingDailyDeps, run: TrainingDailyRun, keys: string[], what: string): Promise<void> {
  if (keys.length === 0) return
  try {
    await deps.releaseReminders(keys)
  } catch (error) {
    // The claims stay held, so nothing is sent twice; this item is not retried until a person looks.
    run.errors.push(`release claims for ${what}: ${messageOf(error)}`)
  }
}

async function markClaims(
  deps: TrainingDailyDeps,
  run: TrainingDailyRun,
  keys: string[],
  status: 'sent' | 'uncertain',
  what: string
): Promise<void> {
  for (const key of keys) {
    try {
      await deps.setReminderStatus(key, status)
    } catch (error) {
      // The claim is still held, which is what stops a resend; only its status is out of date.
      run.errors.push(`mark ${status} for ${what}: ${messageOf(error)}`)
    }
  }
}

interface StaffSendOutcome {
  outcome: SendClass | 'skipped'
  /** The provider's reason, for a refusal. */
  reason: string | null
  refusesEverySend: boolean
}

const SKIPPED: StaffSendOutcome = { outcome: 'skipped', reason: null, refusesEverySend: false }

async function sendStaffEmail(
  deps: TrainingDailyDeps,
  run: TrainingDailyRun,
  planned: PlannedStaffEmail,
  existingClaims: ReadonlySet<string>,
  today: string
): Promise<StaffSendOutcome> {
  const what = `staff reminder for employee ${planned.employeeId}`
  const held: string[] = []

  // The day cap first: whoever holds it has emailed this person today.
  try {
    const capped = await deps.claimReminder({
      kind: 'daily_cap',
      claimKey: planned.capClaimKey,
      londonDate: today,
      employeeId: planned.employeeId,
      detail: { steps: planned.steps.length },
    })
    if (!capped) {
      run.staffEmailsAlreadyClaimed += 1
      return SKIPPED
    }
    held.push(planned.capClaimKey)
  } catch (error) {
    run.errors.push(`claim ${what}: ${messageOf(error)}`)
    return SKIPPED
  }

  const steps: PlannedStaffEmail['steps'] = []
  try {
    for (const step of planned.steps) {
      const claimed = await deps.claimReminder({
        kind: 'staff_step',
        claimKey: step.claimKey,
        londonDate: today,
        assignmentId: step.assignmentId,
        employeeId: planned.employeeId,
        detail: { step: step.step, dueOn: step.dueOn },
      })
      if (!claimed) continue
      held.push(step.claimKey)
      steps.push(step)
      // The claims this step takes with it (the window of a late `assigned` email, the week of an
      // `overdue` one), so tomorrow's run does not send that nudge or weekly email straight after.
      // One already held elsewhere is fine: it stops the same email either way.
      for (const extraKey of step.alsoClaims) {
        const extra = await deps.claimReminder({
          kind: 'staff_step',
          claimKey: extraKey,
          londonDate: today,
          assignmentId: step.assignmentId,
          employeeId: planned.employeeId,
          detail: { step: step.step, dueOn: step.dueOn, takenWith: step.claimKey },
        })
        if (extra) held.push(extraKey)
      }
    }
  } catch (error) {
    run.errors.push(`claim ${what}: ${messageOf(error)}`)
    await releaseQuietly(deps, run, held, what)
    return SKIPPED
  }

  if (steps.length === 0) {
    // Every step was already told by another run: give the day back.
    await releaseQuietly(deps, run, held, what)
    run.staffEmailsAlreadyClaimed += 1
    return SKIPPED
  }

  let email
  try {
    email = buildStaffReminderEmail({
      name: planned.name,
      today,
      steps,
      portalUrl: `${deps.appUrl()}/portal/training`,
    })
  } catch (error) {
    run.errors.push(`build ${what}: ${messageOf(error)}`)
    await releaseQuietly(deps, run, held, what)
    return SKIPPED
  }

  let result: SendResult | null = null
  try {
    result = await deps.sendEmail({
      to: planned.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      commType: 'training_reminder',
      metadata: {
        employee_id: planned.employeeId,
        training_assignment_ids: steps.map((step) => step.assignmentId),
        training_steps: steps.map((step) => step.step),
      },
    })
  } catch {
    result = null
  }
  const outcome = classifySend(result)
  // Run errors carry ids only: a provider's reason can quote the address it refused.
  const reason = result?.error ? redactPii(result.error) : null

  if (outcome === 'suspended' || outcome === 'refused' || outcome === 'provider_refused') {
    await releaseQuietly(deps, run, held, what)
    if (outcome === 'suspended') run.staffEmailsSuspended += 1
    else if (outcome === 'provider_refused') run.staffEmailsProviderRefused += 1
    else {
      run.staffEmailsRefused += 1
      run.errors.push(`${what}: the address was refused (${reason ?? 'no reason given'})`)
    }
    return { outcome, reason, refusesEverySend: refusesEverySend(result) }
  }

  await markClaims(deps, run, held, outcome, what)
  if (outcome === 'uncertain') {
    run.staffEmailsUncertain += 1
    run.errors.push(`${what}: outcome unknown, kept and not resent (${result?.error ?? 'the send threw'})`)
  } else {
    run.staffEmailsSent += 1
    // They can be reached again, so a later problem is told afresh.
    const recovered = [undeliverableClaimKey(planned.employeeId), noLoginClaimKey(planned.employeeId)]
      .filter((key) => existingClaims.has(key))
    await releaseQuietly(deps, run, recovered, `recovered flags for employee ${planned.employeeId}`)
  }

  for (const step of steps) {
    try {
      await deps.writeEvent({
        eventType: 'reminder_sent',
        employeeId: planned.employeeId,
        assignmentId: step.assignmentId,
        courseId: step.courseId,
        actor: SYSTEM_ACTOR,
        noteCode: step.step,
        meta: { step: step.step, dueOn: step.dueOn, outcome },
      })
    } catch (error) {
      run.errors.push(`event for staff reminder on assignment ${step.assignmentId}: ${messageOf(error)}`)
    }
  }
  return { outcome, reason, refusesEverySend: false }
}

async function sendManagerEmail(
  deps: TrainingDailyDeps,
  run: TrainingDailyRun,
  context: { today: string; undeliverableNow: ReadonlySet<string>; certificateFailedIds: ReadonlySet<string> }
): Promise<void> {
  const { today } = context
  const snapshot = await deps.getManagerDailySnapshot(today)
  // An address that cannot be reached only matters to someone with online training to be chased
  // about, so a person with no address and nothing open is not a problem for the manager.
  const people = snapshot.people.map((person) => ({
    ...person,
    emailUndeliverable: person.hasOpenTraining && (person.emailUndeliverable || context.undeliverableNow.has(person.employeeId)),
  }))
  // Only packs that failed in this run's retry: one the deadline stopped us retrying waits.
  const certificateFailures = snapshot.certificateFailures.filter((failure) => context.certificateFailedIds.has(failure.assignmentId))
  const dayKey = managerDayClaimKey(today)
  const existingClaims = await deps.listReminderClaimKeys({
    assignmentIds: snapshot.assignments.map((assignment) => assignment.assignmentId),
    employeeIds: people.map((person) => person.employeeId),
    claimKeys: [dayKey],
  })

  const plan = deps.planManagerDaily({
    today,
    emailsEnabled: true,
    suspended: run.suspended,
    assignments: snapshot.assignments,
    people,
    certificateFailures,
    existingClaims,
  })
  if (!plan.send || plan.items.length === 0) {
    run.managerOutcome = existingClaims.has(dayKey) ? 'already_sent' : 'quiet'
    return
  }

  const claimed = await deps.claimReminder({
    kind: 'manager_daily',
    claimKey: plan.dayClaimKey,
    londonDate: today,
    detail: { items: plan.items.length },
  })
  if (!claimed) {
    run.managerOutcome = 'already_sent'
    return
  }
  const held: string[] = [plan.dayClaimKey]
  const items: ManagerDailyItem[] = []
  try {
    for (const item of plan.items) {
      const ok = await deps.claimReminder({
        kind: item.kind,
        claimKey: item.claimKey,
        londonDate: today,
        assignmentId: item.assignmentId,
        employeeId: item.employeeId,
        detail: { trigger: item.trigger },
      })
      if (ok) {
        held.push(item.claimKey)
        items.push(item)
      }
    }
  } catch (error) {
    await releaseQuietly(deps, run, held, 'manager training email')
    throw error
  }

  if (items.length === 0) {
    await releaseQuietly(deps, run, held, 'manager training email')
    run.managerOutcome = 'quiet'
    return
  }

  const appUrl = deps.appUrl()
  const email = buildManagerTrainingEmail({
    today,
    items,
    trainingUrl: `${appUrl}/employees/training`,
    recordUrl: (employeeId) => `${appUrl}/employees/${encodeURIComponent(employeeId)}?tab=training`,
  })

  let result: SendResult | null = null
  try {
    result = await deps.sendEmail({
      to: deps.managerEmail(),
      subject: email.subject,
      html: email.html,
      text: email.text,
      commType: 'training_manager_daily',
      metadata: {
        training_items: items.length,
        training_triggers: Array.from(new Set(items.map((item) => item.trigger))),
      },
    })
  } catch {
    result = null
  }
  const outcome = classifySend(result)
  run.managerOutcome = outcome

  if (outcome === 'suspended' || outcome === 'refused' || outcome === 'provider_refused') {
    await releaseQuietly(deps, run, held, 'manager training email')
    if (outcome !== 'suspended') run.errors.push(`manager training email: refused (${result?.error ? redactPii(result.error) : 'no reason given'})`)
    return
  }

  await markClaims(deps, run, held, outcome, 'manager training email')
  run.managerEmailSent = outcome === 'sent'
  run.managerItems = items.length
  if (outcome === 'uncertain') {
    run.errors.push(`manager training email: outcome unknown, kept and not resent (${result?.error ?? 'the send threw'})`)
  }

  for (const item of items) {
    try {
      await deps.writeEvent({
        eventType: 'escalated',
        employeeId: item.employeeId,
        assignmentId: item.assignmentId,
        actor: SYSTEM_ACTOR,
        noteCode: item.trigger,
        meta: { trigger: item.trigger, outcome },
      })
    } catch (error) {
      run.errors.push(`event for manager item ${item.claimKey}: ${messageOf(error)}`)
    }
  }
}
