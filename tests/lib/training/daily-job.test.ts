import { describe, expect, it, vi } from 'vitest'
import { classifySend, refusesEverySend, runTrainingDaily, type TrainingDailyDeps } from '@/lib/training/daily-job'
import {
  planManagerDaily,
  planStaffReminders,
  type ManagerDailyAssignment,
  type ManagerDailyPerson,
  type StaffReminderItem,
  type StaffReminderPerson,
} from '@/lib/training/reminders'
import type { NewReminderClaim } from '@/services/training'
import type { TrainingAssignment } from '@/lib/training/types'

/**
 * The training daily job (build contract 5.6). Everything it touches is injected: the ledger is a
 * Map keyed by claim key with the same unique rule as `training_reminders.claim_key`, and the
 * planners are B1's real ones, so these tests read the way production runs.
 */

type LedgerRow = NewReminderClaim & { status: 'claimed' | 'sent' | 'uncertain' }

function makeLedger(seed: string[] = []) {
  const rows = new Map<string, LedgerRow>()
  for (const key of seed) {
    rows.set(key, { kind: 'staff_step', claimKey: key, londonDate: '2026-10-01', status: 'sent', ...ownerOf(key) })
  }
  return {
    rows,
    claimReminder: vi.fn(async (claim: NewReminderClaim) => {
      if (rows.has(claim.claimKey)) return false
      rows.set(claim.claimKey, { ...claim, status: 'claimed' })
      return true
    }),
    setReminderStatus: vi.fn(async (key: string, status: 'sent' | 'uncertain') => {
      const row = rows.get(key)
      if (!row) throw new Error(`not held: ${key}`)
      row.status = status
    }),
    releaseReminders: vi.fn(async (keys: readonly string[]) => {
      for (const key of keys) rows.delete(key)
    }),
    listReminderClaimKeys: vi.fn(async (filter: { assignmentIds?: readonly string[]; employeeIds?: readonly string[]; claimKeys?: readonly string[] }) => {
      const out = new Set<string>()
      for (const row of rows.values()) {
        if (row.assignmentId && filter.assignmentIds?.includes(row.assignmentId)) out.add(row.claimKey)
        if (row.employeeId && filter.employeeIds?.includes(row.employeeId)) out.add(row.claimKey)
        if (filter.claimKeys?.includes(row.claimKey)) out.add(row.claimKey)
      }
      return out
    }),
  }
}

/** Seeded rows carry the assignment or employee id their key names, as real claims do. */
function ownerOf(key: string): { assignmentId?: string; employeeId?: string } {
  const [prefix, id] = key.split(':')
  if (prefix === 'step' || prefix === 'weekly' || prefix === 'esc') return { assignmentId: id }
  if (prefix === 'cap' || prefix === 'nologin' || prefix === 'undeliverable') return { employeeId: id }
  return {}
}

function item(overrides: Partial<StaffReminderItem> = {}): StaffReminderItem {
  return {
    assignmentId: 'a1',
    courseId: 'c1',
    courseTitle: 'Food Safety',
    courseKind: 'online',
    status: 'assigned',
    assignedOn: '2026-11-02',
    dueOn: '2026-11-16',
    confirmationSettled: false,
    progress: { sectionsPassed: 0, sectionsTotal: 3, currentSectionTitle: null },
    ...overrides,
  }
}

function person(overrides: Partial<StaffReminderPerson> = {}): StaffReminderPerson {
  return {
    employeeId: 'e1',
    name: 'Sam Taylor',
    email: 'sam@example.com',
    employeeStatus: 'Active',
    hasLogin: true,
    paused: false,
    emailSuppressed: false,
    items: [item()],
    ...overrides,
  }
}

function managerPerson(overrides: Partial<ManagerDailyPerson> = {}): ManagerDailyPerson {
  return { employeeId: 'e1', employeeName: 'Sam Taylor', hasLogin: true, emailUndeliverable: false, hasOpenTraining: true, ...overrides }
}

function managerAssignment(overrides: Partial<ManagerDailyAssignment> = {}): ManagerDailyAssignment {
  return {
    assignmentId: 'a1',
    employeeId: 'e1',
    employeeName: 'Sam Taylor',
    courseId: 'c1',
    courseTitle: 'Essentials',
    isEssentials: true,
    status: 'assigned',
    dueOn: '2026-10-30',
    lockedSection: null,
    lockedAt: null,
    declinedAt: null,
    paused: false,
    ...overrides,
  }
}

