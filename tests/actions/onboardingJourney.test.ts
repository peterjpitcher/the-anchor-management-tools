import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The onboarding journey, invite through to submission, driven through the real server actions
 * in the real order.
 *
 * WHY THIS EXISTS
 *
 * Two bugs reached production on 2026-08-18 and both were found by the owner, not by the test
 * suite, because every existing test exercised a single step in isolation. Neither could have
 * been caught that way:
 *
 *   1. A token binding check treated "nobody is signed in" as "wrong person". Creating a
 *      password sets employees.auth_user_id through the ADMIN client and never signs the browser
 *      in, so from that point on the employee has an account and no session. Every step after
 *      the password was refused. Only walking the sequence surfaces that state.
 *   2. A duplicate preferred name was accepted all the way through and only failed at the final
 *      submit, because the uniqueness index is partial and an Onboarding row sits outside it.
 *
 * WHAT THIS PROVES
 *
 * The client side contract: that each action can be called in the order the UI calls it, with
 * the session state that genuinely exists at that point, and that the gating flows through to
 * what the review screen reads. It is a sequence test.
 *
 * WHAT THIS DOES NOT PROVE
 *
 * It does not prove the SQL. The database functions are represented here only by the contract
 * the actions depend on. supabase/migrations is the source of truth for the real behaviour, and
 * the partial index in particular can only be proved against a real Postgres. Anything asserted
 * about constraint timing below is a reminder of the rule, not evidence of it.
 */

const permissionMock = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: (...args: unknown[]) => permissionMock(...args),
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'manager-1', user_email: 'manager@example.com' }),
}))
vi.mock('@/lib/email/employee-invite-emails', () => ({
  sendWelcomeEmail: vi.fn(),
  sendChaseEmail: vi.fn(),
  sendPortalInviteEmail: vi.fn(),
  sendOnboardingCompleteEmail: vi.fn(),
  sendSeparationStartedEmail: vi.fn(),
}))

// ---------------------------------------------------------------------------
// A small stand-in for the two Supabase clients.
//
// The distinction that matters, and the one the first bug turned on: the admin client writes
// rows regardless of who is signed in, while the cookie client's auth.getUser() reflects the
// browser session. Creating an account uses the former and never touches the latter.
// ---------------------------------------------------------------------------

type Row = Record<string, any>

const db: Record<string, Row[]> = {}
let sessionUserId: string | null = null

function reset() {
  for (const key of Object.keys(db)) delete db[key]
  db.employees = []
  db.employee_invite_tokens = []
  db.employee_onboarding_checklist = []
  db.employee_pay_settings = []
  db.employee_onboarding_responses = []
  db.employee_emergency_contacts = []
  db.employee_financial_details = []
  db.employee_health_records = []
  db.leave_requests = []
  db.leave_days = []
  db.leave_types = [
    { code: 'holiday', label: 'Holiday', consumes_allowance: true, is_active: true, allowed_at_onboarding: true },
    { code: 'unavailable', label: 'Not available to work', consumes_allowance: false, is_active: true, allowed_at_onboarding: true },
  ]
  sessionUserId = null
}

function matches(row: Row, filters: Array<[string, string, any]>): boolean {
  return filters.every(([op, column, value]) => {
    const actual = row[column]
    if (op === 'eq') return actual === value
    if (op === 'neq') return actual !== value
    if (op === 'in') return (value as any[]).includes(actual)
    if (op === 'ilike') return String(actual ?? '').toLowerCase() === String(value).toLowerCase()
    if (op === 'is') return actual === value
    if (op === 'gt') return actual > value
    return true
  })
}

