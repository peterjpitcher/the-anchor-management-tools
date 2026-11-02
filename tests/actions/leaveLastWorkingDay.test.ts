// Leave and the end of employment (FF-41, FF-45).
//
// Marking a leaver as Former is refused while any leave day sits after their last working day,
// but neither booking path checked that day. Leave booked past it stalled the separation, and
// the nightly job then skipped the person every night. A former employee could also be given
// leave. Both booking paths now refuse.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/rota-settings', () => ({ getRotaSettings: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/rota/email-templates', () => ({
  buildHolidaySubmittedEmailHtml: vi.fn(),
  buildHolidayDecisionEmailHtml: vi.fn(),
}))
vi.mock('@/services/employee-reliability', () => ({
  recordHolidayAuditOnly: vi.fn(),
  recordHolidayReliabilityEvents: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRotaSettings } from '@/app/actions/rota-settings'
import { bookApprovedHoliday, reviewLeaveRequest, submitLeaveRequest } from '@/app/actions/leave'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetRotaSettings = getRotaSettings as unknown as Mock

const EMPLOYEE_ID = '33333333-3333-3333-3333-333333333333'
const REQUEST_ID = '11111111-1111-1111-1111-111111111111'

/** The service-role client: the employment check, and the booking RPC if it gets that far. */
function adminFor(employee: { status: string; employment_end_date: string | null } | null) {
  const rpc = vi.fn().mockResolvedValue({
    data: { status: 'booked', request_id: REQUEST_ID, leave_dates: ['2099-06-10'] },
    error: null,
  })
  const from = vi.fn((table: string) => {
    if (table !== 'employees') throw new Error(`Unexpected admin table: ${table}`)
    return {
      select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: employee, error: null }) }) }),
    }
  })
  mockedCreateAdminClient.mockReturnValue({ rpc, from })
  return { rpc }
}

function sessionClient() {
  const insert = vi.fn()
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } }) },
    from: vi.fn(() => ({ insert, select: vi.fn() })),
  })
  return { insert }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPermission.mockResolvedValue(true)
  mockedGetRotaSettings.mockResolvedValue({ holidayYearStartMonth: 4, holidayYearStartDay: 1, defaultHolidayDays: 28 })
})

describe('bookApprovedHoliday and the last working day', () => {
  it('refuses holiday that runs past the last working day of someone on notice', async () => {
    sessionClient()
    const { rpc } = adminFor({ status: 'Started Separation', employment_end_date: '2099-06-08' })

    const result = await bookApprovedHoliday({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-10' })

    expect(result).toEqual({
      success: false,
      error: 'Holiday cannot run past 08 June 2099, the last working day before leaving.',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('books holiday that ends on the last working day', async () => {
    sessionClient()
    const { rpc } = adminFor({ status: 'Started Separation', employment_end_date: '2099-06-10' })

    const result = await bookApprovedHoliday({ employeeId: EMPLOYEE_ID, startDate: '2099-06-10', endDate: '2099-06-10' })

    expect(result.success).toBe(true)
    expect(rpc).toHaveBeenCalledWith('book_approved_leave_with_rota_guard', expect.objectContaining({ p_end_date: '2099-06-10' }))
  })

  it('refuses holiday for a former employee', async () => {
    sessionClient()
    const { rpc } = adminFor({ status: 'Former', employment_end_date: '2099-01-01' })

    const result = await bookApprovedHoliday({ employeeId: EMPLOYEE_ID, startDate: '2099-06-10', endDate: '2099-06-10' })

    expect(result).toEqual({ success: false, error: 'This person has left, so holiday cannot be booked for them.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('submitLeaveRequest and the last working day', () => {
  it('refuses a request that runs past the last working day, before anything is written', async () => {
    const { insert } = sessionClient()
    adminFor({ status: 'Started Separation', employment_end_date: '2099-06-08' })

    const result = await submitLeaveRequest({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-09' })

    expect(result).toEqual({
      success: false,
      error: 'Holiday cannot run past 08 June 2099, the last working day before leaving.',
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it('fails closed when the employee record cannot be read', async () => {
    const { insert } = sessionClient()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedCreateAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } }) }),
        }),
      }),
    })

    const result = await submitLeaveRequest({ employeeId: EMPLOYEE_ID, startDate: '2099-06-07', endDate: '2099-06-09' })

    expect(result).toEqual({
      success: false,
      error: 'Could not check the employee record, so the holiday was not saved. Please try again.',
    })
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('reviewLeaveRequest and the last working day', () => {
  function pendingRequestClient() {
    const update = vi.fn()
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } }) },
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: REQUEST_ID,
                status: 'pending',
                start_date: '2099-06-07',
                end_date: '2099-06-10',
                employee_id: EMPLOYEE_ID,
                note: null,
                created_at: '2099-05-01T09:00:00Z',
                employees: { email_address: 'sam@example.com', first_name: 'Sam', preferred_name: null },
              },
              error: null,
            }),
          }),
        }),
        update,
      })),
    })
    return { update }
  }

  it('refuses to approve holiday that runs past the last working day of someone on notice', async () => {
    pendingRequestClient()
    const { rpc } = adminFor({ status: 'Started Separation', employment_end_date: '2099-06-08' })

    const result = await reviewLeaveRequest(REQUEST_ID, 'approved')

    expect(result).toEqual({
      success: false,
      error: 'Holiday cannot run past 08 June 2099, the last working day before leaving.',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses to approve holiday for someone who has left', async () => {
    pendingRequestClient()
    const { rpc } = adminFor({ status: 'Former', employment_end_date: '2099-06-01' })

    const result = await reviewLeaveRequest(REQUEST_ID, 'approved')

    expect(result).toEqual({ success: false, error: 'This person has left, so holiday cannot be booked for them.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
