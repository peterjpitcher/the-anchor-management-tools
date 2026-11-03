// Today's birthday reminder claim, run through the real idempotency helpers on an in-memory
// idempotency_keys table.
//
// Two gaps (siblings review, 2 November 2026). A send the email service did not confirm keeps its
// claim on purpose, so nothing resends it automatically, but for the next ten minutes a press of
// the Birthdays button was told, as a success, that the reminder "has already been dealt with",
// and sent nothing, even when the manager had just said it never arrived. A press in that window
// is now a warning that says to check with the manager and the London time it can be sent from.
// And when the run record failed to save after a successful send, the claim was left as plain
// "processing", so a press ten minutes later sent the manager a second copy. The answer is now
// written into the claim as well, and a run that cannot be recorded at all says so.
//
// sendEmail is mocked: nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { key: string; request_hash: string; response: unknown; expires_at: string | null }

const db = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  employees: [] as unknown[],
  faults: { upsert: false, commit: false },
  /** Reads of the table so far, and the one from which reads fail (null: none fail). */
  reads: 0,
  failReadsFrom: null as number | null,
}))
const sendEmailMock = vi.hoisted(() => vi.fn())

const CONNECTION_FAILURE = { code: '08006', message: 'connection failure' }

/** Just enough of PostgREST's builder for lib/api/idempotency.ts on one table. */
class IdempotencyQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private mode: 'select' | 'update' | 'delete' = 'select'
  private filters: Array<(row: Row) => boolean> = []
  private values: Partial<Row> = {}

  insert(row: Row) {
    if (db.rows.has(row.key)) return { error: { code: '23505', message: 'duplicate key' } }
    db.rows.set(row.key, { ...row })
    return { error: null }
  }

  upsert(row: Row) {
    if (db.faults.upsert) return { error: CONNECTION_FAILURE }
    db.rows.set(row.key, { ...row })
    return { error: null }
  }

  select() {
    return this
  }

  update(values: Partial<Row>) {
    this.mode = 'update'
    this.values = values
    return this
  }

  delete() {
    this.mode = 'delete'
    return this
  }

  eq(column: keyof Row, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  lt(column: keyof Row, value: string) {
    this.filters.push((row) => String(row[column]) < value)
    return this
  }

  filter(column: string, operator: string, value: unknown) {
    const field = column.replace(/^response->>/, '')
    this.filters.push((row) => {
      const actual = (row.response as Record<string, unknown> | null)?.[field]
      return operator === 'is' ? actual == null : actual === value
    })
    return this
  }

  maybeSingle() {
    return Promise.resolve(this.run())
  }

  then<A = { data: unknown; error: unknown }, B = never>(
    onFulfilled?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected)
  }

  private run(): { data: unknown; error: unknown } {
    const matches = [...db.rows.values()].filter((row) => this.filters.every((keep) => keep(row)))
    if (this.mode === 'update') {
      const committing = (this.values.response as { committed_response?: unknown } | undefined)?.committed_response
      if (db.faults.commit && committing !== undefined) return { data: null, error: CONNECTION_FAILURE }
      for (const row of matches) db.rows.set(row.key, { ...row, ...this.values })
      return { data: matches[0] ? { key: matches[0].key } : null, error: null }
    }
    if (this.mode === 'delete') {
      for (const row of matches) db.rows.delete(row.key)
      return { data: null, error: null }
    }
    db.reads += 1
    if (db.failReadsFrom !== null && db.reads >= db.failReadsFrom) return { data: null, error: CONNECTION_FAILURE }
    return { data: matches[0] ? { ...matches[0] } : null, error: null }
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'idempotency_keys') return new IdempotencyQuery()
      if (table === 'employees') {
        const not = () => Promise.resolve({ data: db.employees, error: null })
        return { select: () => ({ in: () => ({ not }) }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: sendEmailMock }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))

import { BIRTHDAY_REMINDER_MESSAGES, sendBirthdayRemindersInternal } from '@/lib/employees/birthday-reminders'

function dueAWeekFrom(dateOfBirth: string) {
  return [{
    employee_id: '00000000-0000-4000-8000-000000000001',
    first_name: 'Sam',
    last_name: 'Rowe',
    preferred_name: null,
    job_title: 'Bar Staff',
    date_of_birth: dateOfBirth,
    email_address: null,
  }]
}

function at(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant))
}