function builder(table: string) {
  const filters: Array<[string, string, any]> = []
  let mode: 'select' | 'update' | 'insert' | 'upsert' = 'select'
  let payload: Row | Row[] | null = null

  const run = () => {
    const rows = (db[table] ?? []).filter(r => matches(r, filters))
    if (mode === 'update' && payload) Object.assign(rows[0] ?? {}, payload)
    return rows
  }

  const api: any = {
    select: () => { if (mode === 'select') mode = 'select'; return api },
    update: (p: Row) => { mode = 'update'; payload = p; return api },
    insert: (p: Row | Row[]) => {
      mode = 'insert'
      const list = Array.isArray(p) ? p : [p]
      db[table] = [...(db[table] ?? []), ...list]
      return api
    },
    upsert: (p: Row | Row[]) => api.insert(p),
    eq: (c: string, v: any) => { filters.push(['eq', c, v]); return api },
    neq: (c: string, v: any) => { filters.push(['neq', c, v]); return api },
    in: (c: string, v: any[]) => { filters.push(['in', c, v]); return api },
    ilike: (c: string, v: any) => { filters.push(['ilike', c, v]); return api },
    is: (c: string, v: any) => { filters.push(['is', c, v]); return api },
    gt: (c: string, v: any) => { filters.push(['gt', c, v]); return api },
    gte: () => api,
    lte: () => api,
    limit: () => api,
    order: () => api,
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => {
      const rows = run()
      return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }
    },
    then: (resolve: (v: any) => any) => resolve({ data: run(), error: null }),
  }
  return api
}

/**
 * The database functions, reduced to the contract the actions rely on. See the header: this is
 * not the SQL, it is the promise the SQL makes to the application.
 */