function sent() {
  return { success: true, messageId: 'm1' } as Awaited<ReturnType<TrainingDailyDeps['sendEmail']>>
}

interface Harness {
  deps: Partial<TrainingDailyDeps>
  ledger: ReturnType<typeof makeLedger>
  sendEmail: ReturnType<typeof vi.fn>
  writeEvent: ReturnType<typeof vi.fn>
  setToday: (date: string) => void
}

function harness(options: {
  enabled?: boolean
  readable?: boolean
  people?: StaffReminderPerson[]
  assignments?: ManagerDailyAssignment[]
  managerPeople?: ManagerDailyPerson[]
  certificateFailures?: Array<{ assignmentId: string; employeeId: string; employeeName: string; courseTitle: string }>
  ledgerSeed?: string[]
  today?: string
  suspension?: 'all_comms' | 'all_email' | null
} = {}): Harness {
  const ledger = makeLedger(options.ledgerSeed)
  let today = options.today ?? '2026-11-02'
  const sendEmail = vi.fn(async () => sent())
  const writeEvent = vi.fn(async () => ({}) as never)
  const deps: Partial<TrainingDailyDeps> = {
    now: () => new Date('2026-11-02T09:00:00Z'),
    today: () => today,
    readEmailsSetting: async () =>
      options.readable === false
        ? { readable: false, enabled: false, error: 'boom' }
        : { readable: true, enabled: options.enabled ?? true, updatedAt: null },
    suspensionReason: () => options.suspension ?? null,
    appUrl: () => 'https://management.example',
    managerEmail: () => 'manager@example.com',
    sendEmail: sendEmail as unknown as TrainingDailyDeps['sendEmail'],
    syncAssignments: vi.fn(async () => ({ created: 0, cancelled: 0, updated: 0 })),
    listConfirmationsToFinalise: vi.fn(async () => []),
    listCertificateRetries: vi.fn(async () => []),
    getStaffReminderPeople: vi.fn(async () => options.people ?? []),
    getManagerDailySnapshot: vi.fn(async () => ({
      assignments: options.assignments ?? [],
      people: options.managerPeople ?? [],
      certificateFailures: options.certificateFailures ?? [],
    })),
    listReminderClaimKeys: ledger.listReminderClaimKeys,
    claimReminder: ledger.claimReminder,
    setReminderStatus: ledger.setReminderStatus as unknown as TrainingDailyDeps['setReminderStatus'],
    releaseReminders: ledger.releaseReminders,
    writeEvent: writeEvent as unknown as TrainingDailyDeps['writeEvent'],
    onSigningCompleted: vi.fn(async () => undefined) as unknown as TrainingDailyDeps['onSigningCompleted'],
    onSigningDeclined: vi.fn(async () => undefined) as unknown as TrainingDailyDeps['onSigningDeclined'],
    prepareCertificate: vi.fn(async () => undefined) as unknown as TrainingDailyDeps['prepareCertificate'],
    planStaffReminders,
    planManagerDaily,
  }
  return { deps, ledger, sendEmail, writeEvent, setToday: (date) => { today = date } }
}

function staffSends(h: Harness) {
  return h.sendEmail.mock.calls.filter(([options]) => (options as { commType?: string }).commType === 'training_reminder')
}

function managerSends(h: Harness) {
  return h.sendEmail.mock.calls.filter(([options]) => (options as { commType?: string }).commType === 'training_manager_daily')
}

