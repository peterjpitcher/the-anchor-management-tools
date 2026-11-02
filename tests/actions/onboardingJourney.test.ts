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
 *      password set employees.auth_user_id through the ADMIN client and never signed the browser
 *      in, so from that point on the employee had an account and no session. Every step after
 *      the password was refused. Only walking the sequence surfaces that state. Account creation
 *      now signs the browser in, and a starter with an account but no session is asked to sign
 *      in (onboarding-session.ts), so a forwarded link stops working once a password is set.
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
const authSignInMock = vi.fn()
vi.mock('@/services/auth', () => ({
  AuthService: { signIn: (...args: unknown[]) => authSignInMock(...args) },
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
/** Tables whose single-row reads fail, for the paths that must say "could not read". */
const failingReads = new Set<string>()

function reset() {
  failingReads.clear()
  for (const key of Object.keys(db)) delete db[key]
  db.employees = []
  db.employee_invite_tokens = []
  db.employee_onboarding_checklist = []
  db.employee_pay_settings = []
  db.employee_onboarding_responses = []
  db.employee_emergency_contacts = []
  db.employee_financial_details = []
  db.employee_health_records = []
  db.employee_notes = []
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
    // Upserts here are all keyed on employee_id: merge into the existing row, as ON CONFLICT does.
    upsert: (p: Row | Row[]) => {
      mode = 'upsert'
      for (const row of Array.isArray(p) ? p : [p]) {
        const existing = (db[table] ?? []).find(r => r.employee_id === row.employee_id)
        if (existing) Object.assign(existing, row)
        else db[table] = [...(db[table] ?? []), { ...row }]
      }
      return api
    },
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
    maybeSingle: async () => (failingReads.has(table)
      ? { data: null, error: { code: 'PGRST000', message: `${table} read failed` } }
      : { data: run()[0] ?? null, error: null }),
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

// The cookie client. Its auth.getUser() reflects the BROWSER session. Signing in with the
// starter's email and password sets it; signing out clears it.
const cookieClient = {
  from: (t: string) => builder(t),
  rpc: (name: string, args: Row) => rpc(name, args),
  auth: {
    getUser: async () => ({ data: { user: sessionUserId ? { id: sessionUserId } : null } }),
    signInWithPassword: async ({ email }: { email: string }) => {
      sessionUserId = `auth-${email}`
      return { data: { user: { id: sessionUserId } }, error: null }
    },
    signOut: async () => {
      sessionUserId = null
      return { error: null }
    },
  },
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
  signInToOnboarding,
  submitOnboardingProfile,
} from '@/app/actions/employeeInvite'
import { logAuditEvent } from '@/app/actions/audit'
import { getLocalIsoDateDaysAhead, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { sendOnboardingCompleteEmail } from '@/lib/email/employee-invite-emails'
import { InviteEmailSendError } from '@/lib/employees/invite-email-failure'

const PASSWORD = 'a-good-long-password'
const DOB = '1990-05-01'
// Time off has to start in the future, so it is built from today: a fixed date stops passing the
// day it goes by.
const LEAVE_START = getLocalIsoDateDaysAhead(30)
const LEAVE_END_3 = shiftIsoDate(LEAVE_START, 2) as string
const LEAVE_END_5 = shiftIsoDate(LEAVE_START, 4) as string

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
  const contacts = await saveOnboardingSection(token, 'emergency_contacts', {
    primary: { name: 'Jo Bloggs', relationship: 'Partner', phone_number: null, mobile_number: '07700 900123', address: null },
  })
  expect(contacts.success).toBe(true)
  const financial = await saveOnboardingSection(token, 'financial', {
    bank_name: 'Test Bank', bank_sort_code: '12-34-56', bank_account_number: '12345678',
  })
  expect(financial.success).toBe(true)
  const health = await saveOnboardingSection(token, 'health', {})
  expect(health.success).toBe(true)
}

async function savePersonal(token: string, values: Row = {}) {
  return saveOnboardingSection(token, 'personal', {
    first_name: 'Ada', last_name: 'Byron', date_of_birth: DOB, ...values,
  })
}

describe('employee onboarding journey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it('runs from invite to an Active employee', async () => {
    const token = await invite('newstarter@example.com')

    // Step 1. The account is created with the admin client, then this browser is signed in as it.
    const account = await createEmployeeAccount(token, PASSWORD)
    expect(account).toEqual({ success: true, signedIn: true })
    expect(db.employees[0].auth_user_id).toBeTruthy()
    expect(sessionUserId).toBe(db.employees[0].auth_user_id)

    // Step 2 onwards work in that state: account linked, signed in as that account.
    const personal = await savePersonal(token, { first_name: 'Sam', last_name: 'Reed', preferred_name: 'Sam' })
    expect(personal.success).toBe(true)

    const timeOff = await saveOnboardingTimeOff(token, 'has_dates', [
      { startDate: LEAVE_START, endDate: LEAVE_END_5, leaveType: 'holiday', note: 'Wedding' },
    ], 1)
    expect(timeOff.success).toBe(true)

    await fillTheMiddleOfTheFlow(token)

    const rtw = await acknowledgeRightToWorkNotice(token)
    expect(rtw.success).toBe(true)

    const submitted = await submitOnboardingProfile(token)
    expect(submitted).toEqual({ success: true })
    expect(db.employees[0].status).toBe('Active')
  })

  it('sends a starter whose account already exists on to sign in, not back to the password form', async () => {
    const token = await invite('twotabs@example.com')
    await createEmployeeAccount(token, PASSWORD)

    const again = await createEmployeeAccount(token, PASSWORD)

    expect(again.success).toBe(false)
    if (!again.success) {
      expect(again.code).toBe('sign_in_required')
      expect(again.error).toMatch(/sign in to carry on/i)
    }
  })

  it('saves the name tidied, the same as the staff forms do', async () => {
    const token = await invite('tidy@example.com')
    await createEmployeeAccount(token, PASSWORD)

    expect((await savePersonal(token, { first_name: '  sam ', last_name: "o'brien" })).success).toBe(true)

    expect(db.employees[0].first_name).toBe('Sam')
    expect(db.employees[0].last_name).toBe("O'Brien")
  })

  it('lets every step through before a password exists, with nobody signed in', async () => {
    const token = await invite('nopassword@example.com')
    expect(sessionUserId).toBeNull()

    expect((await saveOnboardingTimeOff(token, 'none', [], 1)).success).toBe(true)
    expect((await acknowledgeRightToWorkNotice(token)).success).toBe(true)
    expect((await getOnboardingSnapshot(token)).success).toBe(true)
  })

  it('asks a starter with an account but no session to sign in, then lets them carry on', async () => {
    // The original regression was refusing this state as "a different account". It is now
    // refused as "sign in to carry on", with a way to do that on the page.
    const token = await invite('nosession@example.com')
    await createEmployeeAccount(token, PASSWORD)
    sessionUserId = null // a different device, or a cleared browser

    const snapshot = await getOnboardingSnapshot(token)
    expect(snapshot.success).toBe(false)
    if (!snapshot.success) expect(snapshot.code).toBe('sign_in_required')

    const timeOff = await saveOnboardingTimeOff(token, 'none', [], 1)
    expect(timeOff.success).toBe(false)
    if (!timeOff.success) {
      expect(timeOff.code).toBe('sign_in_required')
      expect(timeOff.error).toMatch(/sign in to carry on/i)
    }
    const section = await savePersonal(token)
    expect(section.success).toBe(false)
    if (!section.success) expect(section.code).toBe('sign_in_required')
    expect(db.employees[0].first_name).toBeNull()

    authSignInMock.mockImplementation(async (email: string) => {
      sessionUserId = `auth-${email}`
      return { success: true, userId: sessionUserId }
    })
    expect(await signInToOnboarding(token, PASSWORD)).toEqual({ success: true })
    expect(authSignInMock).toHaveBeenCalledWith('nosession@example.com', PASSWORD)

    expect((await saveOnboardingTimeOff(token, 'none', [], 1)).success).toBe(true)
    expect((await getOnboardingSnapshot(token)).success).toBe(true)
  })

  // The employee edit refuses an email change on an Onboarding starter who has a login, and moves
  // the login for current staff, so the record and the login never disagree. Should they ever, the
  // link must not let in whoever holds the old address: sign in uses the address the page shows,
  // and fails. Signing in with the login's own address (FF-63) let the old address in for good.
  it('signs in with the record\'s own address, and fails closed if the login was left at another one', async () => {
    const token = await invite('old@example.com')
    await createEmployeeAccount(token, PASSWORD)
    sessionUserId = null
    db.employees[0].email_address = 'new@example.com'
    db.employee_invite_tokens.find(t => t.token === token)!.email = 'new@example.com'

    // Only the address a login was made with can sign in.
    const logins = new Set(db.employees.map(e => e.auth_user_id).filter(Boolean))
    authSignInMock.mockImplementation(async (email: string) => {
      if (!logins.has(`auth-${email}`)) throw new Error('Invalid email or password')
      sessionUserId = `auth-${email}`
      return { success: true, userId: sessionUserId }
    })

    const result = await signInToOnboarding(token, PASSWORD)

    expect(authSignInMock).toHaveBeenCalledTimes(1)
    expect(authSignInMock).toHaveBeenCalledWith('new@example.com', PASSWORD)
    expect(result.success).toBe(false)
    expect(sessionUserId).toBeNull()
    expect((await getOnboardingSnapshot(token)).success).toBe(false)
  })

  it('tells a starter plainly when the sign-in password is wrong', async () => {
    const token = await invite('wrongpassword@example.com')
    await createEmployeeAccount(token, PASSWORD)
    sessionUserId = null

    authSignInMock.mockRejectedValue(new Error('Invalid email or password'))
    const result = await signInToOnboarding(token, 'not-the-password')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/password is not right/i)
    expect(sessionUserId).toBeNull()
  })

  it('signs out again if the sign-in lands on an account that is not this employee', async () => {
    const token = await invite('mismatch@example.com')
    await createEmployeeAccount(token, PASSWORD)
    sessionUserId = null

    authSignInMock.mockImplementation(async () => {
      sessionUserId = 'somebody-else'
      return { success: true, userId: 'somebody-else' }
    })
    const result = await signInToOnboarding(token, PASSWORD)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/different account/i)
    expect(sessionUserId).toBeNull()
  })

  it('reports a failed browser sign-in after the account is made, without undoing the account', async () => {
    const token = await invite('nosignin@example.com')
    const original = cookieClient.auth.signInWithPassword
    cookieClient.auth.signInWithPassword = async () => ({ data: { user: null } as any, error: { message: 'down' } as any })
    try {
      const account = await createEmployeeAccount(token, PASSWORD)
      expect(account).toEqual({ success: true, signedIn: false })
      expect(db.employees[0].auth_user_id).toBeTruthy()
    } finally {
      cookieClient.auth.signInWithPassword = original
    }
  })

  it('refuses a step when a different person is signed in on the same browser', async () => {
    const token = await invite('shared@example.com')
    await createEmployeeAccount(token, PASSWORD)

    sessionUserId = 'somebody-else'
    const result = await saveOnboardingTimeOff(token, 'none', [], 1)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/different account/i)
  })

  it('records "nothing booked" as a real answer that lets submission proceed', async () => {
    const token = await invite('nothingbooked@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token)

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
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token, { first_name: 'Grace', last_name: 'Hopper' })
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)

    const result = await submitOnboardingProfile(token)
    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toMatch(/time off/i)
  })

  it('will not complete without the right to work acknowledgement', async () => {
    const token = await invite('nortw@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token, { first_name: 'Alan', last_name: 'Turing' })
    await saveOnboardingTimeOff(token, 'none', [], 1)
    await fillTheMiddleOfTheFlow(token)

    const result = await submitOnboardingProfile(token)
    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toMatch(/right to work/i)
  })

  it('rejects a preferred name already used by an active employee, on the step where it is typed', async () => {
    db.employees.push({
      employee_id: 'existing-1', email_address: 'peter@example.com', status: 'Active',
      preferred_name: 'Peter', first_name: 'Peter', last_name: 'Pitcher', auth_user_id: 'auth-existing',
    })

    const token = await invite('another.peter@example.com')
    await createEmployeeAccount(token, PASSWORD)

    const result = await savePersonal(token, { first_name: 'Peter', last_name: 'Smith', preferred_name: 'Peter' })

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toMatch(/already goes by/i)
    expect(result.success === false && result.fieldErrors?.preferred_name).toMatch(/already goes by/i)
  })

  it('turns a preferred name clash at submission into advice rather than constraint text', async () => {
    // Belt and braces for the race: two starters, only one can have the name. Whoever loses must
    // be told what to change, not shown the name of a database index.
    const token = await invite('racer@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token, { first_name: 'Peter', last_name: 'Smith', preferred_name: 'Peter' })
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
    expect(result.success === false && result.error).toMatch(/go back to Personal Details/i)
    expect(result.success === false && result.error).not.toMatch(/employees_preferred_name_active_unique/)
  })

  it('treats an identical resubmission of time off as a retry, not a duplicate', async () => {
    const token = await invite('retry@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token, { first_name: 'Ada', last_name: 'Lovelace' })

    await saveOnboardingTimeOff(token, 'has_dates', [
      { startDate: LEAVE_START, endDate: LEAVE_END_3, leaveType: 'holiday' },
    ], 1)
    const before = db.leave_requests.length

    await saveOnboardingTimeOff(token, 'has_dates', [
      { startDate: LEAVE_START, endDate: LEAVE_END_3, leaveType: 'holiday' },
    ], 1)

    expect(db.leave_requests).toHaveLength(before)
  })
  it('will not save personal details without a date of birth', async () => {
    const token = await invite('nodob@example.com')
    await createEmployeeAccount(token, PASSWORD)

    const result = await saveOnboardingSection(token, 'personal', { first_name: 'Ada', last_name: 'Byron' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.fieldErrors?.date_of_birth).toBeTruthy()
    expect(db.employees[0].first_name).toBeNull()
  })

  it('will not save a main emergency contact with no phone number', async () => {
    const token = await invite('nophone@example.com')
    await createEmployeeAccount(token, PASSWORD)

    const result = await saveOnboardingSection(token, 'emergency_contacts', {
      primary: { name: 'Jo Bloggs', relationship: 'Partner', phone_number: null, mobile_number: null, address: null },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.fieldErrors?.['primary.phone_number']).toMatch(/phone or mobile/i)
    expect(db.employee_emergency_contacts).toHaveLength(0)
  })

  it('refuses a section it does not save, rather than saying it saved it', async () => {
    const token = await invite('unknownsection@example.com')
    await createEmployeeAccount(token, PASSWORD)

    const result = await saveOnboardingSection(token, 'time_off', { answer: 'none' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/cannot be saved here/i)
  })

  it('will not submit without a sort code and account number, and says which section', async () => {
    const token = await invite('nobank@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token)
    await saveOnboardingTimeOff(token, 'none', [], 1)
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)
    // A partial save is allowed, so the starter can come back to it.
    db.employee_financial_details = []
    expect((await saveOnboardingSection(token, 'financial', { bank_name: 'Test Bank' })).success).toBe(true)

    const result = await submitOnboardingProfile(token)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.section).toBe('financial')
      expect(result.error).toMatch(/sort code and account number/i)
    }
    expect(db.employees[0].status).toBe('Onboarding')
  })

  it('will not submit a profile whose date of birth is missing, even if it was saved before the rule', async () => {
    const token = await invite('olddob@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token)
    await saveOnboardingTimeOff(token, 'none', [], 1)
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)
    db.employees[0].date_of_birth = null

    const result = await submitOnboardingProfile(token)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.section).toBe('personal')
    expect(db.employees[0].status).toBe('Onboarding')
  })

  it('tells the manager about booked time off, the right to work check and an under-18 starter', async () => {
    const token = await invite('young@example.com')
    await createEmployeeAccount(token, PASSWORD)
    // 1 January seventeen years back is exactly 17 on every day of this London year.
    const seventeen = `${Number(getTodayIsoDate().slice(0, 4)) - 17}-01-01`
    await savePersonal(token, { date_of_birth: seventeen })
    await saveOnboardingTimeOff(token, 'has_dates', [
      { startDate: LEAVE_START, endDate: LEAVE_END_5, leaveType: 'holiday', note: 'Wedding' },
    ], 1)
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)

    expect(await submitOnboardingProfile(token)).toEqual({ success: true })
    expect(sendOnboardingCompleteEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendOnboardingCompleteEmail).mock.calls[0][0]).toMatchObject({
      employeeName: 'Ada Byron',
      employeeEmail: 'young@example.com',
      timeOffAnswer: 'has_dates',
      timeOffBlocks: [{ startDate: LEAVE_START, endDate: LEAVE_END_5, leaveType: 'holiday' }],
      rightToWorkCheckedOn: null,
      rightToWorkUnknown: false,
      ageIfUnder18: 17,
      ageUnknown: false,
    })
  })

  it('leaves a note on the record and a failed audit row when the manager email does not go', async () => {
    const token = await invite('emailfails@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token)
    await saveOnboardingTimeOff(token, 'none', [], 1)
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)
    vi.mocked(sendOnboardingCompleteEmail).mockRejectedValueOnce(
      new InviteEmailSendError('The from address is not verified (403)'),
    )

    // The starter's completion stands: the email is for the manager.
    expect(await submitOnboardingProfile(token)).toEqual({ success: true })
    expect(db.employees[0].status).toBe('Active')

    expect(db.employee_notes).toHaveLength(1)
    expect(db.employee_notes[0]).toMatchObject({ employee_id: db.employees[0].employee_id, created_by_user_id: null })
    // Plain words on the record staff read; the provider's own text only in the audit row.
    expect(db.employee_notes[0].note_text).toBe(
      'Onboarding completed, but the email telling the manager did not send because the email service did not accept it. ' +
      'Check their booked time off and arrange their right to work check before their first shift.',
    )
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'onboarding_complete_email',
      operation_status: 'failure',
      error_message: 'The from address is not verified (403)',
      additional_info: expect.objectContaining({ email_outcome: 'not_sent' }),
    }))
  })

  it('says the manager email may have gone, not that it did not send, when the email service gave no answer', async () => {
    const token = await invite('emailunknown@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token)
    await saveOnboardingTimeOff(token, 'none', [], 1)
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)
    vi.mocked(sendOnboardingCompleteEmail).mockRejectedValueOnce(
      new InviteEmailSendError('Resend 503', { uncertain: true }),
    )

    expect(await submitOnboardingProfile(token)).toEqual({ success: true })

    expect(db.employee_notes[0].note_text).toBe(
      'Onboarding completed. We sent the email telling the manager, but we did not hear back from the email service, so it may have gone. ' +
      'Check their booked time off and arrange their right to work check before their first shift.',
    )
    expect(db.employee_notes[0].note_text).not.toContain('Resend 503')
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'onboarding_complete_email',
      error_message: 'Resend 503',
      additional_info: expect.objectContaining({ email_outcome: 'uncertain' }),
    }))
  })

  // FF-64: a right to work record that cannot be read must reach the manager as "could not read",
  // never as "still to check", which would hide a check already recorded.
  it('tells the manager the right to work record could not be read when that read fails, and logs it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const token = await invite('rtwfails@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await savePersonal(token)
    await saveOnboardingTimeOff(token, 'none', [], 1)
    await fillTheMiddleOfTheFlow(token)
    await acknowledgeRightToWorkNotice(token)
    failingReads.add('employee_right_to_work')

    expect(await submitOnboardingProfile(token)).toEqual({ success: true })

    expect(vi.mocked(sendOnboardingCompleteEmail).mock.calls[0][0]).toMatchObject({
      rightToWorkCheckedOn: null,
      rightToWorkUnknown: true,
      // The other reads still worked, so they are reported as facts.
      timeOffAnswer: 'none',
      ageUnknown: false,
    })
    expect(errorSpy).toHaveBeenCalledWith(
      '[onboarding] Failed to read the right to work for the completion email:',
      { code: 'PGRST000', message: 'employee_right_to_work read failed' },
    )
    errorSpy.mockRestore()
  })
  it('keeps the stored bank details when the masks come back unchanged, and refuses an edited mask', async () => {
    const token = await invite('masks@example.com')
    await createEmployeeAccount(token, PASSWORD)
    await saveOnboardingSection(token, 'financial', {
      ni_number: 'QQ123456C', bank_name: 'Test Bank', bank_sort_code: '112233', bank_account_number: '12345678',
    })
    expect(db.employee_financial_details[0]).toMatchObject({
      ni_number: 'QQ123456C', bank_sort_code: '11-22-33', bank_account_number: '12345678',
    })

    // What the snapshot shows, sent back as it is: nothing changes.
    const snapshot = await getOnboardingSnapshot(token)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.financial.ni_number).toBe('••••••56C')
    expect(snapshot.data.financial.bank_account_number).toBe('••••5678')

    const unchanged = await saveOnboardingSection(token, 'financial', {
      ...snapshot.data.financial, bank_name: 'Other Bank',
    })
    expect(unchanged.success).toBe(true)
    expect(db.employee_financial_details[0]).toMatchObject({
      ni_number: 'QQ123456C', bank_name: 'Other Bank', bank_account_number: '12345678',
    })

    // One more digit typed after the mask is an edit, not "unchanged": refuse it, never drop it.
    const edited = await saveOnboardingSection(token, 'financial', {
      ...snapshot.data.financial, bank_account_number: '••••56789',
    })
    expect(edited.success).toBe(false)
    if (!edited.success) expect(edited.fieldErrors?.bank_account_number).toMatch(/type the full value/)
    expect(db.employee_financial_details[0].bank_account_number).toBe('12345678')
  })
})