async function rpc(name: string, args: Row) {
  if (name === 'create_employee_invite') {
    const employee_id = `emp-${db.employees.length + 1}`
    if (db.employees.some(e => e.email_address?.toLowerCase() === args.p_email.toLowerCase())) {
      return { data: null, error: { message: 'An employee with this email address already exists', code: '23505' } }
    }
    db.employees.push({
      employee_id, email_address: args.p_email, job_title: args.p_job_title ?? null,
      employment_start_date: args.p_employment_start_date ?? null,
      status: 'Onboarding', auth_user_id: null, preferred_name: null,
      first_name: null, last_name: null,
    })
    // The invite path creates these; the manual path did not, which was its own defect.
    db.employee_onboarding_checklist.push({ employee_id })
    db.employee_pay_settings.push({ employee_id, pay_type: 'hourly' })
    const token = `token-${employee_id}`
    db.employee_invite_tokens.push({
      id: `tok-${employee_id}`, employee_id, email: args.p_email, token,
      invite_type: 'onboarding', completed_at: null,
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    })
    return { data: { employee_id, token }, error: null }
  }

  if (name === 'link_employee_invite_account') {
    // Keyed on the token, exactly as the real function is.
    const token = db.employee_invite_tokens.find(t => t.token === args.p_token)
    const employee = token && db.employees.find(e => e.employee_id === token.employee_id)
    if (employee) employee.auth_user_id = args.p_auth_user_id
    return { data: null, error: null }
  }

  if (name === 'save_onboarding_time_off') {
    const token = db.employee_invite_tokens.find(t => t.token === args.p_token)
    if (!token) return { data: null, error: { message: 'TIME_OFF_TOKEN_INVALID' } }
    const employeeId = token.employee_id
    const existing = db.employee_onboarding_responses.find(
      r => r.employee_id === employeeId && r.question === 'booked_time_off',
    )
    if (existing && existing.submission_version === args.p_submission_version) {
      return { data: { requests_created: 0, repeated: true }, error: null }
    }
    db.leave_requests = db.leave_requests.filter(
      r => !(r.employee_id === employeeId && r.leave_origin === 'agreed_at_hire'),
    )
    let created = 0
    for (const block of args.p_blocks ?? []) {
      const id = `req-${db.leave_requests.length + 1}`
      db.leave_requests.push({
        id, employee_id: employeeId, start_date: block.startDate, end_date: block.endDate,
        status: 'approved', leave_type: block.leaveType, leave_origin: 'agreed_at_hire',
        request_channel: 'onboarding',
      })
      db.leave_days.push({ request_id: id, employee_id: employeeId, leave_date: block.startDate })
      created += 1
    }
    if (existing) {
      existing.answer = args.p_answer
      existing.submission_version = args.p_submission_version
    } else {
      db.employee_onboarding_responses.push({
        employee_id: employeeId, question: 'booked_time_off',
        answer: args.p_answer, submission_version: args.p_submission_version,
      })
    }
    return { data: { requests_created: created, repeated: false }, error: null }
  }

  if (name === 'record_onboarding_acknowledgement') {
    const token = db.employee_invite_tokens.find(t => t.token === args.p_token)
    if (!token) return { data: null, error: { message: 'TOKEN_INVALID' } }
    db.employee_onboarding_responses.push({
      employee_id: token.employee_id, question: args.p_question, answer: 'acknowledged', submission_version: 1,
    })
    return { data: null, error: null }
  }

  if (name === 'complete_employee_onboarding') {
    const token = db.employee_invite_tokens.find(t => t.token === args.p_token)
    if (!token) return { data: null, error: { message: 'Invalid invite link.' } }
    const employee = db.employees.find(e => e.employee_id === token.employee_id)!
    const answered = (question: string) =>
      db.employee_onboarding_responses.some(r => r.employee_id === employee.employee_id && r.question === question)

    if (!employee.first_name || !employee.last_name) {
      return { data: null, error: { message: 'Personal details must be completed before submitting.' } }
    }
    if (!db.employee_emergency_contacts.some(c => c.employee_id === employee.employee_id)) {
      return { data: null, error: { message: 'Primary emergency contact must be completed before submitting.' } }
    }
    if (!db.employee_financial_details.some(f => f.employee_id === employee.employee_id)) {
      return { data: null, error: { message: 'Financial details must be saved before submitting.' } }
    }
    if (!db.employee_health_records.some(h => h.employee_id === employee.employee_id)) {
      return { data: null, error: { message: 'Health information must be saved before submitting.' } }
    }
    if (!answered('booked_time_off')) {
      return { data: null, error: { message: 'Tell us about any time off you have already booked before submitting.' } }
    }
    if (!answered('right_to_work_notice')) {
      return { data: null, error: { message: 'Please confirm you have read what to bring for your right to work check.' } }
    }
    // The partial unique index only applies from here, because this is where the row becomes
    // Active. See reference: a status scoped index is silent until the status changes.
    const clash = db.employees.some(
      e => e.employee_id !== employee.employee_id
        && ['Active', 'Started Separation'].includes(e.status)
        && e.preferred_name
        && e.preferred_name.toLowerCase() === String(employee.preferred_name ?? '').toLowerCase(),
    )
    if (clash) {
      return {
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "employees_preferred_name_active_unique"',
          code: '23505',
        },
      }
    }

    employee.status = 'Active'
    employee.onboarding_completed_at = new Date().toISOString()
    token.completed_at = new Date().toISOString()
    return {
      data: {
        employee_id: employee.employee_id, email: employee.email_address,
        first_name: employee.first_name, last_name: employee.last_name,
        auth_user_id: employee.auth_user_id, onboarding_completed_at: employee.onboarding_completed_at,
      },
      error: null,
    }
  }

  if (name === 'replace_employee_emergency_contacts') {
    db.employee_emergency_contacts = db.employee_emergency_contacts.filter(c => c.employee_id !== args.p_employee_id)
    for (const contact of args.p_contacts ?? []) {
      db.employee_emergency_contacts.push({ ...contact, employee_id: args.p_employee_id })
    }
    return { data: null, error: null }
  }

  return { data: null, error: null }
}