describe('classifySend', () => {
  it('reads each send result as the ledger needs it', () => {
    expect(classifySend(null)).toBe('uncertain')
    expect(classifySend({ success: true } as never)).toBe('sent')
    expect(classifySend({ success: false, code: 'email_suspended' } as never)).toBe('suspended')
    expect(classifySend({ success: false, uncertain: true } as never)).toBe('uncertain')
    expect(classifySend({ success: false, code: 'recipient_suppressed', error: 'Recipient email address is suppressed' })).toBe('refused')
    expect(classifySend({ success: false, code: 'recipient_rejected', error: 'Invalid `to` field', providerStatus: 422 })).toBe('refused')
  })

  it('reads every other definite refusal as the provider, never as a bad address', () => {
    // A rate limit, a revoked key, an unverified sender, no provider set up, or no code at all.
    expect(classifySend({ success: false, error: 'Too many requests', providerStatus: 429 })).toBe('provider_refused')
    expect(classifySend({ success: false, error: 'API key is invalid', providerStatus: 401 })).toBe('provider_refused')
    expect(classifySend({ success: false, error: 'The domain is not verified', providerStatus: 403 })).toBe('provider_refused')
    expect(classifySend({ success: false, error: 'Email service is not configured', code: 'email_not_configured' })).toBe('provider_refused')
    expect(classifySend({ success: false, error: 'rejected' })).toBe('provider_refused')
    // A lost answer stays uncertain whatever its status: it may have gone.
    expect(classifySend({ success: false, uncertain: true, providerStatus: 429 })).toBe('uncertain')
  })

  it('stops the run only for a provider refusal that refuses every send', () => {
    expect(refusesEverySend({ success: false, providerStatus: 429 })).toBe(true)
    expect(refusesEverySend({ success: false, providerStatus: 401 })).toBe(true)
    expect(refusesEverySend({ success: false, providerStatus: 403 })).toBe(true)
    expect(refusesEverySend({ success: false, code: 'email_not_configured' })).toBe(true)
    expect(refusesEverySend({ success: false, code: 'email_sign_in_failed' })).toBe(true)
    expect(refusesEverySend({ success: false, providerStatus: 422 })).toBe(false)
    expect(refusesEverySend({ success: false, error: 'rejected' })).toBe(false)
    expect(refusesEverySend({ success: false, code: 'recipient_rejected', providerStatus: 403 })).toBe(false)
    expect(refusesEverySend({ success: false, uncertain: true, providerStatus: 429 })).toBe(false)
    expect(refusesEverySend(null)).toBe(false)
  })
})

describe('runTrainingDaily: the switch', () => {
  it('with the setting off reads nothing for email, claims nothing and sends nothing', async () => {
    const h = harness({ enabled: false, people: [person()], assignments: [managerAssignment()], managerPeople: [managerPerson()] })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.emailsEnabled).toBe(false)
    expect(run.managerOutcome).toBe('off')
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.ledger.claimReminder).not.toHaveBeenCalled()
    expect(h.deps.getStaffReminderPeople).not.toHaveBeenCalled()
    expect(h.deps.getManagerDailySnapshot).not.toHaveBeenCalled()
    expect(h.ledger.listReminderClaimKeys).not.toHaveBeenCalled()
    // The sweep and the finishing steps still run with the emails off.
    expect(h.deps.syncAssignments).toHaveBeenCalledWith({ today: '2026-11-02', actor: expect.anything() })
    expect(h.deps.listConfirmationsToFinalise).toHaveBeenCalled()
    expect(h.deps.listCertificateRetries).toHaveBeenCalled()
    expect(run.errors).toEqual([])
  })

  it('treats a setting it cannot read as off, and reports the stage', async () => {
    const h = harness({ readable: false, people: [person()] })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.emailsEnabled).toBe(false)
    expect(run.failedStages).toEqual(['settings'])
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.ledger.rows.size).toBe(0)
  })

  it('with a kill switch on plans, claims and sends nothing', async () => {
    const h = harness({ suspension: 'all_email', people: [person()], assignments: [managerAssignment()], managerPeople: [managerPerson()] })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.suspended).toBe(true)
    expect(run.managerOutcome).toBe('suspended')
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.ledger.rows.size).toBe(0)
  })
})

