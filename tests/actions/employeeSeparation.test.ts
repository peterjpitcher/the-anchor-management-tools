import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn((callback: () => void) => callback()) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/audit-helpers', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/email/employee-invite-emails', () => ({ sendSeparationStartedEmail: vi.fn() }))
vi.mock('@/lib/google-calendar-rota', () => ({ syncRotaWeekToCalendar: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { beginEmployeeSeparation, getEmployeeSeparationPreview } from '@/app/actions/employeeSeparation'
import { getCurrentUser } from '@/lib/audit-helpers'
import { sendSeparationStartedEmail } from '@/lib/email/employee-invite-emails'
import { InviteEmailSendError } from '@/lib/employees/invite-email-failure'
import { createAdminClient } from '@/lib/supabase/admin'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedUser = getCurrentUser as unknown as Mock
const mockedSendEmail = sendSeparationStartedEmail as unknown as Mock
const mockedAdmin = createAdminClient as unknown as Mock

function employeeQuery(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }
}

function shiftsQuery(data: unknown, error: unknown = null) {
  const secondOrder = vi.fn().mockResolvedValue({ data, error })
  const firstOrder = vi.fn().mockReturnValue({ order: secondOrder })
  const gte = vi.fn().mockReturnValue({ order: firstOrder })
  const thirdEq = vi.fn().mockReturnValue({ gte })
  const secondEq = vi.fn().mockReturnValue({ eq: thirdEq })
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
  return { select: vi.fn().mockReturnValue({ eq: firstEq }) }
}

// No lower date bound: a last working day can be set in the past, and leave between it and today
// is removed when they are marked as Former, so the preview has to see it too.
function leaveQuery(data: unknown, error: unknown = null) {
  const order = vi.fn().mockResolvedValue({ data, error })
  const statusIn = vi.fn().mockReturnValue({ order })
  const firstEq = vi.fn().mockReturnValue({ in: statusIn })
  return { select: vi.fn().mockReturnValue({ eq: firstEq }), statusIn }
}

function mutationClient(rpcData: unknown, rpcError: unknown = null) {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError })
  const from = vi.fn((table: string) => {
    if (table === 'employees') {
      return employeeQuery({
        email_address: 'alex@example.com',
        first_name: 'Alex',
        last_name: 'Rowe',
        employment_start_date: '2099-05-01',
        status: 'Active',
      })
    }
    if (table === 'employee_notes') return { insert }
    throw new Error(`Unexpected table: ${table}`)
  })
  return { from, rpc, insert }
}