const adminClient = {
  from: (t: string) => builder(t),
  rpc: (name: string, args: Row) => rpc(name, args),
  auth: {
    admin: {
      createUser: async ({ email }: { email: string }) => ({
        data: { user: { id: `auth-${email}` } }, error: null,
      }),
      deleteUser: async () => ({ error: null }),
    },
  },
}

// The cookie client. Its auth.getUser() reflects the BROWSER session, which onboarding never
// establishes, so it stays null for the whole journey after the password is set.
const cookieClient = {
  from: (t: string) => builder(t),
  rpc: (name: string, args: Row) => rpc(name, args),
  auth: { getUser: async () => ({ data: { user: sessionUserId ? { id: sessionUserId } : null } }) },
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => cookieClient }))

import {
  acknowledgeRightToWorkNotice,
  createEmployeeAccount,
  getOnboardingSnapshot,
  inviteEmployee,
  saveOnboardingSection,
  saveOnboardingTimeOff,
  submitOnboardingProfile,
} from '@/app/actions/employeeInvite'

async function invite(email: string) {
  permissionMock.mockResolvedValue(true)
  const form = new FormData()
  form.append('email', email)
  form.append('job_title', 'Bar Staff')
  form.append('employment_start_date', '2026-09-01')
  const result: any = await inviteEmployee(null, form)
  expect(result.type).toBe('success')
  return db.employee_invite_tokens.find(t => t.employee_id === result.employeeId)!.token as string
}

async function fillTheMiddleOfTheFlow(token: string) {
  await saveOnboardingSection(token, 'emergency_contacts', {
    primary: { name: 'Jo Bloggs', relationship: 'Partner', phone_number: null, mobile_number: null, address: null },
  })
  await saveOnboardingSection(token, 'financial', { bank_name: 'Test Bank' })
  await saveOnboardingSection(token, 'health', {})
}