describe('runTrainingDaily: staff reminders', () => {
  it('sends nothing when nothing is due, and leaves no claims behind', async () => {
    // Assigned email already sent; today is before the nudge window opens.
    const h = harness({
      today: '2026-11-03',
      people: [person()],
      ledgerSeed: ['step:a1:assigned:2026-11-16'],
    })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(run.managerOutcome).toBe('quiet')
    expect([...h.ledger.rows.keys()]).toEqual(['step:a1:assigned:2026-11-16'])
    expect(run.errors).toEqual([])
  })

  it('sends one email for a new item, with the portal link, and keeps every claim as sent', async () => {
    const h = harness({ people: [person()] })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.staffEmailsSent).toBe(1)
    const sends = staffSends(h)
    expect(sends).toHaveLength(1)
    const options = sends[0][0] as { to: string; subject: string; text: string; metadata: Record<string, unknown> }
    expect(options.to).toBe('sam@example.com')
    expect(options.subject).toBe('New training for you')
    expect(options.text).toContain('https://management.example/portal/training')
    expect(options.metadata).toEqual({ employee_id: 'e1', training_assignment_ids: ['a1'], training_steps: ['assigned'] })
    expect(h.ledger.rows.get('cap:e1:2026-11-02')?.status).toBe('sent')
    expect(h.ledger.rows.get('step:a1:assigned:2026-11-16')?.status).toBe('sent')
    expect(h.writeEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'reminder_sent', assignmentId: 'a1', noteCode: 'assigned' }))
  })

  it('a second run the same day sends nothing more', async () => {
    const h = harness({ people: [person()] })
    await runTrainingDaily({ deps: h.deps })
    const second = await runTrainingDaily({ deps: h.deps })

    expect(staffSends(h)).toHaveLength(1)
    expect(second.staffEmailsSent).toBe(0)
  })

  it('sends one email per person per day listing every step due', async () => {
    const h = harness({
      people: [
        person({
          items: [
            item(),
            item({ assignmentId: 'a2', courseId: 'c2', courseTitle: 'Fire Safety', assignedOn: '2026-10-01', dueOn: '2026-10-29' }),
          ],
        }),
      ],
      ledgerSeed: ['step:a2:assigned:2026-10-29'],
    })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.staffEmailsSent).toBe(1)
    const sends = staffSends(h)
    expect(sends).toHaveLength(1)
    const options = sends[0][0] as { subject: string; text: string; metadata: { training_steps: string[] } }
    expect(options.subject).toBe('Your training is overdue')
    expect(options.metadata.training_steps.sort()).toEqual(['assigned', 'overdue'])
    expect(options.text).toContain('Food Safety')
    expect(options.text).toContain('Fire Safety')
  })

  it('claims the week with the overdue email, so no weekly email comes the next morning', async () => {
    const h = harness({
      today: '2026-11-03',
      people: [person({ items: [item({ assignedOn: '2026-10-01', dueOn: '2026-10-29' })] })],
      ledgerSeed: ['step:a1:assigned:2026-10-29'],
    })
    await runTrainingDaily({ deps: h.deps })
    expect(staffSends(h)).toHaveLength(1)
    // The week's claim was taken with the overdue step and kept as sent.
    expect(h.ledger.rows.get('weekly:a1:2026-11-02')?.status).toBe('sent')

    h.setToday('2026-11-04')
    await runTrainingDaily({ deps: h.deps })
    expect(staffSends(h)).toHaveLength(1)
  })

  it('sends the weekly email on Mondays only, once a week', async () => {
    const h = harness({
      today: '2026-11-09',
      people: [person({ items: [item({ assignedOn: '2026-10-01', dueOn: '2026-10-22' })] })],
      ledgerSeed: ['step:a1:assigned:2026-10-22', 'step:a1:overdue:2026-10-22', 'weekly:a1:2026-10-19', 'weekly:a1:2026-10-26', 'weekly:a1:2026-11-02'],
    })
    await runTrainingDaily({ deps: h.deps })
    let sends = staffSends(h)
    expect(sends).toHaveLength(1)
    expect((sends[0][0] as { subject: string }).subject).toBe('Your training is still not done')
    expect(h.ledger.rows.has('weekly:a1:2026-11-09')).toBe(true)

    for (const day of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) {
      h.setToday(day)
      await runTrainingDaily({ deps: h.deps })
    }
    expect(staffSends(h)).toHaveLength(1)

    h.setToday('2026-11-16')
    await runTrainingDaily({ deps: h.deps })
    sends = staffSends(h)
    expect(sends).toHaveLength(2)
    expect(h.ledger.rows.has('weekly:a1:2026-11-16')).toBe(true)
  })

  it('a late assigned email takes its window, so no due soon email follows the next day', async () => {
    const h = harness({
      today: '2026-11-14',
      people: [person({ items: [item({ assignedOn: '2026-11-02', dueOn: '2026-11-16' })] })],
    })
    await runTrainingDaily({ deps: h.deps })
    expect(staffSends(h)).toHaveLength(1)
    expect(h.ledger.rows.get('step:a1:due_soon:2026-11-16')?.status).toBe('sent')

    h.setToday('2026-11-15')
    await runTrainingDaily({ deps: h.deps })
    expect(staffSends(h)).toHaveLength(1)
  })

  it('a suspended send releases every claim and stops further sends this run', async () => {
    const h = harness({
      people: [
        person(),
        person({ employeeId: 'e2', email: 'alex@example.com', items: [item({ assignmentId: 'b1' })] }),
      ],
      assignments: [managerAssignment()],
      managerPeople: [managerPerson()],
    })
    h.sendEmail.mockResolvedValue({ success: false, code: 'email_suspended', error: 'Email suspended' })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(run.staffEmailsSuspended).toBe(1)
    expect(run.managerOutcome).toBe('suspended')
    expect(h.ledger.rows.size).toBe(0)

    // Next run with the switch back off sends both.
    h.sendEmail.mockResolvedValue(sent())
    await runTrainingDaily({ deps: h.deps })
    expect(staffSends(h)).toHaveLength(3)
  })

  it('an uncertain send keeps its claims, is reported, and is never retried', async () => {
    const h = harness({ people: [person()] })
    h.sendEmail.mockResolvedValueOnce({ success: false, uncertain: true, error: 'timeout' })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.staffEmailsUncertain).toBe(1)
    expect(run.errors.some((line) => line.includes('outcome unknown'))).toBe(true)
    expect(h.ledger.rows.get('cap:e1:2026-11-02')?.status).toBe('uncertain')
    expect(h.ledger.rows.get('step:a1:assigned:2026-11-16')?.status).toBe('uncertain')

    // Not the next day either: the step claim is held, so the assigned email is never resent.
    h.setToday('2026-11-03')
    await runTrainingDaily({ deps: h.deps })
    expect(staffSends(h)).toHaveLength(1)
  })

  it('a send that throws is treated as uncertain', async () => {
    const h = harness({ people: [person()] })
    h.sendEmail.mockRejectedValueOnce(new Error('socket hang up'))
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.staffEmailsUncertain).toBe(1)
    expect(h.ledger.rows.get('step:a1:assigned:2026-11-16')?.status).toBe('uncertain')
  })

  it('a send refused because of the address releases its claims and tells the manager the person cannot be reached', async () => {
    const h = harness({ people: [person()], managerPeople: [managerPerson()] })
    h.sendEmail.mockResolvedValueOnce({ success: false, code: 'recipient_rejected', providerStatus: 422, error: 'Invalid `to` field' })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.staffEmailsRefused).toBe(1)
    expect(run.staffEmailsProviderRefused).toBe(0)
    expect(h.ledger.rows.has('step:a1:assigned:2026-11-16')).toBe(false)
    expect(h.ledger.rows.has('cap:e1:2026-11-02')).toBe(false)
    const manager = managerSends(h)
    expect(manager).toHaveLength(1)
    expect((manager[0][0] as { text: string }).text).toContain('Sam Taylor')
    expect(h.ledger.rows.get('undeliverable:e1')?.status).toBe('sent')
  })

  describe('a send the provider refused (FAIL-4: not the address)', () => {
    const twoPeople = () => [
      person(),
      person({ employeeId: 'e2', name: 'Alex Moss', email: 'alex@example.com', items: [item({ assignmentId: 'b1' })] }),
    ]
    const managerTwo = () => [managerPerson(), managerPerson({ employeeId: 'e2', employeeName: 'Alex Moss' })]

    it('on a rate limit releases the claims, flags nobody, stops the run and adds one error line', async () => {
      const h = harness({ people: twoPeople(), assignments: [managerAssignment()], managerPeople: managerTwo() })
      h.sendEmail.mockResolvedValue({ success: false, error: 'Too many requests', providerStatus: 429 })
      const run = await runTrainingDaily({ deps: h.deps })

      // Only the first staff email was tried; the second and the manager email were not.
      expect(h.sendEmail).toHaveBeenCalledTimes(1)
      expect(run.staffEmailsProviderRefused).toBe(1)
      expect(run.staffEmailsRefused).toBe(0)
      expect(run.managerOutcome).toBe('provider_refused')
      expect(managerSends(h)).toHaveLength(0)
      // Every claim is given back, and no undeliverable claim is taken for anyone.
      expect(h.ledger.rows.size).toBe(0)
      expect(run.errors).toEqual([
        'staff reminders: the email provider refused 1 send, claims released for the next run; it refuses every send, so 1 more staff reminder and the manager email were not tried (Too many requests)',
      ])
      expect(run.errors.join(' ')).not.toMatch(/e1|e2|example\.com/)
      expect(h.writeEvent).not.toHaveBeenCalled()

      // The next run, with the provider back, sends to both and tells the manager nothing about addresses.
      h.sendEmail.mockResolvedValue(sent())
      const next = await runTrainingDaily({ deps: h.deps })
      expect(next.staffEmailsSent).toBe(2)
      const manager = managerSends(h)
      expect(manager).toHaveLength(1)
      expect((manager[0][0] as { text: string }).text).not.toContain('Check their email address')
      expect(h.ledger.rows.has('undeliverable:e1')).toBe(false)
      expect(h.ledger.rows.has('undeliverable:e2')).toBe(false)
    })

    it('keeps the address a provider quotes out of the run error line', async () => {
      const h = harness({ people: [person()], managerPeople: [managerPerson()] })
      h.sendEmail.mockResolvedValueOnce({ success: false, error: 'Recipient sam@example.com was refused', providerStatus: 451 })
      const run = await runTrainingDaily({ deps: h.deps })
      expect(run.staffEmailsProviderRefused).toBe(1)
      expect(run.errors).toHaveLength(1)
      expect(run.errors[0]).not.toContain('sam@example.com')
    })

    it('on a revoked key or an unverified sender stops the run the same way', async () => {
      for (const providerStatus of [401, 403]) {
        const h = harness({ people: twoPeople(), managerPeople: managerTwo() })
        h.sendEmail.mockResolvedValue({ success: false, error: 'refused', providerStatus })
        const run = await runTrainingDaily({ deps: h.deps })
        expect(h.sendEmail).toHaveBeenCalledTimes(1)
        expect(run.managerOutcome).toBe('provider_refused')
        expect(h.ledger.rows.size).toBe(0)
      }
    })

    it('with no status keeps going, flags nobody, and still adds only one error line', async () => {
      const h = harness({ people: twoPeople(), assignments: [managerAssignment()], managerPeople: managerTwo() })
      h.sendEmail
        .mockResolvedValueOnce({ success: false, error: 'Something the provider said no to' })
        .mockResolvedValueOnce({ success: false, error: 'Something the provider said no to' })
      const run = await runTrainingDaily({ deps: h.deps })

      expect(staffSends(h)).toHaveLength(2)
      expect(run.staffEmailsProviderRefused).toBe(2)
      expect(run.errors).toEqual([
        'staff reminders: the email provider refused 2 sends, claims released for the next run (Something the provider said no to)',
      ])
      // The manager email still goes, for the overdue essentials, and calls nobody undeliverable.
      const manager = managerSends(h)
      expect(manager).toHaveLength(1)
      expect((manager[0][0] as { text: string }).text).not.toContain('Check their email address')
      expect(h.ledger.rows.has('undeliverable:e1')).toBe(false)
      expect(h.ledger.rows.has('undeliverable:e2')).toBe(false)
      expect(h.ledger.rows.has('cap:e1:2026-11-02')).toBe(false)
    })
  })

  it('a successful send clears an old undeliverable flag so a later failure is told again', async () => {
    const h = harness({ people: [person()], ledgerSeed: ['undeliverable:e1', 'nologin:e1'] })
    await runTrainingDaily({ deps: h.deps })

    expect(h.ledger.rows.has('undeliverable:e1')).toBe(false)
    expect(h.ledger.rows.has('nologin:e1')).toBe(false)
  })

  it('one failed stage does not stop the others', async () => {
    const h = harness({ people: [person()] })
    h.deps.syncAssignments = vi.fn(async () => { throw new Error('sweep broke') })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.failedStages).toEqual(['sweep'])
    expect(run.staffEmailsSent).toBe(1)
  })
})

