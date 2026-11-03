import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/google-calendar-birthdays', () => ({
  syncBirthdayCalendarEvent: vi.fn(),
  deleteBirthdayCalendarEvent: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  EmergencyContactSchema,
  EmployeeService,
  EmployeeServiceError,
  FinancialDetailsSchema,
  LoginLeftMovedError,
  RightToWorkSchema,
  employeeSchema,
  noteSchema,
} from '@/services/employees'
import {
  APP_LOGIN_CHECK_FAILED,
  APP_LOGIN_EMAIL_REFUSAL,
  type LoginMoveAuthority,
} from '@/lib/employees/login-email'

const EMPLOYEE_ID = '3f24f3f6-26bb-4a53-a29a-07b6acffad4f'

type Result = { data?: unknown; error?: unknown; count?: number | null }
type Call = { table: string; method: string; args: unknown[] }

/**
 * A stand-in for the Supabase client. Each `from(table)` takes the next queued result for that
 * table; every chained call is recorded so a test can check what was filtered and written.
 */
function fakeClient(queues: Record<string, Result[]>, extras: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const tablesTouched: string[] = []

  const from = vi.fn((table: string) => {
    tablesTouched.push(table)
    const queue = queues[table]
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected query on ${table}`)
    }
    const result = queue.shift() as Result
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'update', 'delete', 'insert', 'upsert', 'eq', 'is', 'gt', 'in', 'order']) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args })
        return builder
      })
    }
    builder.maybeSingle = vi.fn(() => Promise.resolve(result))
    builder.single = vi.fn(() => Promise.resolve(result))
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
    return builder
  })

  const client = { from, ...extras }
  ;(createAdminClient as unknown as Mock).mockReturnValue(client)
  return { client, calls, tablesTouched }
}

const noBlockers = (): Record<string, Result[]> => ({
  // The training pre-check runs first (tests/services/employees-training-precheck.test.ts).
  training_assignments: [{ count: 0, error: null }],
  training_profiles: [{ count: 0, error: null }],
  training_events: [{ count: 0, error: null }],
  checklist_task_instances: [{ count: 0, error: null }, { count: 0, error: null }],
  checklist_spot_checks: [{ count: 0, error: null }],
  checklist_todos: [{ count: 0, error: null }, { count: 0, error: null }],
  recruitment_candidates: [{ count: 0, error: null }],
  recruitment_appointment_slots: [{ count: 0, error: null }],
  recruitment_candidate_appointments: [{ count: 0, error: null }],
})

const baseEmployeeUpdate = {
  first_name: 'Jacob',
  last_name: 'Williams',
  email_address: 'jacob@example.com',
  job_title: 'Bartender',
  employment_start_date: '2026-05-22',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('staff form schemas', () => {
  it('trims and lower-cases the email address (FF-34)', () => {
    const parsed = employeeSchema.parse({ ...baseEmployeeUpdate, email_address: '  Jacob.W@Example.COM ', status: 'Active' })
    expect(parsed.email_address).toBe('jacob.w@example.com')
  })

  it('refuses a note that is only spaces (FF-38)', () => {
    const result = noteSchema.safeParse({ employee_id: EMPLOYEE_ID, note_text: '   \n ' })
    expect(result.success).toBe(false)
    expect(result.success ? [] : result.error.flatten().fieldErrors.note_text).toContain('Note text cannot be empty.')
  })

  it('needs a phone for a primary contact, but not for a secondary one (FF-30)', () => {
    const primary = EmergencyContactSchema.safeParse({ employee_id: EMPLOYEE_ID, name: 'Sam', priority: 'Primary' })
    expect(primary.success).toBe(false)
    expect(primary.success ? [] : primary.error.flatten().fieldErrors.mobile_number).toContain(
      'A primary contact needs a telephone or mobile number.'
    )

    const blankName = EmergencyContactSchema.safeParse({ employee_id: EMPLOYEE_ID, name: '   ', priority: 'Other', mobile_number: '07561 773635' })
    expect(blankName.success).toBe(false)

    const secondary = EmergencyContactSchema.safeParse({ employee_id: EMPLOYEE_ID, name: 'Sam', priority: 'Secondary' })
    expect(secondary.success).toBe(true)
  })

  it('normalises bank and NI details the way onboarding does (FF-24)', () => {
    const parsed = FinancialDetailsSchema.parse({
      employee_id: EMPLOYEE_ID,
      ni_number: ' ab 12 34 56 c ',
      bank_sort_code: '12 34 56',
      bank_account_number: '1234 5678',
    })
    expect(parsed.ni_number).toBe('AB123456C')
    expect(parsed.bank_sort_code).toBe('12-34-56')
    expect(parsed.bank_account_number).toBe('12345678')

    const blank = FinancialDetailsSchema.parse({ employee_id: EMPLOYEE_ID, ni_number: '  ' })
    expect(blank.ni_number).toBeNull()

    const bad = FinancialDetailsSchema.safeParse({ employee_id: EMPLOYEE_ID, bank_sort_code: '12345' })
    expect(bad.success).toBe(false)
  })

  it('drops a verifier sent from the form (FF-32)', () => {
    const parsed = RightToWorkSchema.parse({
      employee_id: EMPLOYEE_ID,
      document_type: 'Passport',
      verification_date: '2026-11-01',
      verified_by_user_id: 'someone-else',
    })
    expect(parsed).not.toHaveProperty('verified_by_user_id')
  })
})

describe('EmployeeService.updateEmployee status rules (FF-23)', () => {
  it('refuses to start a separation from the edit form, before writing anything', async () => {
    const { tablesTouched } = fakeClient({
      employees: [{ data: { employee_id: EMPLOYEE_ID, status: 'Active' }, error: null }],
    })

    const attempt = EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Started Separation' } as any)
    await expect(attempt).rejects.toBeInstanceOf(EmployeeServiceError)
    await expect(attempt).rejects.toThrow('Use Begin Separation on the employee page')
    // Only the read of the current record: no update was sent.
    expect(tablesTouched).toEqual(['employees'])
  })

  it('points to Cancel Separation when moving a separating employee back to Active', async () => {
    fakeClient({
      employees: [{ data: { employee_id: EMPLOYEE_ID, status: 'Started Separation', employment_end_date: '2026-11-30' }, error: null }],
    })

    await expect(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any)
    ).rejects.toThrow('Use Cancel Separation on the employee page')
  })

  it('refuses a change to the last day while separating, but allows the same date', async () => {
    fakeClient({
      employees: [{ data: { employee_id: EMPLOYEE_ID, status: 'Started Separation', employment_end_date: '2026-11-30' }, error: null }],
    })

    await expect(
      EmployeeService.updateEmployee(EMPLOYEE_ID, {
        ...baseEmployeeUpdate,
        status: 'Started Separation',
        employment_end_date: '2026-12-15',
      } as any)
    ).rejects.toThrow('Their last day is set by the separation')

    fakeClient({
      employees: [
        { data: { employee_id: EMPLOYEE_ID, status: 'Started Separation', employment_end_date: '2026-11-30' }, error: null },
        { data: { employee_id: EMPLOYEE_ID, status: 'Started Separation', employment_end_date: '2026-11-30' }, error: null },
      ],
    })

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, {
      ...baseEmployeeUpdate,
      status: 'Started Separation',
      employment_end_date: '2026-11-30',
    } as any)
    expect(result.onboardingLinks).toBeNull()
  })

  it('closes open onboarding links when a starter is made Active, and writes the PIN in the same update', async () => {
    const { calls } = fakeClient({
      employees: [
        { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding' }, error: null },
        { data: { employee_id: EMPLOYEE_ID, status: 'Active' }, error: null },
      ],
      employee_invite_tokens: [{ data: [{ id: 'invite-1' }], error: null }],
    })

    const result = await EmployeeService.updateEmployee(
      EMPLOYEE_ID,
      { ...baseEmployeeUpdate, status: 'Active' } as any,
      { preferred_name: 'Jake', timeclock_pin_hash: 'hash', timeclock_pin_updated_at: '2026-11-02T10:00:00.000Z' }
    )

    expect(result.onboardingLinks).toEqual({ closed: 1 })

    const employeeUpdate = calls.find((call) => call.table === 'employees' && call.method === 'update')
    expect(employeeUpdate?.args[0]).toMatchObject({ preferred_name: 'Jake', timeclock_pin_hash: 'hash', status: 'Active' })

    const tokenCalls = calls.filter((call) => call.table === 'employee_invite_tokens')
    expect(tokenCalls.find((call) => call.method === 'update')?.args[0]).toHaveProperty('expires_at')
    expect(tokenCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'eq', args: ['employee_id', EMPLOYEE_ID] }),
      expect.objectContaining({ method: 'eq', args: ['invite_type', 'onboarding'] }),
      expect.objectContaining({ method: 'is', args: ['completed_at', null] }),
    ]))
  })

  it('reports, without undoing the activation, when the links cannot be closed', async () => {
    fakeClient({
      employees: [
        { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding' }, error: null },
        { data: { employee_id: EMPLOYEE_ID, status: 'Active' }, error: null },
      ],
      employee_invite_tokens: [{ data: null, error: { message: 'boom' } }],
    })

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any)
    expect(result.updatedEmployee).toMatchObject({ status: 'Active' })
    expect(result.onboardingLinks).toEqual({ failed: true })
  })

  it('says no link was closed when the starter never had one', async () => {
    fakeClient({
      employees: [
        { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding' }, error: null },
        { data: { employee_id: EMPLOYEE_ID, status: 'Active' }, error: null },
      ],
      employee_invite_tokens: [{ data: [], error: null }],
    })

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any)
    expect(result.onboardingLinks).toEqual({ closed: 0 })
  })
})

describe('EmployeeService.updateEmployee moves the login with a new email address (security#1)', () => {
  const OLD_EMAIL = 'jacob.old@example.com'
  // Most tests here are about the move itself, so the editor may move any login.
  const ROLE_MANAGER: LoginMoveAuthority = { editorUserId: 'manager-1', canManageRoles: true }
  const PLAIN_EDITOR: LoginMoveAuthority = { editorUserId: 'manager-1', canManageRoles: false }

  /** What reading the login again, after a move or a put-back reported an error, gives back. */
  type Reread = { email: string | null } | { error: unknown } | { throws: unknown }

  function loginAdmin(options: {
    loginEmail?: string | null
    moveError?: unknown
    restoreError?: unknown
    readError?: unknown
    // Without these, every read gives the first read's answer.
    rereads?: Reread[]
  } = {}) {
    const firstRead = options.readError
      ? { data: { user: null }, error: options.readError }
      : { data: { user: { id: 'auth-1', email: options.loginEmail === undefined ? OLD_EMAIL : options.loginEmail } }, error: null }
    const getUserById = vi.fn().mockResolvedValue(firstRead)
    if (options.rereads) {
      getUserById.mockResolvedValueOnce(firstRead)
      for (const reread of options.rereads) {
        if ('throws' in reread) getUserById.mockRejectedValueOnce(reread.throws)
        else if ('error' in reread) getUserById.mockResolvedValueOnce({ data: { user: null }, error: reread.error })
        else getUserById.mockResolvedValueOnce({ data: { user: { id: 'auth-1', email: reread.email } }, error: null })
      }
    }
    const updateUserById = vi.fn()
      .mockResolvedValueOnce({ data: { user: null }, error: options.moveError ?? null })
      .mockResolvedValueOnce({ data: { user: null }, error: options.restoreError ?? null })
    return { getUserById, updateUserById, auth: { admin: { getUserById, updateUserById } } }
  }

  /** The save's rejection, checked to be the error that says the login was left on the new address. */
  async function leftMovedError(attempt: Promise<unknown>): Promise<LoginLeftMovedError> {
    const reason = await attempt.then(
      () => { throw new Error('Expected the save to fail') },
      (rejection: unknown) => rejection
    )
    expect(reason).toBeInstanceOf(LoginLeftMovedError)
    return reason as LoginLeftMovedError
  }

  const activeWithLogin = { employee_id: EMPLOYEE_ID, status: 'Active', auth_user_id: 'auth-1', email_address: OLD_EMAIL }
  const saved = { employee_id: EMPLOYEE_ID, status: 'Active', email_address: 'jacob@example.com' }
  const profileWritten = (): Result => ({ data: null, error: null })

  it('refuses a new email for a starter who has set a password, before anything is written', async () => {
    const { auth, getUserById, updateUserById } = loginAdmin()
    const { tablesTouched } = fakeClient(
      { employees: [{ data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', auth_user_id: 'auth-1', email_address: 'typo@exmaple.com' }, error: null }] },
      { auth }
    )

    const attempt = EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Onboarding' } as any, {}, ROLE_MANAGER)
    await expect(attempt).rejects.toBeInstanceOf(EmployeeServiceError)
    await expect(attempt).rejects.toThrow('delete this record and invite them again')
    expect(tablesTouched).toEqual(['employees'])
    expect(getUserById).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('lets a starter with no login have their email corrected', async () => {
    const { auth, updateUserById } = loginAdmin()
    const { calls, tablesTouched } = fakeClient(
      {
        employees: [
          { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', auth_user_id: null, email_address: 'typo@exmaple.com' }, error: null },
          { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', email_address: 'jacob@example.com' }, error: null },
        ],
      },
      { auth }
    )

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Onboarding' } as any)

    expect(result.loginEmail).toBeNull()
    expect(updateUserById).not.toHaveBeenCalled()
    expect(tablesTouched).toEqual(['employees', 'employees'])
    expect(calls.find((call) => call.method === 'update')?.args[0]).toMatchObject({ email_address: 'jacob@example.com' })
  })

  it.each(['Active', 'Started Separation'])('moves the login and its profile email before saving the record for someone %s', async (status) => {
    const order: string[] = []
    const { auth, updateUserById } = loginAdmin()
    updateUserById.mockReset().mockImplementation(async () => {
      order.push('auth.updateUserById')
      return { data: { user: null }, error: null }
    })
    const { client, calls } = fakeClient(
      {
        employees: [
          { data: { ...activeWithLogin, status, employment_end_date: null }, error: null },
          { data: { ...saved, status }, error: null },
        ],
        profiles: [profileWritten()],
      },
      { auth }
    )
    const from = client.from as Mock
    const originalFrom = from.getMockImplementation()!
    from.mockImplementation((table: string) => {
      order.push(`from:${table}`)
      return originalFrom(table)
    })

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status } as any, {}, ROLE_MANAGER)

    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(updateUserById).toHaveBeenCalledWith('auth-1', { email: 'jacob@example.com', email_confirm: true })
    expect(result.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    // Read, then the login and the profile that follows it, then the record.
    expect(order).toEqual(['from:employees', 'auth.updateUserById', 'from:profiles', 'from:employees'])
    // The GDPR lookup matches on profiles.email, so it moves with the login.
    const profileCalls = calls.filter((call) => call.table === 'profiles')
    expect(profileCalls).toEqual([
      { table: 'profiles', method: 'update', args: [{ email: 'jacob@example.com' }] },
      { table: 'profiles', method: 'eq', args: ['id', 'auth-1'] },
    ])
  })

  it('still saves when the profile email cannot be updated, and logs it', async () => {
    const { auth, updateUserById } = loginAdmin()
    fakeClient(
      {
        employees: [{ data: activeWithLogin, error: null }, { data: saved, error: null }],
        profiles: [{ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)

    expect(result.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('profile email could not be updated'),
      expect.objectContaining({ employeeId: EMPLOYEE_ID, authUserId: 'auth-1' })
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  it('refuses the save and leaves the record alone when the address already has a login', async () => {
    const { auth, getUserById, updateUserById } = loginAdmin({
      moveError: { code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' },
    })
    const { tablesTouched, calls } = fakeClient(
      { employees: [{ data: activeWithLogin, error: null }] },
      { auth }
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const attempt = EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
    await expect(attempt).rejects.toBeInstanceOf(EmployeeServiceError)
    await expect(attempt).rejects.toThrow('That email address already has its own login')
    expect(tablesTouched).toEqual(['employees'])
    expect(calls.some((call) => call.method === 'update')).toBe(false)
    // Nothing moved, so there is nothing to put back, and a taken address is not read again.
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(getUserById).toHaveBeenCalledTimes(1)
  })

  it('refuses the save when the login cannot be moved for any other reason and reads back on its old address', async () => {
    const { auth, getUserById } = loginAdmin({
      moveError: { status: 500, message: 'Database error updating user' },
      rereads: [{ email: OLD_EMAIL }],
    })
    const { calls, tablesTouched } = fakeClient(
      { employees: [{ data: activeWithLogin, error: null }] },
      { auth }
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = (await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
      .catch((reason: unknown) => reason)) as Error
    expect(error).toBeInstanceOf(EmployeeServiceError)
    expect(error).not.toBeInstanceOf(LoginLeftMovedError)
    expect(error.message).toBe('Their login could not be moved to the new email address, so nothing was saved. Please try again.')
    // Supabase's own text stays in the log.
    expect(error.message).not.toContain('Database error updating user')
    // Read before the move, then again after the error to see where the login is.
    expect(getUserById).toHaveBeenCalledTimes(2)
    expect(getUserById).toHaveBeenNthCalledWith(2, 'auth-1')
    expect(tablesTouched).toEqual(['employees'])
    expect(calls.some((call) => call.method === 'update')).toBe(false)
  })

  it('carries on with the save when the move reported an error but the login holds the new address', async () => {
    const { auth, getUserById, updateUserById } = loginAdmin({
      // Supabase applied the move, then the gateway timed out before it answered.
      moveError: { name: 'AuthRetryableFetchError', status: 504, message: 'Gateway Timeout' },
      // Read back as the login stores it, which need not match the case the form sent.
      rereads: [{ email: 'Jacob@Example.com' }],
    })
    const { calls, tablesTouched } = fakeClient(
      {
        employees: [{ data: activeWithLogin, error: null }, { data: saved, error: null }],
        profiles: [profileWritten()],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)

    // A moved record, so the action writes the success audit row for the login.
    expect(result.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    expect(getUserById).toHaveBeenCalledTimes(2)
    // Nothing is put back: the login is where the record is going.
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(tablesTouched).toEqual(['employees', 'profiles', 'employees'])
    expect(calls.filter((call) => call.table === 'profiles' && call.method === 'update').map((call) => call.args[0])).toEqual([
      { email: 'jacob@example.com' },
    ])
    expect(calls.find((call) => call.table === 'employees' && call.method === 'update')?.args[0]).toMatchObject({
      email_address: 'jacob@example.com',
    })
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('the login holds the new email address, so the save went on'),
      { employeeId: EMPLOYEE_ID, authUserId: 'auth-1' }
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  it.each<[string, Reread]>([
    ['the read reports an error', { error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' } }],
    ['the read throws', { throws: new TypeError('fetch failed') }],
    ['the login comes back without an address', { email: null }],
  ])('refuses, saying it could not confirm whether the login moved, when the move reported an error and %s', async (_label, reread) => {
    const { auth, getUserById, updateUserById } = loginAdmin({
      moveError: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' },
      rereads: [reread],
    })
    const { calls, tablesTouched } = fakeClient(
      { employees: [{ data: activeWithLogin, error: null }] },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = (await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
      .catch((reason: unknown) => reason)) as Error
    expect(error).toBeInstanceOf(EmployeeServiceError)
    expect(error).not.toBeInstanceOf(LoginLeftMovedError)
    expect(error.message).toBe(
      'We could not confirm whether their login moved to the new email address, so the changes were not saved. Please save again. If this keeps happening, tell an administrator.'
    )
    expect(getUserById).toHaveBeenCalledTimes(2)
    // Not put back: nobody knows it moved, and a second blind write could make things worse.
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(tablesTouched).toEqual(['employees'])
    expect(calls.some((call) => call.method === 'update')).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Could not read the login again'),
      expect.objectContaining({ employeeId: EMPLOYEE_ID, authUserId: 'auth-1' })
    )
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Could not confirm whether the login moved'),
      { employeeId: EMPLOYEE_ID, authUserId: 'auth-1' }
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  it('refuses the save when the login cannot be read first', async () => {
    const { auth, updateUserById } = loginAdmin({ readError: { status: 500, message: 'auth down' } })
    const { calls } = fakeClient(
      { employees: [{ data: activeWithLogin, error: null }] },
      { auth }
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
    ).rejects.toThrow('We could not check their login')
    expect(updateUserById).not.toHaveBeenCalled()
    expect(calls.some((call) => call.method === 'update')).toBe(false)
  })

  it('puts the login and its profile back when the record is seen without the new address', async () => {
    const { auth, updateUserById } = loginAdmin()
    const { calls } = fakeClient(
      {
        employees: [
          { data: activeWithLogin, error: null },
          { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "employees_email_address_key"' } },
          // Read again after the failure: still the old address, so the write did not land.
          { data: { email_address: OLD_EMAIL }, error: null },
        ],
        profiles: [profileWritten(), profileWritten()],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
    ).rejects.toMatchObject({ code: '23505' })

    expect(updateUserById).toHaveBeenCalledTimes(2)
    expect(updateUserById).toHaveBeenNthCalledWith(1, 'auth-1', { email: 'jacob@example.com', email_confirm: true })
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'auth-1', { email: OLD_EMAIL, email_confirm: true })
    expect(calls.filter((call) => call.table === 'profiles' && call.method === 'update').map((call) => call.args[0])).toEqual([
      { email: 'jacob@example.com' },
      { email: OLD_EMAIL },
    ])
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'employees', method: 'select', args: ['email_address'] },
    ]))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('the login was put back'), expect.anything())
  })

  it('puts the login back when the record row has gone', async () => {
    const { auth, updateUserById } = loginAdmin()
    fakeClient(
      {
        employees: [
          { data: activeWithLogin, error: null },
          { data: null, error: null },
          { data: null, error: null },
        ],
        profiles: [profileWritten(), profileWritten()],
      },
      { auth }
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
    ).rejects.toThrow('Employee not found or failed to update.')
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'auth-1', { email: OLD_EMAIL, email_confirm: true })
  })

  it('says the record saved when it holds the new address, and carries both addresses for the audit', async () => {
    const { auth, updateUserById } = loginAdmin()
    const { calls } = fakeClient(
      {
        employees: [
          { data: activeWithLogin, error: null },
          // The connection dropped after the write committed.
          { data: null, error: { code: '', message: 'TypeError: fetch failed', details: '', hint: '' } },
          { data: { email_address: 'jacob@example.com' }, error: null },
        ],
        profiles: [profileWritten()],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = await leftMovedError(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
    )
    // Still a refusal the action shows as written.
    expect(error).toBeInstanceOf(EmployeeServiceError)
    expect(error.message).toBe(
      'The changes were saved and they now sign in with their new email address, but the save reported a problem. Please refresh the page to check the record before saving again.'
    )
    expect(error.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    expect(error.message).not.toContain('@')
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(calls.filter((call) => call.table === 'profiles' && call.method === 'update')).toHaveLength(1)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  it('does not put the login back when the record cannot be read again, carries both addresses, and logs it loudly without them', async () => {
    const { auth, updateUserById } = loginAdmin()
    fakeClient(
      {
        employees: [
          { data: activeWithLogin, error: null },
          { data: null, error: { code: '', message: 'TypeError: fetch failed', details: '', hint: '' } },
          { data: null, error: { code: '', message: 'TypeError: fetch failed', details: '', hint: '' } },
        ],
        profiles: [profileWritten()],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = await leftMovedError(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
    )
    expect(error.message).toBe(
      'We could not tell whether the changes were saved, but they now sign in with their new email address. Please refresh the page and check the record before saving again. If it still shows the old email address, tell an administrator.'
    )
    expect(error.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringMatching(/CRITICAL.*may disagree/),
      expect.objectContaining({ employeeId: EMPLOYEE_ID })
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  /**
   * What PostgREST returns when another employee record already has the address: the address
   * itself is in `details`, which is why the log lines must leave `details` out.
   */
  const duplicateEmailError = () => ({
    code: '23505',
    message: 'duplicate key value violates unique constraint "employees_email_address_key"',
    details: 'Key (email_address)=(jacob@example.com) already exists.',
    hint: null,
  })

  it('tells staff to get help when the login cannot be put back and still holds the new address, and carries both addresses', async () => {
    const { auth, getUserById, updateUserById } = loginAdmin({
      restoreError: { status: 500, message: 'auth down' },
      rereads: [{ email: 'jacob@example.com' }],
    })
    const { calls } = fakeClient(
      {
        employees: [
          { data: activeWithLogin, error: null },
          { data: null, error: duplicateEmailError() },
          { data: { email_address: OLD_EMAIL }, error: null },
        ],
        profiles: [profileWritten()],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = await leftMovedError(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
    )
    expect(error.message).toBe(
      'The changes were not saved, but their login had already moved to the new email address and could not be moved back, so they now sign in with the new address. Please tell an administrator before saving again.'
    )
    expect(error.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    // Read before the move, then again after the put-back failed.
    expect(getUserById).toHaveBeenCalledTimes(2)
    expect(updateUserById).toHaveBeenCalledTimes(2)
    // The profile followed the login to the new address and stays with it.
    expect(calls.filter((call) => call.table === 'profiles' && call.method === 'update')).toHaveLength(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
      expect.objectContaining({ employeeId: EMPLOYEE_ID, loginAddressConfirmed: true })
    )
    // The failed write is logged by its code and message only; its details carry the address.
    expect(consoleError).toHaveBeenCalledWith('Update employee error:', {
      code: '23505',
      message: 'duplicate key value violates unique constraint "employees_email_address_key"',
      hint: null,
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  it('treats a put-back that reported an error as done when the login holds its old address again', async () => {
    const { auth, getUserById, updateUserById } = loginAdmin({
      restoreError: { name: 'AuthRetryableFetchError', status: 502, message: 'Bad Gateway' },
      rereads: [{ email: OLD_EMAIL }],
    })
    const { calls } = fakeClient(
      {
        employees: [
          { data: activeWithLogin, error: null },
          { data: null, error: duplicateEmailError() },
          { data: { email_address: OLD_EMAIL }, error: null },
        ],
        profiles: [profileWritten(), profileWritten()],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The save's own error comes back, as it does when the put-back works first time.
    const reason = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
      .then(() => { throw new Error('Expected the save to fail') }, (rejection: unknown) => rejection)
    expect(reason).not.toBeInstanceOf(LoginLeftMovedError)
    expect(reason).toMatchObject({ code: '23505' })

    expect(getUserById).toHaveBeenCalledTimes(2)
    expect(updateUserById).toHaveBeenCalledTimes(2)
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'auth-1', { email: OLD_EMAIL, email_confirm: true })
    // The profile goes back with the login.
    expect(calls.filter((call) => call.table === 'profiles' && call.method === 'update').map((call) => call.args[0])).toEqual([
      { email: 'jacob@example.com' },
      { email: OLD_EMAIL },
    ])
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('the login holds its old address again'),
      expect.objectContaining({ employeeId: EMPLOYEE_ID, status: 502 })
    )
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('the login was put back on its old address'),
      { employeeId: EMPLOYEE_ID, authUserId: 'auth-1' }
    )
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('CRITICAL'), expect.anything())
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  it.each<[string, Reread]>([
    ['the read reports an error', { error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' } }],
    ['the read throws', { throws: new TypeError('fetch failed') }],
    ['the login holds some other address', { email: 'someone.else@example.com' }],
  ])('says it cannot confirm which address the login uses when the put-back fails and %s', async (_label, reread) => {
    const { auth, getUserById } = loginAdmin({
      restoreError: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' },
      rereads: [reread],
    })
    const { calls } = fakeClient(
      {
        employees: [
          { data: activeWithLogin, error: null },
          { data: null, error: duplicateEmailError() },
          { data: { email_address: OLD_EMAIL }, error: null },
        ],
        profiles: [profileWritten()],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = await leftMovedError(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)
    )
    expect(error.message).toBe(
      'The changes were not saved, but their login had already moved to the new email address. We tried to move it back and could not confirm which email address it now uses. Please tell an administrator, and check which address they sign in with before saving again.'
    )
    expect(error.message).not.toContain('@')
    // The move is known to have happened, so the action still writes its audit row.
    expect(error.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    expect(getUserById).toHaveBeenCalledTimes(2)
    // The profile is not moved back on a guess.
    expect(calls.filter((call) => call.table === 'profiles' && call.method === 'update')).toHaveLength(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
      expect.objectContaining({ employeeId: EMPLOYEE_ID, loginAddressConfirmed: false })
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  it('leaves the login alone when only the case of the address changes', async () => {
    const { auth, getUserById, updateUserById } = loginAdmin()
    fakeClient(
      {
        employees: [
          { data: { ...activeWithLogin, email_address: 'Jacob@Example.com' }, error: null },
          { data: saved, error: null },
        ],
      },
      { auth }
    )

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any)

    expect(result.loginEmail).toBeNull()
    expect(getUserById).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('does not move a login that already has the new address', async () => {
    const { auth, updateUserById } = loginAdmin({ loginEmail: 'jacob@example.com' })
    fakeClient(
      {
        employees: [
          { data: activeWithLogin, error: null },
          { data: saved, error: null },
        ],
      },
      { auth }
    )

    const result = await EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any, {}, ROLE_MANAGER)

    expect(result.loginEmail).toBeNull()
    expect(updateUserById).not.toHaveBeenCalled()
  })
})

describe('EmployeeService.createEmployee logs a failed save without the row values', () => {
  it('logs the code and message of a duplicate email, not the address in its details', async () => {
    const duplicate = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "employees_email_address_key"',
      details: 'Key (email_address)=(jacob@example.com) already exists.',
      hint: null,
    }
    const rpc = vi.fn().mockResolvedValue({ data: null, error: duplicate })
    fakeClient({}, { rpc })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The error itself still reaches the action, which turns it into a message for staff.
    await expect(
      EmployeeService.createEmployee({ ...baseEmployeeUpdate, status: 'Onboarding' })
    ).rejects.toBe(duplicate)

    expect(rpc).toHaveBeenCalledWith('create_employee_transaction', expect.anything())
    expect(consoleError).toHaveBeenCalledWith('Create employee transaction error:', {
      code: '23505',
      message: 'duplicate key value violates unique constraint "employees_email_address_key"',
      hint: null,
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })
})

describe('EmployeeService.updateEmployee only moves a management app login for a role manager (login#1)', () => {
  const OLD_EMAIL = 'owner.old@example.com'
  const activeWithLogin = { employee_id: EMPLOYEE_ID, status: 'Active', auth_user_id: 'auth-1', email_address: OLD_EMAIL }
  const saved = { employee_id: EMPLOYEE_ID, status: 'Active', email_address: 'jacob@example.com' }

  function loginAdmin() {
    const getUserById = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1', email: OLD_EMAIL } }, error: null })
    const updateUserById = vi.fn().mockResolvedValue({ data: { user: null }, error: null })
    return { getUserById, updateUserById, auth: { admin: { getUserById, updateUserById } } }
  }

  it('refuses an editor who cannot manage roles, before anything is written', async () => {
    const { auth, getUserById, updateUserById } = loginAdmin()
    const { tablesTouched, calls } = fakeClient(
      {
        employees: [{ data: activeWithLogin, error: null }],
        user_roles: [{ data: [{ role_id: 'role-super-admin' }], error: null }],
      },
      { auth }
    )

    const attempt = EmployeeService.updateEmployee(
      EMPLOYEE_ID,
      { ...baseEmployeeUpdate, status: 'Active' } as any,
      {},
      { editorUserId: 'manager-1', canManageRoles: false }
    )
    await expect(attempt).rejects.toBeInstanceOf(EmployeeServiceError)
    await expect(attempt).rejects.toThrow(APP_LOGIN_EMAIL_REFUSAL)

    expect(tablesTouched).toEqual(['employees', 'user_roles'])
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'user_roles', method: 'eq', args: ['user_id', 'auth-1'] },
    ]))
    expect(calls.some((call) => call.method === 'update')).toBe(false)
    expect(getUserById).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('refuses when no editor is passed at all (fails closed)', async () => {
    const { auth, updateUserById } = loginAdmin()
    fakeClient(
      {
        employees: [{ data: activeWithLogin, error: null }],
        user_roles: [{ data: [{ role_id: 'role-manager' }], error: null }],
      },
      { auth }
    )

    await expect(
      EmployeeService.updateEmployee(EMPLOYEE_ID, { ...baseEmployeeUpdate, status: 'Active' } as any)
    ).rejects.toThrow(APP_LOGIN_EMAIL_REFUSAL)
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('moves it for an editor who can manage roles, without reading the roles', async () => {
    const { auth, updateUserById } = loginAdmin()
    const { tablesTouched } = fakeClient(
      {
        employees: [{ data: activeWithLogin, error: null }, { data: saved, error: null }],
        profiles: [{ data: null, error: null }],
      },
      { auth }
    )

    const result = await EmployeeService.updateEmployee(
      EMPLOYEE_ID,
      { ...baseEmployeeUpdate, status: 'Active' } as any,
      {},
      { editorUserId: 'owner-1', canManageRoles: true }
    )

    expect(result.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    expect(updateUserById).toHaveBeenCalledWith('auth-1', { email: 'jacob@example.com', email_confirm: true })
    expect(tablesTouched).not.toContain('user_roles')
  })

  it('moves a staff portal login with no role for any editor', async () => {
    const { auth, updateUserById } = loginAdmin()
    const { tablesTouched } = fakeClient(
      {
        employees: [{ data: activeWithLogin, error: null }, { data: saved, error: null }],
        user_roles: [{ data: [], error: null }],
        profiles: [{ data: null, error: null }],
      },
      { auth }
    )

    const result = await EmployeeService.updateEmployee(
      EMPLOYEE_ID,
      { ...baseEmployeeUpdate, status: 'Active' } as any,
      {},
      { editorUserId: 'manager-1', canManageRoles: false }
    )

    expect(result.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(tablesTouched).toEqual(['employees', 'user_roles', 'profiles', 'employees'])
  })

  it('lets someone move their own login', async () => {
    const { auth, updateUserById } = loginAdmin()
    const { tablesTouched } = fakeClient(
      {
        employees: [{ data: activeWithLogin, error: null }, { data: saved, error: null }],
        profiles: [{ data: null, error: null }],
      },
      { auth }
    )

    const result = await EmployeeService.updateEmployee(
      EMPLOYEE_ID,
      { ...baseEmployeeUpdate, status: 'Active' } as any,
      {},
      { editorUserId: 'auth-1', canManageRoles: false }
    )

    expect(result.loginEmail).toEqual({ previous: OLD_EMAIL, current: 'jacob@example.com' })
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(tablesTouched).not.toContain('user_roles')
  })

  it('refuses when the roles cannot be read', async () => {
    const { auth, getUserById, updateUserById } = loginAdmin()
    const { calls } = fakeClient(
      {
        employees: [{ data: activeWithLogin, error: null }],
        user_roles: [{ data: null, error: { code: '', message: 'TypeError: fetch failed' } }],
      },
      { auth }
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const attempt = EmployeeService.updateEmployee(
      EMPLOYEE_ID,
      { ...baseEmployeeUpdate, status: 'Active' } as any,
      {},
      { editorUserId: 'manager-1', canManageRoles: false }
    )
    await expect(attempt).rejects.toBeInstanceOf(EmployeeServiceError)
    await expect(attempt).rejects.toThrow(APP_LOGIN_CHECK_FAILED)
    expect(getUserById).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
    expect(calls.some((call) => call.method === 'update')).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('roles'), expect.objectContaining({ employeeId: EMPLOYEE_ID }))
  })
})

describe('EmployeeService.deleteEmployee (FF-40)', () => {
  it('refuses anyone who is not still onboarding, without touching their access', async () => {
    const deleteUser = vi.fn()
    const { tablesTouched } = fakeClient(
      { employees: [{ data: { employee_id: EMPLOYEE_ID, status: 'Active', auth_user_id: 'auth-1' }, error: null }] },
      { auth: { admin: { deleteUser } } }
    )

    await expect(EmployeeService.deleteEmployee(EMPLOYEE_ID)).rejects.toThrow('use Begin Separation')
    expect(tablesTouched).toEqual(['employees'])
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses when other records refer to them, before removing roles or the login', async () => {
    const deleteUser = vi.fn()
    const queues = noBlockers()
    queues.checklist_todos = [{ count: 2, error: null }, { count: 0, error: null }]
    const { tablesTouched } = fakeClient(
      { ...queues, employees: [{ data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', auth_user_id: 'auth-1' }, error: null }] },
      { auth: { admin: { deleteUser } } }
    )

    await expect(EmployeeService.deleteEmployee(EMPLOYEE_ID)).rejects.toThrow('checklist to-dos')
    expect(tablesTouched).not.toContain('user_roles')
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses when the reference check itself fails', async () => {
    const queues = noBlockers()
    queues.recruitment_candidates = [{ count: null, error: { message: 'timeout' } }]
    fakeClient(
      { ...queues, employees: [{ data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', auth_user_id: null }, error: null }] },
      { auth: { admin: { deleteUser: vi.fn() } } }
    )

    await expect(EmployeeService.deleteEmployee(EMPLOYEE_ID)).rejects.toThrow('Could not check what else refers to this employee')
  })

  it('removes the login only after the row is gone', async () => {
    const order: string[] = []
    const deleteUser = vi.fn(async () => {
      order.push('auth.deleteUser')
      return { error: null }
    })
    const list = vi.fn().mockResolvedValue({ data: [], error: null })
    const { client } = fakeClient(
      {
        ...noBlockers(),
        employees: [
          { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', auth_user_id: 'auth-1', date_of_birth: null }, error: null },
          { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', timeclock_pin_hash: 'secret' }, error: null },
        ],
        user_roles: [
          { data: [{ user_id: 'auth-1', role_id: 'role-1', assigned_at: null, assigned_by: null }], error: null },
          { data: null, error: null },
        ],
      },
      { auth: { admin: { deleteUser } }, storage: { from: vi.fn(() => ({ list, remove: vi.fn() })) } }
    )
    const from = client.from as Mock
    const originalFrom = from.getMockImplementation()!
    from.mockImplementation((table: string) => {
      order.push(`from:${table}`)
      return originalFrom(table)
    })

    const result = await EmployeeService.deleteEmployee(EMPLOYEE_ID)

    expect(result.loginRemoved).toBe(true)
    expect(result.deletedEmployee).not.toHaveProperty('timeclock_pin_hash')
    const rowDelete = order.lastIndexOf('from:employees')
    expect(order.indexOf('auth.deleteUser')).toBeGreaterThan(rowDelete)
    expect(order.indexOf('from:user_roles')).toBeLessThan(rowDelete)
  })

  it('does not delete someone made Active after the first read, and gives their access back', async () => {
    const deleteUser = vi.fn()
    const { calls } = fakeClient(
      {
        ...noBlockers(),
        employees: [
          { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', auth_user_id: 'auth-1' }, error: null },
          // The delete matches no row: by then they were no longer Onboarding.
          { data: null, error: null },
        ],
        user_roles: [
          { data: [{ user_id: 'auth-1', role_id: 'role-1', assigned_at: null, assigned_by: null }], error: null },
          { data: null, error: null },
          { data: null, error: null },
        ],
      },
      { auth: { admin: { deleteUser } } }
    )

    await expect(EmployeeService.deleteEmployee(EMPLOYEE_ID)).rejects.toThrow('no longer onboarding')

    const employeeCalls = calls.filter((call) => call.table === 'employees')
    expect(employeeCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'eq', args: ['status', 'Onboarding'] }),
    ]))
    expect(calls.some((call) => call.table === 'user_roles' && call.method === 'insert')).toBe(true)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('puts the roles back and keeps the login when the row cannot be deleted', async () => {
    const deleteUser = vi.fn()
    const { calls } = fakeClient(
      {
        ...noBlockers(),
        employees: [
          { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', auth_user_id: 'auth-1' }, error: null },
          { data: null, error: { code: '23503', message: 'still referenced' } },
        ],
        user_roles: [
          { data: [{ user_id: 'auth-1', role_id: 'role-1', assigned_at: null, assigned_by: null }], error: null },
          { data: null, error: null },
          { data: null, error: null },
        ],
      },
      { auth: { admin: { deleteUser } } }
    )

    await expect(EmployeeService.deleteEmployee(EMPLOYEE_ID)).rejects.toMatchObject({ code: '23503' })
    expect(deleteUser).not.toHaveBeenCalled()
    const restore = calls.find((call) => call.table === 'user_roles' && call.method === 'insert')
    expect(restore?.args[0]).toEqual([{ user_id: 'auth-1', role_id: 'role-1', assigned_at: null, assigned_by: null }])
  })

  it('says so when the row went but the login could not be removed', async () => {
    fakeClient(
      {
        ...noBlockers(),
        employees: [
          { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding', auth_user_id: 'auth-1' }, error: null },
          { data: { employee_id: EMPLOYEE_ID, status: 'Onboarding' }, error: null },
        ],
        user_roles: [{ data: [], error: null }],
      },
      {
        auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: { message: 'auth down' } }) } },
        storage: { from: vi.fn(() => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }), remove: vi.fn() })) },
      }
    )

    const result = await EmployeeService.deleteEmployee(EMPLOYEE_ID)
    expect(result.loginRemoved).toBe(false)
  })
})

describe('emergency contacts are scoped to the employee (FF-33)', () => {
  it('filters an update by employee and refuses when no row matched', async () => {
    const { calls } = fakeClient({ employee_emergency_contacts: [{ data: [], error: null }] })

    await expect(
      EmployeeService.updateEmergencyContact('contact-1', { employee_id: EMPLOYEE_ID, name: 'Sam', priority: 'Other' } as any)
    ).rejects.toThrow('That emergency contact was not found for this employee')

    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'eq', args: ['id', 'contact-1'] }),
      expect.objectContaining({ method: 'eq', args: ['employee_id', EMPLOYEE_ID] }),
    ]))
    const update = calls.find((call) => call.method === 'update')
    expect(update?.args[0]).not.toHaveProperty('employee_id')
  })

  it('filters a delete by employee and refuses when no row matched', async () => {
    const { calls } = fakeClient({ employee_emergency_contacts: [{ data: [], error: null }] })

    await expect(EmployeeService.deleteEmergencyContact('contact-1', EMPLOYEE_ID)).rejects.toThrow(
      'That emergency contact was not found for this employee'
    )
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'eq', args: ['employee_id', EMPLOYEE_ID] }),
    ]))
  })

  it('deletes when the contact belongs to the employee', async () => {
    fakeClient({ employee_emergency_contacts: [{ data: [{ id: 'contact-1' }], error: null }] })
    await expect(EmployeeService.deleteEmergencyContact('contact-1', EMPLOYEE_ID)).resolves.toBeUndefined()
  })
})

describe('EmployeeService.upsertRightToWork (FF-32)', () => {
  const check = {
    employee_id: EMPLOYEE_ID,
    document_type: 'Passport' as const,
    check_method: 'manual' as const,
    document_reference: 'P123',
    verification_date: '2026-10-01',
    document_expiry_date: null,
    document_details: 'Seen in person',
  }

  it('keeps the original verifier when only the notes change', async () => {
    const { calls } = fakeClient({
      employee_right_to_work: [
        {
          data: { ...check, photo_storage_path: null, verified_by_user_id: 'manager-1', verification_date: '2026-10-01T00:00:00+00:00' },
          error: null,
        },
        { data: null, error: null },
      ],
    })

    await EmployeeService.upsertRightToWork(EMPLOYEE_ID, { ...check, document_details: 'Typo fixed' }, 'manager-2')

    const upsert = calls.find((call) => call.method === 'upsert')
    expect(upsert?.args[0]).toMatchObject({ verified_by_user_id: 'manager-1', document_details: 'Typo fixed' })
  })

  it('records the current user as verifier when the check itself changes', async () => {
    const { calls } = fakeClient({
      employee_right_to_work: [
        { data: { ...check, photo_storage_path: null, verified_by_user_id: 'manager-1' }, error: null },
        { data: null, error: null },
      ],
    })

    await EmployeeService.upsertRightToWork(EMPLOYEE_ID, { ...check, verification_date: '2026-11-02' }, 'manager-2')

    const upsert = calls.find((call) => call.method === 'upsert')
    expect(upsert?.args[0]).toMatchObject({ verified_by_user_id: 'manager-2' })
  })

  it('refuses a photo path that is not this employee\'s right to work upload', async () => {
    fakeClient({})
    await expect(
      EmployeeService.upsertRightToWork(EMPLOYEE_ID, check, 'manager-2', `${EMPLOYEE_ID}/contract.pdf`)
    ).rejects.toThrow('Invalid photo storage path.')
    await expect(
      EmployeeService.upsertRightToWork(EMPLOYEE_ID, check, 'manager-2', `other-employee/rtw_1_passport.pdf`)
    ).rejects.toThrow('Invalid photo storage path.')
  })

  it('refuses a photo path whose file was never uploaded', async () => {
    const exists = vi.fn().mockResolvedValue({ data: false, error: null })
    const { tablesTouched } = fakeClient({}, { storage: { from: vi.fn(() => ({ exists })) } })

    await expect(
      EmployeeService.upsertRightToWork(EMPLOYEE_ID, check, 'manager-2', `${EMPLOYEE_ID}/rtw_1730000000000_passport.pdf`)
    ).rejects.toThrow('The uploaded document could not be found')
    expect(exists).toHaveBeenCalledWith(`${EMPLOYEE_ID}/rtw_1730000000000_passport.pdf`)
    expect(tablesTouched).toEqual([])
  })
})

describe('signing-owned checklist item (FF-27)', () => {
  it('refuses to tick the employee agreement by hand', async () => {
    const { tablesTouched } = fakeClient({})
    await expect(
      EmployeeService.updateOnboardingChecklist(EMPLOYEE_ID, 'employee_agreement_accepted', true)
    ).rejects.toThrow('Use Send for Signature')
    expect(tablesTouched).toEqual([])
  })

  it('still ticks an office item', async () => {
    const { calls } = fakeClient({ employee_onboarding_checklist: [{ data: null, error: null }] })
    await EmployeeService.updateOnboardingChecklist(EMPLOYEE_ID, 'till_system_setup', true)
    expect(calls.find((call) => call.method === 'upsert')?.args[0]).toMatchObject({ till_system_setup: true })
  })
})

describe('signed document links (FF-36)', () => {
  it('asks storage for a download link named after the file', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    fakeClient({}, { storage: { from: vi.fn(() => ({ createSignedUrl })) } })

    await EmployeeService.getAttachmentSignedUrl(`${EMPLOYEE_ID}/contract.pdf`, 'contract.pdf')
    expect(createSignedUrl).toHaveBeenCalledWith(`${EMPLOYEE_ID}/contract.pdf`, 300, { download: 'contract.pdf' })

    await EmployeeService.getRightToWorkPhotoUrl(`${EMPLOYEE_ID}/rtw_1_passport.pdf`)
    expect(createSignedUrl).toHaveBeenLastCalledWith(`${EMPLOYEE_ID}/rtw_1_passport.pdf`, 300, undefined)
  })
})