describe('employee onboarding journey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('runs from invite to an Active employee', async () => {
    const token = await invite('newstarter@example.com')

    // Step 1. The account is created with the admin client and does NOT sign the browser in.
    const account = await createEmployeeAccount(token, 'a-good-password')
    expect(account.success).toBe(true)
    expect(db.employees[0].auth_user_id).toBeTruthy()
    expect(sessionUserId).toBeNull()

    // Step 2 onwards must all work in exactly that state: account linked, no session.
    const personal = await saveOnboardingSection(token, 'personal', {
      first_name: 'Sam', last_name: 'Reed', preferred_name: 'Sam',
    })
    expect(personal.success).toBe(true)

    const timeOff = await saveOnboardingTimeOff(token, 'has_dates', [
      { startDate: '2026-12-01', endDate: '2026-12-05', leaveType: 'holiday', note: 'Wedding' },
    ], 1)
    expect(timeOff.success).toBe(true)

    await fillTheMiddleOfTheFlow(token)

    const rtw = await acknowledgeRightToWorkNotice(token)
    expect(rtw.success).toBe(true)

    const submitted = await submitOnboardingProfile(token)
    expect(submitted).toEqual({ success: true })
    expect(db.employees[0].status).toBe('Active')
  })

  it('does not refuse a step just because the browser has no session', async () => {
    // The exact regression. Account exists, session does not, and the two steps that carry the
    // token binding check must still work.
    const token = await invite('nosession@example.com')
    await createEmployeeAccount(token, 'a-good-password')
    expect(db.employees[0].auth_user_id).toBeTruthy()
    expect(sessionUserId).toBeNull()

    const timeOff = await saveOnboardingTimeOff(token, 'none', [], 1)
    expect(timeOff.success).toBe(true)

    const rtw = await acknowledgeRightToWorkNotice(token)
    expect(rtw.success).toBe(true)
  })

  it('refuses a step when a different person is signed in on the same browser', async () => {
    const token = await invite('shared@example.com')
    await createEmployeeAccount(token, 'a-good-password')

    sessionUserId = 'somebody-else'
    const result = await saveOnboardingTimeOff(token, 'none', [], 1)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/different account/i)
  })

  it('records "nothing booked" as a real answer that lets submission proceed', async () => {
    const token = await invite('nothingbooked@example.com')
    await createEmployeeAccount(token, 'a-good-password')
    await saveOnboardingSection(token, 'personal', { first_name: 'Ada', last_name: 'Byron' })

    await saveOnboardingTimeOff(token, 'none', [], 1)
    expect(db.leave_requests).toHaveLength(0)

    const snapshot = await getOnboardingSnapshot(token)
    expect(snapshot.success && snapshot.data.completedSections.time_off).toBe(true)

    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)
    expect(await submitOnboardingProfile(token)).toEqual({ success: true })
  })

  it('will not complete without an answer about booked time off', async () => {
    const token = await invite('notimeoff@example.com')
    await createEmployeeAccount(token, 'a-good-password')
    await saveOnboardingSection(token, 'personal', { first_name: 'Grace', last_name: 'Hopper' })
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)

    const result = await submitOnboardingProfile(token)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/time off/i)
  })

  it('will not complete without the right to work acknowledgement', async () => {
    const token = await invite('nortw@example.com')
    await createEmployeeAccount(token, 'a-good-password')
    await saveOnboardingSection(token, 'personal', { first_name: 'Alan', last_name: 'Turing' })
    await saveOnboardingTimeOff(token, 'none', [], 1)
    await fillTheMiddleOfTheFlow(token)

    const result = await submitOnboardingProfile(token)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/right to work/i)
  })

  it('rejects a preferred name already used by an active employee, on the step where it is typed', async () => {
    db.employees.push({
      employee_id: 'existing-1', email_address: 'peter@example.com', status: 'Active',
      preferred_name: 'Peter', first_name: 'Peter', last_name: 'Pitcher', auth_user_id: 'auth-existing',
    })

    const token = await invite('another.peter@example.com')
    await createEmployeeAccount(token, 'a-good-password')

    const result = await saveOnboardingSection(token, 'personal', {
      first_name: 'Peter', last_name: 'Smith', preferred_name: 'Peter',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already goes by/i)
  })

  it('turns a preferred name clash at submission into advice rather than constraint text', async () => {
    // Belt and braces for the race: two starters, only one can have the name. Whoever loses must
    // be told what to change, not shown the name of a database index.
    const token = await invite('racer@example.com')
    await createEmployeeAccount(token, 'a-good-password')
    await saveOnboardingSection(token, 'personal', {
      first_name: 'Peter', last_name: 'Smith', preferred_name: 'Peter',
    })
    await saveOnboardingTimeOff(token, 'none', [], 1)
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)

    // Somebody else takes the name after the check passed and before submission.
    db.employees.push({
      employee_id: 'existing-2', email_address: 'peter@example.com', status: 'Active',
      preferred_name: 'Peter', first_name: 'Peter', last_name: 'Pitcher', auth_user_id: 'auth-x',
    })

    const result = await submitOnboardingProfile(token)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/go back to Personal Details/i)
    expect(result.error).not.toMatch(/employees_preferred_name_active_unique/)
  })

  it('treats an identical resubmission of time off as a retry, not a duplicate', async () => {
    const token = await invite('retry@example.com')
    await createEmployeeAccount(token, 'a-good-password')
    await saveOnboardingSection(token, 'personal', { first_name: 'Ada', last_name: 'Lovelace' })

    await saveOnboardingTimeOff(token, 'has_dates', [
      { startDate: '2026-12-01', endDate: '2026-12-03', leaveType: 'holiday' },
    ], 1)
    const before = db.leave_requests.length

    await saveOnboardingTimeOff(token, 'has_dates', [
      { startDate: '2026-12-01', endDate: '2026-12-03', leaveType: 'holiday' },
    ], 1)

    expect(db.leave_requests).toHaveLength(before)
  })
})