describe('runTrainingDaily: manager email', () => {
  it('sends nothing on a quiet day and leaves no day claim', async () => {
    const h = harness({ managerPeople: [managerPerson()] })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.managerOutcome).toBe('quiet')
    expect(managerSends(h)).toHaveLength(0)
    expect(h.ledger.rows.size).toBe(0)
  })

  it('sends once for a new problem, then never again for the same problem', async () => {
    const h = harness({ assignments: [managerAssignment()], managerPeople: [managerPerson()] })
    const first = await runTrainingDaily({ deps: h.deps })

    expect(first.managerEmailSent).toBe(true)
    expect(first.managerItems).toBe(1)
    const manager = managerSends(h)
    expect(manager).toHaveLength(1)
    const options = manager[0][0] as { to: string; subject: string; text: string }
    expect(options.to).toBe('manager@example.com')
    expect(options.subject).toBe('Training: 1 new problem needs you')
    expect(options.text).toContain('https://management.example/employees/e1?tab=training')
    expect(h.ledger.rows.get('manager:2026-11-02')?.status).toBe('sent')
    expect(h.ledger.rows.get('esc:a1:essentials_overdue:2026-10-30')?.status).toBe('sent')

    // Same day again: the day is claimed.
    const again = await runTrainingDaily({ deps: h.deps })
    expect(again.managerOutcome).toBe('already_sent')

    // Next day, same problem: nothing new, so no email.
    h.setToday('2026-11-03')
    const nextDay = await runTrainingDaily({ deps: h.deps })
    expect(nextDay.managerOutcome).toBe('quiet')
    expect(managerSends(h)).toHaveLength(1)
    expect(h.ledger.rows.has('manager:2026-11-03')).toBe(false)
  })

  it('an uncertain manager email keeps its claims and is not resent', async () => {
    const h = harness({ assignments: [managerAssignment()], managerPeople: [managerPerson()] })
    h.sendEmail.mockResolvedValueOnce({ success: false, uncertain: true, error: 'timeout' })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.managerOutcome).toBe('uncertain')
    expect(h.ledger.rows.get('esc:a1:essentials_overdue:2026-10-30')?.status).toBe('uncertain')
    h.setToday('2026-11-03')
    await runTrainingDaily({ deps: h.deps })
    expect(managerSends(h)).toHaveLength(1)
  })

  it('a refused manager email releases its claims for tomorrow', async () => {
    const h = harness({ assignments: [managerAssignment()], managerPeople: [managerPerson()] })
    h.sendEmail.mockResolvedValueOnce({ success: false, error: 'mailbox full' })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.managerOutcome).toBe('provider_refused')
    expect(run.errors).toEqual(['manager training email: refused (mailbox full)'])
    expect(h.ledger.rows.size).toBe(0)
    h.setToday('2026-11-03')
    await runTrainingDaily({ deps: h.deps })
    expect(managerSends(h)).toHaveLength(2)
  })

  it('reports only certificate packs that failed in this run', async () => {
    const failing = { id: 'a1' } as TrainingAssignment
    const h = harness({
      managerPeople: [managerPerson()],
      certificateFailures: [
        { assignmentId: 'a1', employeeId: 'e1', employeeName: 'Sam Taylor', courseTitle: 'Food Safety' },
        { assignmentId: 'a9', employeeId: 'e1', employeeName: 'Sam Taylor', courseTitle: 'Not retried' },
      ],
    })
    h.deps.listCertificateRetries = vi.fn(async () => [failing])
    h.deps.prepareCertificate = vi.fn(async () => { throw new Error('browser failed') }) as unknown as TrainingDailyDeps['prepareCertificate']
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.certificatesFailed).toBe(1)
    expect(run.failedStages).toEqual([])
    const manager = managerSends(h)
    expect(manager).toHaveLength(1)
    const text = (manager[0][0] as { text: string }).text
    expect(text).toContain('Food Safety')
    expect(text).not.toContain('Not retried')
  })

  it('does not raise an unreachable address for someone with no online training open', async () => {
    const h = harness({ managerPeople: [managerPerson({ emailUndeliverable: true, hasOpenTraining: false })] })
    const run = await runTrainingDaily({ deps: h.deps })

    expect(run.managerOutcome).toBe('quiet')
    expect(managerSends(h)).toHaveLength(0)
  })
})