describe('employee separation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-05-13T11:00:00.000Z'))
    mockedPermission.mockResolvedValue(true)
    mockedUser.mockResolvedValue({ user_id: '00000000-0000-0000-0000-000000000099', user_email: 'manager@example.com' })
    mockedSendEmail.mockResolvedValue({ success: true })
    mockedAudit.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads only assigned shifts which have not started yet', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'employees') return employeeQuery({ employment_start_date: '2099-05-01', status: 'Active' })
      if (table === 'rota_shifts') {
        return shiftsQuery([
          {
            id: '30000000-0000-0000-0000-000000000001',
            week_id: '10000000-0000-0000-0000-000000000001',
            shift_date: '2099-05-13',
            start_time: '11:00:00',
            end_time: '12:00:00',
            department: 'bar',
            name: 'Started',
            acceptance_status: 'accepted',
            rota_weeks: { status: 'published' },
          },
          {
            id: '30000000-0000-0000-0000-000000000002',
            week_id: '10000000-0000-0000-0000-000000000001',
            shift_date: '2099-05-13',
            start_time: '13:00:00',
            end_time: '17:00:00',
            department: 'bar',
            name: 'Later',
            acceptance_status: 'pending',
            rota_weeks: [{ status: 'published' }],
          },
        ])
      }
      if (table === 'leave_days') {
        return leaveQuery([
          { leave_date: '2099-05-20', leave_requests: { status: 'approved' } },
          { leave_date: '2099-05-27', leave_requests: [{ status: 'pending' }] },
        ])
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    mockedAdmin.mockReturnValue({ from })

    const result = await getEmployeeSeparationPreview('00000000-0000-0000-0000-000000000001')

    expect(result).toEqual({
      success: true,
      data: {
        employmentStartDate: '2099-05-01',
        shifts: [{
          id: '30000000-0000-0000-0000-000000000002',
          weekId: '10000000-0000-0000-0000-000000000001',
          shiftDate: '2099-05-13',
          startTime: '13:00:00',
          endTime: '17:00:00',
          department: 'bar',
          name: 'Later',
          weekStatus: 'published',
          acceptanceStatus: 'pending',
        }],
        futureLeaveDates: ['2099-05-20'],
        pendingLeaveDates: ['2099-05-27'],
      },
    })
  })

  it('rejects a last working day on or before the employment start date', async () => {
    const client = mutationClient(null)
    mockedAdmin.mockReturnValue(client)

    const result = await beginEmployeeSeparation('00000000-0000-0000-0000-000000000001', {
      employmentEndDate: '2099-05-01',
      shiftPolicy: 'work_remaining',
    })

    expect(result).toEqual({ success: false, error: 'Last working day must be after Friday, 1 May 2099.' })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('starts separation, records the decision and emails only retained shifts', async () => {
    const retained = {
      id: '30000000-0000-0000-0000-000000000002',
      week_id: '10000000-0000-0000-0000-000000000001',
      shift_date: '2099-05-14',
      start_time: '09:00:00',
      end_time: '17:00:00',
      department: 'bar',
      name: 'Day',
      acceptance_status: 'accepted',
      week_status: 'published',
    }
    const released = {
      ...retained,
      id: '30000000-0000-0000-0000-000000000003',
      shift_date: '2099-05-16',
    }
    const client = mutationClient({
      state: 'started',
      retained_shifts: [retained],
      released_shifts: [released],
      affected_published_week_ids: [],
    })
    mockedAdmin.mockReturnValue(client)

    const result = await beginEmployeeSeparation('00000000-0000-0000-0000-000000000001', {
      employmentEndDate: '2099-05-15',
      shiftPolicy: 'work_remaining',
      note: 'Notice given',
    })

    expect(result).toEqual({ success: true, retainedShiftCount: 1, releasedShiftCount: 1 })
    expect(client.rpc).toHaveBeenCalledWith('begin_employee_separation', expect.objectContaining({
      p_shift_policy: 'work_remaining',
      p_employment_end_date: '2099-05-15',
    }))
    expect(client.insert).toHaveBeenCalledWith(expect.objectContaining({
      note_text: expect.stringContaining('1 remaining shift retained; 1 released to open shifts.'),
    }))
    // The date as the employee page shows it, not the stored 2099-05-15.
    const noteText = client.insert.mock.calls[0][0].note_text as string
    expect(noteText).toContain('Last working day: 15 May 2099.')
    expect(noteText).not.toContain('2099-05-15')
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      shiftPolicy: 'work_remaining',
      remainingShifts: [expect.objectContaining({ id: retained.id, shiftDate: '2099-05-14' })],
    }))
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      new_values: expect.objectContaining({ separation_shift_policy: 'work_remaining' }),
      additional_info: {
        retained_shift_ids: [retained.id],
        released_shift_ids: [released.id],
      },
    }))
  })

  describe('when the employee email does not go', () => {
    const released = {
      id: '30000000-0000-0000-0000-000000000003',
      week_id: '10000000-0000-0000-0000-000000000001',
      shift_date: '2099-05-14',
      start_time: '09:00:00',
      end_time: '17:00:00',
      department: 'bar',
      name: 'Day',
      acceptance_status: 'accepted',
      week_status: 'published',
    }

    async function beginWithFailedEmail(emailError: unknown) {
      const client = mutationClient({
        state: 'started',
        retained_shifts: [],
        released_shifts: [released],
        affected_published_week_ids: [],
      })
      mockedAdmin.mockReturnValue(client)
      mockedSendEmail.mockRejectedValue(emailError)
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await beginEmployeeSeparation('00000000-0000-0000-0000-000000000001', {
        employmentEndDate: '2099-05-15',
        shiftPolicy: 'release_remaining',
      })
      const logged = consoleError.mock.calls
      consoleError.mockRestore()
      return { client, result, logged }
    }

    it('keeps the committed release and says a refused email was not sent', async () => {
      const { client, result, logged } = await beginWithFailedEmail(
        new InviteEmailSendError('Resend 422: invalid to address'),
      )

      expect(result).toEqual({
        success: true,
        retainedShiftCount: 0,
        releasedShiftCount: 1,
        warning: 'Separation was started and the rota was updated, but the separation email was not sent because the email service did not accept it. Send it to them yourself.',
      })
      expect(client.rpc).toHaveBeenCalledTimes(1)
      expect(mockedSendEmail).toHaveBeenCalledTimes(1)
      // The provider's own text goes to the log, never to the screen.
      expect(JSON.stringify(result)).not.toContain('Resend 422')
      expect(logged).toContainEqual([
        '[beginEmployeeSeparation] Failed to send separation email:',
        { uncertain: false, code: null, message: 'Resend 422: invalid to address' },
      ])
    })

    // The provider may have taken it, so staff must not be told it was not sent, or to send it
    // again, until they have checked with the person. Nothing sends it again on its own.
    it('says an email we did not hear back about may have gone', async () => {
      const { result, logged } = await beginWithFailedEmail(
        new InviteEmailSendError('Resend timed out', { uncertain: true }),
      )

      expect(result).toEqual({
        success: true,
        retainedShiftCount: 0,
        releasedShiftCount: 1,
        warning: 'Separation was started and the rota was updated. We sent the separation email to alex@example.com, but we did not hear back from the email service, so it may have gone. Check with them before sending it again.',
      })
      expect(result.success && result.warning).not.toMatch(/not sent|could not be sent|send it to them yourself/i)
      expect(mockedSendEmail).toHaveBeenCalledTimes(1)
      expect(logged).toContainEqual([
        '[beginEmployeeSeparation] Failed to send separation email:',
        { uncertain: true, code: null, message: 'Resend timed out' },
      ])
    })

    it('says email sending is switched off when it is suspended', async () => {
      const { result } = await beginWithFailedEmail(
        new InviteEmailSendError('Email sending is currently suspended', { code: 'email_suspended' }),
      )

      expect(result).toEqual({
        success: true,
        retainedShiftCount: 0,
        releasedShiftCount: 1,
        warning: 'Separation was started and the rota was updated, but the separation email was not sent because email sending is switched off at the moment. Send it to them yourself.',
      })
    })

    it('says it was not sent when it failed before reaching the email service', async () => {
      const { result } = await beginWithFailedEmail(new Error('Invalid time value'))

      expect(result).toEqual({
        success: true,
        retainedShiftCount: 0,
        releasedShiftCount: 1,
        warning: 'Separation was started and the rota was updated, but the separation email was not sent because something went wrong before it could be sent. Send it to them yourself.',
      })
      expect(JSON.stringify(result)).not.toContain('Invalid time value')
    })
  })

  it('reports a database failure without sending an email', async () => {
    const client = mutationClient(null, { code: 'XX000', message: 'transaction failed', details: null, hint: null })
    mockedAdmin.mockReturnValue(client)

    const result = await beginEmployeeSeparation('00000000-0000-0000-0000-000000000001', {
      employmentEndDate: '2099-05-15',
      shiftPolicy: 'release_remaining',
    })

    expect(result).toEqual({ success: false, error: 'Failed to start separation and update the rota.' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })
})
