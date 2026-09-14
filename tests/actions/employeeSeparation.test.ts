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

function leaveQuery(data: unknown, error: unknown = null) {
  const order = vi.fn().mockResolvedValue({ data, error })
  const secondEq = vi.fn().mockReturnValue({ order })
  const gte = vi.fn().mockReturnValue({ eq: secondEq })
  const firstEq = vi.fn().mockReturnValue({ gte })
  return { select: vi.fn().mockReturnValue({ eq: firstEq }) }
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
      if (table === 'leave_days') return leaveQuery([{ leave_date: '2099-05-20' }])
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

  it('keeps the committed release when the employee email fails', async () => {
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
    const client = mutationClient({
      state: 'started',
      retained_shifts: [],
      released_shifts: [released],
      affected_published_week_ids: [],
    })
    mockedAdmin.mockReturnValue(client)
    mockedSendEmail.mockRejectedValue(new Error('Resend unavailable'))

    const result = await beginEmployeeSeparation('00000000-0000-0000-0000-000000000001', {
      employmentEndDate: '2099-05-15',
      shiftPolicy: 'release_remaining',
    })

    expect(result).toEqual({
      success: true,
      retainedShiftCount: 0,
      releasedShiftCount: 1,
      warning: 'Separation was started and the rota was updated, but the employee email could not be sent. Send it manually.',
    })
    expect(client.rpc).toHaveBeenCalledTimes(1)
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
