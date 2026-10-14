import { beforeEach, describe, expect, it, vi } from 'vitest'

// Claim-then-send for the hourly appointment reminders. The "sent" stamp used to be written
// after the send, so a failed stamp write meant the next run (the window is two hours wide)
// sent the same reminder again. These tests run the real reminder job against an in-memory
// table that keeps its stamps between runs.

const sendEmail = vi.hoisted(() => vi.fn())
const sendSMS = vi.hoisted(() => vi.fn())

vi.mock('@/lib/email/emailService', () => ({ sendEmail }))
vi.mock('@/lib/twilio', () => ({ sendSMS }))
vi.mock('@/lib/recruitment/ai', () => ({ draftRecruitmentEmail: vi.fn() }))

import { sendDueRecruitmentAppointmentReminders } from '@/lib/recruitment/communications'

type Row = Record<string, any>
type Marker = 'reminder_email_sent_at' | 'reminder_sms_sent_at'
type DbError = { message: string; code?: string | null; details?: string | null; hint?: string | null }

const APPLICATION = {
  id: 'application-1',
  candidate_id: 'candidate-1',
  candidate: { id: 'candidate-1', first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com' },
  job_posting: { title: 'Bartender' },
}

const REMINDER_TEMPLATE = {
  type: 'reminder',
  is_active: true,
  subject: 'Your {{appointment_type}} at The Anchor',
  body: 'Hi {{first_name}}, a reminder of your {{appointment_type}} on {{appointment_time}}.',
}

interface FakeOptions {
  /** The claim (a conditional update on a null stamp) is refused with this error. */
  claimError?: DbError
  /** Stamp writes made after a send in the same run are refused, the failure that caused repeats. */
  failStampWritesAfterSend?: boolean
}

function makeAppointment(overrides: Partial<Row> = {}): Row {
  return {
    id: 'appointment-1',
    application_id: 'application-1',
    candidate_id: 'candidate-1',
    status: 'scheduled',
    type: 'interview',
    scheduled_start: '2026-10-15T10:00:00.000Z',
    timezone: 'Europe/London',
    reminder_email_sent_at: null,
    reminder_sms_sent_at: null,
    candidate: { id: 'candidate-1', sms_consent: false },
    ...overrides,
  }
}

/**
 * A small stand-in for the Supabase client. It applies eq/is filters to the stored rows,
 * keeps every update, and records each stamp write so tests can see claims and releases.
 */
function createFakeDb(appointment: Row, options: FakeOptions = {}) {
  const state = { appointment: { ...appointment } }
  const stampWrites: Array<{ marker: Marker; value: string | null; conditional: 'is-null' | 'eq-value' | 'none'; applied: boolean }> = []
  let sentSinceLastStamp = false

  sendEmail.mockImplementation(async () => {
    sentSinceLastStamp = true
    return { success: true, messageId: 'email-1' }
  })
  sendSMS.mockImplementation(async () => {
    sentSinceLastStamp = true
    return { success: true, messageSid: 'SM1' }
  })

  function appointmentsQuery() {
    const filters: Array<(row: Row) => boolean> = []
    const conditions: Array<{ column: string; kind: 'is' | 'eq'; value: unknown }> = []
    let mode: 'select' | 'update' = 'select'
    let patch: Row = {}
    let returning = false

    const run = (): { data: any; error: DbError | null } => {
      const matches = filters.every(filter => filter(state.appointment))
      if (mode === 'select') {
        return { data: matches ? [{ ...state.appointment }] : [], error: null }
      }

      const marker = (Object.keys(patch).find(key => key === 'reminder_email_sent_at' || key === 'reminder_sms_sent_at') ?? null) as Marker | null
      const markerCondition = marker ? conditions.find(condition => condition.column === marker) : undefined
      const conditional = !markerCondition ? 'none' : markerCondition.kind === 'is' ? 'is-null' : 'eq-value'

      if (marker && conditional === 'is-null' && options.claimError) {
        stampWrites.push({ marker, value: patch[marker], conditional, applied: false })
        return { data: null, error: options.claimError }
      }
      if (marker && patch[marker] !== null && options.failStampWritesAfterSend && sentSinceLastStamp) {
        stampWrites.push({ marker, value: patch[marker], conditional, applied: false })
        sentSinceLastStamp = false
        return { data: null, error: { message: 'connection reset', code: '08006' } }
      }

      if (matches) Object.assign(state.appointment, patch)
      if (marker) stampWrites.push({ marker, value: patch[marker], conditional, applied: matches })
      return { data: returning ? (matches ? [{ id: state.appointment.id }] : []) : null, error: null }
    }

    const chain: any = {
      select: vi.fn(() => {
        if (mode === 'update') returning = true
        return chain
      }),
      update: vi.fn((values: Row) => {
        mode = 'update'
        patch = values
        return chain
      }),
      eq: vi.fn((column: string, value: unknown) => {
        conditions.push({ column, kind: 'eq', value })
        filters.push(row => row[column] === value)
        return chain
      }),
      is: vi.fn((column: string, value: unknown) => {
        conditions.push({ column, kind: 'is', value })
        filters.push(row => row[column] === value)
        return chain
      }),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(async () => run()),
      maybeSingle: vi.fn(async () => {
        const result = run()
        return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }
      }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }

  function singleRowTable(row: Row) {
    const chain: any = {}
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    return chain
  }

  function communicationsTable() {
    const chain: any = {}
    chain.insert = vi.fn(() => chain)
    chain.select = vi.fn(() => chain)
    chain.single = vi.fn().mockResolvedValue({ data: { id: 'comm-1' }, error: null })
    chain.update = vi.fn(() => chain)
    chain.eq = vi.fn().mockResolvedValue({ error: null })
    return chain
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'recruitment_candidate_appointments') return appointmentsQuery()
      if (table === 'recruitment_applications') return singleRowTable(APPLICATION)
      if (table === 'recruitment_email_templates') return singleRowTable(REMINDER_TEMPLATE)
      if (table === 'recruitment_communications') return communicationsTable()
      if (table === 'recruitment_candidates') {
        return singleRowTable({ id: 'candidate-1', phone: '07700900123', phone_e164: '+447700900123', sms_consent: true })
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  } as any

  return {
    supabase,
    state,
    stampWrites,
    newRun() {
      sentSinceLastStamp = false
    },
  }
}

describe('sendDueRecruitmentAppointmentReminders: claim before send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RECRUITMENT_FROM_EMAIL = 'peter@orangejelly.co.uk'
  })

  it('claims the email stamp, sends once and keeps the stamp', async () => {
    const db = createFakeDb(makeAppointment())

    const result = await sendDueRecruitmentAppointmentReminders(db.supabase)

    expect(result).toEqual({ processed: 1, emailSent: 1, smsSent: 0, failed: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(db.state.appointment.reminder_email_sent_at).toEqual(expect.any(String))
    // The stamp was claimed conditionally and before the send, and never released.
    expect(db.stampWrites).toEqual([
      expect.objectContaining({ marker: 'reminder_email_sent_at', conditional: 'is-null', applied: true }),
    ])
  })

  it('sends nothing when another run has already claimed the reminder', async () => {
    const db = createFakeDb(makeAppointment())
    // Another run claimed it between this run's read and its claim.
    const listed = { ...db.state.appointment }
    db.state.appointment.reminder_email_sent_at = '2026-10-14T09:00:00.000Z'
    const originalFrom = db.supabase.from
    let listedOnce = false
    db.supabase.from = vi.fn((table: string) => {
      const query = originalFrom(table)
      if (table === 'recruitment_candidate_appointments' && !listedOnce) {
        listedOnce = true
        query.limit = vi.fn(async () => ({ data: [listed], error: null }))
      }
      return query
    })

    const result = await sendDueRecruitmentAppointmentReminders(db.supabase)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 1, emailSent: 0, smsSent: 0, failed: 0 })
    expect(db.state.appointment.reminder_email_sent_at).toBe('2026-10-14T09:00:00.000Z')
  })

  it('sends nothing and reports the error when the claim is refused', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb(makeAppointment(), { claimError: { message: 'permission denied', code: '42501' } })

    const result = await sendDueRecruitmentAppointmentReminders(db.supabase)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 1, emailSent: 0, smsSent: 0, failed: 1 })
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[recruitment_candidate_appointments] Claiming reminder_email_sent_at before sending the reminder failed'),
      expect.objectContaining({ appointmentId: 'appointment-1', code: '42501' }),
    )
    consoleError.mockRestore()
  })

  it('releases the email claim when the send definitely failed, so the next run sends it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb(makeAppointment())
    sendEmail.mockResolvedValueOnce({ success: false, error: 'Email sending is currently suspended', code: 'email_suspended' })

    const first = await sendDueRecruitmentAppointmentReminders(db.supabase)
    expect(first).toEqual({ processed: 1, emailSent: 0, smsSent: 0, failed: 1 })
    expect(db.state.appointment.reminder_email_sent_at).toBeNull()
    expect(db.stampWrites.map(write => write.conditional)).toEqual(['is-null', 'eq-value'])

    db.newRun()
    const second = await sendDueRecruitmentAppointmentReminders(db.supabase)
    expect(second).toEqual({ processed: 1, emailSent: 1, smsSent: 0, failed: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(db.state.appointment.reminder_email_sent_at).toEqual(expect.any(String))
    consoleError.mockRestore()
  })

  it('keeps the email claim when the send outcome is unknown, and never retries it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb(makeAppointment())
    sendEmail.mockResolvedValueOnce({ success: false, error: 'socket hang up', uncertain: true })

    const first = await sendDueRecruitmentAppointmentReminders(db.supabase)
    expect(first).toEqual({ processed: 1, emailSent: 0, smsSent: 0, failed: 1 })
    expect(db.state.appointment.reminder_email_sent_at).toEqual(expect.any(String))
    expect(db.stampWrites.map(write => write.conditional)).toEqual(['is-null'])
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('outcome unknown'),
      expect.objectContaining({ appointmentId: 'appointment-1' }),
    )

    db.newRun()
    await sendDueRecruitmentAppointmentReminders(db.supabase)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it('sends the reminder email at most once across two runs when the stamp write after the send fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb(makeAppointment(), { failStampWritesAfterSend: true })

    await sendDueRecruitmentAppointmentReminders(db.supabase)
    db.newRun()
    await sendDueRecruitmentAppointmentReminders(db.supabase)

    expect(sendEmail).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it('claims the SMS stamp, sends once and keeps the stamp', async () => {
    const db = createFakeDb(makeAppointment({
      reminder_email_sent_at: '2026-10-14T08:00:00.000Z',
      candidate: { id: 'candidate-1', sms_consent: true },
    }))

    const result = await sendDueRecruitmentAppointmentReminders(db.supabase)

    expect(result).toEqual({ processed: 1, emailSent: 0, smsSent: 1, failed: 0 })
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(db.state.appointment.reminder_sms_sent_at).toEqual(expect.any(String))
    expect(db.stampWrites).toEqual([
      expect.objectContaining({ marker: 'reminder_sms_sent_at', conditional: 'is-null', applied: true }),
    ])
  })

  it('releases the SMS claim when the text was not sent, so the next run sends it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb(makeAppointment({
      reminder_email_sent_at: '2026-10-14T08:00:00.000Z',
      candidate: { id: 'candidate-1', sms_consent: true },
    }))
    sendSMS.mockResolvedValueOnce({ success: false, error: 'SMS sending is currently suspended', code: 'sms_suspended' })

    const first = await sendDueRecruitmentAppointmentReminders(db.supabase)
    expect(first).toEqual({ processed: 1, emailSent: 0, smsSent: 0, failed: 1 })
    expect(db.state.appointment.reminder_sms_sent_at).toBeNull()

    db.newRun()
    const second = await sendDueRecruitmentAppointmentReminders(db.supabase)
    expect(second).toEqual({ processed: 1, emailSent: 0, smsSent: 1, failed: 0 })
    expect(sendSMS).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  it('sends no SMS and reports the error when the SMS claim is refused', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const refused = createFakeDb(makeAppointment({
      reminder_email_sent_at: '2026-10-14T08:00:00.000Z',
      candidate: { id: 'candidate-1', sms_consent: true },
    }), { claimError: { message: 'permission denied', code: '42501' } })

    const result = await sendDueRecruitmentAppointmentReminders(refused.supabase)

    expect(sendSMS).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 1, emailSent: 0, smsSent: 0, failed: 1 })
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Claiming reminder_sms_sent_at before sending the reminder failed'),
      expect.objectContaining({ appointmentId: 'appointment-1', code: '42501' }),
    )
    consoleError.mockRestore()
  })

  it('sends the reminder SMS at most once across two runs when the stamp write after the send fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = createFakeDb(makeAppointment({
      reminder_email_sent_at: '2026-10-14T08:00:00.000Z',
      candidate: { id: 'candidate-1', sms_consent: true },
    }), { failStampWritesAfterSend: true })

    await sendDueRecruitmentAppointmentReminders(db.supabase)
    db.newRun()
    await sendDueRecruitmentAppointmentReminders(db.supabase)

    expect(sendSMS).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })
})
