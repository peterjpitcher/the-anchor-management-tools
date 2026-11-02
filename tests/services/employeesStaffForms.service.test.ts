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
  RightToWorkSchema,
  employeeSchema,
  noteSchema,
} from '@/services/employees'

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