const MAY_HAVE_GONE = { success: false, error: 'Request timed out', uncertain: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  db.rows.clear()
  db.faults = { upsert: false, commit: false }
  db.reads = 0
  db.failReadsFrom = null
  // 09:00 GMT on Monday 2 November 2026: a birthday on 9 November is a week away.
  db.employees = dueAWeekFrom('1990-11-09')
  sendEmailMock.mockResolvedValue({ success: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a press after a send that may have gone', () => {
  it('is a warning that says to check with the manager and when it can be sent, and sends nothing', async () => {
    at('2026-11-02T09:00:00Z')
    sendEmailMock.mockResolvedValueOnce(MAY_HAVE_GONE)
    expect(await sendBirthdayRemindersInternal(7)).toEqual({ error: BIRTHDAY_REMINDER_MESSAGES.uncertain, uncertain: true })

    at('2026-11-02T09:04:00Z')
    const press = await sendBirthdayRemindersInternal(7)

    expect(press).toEqual({ warning: BIRTHDAY_REMINDER_MESSAGES.inProgress('09:11') })
    expect(press.warning).toMatch(/may already have reached the manager/)
    expect(press.warning).toMatch(/Check with the manager before sending it again/)
    expect(press).not.toHaveProperty('success')
    expect(press.warning).not.toMatch(/already been dealt with/)
    // No automatic resend.
    expect(sendEmailMock).toHaveBeenCalledOnce()
  })

  it('gives the London time in summer, not the server clock', async () => {
    // 09:00 BST on Thursday 17 September 2026 is 08:00 UTC; a birthday on 24 September is a week away.
    db.employees = dueAWeekFrom('1990-09-24')
    at('2026-09-17T08:00:00Z')
    sendEmailMock.mockResolvedValueOnce(MAY_HAVE_GONE)
    await sendBirthdayRemindersInternal(7)

    at('2026-09-17T08:03:00Z')
    const press = await sendBirthdayRemindersInternal(7)

    expect(press.warning).toBe(BIRTHDAY_REMINDER_MESSAGES.inProgress('09:11'))
    expect(sendEmailMock).toHaveBeenCalledOnce()
  })

  it('names a time that is never too early when the claim cannot be read', async () => {
    at('2026-11-02T09:00:00Z')
    sendEmailMock.mockResolvedValueOnce(MAY_HAVE_GONE)
    await sendBirthdayRemindersInternal(7)

    at('2026-11-02T09:04:30Z')
    // The claim's own read works (it finds the claim held); the read for its time fails.
    db.failReadsFrom = db.reads + 2
    const press = await sendBirthdayRemindersInternal(7)

    // Counted from now, the latest the claim can have been taken.
    expect(press.warning).toBe(BIRTHDAY_REMINDER_MESSAGES.inProgress('09:15'))
    expect(sendEmailMock).toHaveBeenCalledOnce()
  })

  it('lets a person who has checked with the manager send it once the claim goes stale', async () => {
    at('2026-11-02T09:00:00Z')
    sendEmailMock.mockResolvedValueOnce(MAY_HAVE_GONE)
    await sendBirthdayRemindersInternal(7)

    at('2026-11-02T09:11:00Z')
    const press = await sendBirthdayRemindersInternal(7)

    expect(press).toMatchObject({ success: true, sent: 1 })
    expect(sendEmailMock).toHaveBeenCalledTimes(2)
  })
})

describe('a sent reminder whose run record fails to save', () => {
  it('is written into the claim, so no press that day sends a second copy', async () => {
    at('2026-11-02T09:00:00Z')
    db.faults.upsert = true
    const run = await sendBirthdayRemindersInternal(7)
    expect(run).toEqual({ success: true, sent: 1, message: 'Birthday reminder sent for 1 employee' })

    // Inside the ten minutes: done, not "may have gone".
    at('2026-11-02T09:05:00Z')
    expect(await sendBirthdayRemindersInternal(7)).toEqual({
      success: true,
      sent: 0,
      message: BIRTHDAY_REMINDER_MESSAGES.alreadyDone,
    })

    // After the claim goes stale, when a plain processing claim was handed to the next press.
    at('2026-11-02T09:30:00Z')
    expect(await sendBirthdayRemindersInternal(7)).toMatchObject({ success: true, sent: 0 })
    at('2026-11-02T16:00:00Z')
    expect(await sendBirthdayRemindersInternal(7)).toMatchObject({ success: true, sent: 0 })

    expect(sendEmailMock).toHaveBeenCalledOnce()
  })

  it('says it went but could not be recorded when neither write saves', async () => {
    at('2026-11-02T09:00:00Z')
    db.faults.upsert = true
    db.faults.commit = true

    const run = await sendBirthdayRemindersInternal(7)

    expect(run).toEqual({
      success: true,
      sent: 1,
      unrecorded: true,
      message: `Birthday reminder sent for 1 employee, ${BIRTHDAY_REMINDER_MESSAGES.unrecorded}`,
    })
    expect(run.message).toMatch(/Do not send it again today/)
    expect(run.message).not.toMatch(/connection failure/)
    expect(sendEmailMock).toHaveBeenCalledOnce()
  })

  it('does not flag a day with nothing to send', async () => {
    at('2026-11-02T09:00:00Z')
    db.employees = dueAWeekFrom('1990-11-10')
    db.faults.upsert = true
    db.faults.commit = true

    const run = await sendBirthdayRemindersInternal(7)

    expect(run).toEqual({ success: true, sent: 0, message: 'No birthdays exactly 7 days away' })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})

describe('a send refused because email is switched off', () => {
  const SWITCHED_OFF = { success: false, error: 'Email sending is currently suspended', code: 'email_suspended' }

  it('says email is switched off, not "try again later", and frees the day', async () => {
    at('2026-11-02T09:00:00Z')
    sendEmailMock.mockResolvedValueOnce(SWITCHED_OFF)

    const run = await sendBirthdayRemindersInternal(7)

    expect(run).toEqual({ error: BIRTHDAY_REMINDER_MESSAGES.suspended })
    expect(run.error).toMatch(/switched off/)
    expect(run.error).toMatch(/was not sent/)
    expect(run.error).not.toMatch(/try again later/i)
    expect(run.error).not.toMatch(/currently suspended/)
    expect(run).not.toHaveProperty('uncertain')
    // Nothing went, so the claim is released straight away.
    expect(db.rows.size).toBe(0)

    // Once email is back on, a press sends it.
    at('2026-11-02T09:01:00Z')
    expect(await sendBirthdayRemindersInternal(7)).toMatchObject({ success: true, sent: 1 })
    expect(sendEmailMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the plain "not sent" message for any other refusal', async () => {
    at('2026-11-02T09:00:00Z')
    sendEmailMock.mockResolvedValueOnce({ success: false, error: 'Resend 422: invalid from address' })

    expect(await sendBirthdayRemindersInternal(7)).toEqual({ error: BIRTHDAY_REMINDER_MESSAGES.notSent })
  })
})
