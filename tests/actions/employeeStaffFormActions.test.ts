import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/rate-limit-server', () => ({
  checkRateLimit: vi.fn(),
}))

vi.mock('@/services/employees', async () => {
  const actual = await vi.importActual<typeof import('@/services/employees')>('@/services/employees')
  return {
    ...actual,
    EmployeeService: {
      addEmergencyContact: vi.fn(),
      addEmployeeAttachment: vi.fn(),
      addEmployeeNote: vi.fn(),
      createEmployee: vi.fn(),
      deleteEmergencyContact: vi.fn(),
      deleteEmployee: vi.fn(),
      deleteRightToWorkPhoto: vi.fn(),
      getAttachmentSignedUrl: vi.fn(),
      getRightToWorkPhotoUrl: vi.fn(),
      updateEmergencyContact: vi.fn(),
      updateEmployee: vi.fn(),
      updateOnboardingChecklist: vi.fn(),
      upsertFinancialDetails: vi.fn(),
      upsertHealthRecord: vi.fn(),
      upsertRightToWork: vi.fn(),
    },
  }
})

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/audit-helpers'
import { logAuditEvent } from '@/app/actions/audit'
import { sendEmail } from '@/lib/email/emailService'
import { EmployeeService, EmployeeServiceError, LoginLeftMovedError } from '@/services/employees'
import { APP_LOGIN_EMAIL_REFUSAL, ONBOARDING_LOGIN_EMAIL_REFUSAL } from '@/lib/employees/login-email'
import {
  addEmergencyContact,
  addEmployee,
  addEmployeeAttachment,
  addEmployeeNote,
  createRightToWorkDocumentUploadUrl,
  deleteEmergencyContact,
  deleteEmployee,
  deleteRightToWorkPhoto,
  getAttachmentSignedUrl,
  getRightToWorkPhotoUrl,
  updateEmergencyContact,
  updateEmployee,
  updateOnboardingChecklist,
  upsertFinancialDetails,
  upsertHealthRecord,
  upsertRightToWork,
} from '@/app/actions/employeeActions'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock
const mockedSendEmail = sendEmail as unknown as Mock
const service = EmployeeService as unknown as Record<string, Mock>

const EMPLOYEE_ID = '3f24f3f6-26bb-4a53-a29a-07b6acffad4f'
const CATEGORY_ID = '8caa75bc-9f5b-4421-b8e8-8748b92276d2'

function form(values: Record<string, string>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(values)) formData.set(key, value)
  return formData
}

const employeeFields = {
  employee_id: EMPLOYEE_ID,
  first_name: 'Jacob',
  last_name: 'Williams',
  email_address: 'jacob@example.com',
  job_title: 'Bartender',
  employment_start_date: '2026-05-22',
  status: 'Active',
}

/** Allows everything except the named permissions. */
function allowAllExcept(...refused: string[]) {
  mockedPermission.mockImplementation(async (_module: string, action: string) => !refused.includes(action))
}

beforeEach(() => {
  vi.clearAllMocks()
  allowAllExcept()
  ;(getCurrentUser as unknown as Mock).mockResolvedValue({ user_id: 'user-1', user_email: 'manager@example.com' })
  mockedLogAuditEvent.mockResolvedValue(undefined)
})

describe('updateEmployee', () => {
  it('shows the service refusal instead of a database error (FF-25)', async () => {
    service.updateEmployee.mockRejectedValue(
      new EmployeeServiceError('Use Begin Separation on the employee page to start a separation.')
    )

    const result = await updateEmployee(null, form({ ...employeeFields, status: 'Started Separation' }))

    expect(result).toEqual({ type: 'error', message: 'Use Begin Separation on the employee page to start a separation.' })
  })

  it('explains the separation shift check in plain words (FF-25)', async () => {
    service.updateEmployee.mockRejectedValue({
      code: '23514',
      message: 'new row for relation "employees" violates check constraint "employees_separation_shift_policy_check"',
      details: null,
      hint: null,
    })

    const result = await updateEmployee(null, form(employeeFields))

    expect(result?.message).toContain('Use Cancel Separation on the employee page')
  })

  it('sends the PIN and preferred name in the one update, with no second write (FF-25)', async () => {
    service.updateEmployee.mockResolvedValue({
      updatedEmployee: { employee_id: EMPLOYEE_ID },
      oldEmployee: { employee_id: EMPLOYEE_ID },
      onboardingLinks: null,
    })

    const result = await updateEmployee(null, form({ ...employeeFields, preferred_name: '', timeclock_pin: '1234' }))

    expect(result?.type).toBe('success')
    expect(service.updateEmployee).toHaveBeenCalledTimes(1)
    expect(service.updateEmployee.mock.calls[0][2]).toEqual({
      preferred_name: null,
      timeclock_pin_hash: expect.any(String),
      timeclock_pin_updated_at: expect.any(String),
    })
    expect(service.updateEmployee.mock.calls[0][2].timeclock_pin_hash).not.toBe('1234')
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('says when activating a starter closed their onboarding link, and audits it (FF-23)', async () => {
    service.updateEmployee.mockResolvedValue({
      updatedEmployee: { employee_id: EMPLOYEE_ID, status: 'Active' },
      oldEmployee: { employee_id: EMPLOYEE_ID, status: 'Onboarding' },
      onboardingLinks: { closed: 1 },
    })

    const result = await updateEmployee(null, form(employeeFields))

    expect(result?.message).toBe('Employee updated. They are now Active and their onboarding link has been closed.')
    expect(result?.warning).toBeUndefined()
    const audit = mockedLogAuditEvent.mock.calls[0][0]
    expect(audit.additional_info).toMatchObject({ onboarding_invite_links_closed: 1 })
  })

  it('does not mention a link when the starter never had one', async () => {
    service.updateEmployee.mockResolvedValue({
      updatedEmployee: { employee_id: EMPLOYEE_ID, status: 'Active' },
      oldEmployee: { employee_id: EMPLOYEE_ID, status: 'Onboarding' },
      onboardingLinks: { closed: 0 },
    })

    const result = await updateEmployee(null, form(employeeFields))

    expect(result?.message).toBe('Employee updated. They are now Active.')
  })

  it('saves but warns when the old onboarding link could not be closed', async () => {
    service.updateEmployee.mockResolvedValue({
      updatedEmployee: { employee_id: EMPLOYEE_ID, status: 'Active' },
      oldEmployee: { employee_id: EMPLOYEE_ID, status: 'Onboarding' },
      onboardingLinks: { failed: true },
    })

    const result = await updateEmployee(null, form(employeeFields))

    expect(result).toMatchObject({ type: 'success', warning: true })
    expect(result?.message).toContain('could not be closed')
    const audit = mockedLogAuditEvent.mock.calls[0][0]
    expect(audit.additional_info).toMatchObject({ onboarding_invite_links_close_failed: true })
  })

  it('lower-cases the email before saving (FF-34)', async () => {
    service.updateEmployee.mockResolvedValue({ updatedEmployee: {}, oldEmployee: {}, onboardingLinks: null })

    await updateEmployee(null, form({ ...employeeFields, email_address: ' Jacob@Example.COM ' }))

    expect(service.updateEmployee.mock.calls[0][1].email_address).toBe('jacob@example.com')
  })

  it('audits the login moving with a new email address, with the addresses only in the audit row (security#1)', async () => {
    service.updateEmployee.mockResolvedValue({
      updatedEmployee: { employee_id: EMPLOYEE_ID, email_address: 'jacob@example.com' },
      oldEmployee: { employee_id: EMPLOYEE_ID, email_address: 'jacob.old@example.com' },
      onboardingLinks: null,
      loginEmail: { previous: 'jacob.old@example.com', current: 'jacob@example.com' },
    })

    const result = await updateEmployee(null, form(employeeFields))

    expect(result).toMatchObject({ type: 'success', message: 'Employee updated. They now sign in with their new email address.' })
    expect(result?.message).not.toContain('@')
    const loginAudit = mockedLogAuditEvent.mock.calls.map((call) => call[0]).find((entry) => entry.operation_type === 'update_login_email')
    expect(loginAudit).toMatchObject({
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      operation_status: 'success',
      old_values: { login_email: 'jacob.old@example.com' },
      new_values: { login_email: 'jacob@example.com' },
    })
  })

  it('writes no login audit when the login did not move', async () => {
    service.updateEmployee.mockResolvedValue({
      updatedEmployee: { employee_id: EMPLOYEE_ID },
      oldEmployee: { employee_id: EMPLOYEE_ID },
      onboardingLinks: null,
      loginEmail: null,
    })

    const result = await updateEmployee(null, form(employeeFields))

    expect(result?.message).toBe('Employee updated successfully.')
    expect(mockedLogAuditEvent.mock.calls.some((call) => call[0].operation_type === 'update_login_email')).toBe(false)
  })

  it('tells staff to delete and re-invite a starter who already set a password (security#1)', async () => {
    service.updateEmployee.mockRejectedValue(new EmployeeServiceError(ONBOARDING_LOGIN_EMAIL_REFUSAL))

    const result = await updateEmployee(null, form({ ...employeeFields, status: 'Onboarding' }))

    expect(result).toEqual({ type: 'error', message: ONBOARDING_LOGIN_EMAIL_REFUSAL })
    expect(result?.message).toContain('delete this record and invite them again')
    expect(mockedLogAuditEvent.mock.calls.some((call) => call[0].operation_type === 'update_login_email')).toBe(false)
  })

  it('tells the service who is saving and whether they can manage user roles (login#1)', async () => {
    service.updateEmployee.mockResolvedValue({ updatedEmployee: {}, oldEmployee: {}, onboardingLinks: null, loginEmail: null })

    await updateEmployee(null, form(employeeFields))

    expect(mockedPermission).toHaveBeenCalledWith('users', 'manage_roles', 'user-1')
    expect(service.updateEmployee.mock.calls[0][3]).toEqual({ editorUserId: 'user-1', canManageRoles: true })
  })

  it('passes canManageRoles false for an editor without users:manage_roles (login#1)', async () => {
    allowAllExcept('manage_roles')
    service.updateEmployee.mockResolvedValue({ updatedEmployee: {}, oldEmployee: {}, onboardingLinks: null, loginEmail: null })

    const result = await updateEmployee(null, form(employeeFields))

    expect(result?.type).toBe('success')
    expect(service.updateEmployee.mock.calls[0][3]).toEqual({ editorUserId: 'user-1', canManageRoles: false })
  })

  it('passes no editor and no role management when the signed-in user cannot be read (login#1)', async () => {
    ;(getCurrentUser as unknown as Mock).mockResolvedValue({ user_id: null, user_email: null })
    service.updateEmployee.mockResolvedValue({ updatedEmployee: {}, oldEmployee: {}, onboardingLinks: null, loginEmail: null })

    await updateEmployee(null, form(employeeFields))

    expect(mockedPermission).not.toHaveBeenCalledWith('users', 'manage_roles', expect.anything())
    expect(service.updateEmployee.mock.calls[0][3]).toEqual({ editorUserId: null, canManageRoles: false })
  })

  it('shows the refusal when the login also opens the management app (login#1)', async () => {
    allowAllExcept('manage_roles')
    service.updateEmployee.mockRejectedValue(new EmployeeServiceError(APP_LOGIN_EMAIL_REFUSAL))

    const result = await updateEmployee(null, form(employeeFields))

    expect(result).toEqual({ type: 'error', message: APP_LOGIN_EMAIL_REFUSAL })
    expect(mockedLogAuditEvent.mock.calls.some((call) => call[0].operation_type === 'update_login_email')).toBe(false)
  })

  it('audits the login move when the save failed but the login was left on the new address (login-audit)', async () => {
    const message = 'We could not tell whether the changes were saved, but they now sign in with their new email address. Please refresh the page and check the record before saving again. If it still shows the old email address, tell an administrator.'
    service.updateEmployee.mockRejectedValue(
      new LoginLeftMovedError(message, { previous: 'jacob.old@example.com', current: 'jacob@example.com' })
    )

    const result = await updateEmployee(null, form(employeeFields))

    expect(result).toEqual({ type: 'error', message })
    const entries = mockedLogAuditEvent.mock.calls.map((call) => call[0])
    // The failed save is still recorded as one.
    expect(entries.find((entry) => entry.operation_type === 'update')).toMatchObject({
      operation_status: 'failure',
      error_message: message,
    })
    const loginAudit = entries.find((entry) => entry.operation_type === 'update_login_email')
    expect(loginAudit).toEqual({
      user_id: 'user-1',
      user_email: 'manager@example.com',
      operation_type: 'update_login_email',
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      operation_status: 'success',
      old_values: { login_email: 'jacob.old@example.com' },
      new_values: { login_email: 'jacob@example.com' },
      additional_info: { reason: 'employee_email_changed', record_save_unconfirmed: true },
    })
  })

  it('writes no login audit for any other failed save', async () => {
    service.updateEmployee.mockRejectedValue(
      new EmployeeServiceError('We could not check their login, so the new email address was not saved. Please try again.')
    )

    await updateEmployee(null, form(employeeFields))

    expect(mockedLogAuditEvent.mock.calls.some((call) => call[0].operation_type === 'update_login_email')).toBe(false)
  })

  it('keeps "check your input" for data the database refused, and not for a timeout (login#4)', async () => {
    service.updateEmployee.mockRejectedValueOnce({
      code: '23514',
      message: 'new row for relation "employees" violates check constraint "chk_employee_email_format"',
      details: null,
      hint: null,
    })
    const refused = await updateEmployee(null, form(employeeFields))
    expect(refused?.message).toBe('Please enter a valid email address')

    service.updateEmployee.mockRejectedValueOnce({ code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null })
    const timedOut = await updateEmployee(null, form(employeeFields))
    expect(timedOut).toEqual({ type: 'error', message: 'The changes could not be saved. Please try again.' })
  })
})

describe('addEmployee', () => {
  it('refuses a bad sort code before the employee is created (FF-24)', async () => {
    const result = await addEmployee(null, form({ ...employeeFields, bank_sort_code: '1234' }))

    expect(result?.type).toBe('error')
    expect(result?.errors?.bank_sort_code).toEqual(['Sort code must be 6 digits'])
    expect(service.createEmployee).not.toHaveBeenCalled()
  })

  it('stores bank details normalised and drops disability details once unticked (FF-24, FF-29)', async () => {
    service.createEmployee.mockResolvedValue({ employee_id: EMPLOYEE_ID, first_name: 'Jacob', last_name: 'Williams' })

    const result = await addEmployee(null, form({
      ...employeeFields,
      ni_number: 'ab 12 34 56 c',
      bank_sort_code: '123456',
      bank_account_number: '1234 5678',
      had_absence_over_2_weeks_last_3_years: 'false',
      had_outpatient_treatment_over_3_months_last_3_years: 'false',
      is_registered_disabled: 'false',
      disability_details: 'Left over from an earlier answer',
      recent_treatment: 'Physio',
    }))

    expect(result?.type).toBe('success')
    const payload = service.createEmployee.mock.calls[0][0]
    expect(payload.financial).toMatchObject({ ni_number: 'AB123456C', bank_sort_code: '12-34-56', bank_account_number: '12345678' })
    expect(payload.health).toMatchObject({ disability_details: null, recent_treatment: 'Physio' })
  })

  it('creates no health record when no health answers were sent', async () => {
    service.createEmployee.mockResolvedValue({ employee_id: EMPLOYEE_ID, first_name: 'Jacob', last_name: 'Williams' })

    await addEmployee(null, form(employeeFields))

    expect(service.createEmployee.mock.calls[0][0].health).toBeUndefined()
  })
})

describe('upsertHealthRecord (FF-29, FF-15)', () => {
  it('clears the disability details when "registered disabled" is unticked, and keeps recent treatment', async () => {
    service.upsertHealthRecord.mockResolvedValue({})

    const result = await upsertHealthRecord(null, form({
      employee_id: EMPLOYEE_ID,
      disability_reg_number: 'D-123',
      disability_reg_expiry_date: '2027-01-01',
      disability_details: 'Old answer',
      recent_treatment: 'Physio in October',
    }))

    expect(result?.type).toBe('success')
    expect(service.upsertHealthRecord.mock.calls[0][0]).toMatchObject({
      is_registered_disabled: false,
      disability_reg_number: null,
      disability_reg_expiry_date: null,
      disability_details: null,
      recent_treatment: 'Physio in October',
    })
  })
})

describe('addEmployeeNote (FF-33)', () => {
  it('records the signed-in user as the author, whatever the form says', async () => {
    service.addEmployeeNote.mockResolvedValue({})

    await addEmployeeNote(null, form({ employee_id: EMPLOYEE_ID, note_text: 'Spoke about shifts', created_by_user_id: 'someone-else' }))

    expect(service.addEmployeeNote).toHaveBeenCalledWith({
      employee_id: EMPLOYEE_ID,
      note_text: 'Spoke about shifts',
      created_by_user_id: 'user-1',
    })
  })
})

describe('addEmployeeNote and updateOnboardingChecklist keep database text out of the toast (siblings#10)', () => {
  const foreignKeyError = {
    code: '23503',
    message: 'insert or update on table "employee_notes" violates foreign key constraint "employee_notes_employee_id_fkey"',
    details: 'Key (employee_id) is not present in table "employees".',
    hint: null,
  }

  it('says the employee is gone when a note is added to a deleted record', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.addEmployeeNote.mockRejectedValue(foreignKeyError)

    const result = await addEmployeeNote(null, form({ employee_id: EMPLOYEE_ID, note_text: 'Spoke about shifts' }))

    expect(result).toEqual({ type: 'error', message: 'This employee no longer exists, so the note was not saved. Refresh the page.' })
    expect(result?.message).not.toContain('foreign key')
    expect(result?.message).not.toContain('Database error')
  })

  it('gives a plain message for any other note failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.addEmployeeNote.mockRejectedValue(new Error('fetch failed: ECONNRESET'))

    const result = await addEmployeeNote(null, form({ employee_id: EMPLOYEE_ID, note_text: 'Spoke about shifts' }))

    expect(result).toEqual({ type: 'error', message: 'The note could not be saved. Please try again.' })
  })

  it('says the employee is gone when a checklist item is ticked on a deleted record', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.updateOnboardingChecklist.mockRejectedValue({
      ...foreignKeyError,
      message: 'insert or update on table "employee_onboarding_checklist" violates foreign key constraint "employee_onboarding_checklist_employee_id_fkey"',
    })

    const result = await updateOnboardingChecklist(EMPLOYEE_ID, 'till_system_setup', true)

    expect(result).toEqual({ error: 'This employee no longer exists, so the checklist was not updated. Refresh the page.' })
  })

  it('keeps the signing refusal as written, and hides any other checklist failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.updateOnboardingChecklist.mockRejectedValueOnce(
      new EmployeeServiceError('The employee agreement is ticked when the employee signs it. Use Send for Signature on their page instead of ticking it by hand.')
    )
    const refused = await updateOnboardingChecklist(EMPLOYEE_ID, 'employee_agreement_accepted', true)
    expect(refused.error).toContain('Use Send for Signature')

    service.updateOnboardingChecklist.mockRejectedValueOnce(new Error('upstream connect error or disconnect/reset before headers'))
    const failed = await updateOnboardingChecklist(EMPLOYEE_ID, 'till_system_setup', true)
    expect(failed).toEqual({ error: 'The checklist could not be updated. Please try again.' })
  })
})

describe('a database that cannot be reached is not "invalid data" (login#4)', () => {
  // What supabase-js hands back when the request never reached the database: it has a code, so
  // it looked like a constraint error and read "Invalid data provided".
  const connectionError = { code: '', message: 'TypeError: fetch failed', details: 'ECONNRESET', hint: '' }
  const CONTACT_ID = '9e0c1f6e-2b8a-4a51-9c11-1a2b3c4d5e6f'

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('gives the note fallback when a note cannot reach the database', async () => {
    service.addEmployeeNote.mockRejectedValue(connectionError)
    const result = await addEmployeeNote(null, form({ employee_id: EMPLOYEE_ID, note_text: 'Spoke about shifts' }))
    expect(result).toEqual({ type: 'error', message: 'The note could not be saved. Please try again.' })
  })

  it('gives the checklist fallback when a tick cannot reach the database', async () => {
    service.updateOnboardingChecklist.mockRejectedValue(connectionError)
    const result = await updateOnboardingChecklist(EMPLOYEE_ID, 'till_system_setup', true)
    expect(result).toEqual({ error: 'The checklist could not be updated. Please try again.' })
  })

  it('gives each sibling form its own plain fallback', async () => {
    service.createEmployee.mockRejectedValue(connectionError)
    expect((await addEmployee(null, form(employeeFields)))?.message).toBe('The employee could not be added. Please try again.')

    service.addEmergencyContact.mockRejectedValue(connectionError)
    expect((await addEmergencyContact(null, form({ employee_id: EMPLOYEE_ID, name: 'Sam', priority: 'Secondary' })))?.message)
      .toBe('The emergency contact could not be added. Please try again.')

    service.updateEmergencyContact.mockRejectedValue(connectionError)
    expect((await updateEmergencyContact(null, form({ contact_id: CONTACT_ID, employee_id: EMPLOYEE_ID, name: 'Sam', priority: 'Secondary' })))?.message)
      .toBe('The emergency contact could not be updated. Please try again.')

    service.deleteEmergencyContact.mockRejectedValue(connectionError)
    expect((await deleteEmergencyContact(null, form({ contact_id: CONTACT_ID, employee_id: EMPLOYEE_ID })))?.message)
      .toBe('The emergency contact could not be deleted. Please try again.')

    service.upsertFinancialDetails.mockRejectedValue(connectionError)
    expect((await upsertFinancialDetails(null, form({ employee_id: EMPLOYEE_ID, bank_name: 'Lloyds' })))?.message)
      .toBe('The financial details could not be saved. Please try again.')

    service.upsertHealthRecord.mockRejectedValue(connectionError)
    expect((await upsertHealthRecord(null, form({ employee_id: EMPLOYEE_ID })))?.message)
      .toBe('The health record could not be saved. Please try again.')
  })

  it('keeps a duplicate address out of the server log', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    service.createEmployee.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "employees_email_address_key"',
      details: 'Key (email_address)=(jacob@example.com) already exists.',
      hint: null,
    })

    expect((await addEmployee(null, form(employeeFields)))?.message).toBe('This email address is already in use')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('@')
  })

  it('still explains data the database refused on the sibling forms', async () => {
    service.createEmployee.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "employees_email_address_key"',
      details: null,
      hint: null,
    })
    expect((await addEmployee(null, form(employeeFields)))?.message).toBe('This email address is already in use')

    service.upsertFinancialDetails.mockRejectedValue({
      code: '23514',
      message: 'new row violates check constraint "chk_bank_details"',
      details: null,
      hint: null,
    })
    expect((await upsertFinancialDetails(null, form({ employee_id: EMPLOYEE_ID, bank_name: 'Lloyds' })))?.message)
      .toBe('Please enter valid UK bank details (8-digit account number and 6-digit sort code)')
  })

  it('no longer shows the error\'s own text when adding an employee fails', async () => {
    service.createEmployee.mockRejectedValue(new Error('upstream connect error or disconnect/reset before headers'))
    const result = await addEmployee(null, form(employeeFields))
    expect(result).toEqual({ type: 'error', message: 'The employee could not be added. Please try again.' })
  })
})

describe('right to work actions (FF-32, FF-36)', () => {
  const rtwFields = { employee_id: EMPLOYEE_ID, document_type: 'Passport', verification_date: '2026-11-01' }

  it('refuses a stored path that is not a right to work upload', async () => {
    const result = await upsertRightToWork(null, form({ ...rtwFields, photo_storage_path: `${EMPLOYEE_ID}/contract.pdf` }))
    expect(result).toEqual({ type: 'error', message: 'Invalid upload path.' })
    expect(service.upsertRightToWork).not.toHaveBeenCalled()
  })

  it('needs the upload permission to attach a scan', async () => {
    allowAllExcept('upload_documents')
    const result = await upsertRightToWork(null, form({ ...rtwFields, photo_storage_path: `${EMPLOYEE_ID}/rtw_1730000000000_passport.pdf` }))
    expect(result?.type).toBe('error')
    expect(service.upsertRightToWork).not.toHaveBeenCalled()

    const upload = await createRightToWorkDocumentUploadUrl(EMPLOYEE_ID, 'passport.pdf', 'application/pdf', 1000)
    expect(upload.type).toBe('error')
  })

  it('saves the check details without the upload permission when no scan is attached', async () => {
    allowAllExcept('upload_documents')
    service.upsertRightToWork.mockResolvedValue({})
    const result = await upsertRightToWork(null, form(rtwFields))
    expect(result?.type).toBe('success')
  })

  it('needs the delete permission to remove a scan', async () => {
    allowAllExcept('delete_documents')
    const result = await deleteRightToWorkPhoto(EMPLOYEE_ID)
    expect(result.error).toBeDefined()
    expect(service.deleteRightToWorkPhoto).not.toHaveBeenCalled()
  })

  it('records the stored path when a scan is deleted', async () => {
    service.deleteRightToWorkPhoto.mockResolvedValue({ photoPath: `${EMPLOYEE_ID}/rtw_1_passport.pdf` })
    await deleteRightToWorkPhoto(EMPLOYEE_ID)
    expect(mockedLogAuditEvent.mock.calls[0][0].additional_info).toMatchObject({ file_path: `${EMPLOYEE_ID}/rtw_1_passport.pdf` })
  })

  it('audits each view and download of the scan, and names the download', async () => {
    const single = vi.fn().mockResolvedValue({ data: { photo_storage_path: `${EMPLOYEE_ID}/rtw_1730000000000_passport.pdf` }, error: null })
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
    })
    service.getRightToWorkPhotoUrl.mockResolvedValue('https://signed')

    await getRightToWorkPhotoUrl(EMPLOYEE_ID)
    await getRightToWorkPhotoUrl(EMPLOYEE_ID, { download: true })

    expect(service.getRightToWorkPhotoUrl.mock.calls[0]).toEqual([`${EMPLOYEE_ID}/rtw_1730000000000_passport.pdf`, undefined])
    expect(service.getRightToWorkPhotoUrl.mock.calls[1]).toEqual([`${EMPLOYEE_ID}/rtw_1730000000000_passport.pdf`, 'passport.pdf'])
    expect(mockedLogAuditEvent.mock.calls.map((call) => call[0].operation_type)).toEqual(['view', 'download'])
    expect(mockedLogAuditEvent.mock.calls[0][0].additional_info).toMatchObject({ attachment_type: 'right_to_work_photo' })
  })

  it('shows a plain message, not storage\'s own text, when the scan cannot be opened', async () => {
    const single = vi.fn().mockResolvedValue({ data: { photo_storage_path: `${EMPLOYEE_ID}/rtw_1730000000000_passport.pdf` }, error: null })
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
    })
    service.getRightToWorkPhotoUrl.mockRejectedValue(new Error('Object not found'))

    const result = await getRightToWorkPhotoUrl(EMPLOYEE_ID)

    expect(result).toEqual({ url: null, error: 'Could not open the document. Please try again.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('says it could not download, not open, when a Download fails (correctness#6)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const single = vi.fn().mockResolvedValue({ data: { photo_storage_path: `${EMPLOYEE_ID}/rtw_1730000000000_passport.pdf` }, error: null })
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
    })
    service.getRightToWorkPhotoUrl.mockRejectedValueOnce(new Error('Object not found'))
    expect(await getRightToWorkPhotoUrl(EMPLOYEE_ID, { download: true })).toEqual({
      url: null,
      error: 'Could not download the document. Please try again.',
    })

    // Storage handed back no link at all.
    service.getRightToWorkPhotoUrl.mockResolvedValueOnce(null)
    expect(await getRightToWorkPhotoUrl(EMPLOYEE_ID, { download: true })).toEqual({
      url: null,
      error: 'Could not download the document. Please try again.',
    })
  })

  it('shows a fixed message, not storage\'s own text, when the upload link cannot be made (security#4)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: null,
      error: { name: 'StorageApiError', message: 'new row violates row-level security policy', status: 403, statusCode: '403' },
    })
    mockedCreateAdminClient.mockReturnValue({ storage: { from: vi.fn(() => ({ createSignedUploadUrl })) } })

    const result = await createRightToWorkDocumentUploadUrl(EMPLOYEE_ID, 'passport.pdf', 'application/pdf', 1000)

    expect(result).toEqual({ type: 'error', message: 'We could not prepare the upload. Please try again.' })
    // The storage text is kept, field by field, in the server log.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('signed upload link'),
      expect.objectContaining({ message: 'new row violates row-level security policy', status: 403 })
    )
  })

  it('does not pass a storage error through when the right to work save fails (security#4)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.upsertRightToWork.mockRejectedValueOnce(new Error('Failed to upload document photo: Failed to fetch'))
    const failed = await upsertRightToWork(null, form(rtwFields))
    expect(failed).toEqual({ type: 'error', message: 'The right to work details could not be saved. Please try again.' })

    // A refusal written for people is still shown as it is.
    service.upsertRightToWork.mockRejectedValueOnce(
      new EmployeeServiceError('The uploaded document could not be found, so nothing was saved. Please upload it again.')
    )
    const refused = await upsertRightToWork(null, form(rtwFields))
    expect(refused?.message).toBe('The uploaded document could not be found, so nothing was saved. Please upload it again.')
  })
})

describe('getAttachmentSignedUrl (FF-68, correctness#6, correctness#9)', () => {
  const ATTACHMENT_ID = '5b1d2c3e-4f50-4a61-8b72-9c83d4e5f601'

  function attachmentRow() {
    const single = vi.fn().mockResolvedValue({
      data: { storage_path: `${EMPLOYEE_ID}/contract.pdf`, employee_id: EMPLOYEE_ID, file_name: 'contract.pdf' },
      error: null,
    })
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
    })
  }

  it('shows a plain message, not storage\'s own text, when the file cannot be opened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    attachmentRow()
    service.getAttachmentSignedUrl.mockRejectedValue(new Error('Object not found'))

    const result = await getAttachmentSignedUrl(ATTACHMENT_ID)

    expect(result).toEqual({ url: null, error: 'Could not open the document. Please try again.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('says it could not download when a Download fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    attachmentRow()
    service.getAttachmentSignedUrl.mockRejectedValue(new Error('Object not found'))

    const result = await getAttachmentSignedUrl(ATTACHMENT_ID, { download: true })

    expect(result).toEqual({ url: null, error: 'Could not download the document. Please try again.' })
    expect(service.getAttachmentSignedUrl).toHaveBeenCalledWith(`${EMPLOYEE_ID}/contract.pdf`, 'contract.pdf')
  })

  it('audits a download that worked', async () => {
    attachmentRow()
    service.getAttachmentSignedUrl.mockResolvedValue('https://signed')

    const result = await getAttachmentSignedUrl(ATTACHMENT_ID, { download: true })

    expect(result).toEqual({ url: 'https://signed', error: null })
    expect(mockedLogAuditEvent.mock.calls[0][0]).toMatchObject({ operation_type: 'download', resource_id: ATTACHMENT_ID })
  })
})

describe('deleteEmployee (FF-40, FF-04, FF-39)', () => {
  it('passes on the service refusal for anyone not onboarding', async () => {
    service.deleteEmployee.mockRejectedValue(
      new EmployeeServiceError('Only a new starter who is still onboarding can be deleted. For anyone who has worked here, use Begin Separation so their shifts, hours and pay history are kept.')
    )

    const result = await deleteEmployee(null, form({ employee_id: EMPLOYEE_ID }))

    expect(result?.type).toBe('error')
    expect(result?.message).toContain('use Begin Separation')
  })

  it('returns success with a warning when the login could not be removed, and sanitises the audit', async () => {
    service.deleteEmployee.mockResolvedValue({
      deletedEmployee: { employee_id: EMPLOYEE_ID, first_name: 'Jacob', last_name: 'Williams', ni_number: 'AB123456C' },
      loginRemoved: false,
    })

    const result = await deleteEmployee(null, form({ employee_id: EMPLOYEE_ID }))

    expect(result).toMatchObject({ type: 'success', message: 'Employee deleted.' })
    expect(result?.warning).toContain('their login could not be removed')
    const audit = mockedLogAuditEvent.mock.calls[0][0]
    expect(audit.old_values).not.toHaveProperty('ni_number')
    expect(audit.additional_info).toMatchObject({ login_removed: false })
  })

  it('says plainly when another record still refers to them', async () => {
    service.deleteEmployee.mockRejectedValue({ code: '23503', message: 'fk', details: null, hint: null })
    const result = await deleteEmployee(null, form({ employee_id: EMPLOYEE_ID }))
    expect(result?.message).toBe('Other records still refer to this employee, so they were not deleted.')
  })
})

describe('deleteEmergencyContact (FF-33)', () => {
  it('scopes the delete to the employee', async () => {
    service.deleteEmergencyContact.mockResolvedValue(undefined)
    await deleteEmergencyContact(null, form({ contact_id: '9e0c1f6e-2b8a-4a51-9c11-1a2b3c4d5e6f', employee_id: EMPLOYEE_ID }))
    expect(service.deleteEmergencyContact).toHaveBeenCalledWith('9e0c1f6e-2b8a-4a51-9c11-1a2b3c4d5e6f', EMPLOYEE_ID)
  })

  it('shows the not-found refusal', async () => {
    service.deleteEmergencyContact.mockRejectedValue(
      new EmployeeServiceError('That emergency contact was not found for this employee. Refresh the page and try again.')
    )
    const result = await deleteEmergencyContact(null, form({ contact_id: '9e0c1f6e-2b8a-4a51-9c11-1a2b3c4d5e6f', employee_id: EMPLOYEE_ID }))
    expect(result?.message).toContain('not found for this employee')
  })
})

describe('addEmployeeAttachment email outcome (FF-31)', () => {
  function attachmentClient(category: { category_name: string; email_on_upload: boolean }) {
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        const row = table === 'attachment_categories'
          ? category
          : { first_name: 'Jacob', last_name: 'Williams', preferred_name: null, email_address: 'jacob@example.com' }
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) })) })),
        }
      }),
      storage: {
        from: vi.fn(() => ({ download: vi.fn().mockResolvedValue({ data: new Blob(['pdf']), error: null }) })),
      },
    })
    service.addEmployeeAttachment.mockResolvedValue({ storagePath: `${EMPLOYEE_ID}/contract.pdf` })
  }

  function uploadForm() {
    const formData = form({ employee_id: EMPLOYEE_ID, category_id: CATEGORY_ID })
    formData.set('attachment_file', new File(['pdf'], 'contract.pdf', { type: 'application/pdf' }))
    return formData
  }

  it('reports who the file was emailed to', async () => {
    attachmentClient({ category_name: 'Contracts', email_on_upload: true })
    mockedSendEmail.mockResolvedValue({ success: true })

    const result = await addEmployeeAttachment(null, uploadForm())

    expect(result).toMatchObject({ type: 'success', email: { status: 'sent', recipient: 'jacob@example.com' } })
    expect(result?.message).toBe('Attachment uploaded and emailed to jacob@example.com.')
  })

  it('warns when the email did not go, while keeping the upload', async () => {
    attachmentClient({ category_name: 'Contracts', email_on_upload: true })
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend: domain not verified' })

    const result = await addEmployeeAttachment(null, uploadForm())

    expect(result).toMatchObject({ type: 'success', email: { status: 'failed', reason: 'the email service did not accept it' } })
    expect(result?.message).toBe(
      'Attachment uploaded, but the email to the employee may not have been sent (the email service did not accept it). Check with them, or send it another way.',
    )
    // The provider's own text stays out of what staff see.
    expect(result?.message).not.toContain('Resend')
  })

  it('says plainly when email sending is switched off', async () => {
    attachmentClient({ category_name: 'Contracts', email_on_upload: true })
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Email is suspended', code: 'email_suspended' })

    const result = await addEmployeeAttachment(null, uploadForm())

    expect(result?.message).toContain('(email sending is switched off at the moment)')
  })

  it('names a blocked address rather than blaming the email service (correctness#5)', async () => {
    attachmentClient({ category_name: 'Payslip', email_on_upload: true })
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Recipient email address is suppressed', code: 'recipient_suppressed' })

    const result = await addEmployeeAttachment(null, uploadForm())

    expect(result).toMatchObject({
      type: 'success',
      email: { status: 'failed', reason: 'emails to their address are blocked after an earlier bounce or complaint, so check the address on their record' },
    })
    expect(result?.message).not.toContain('did not accept it')
    expect(result?.message).not.toContain('suppressed')
  })

  it('says the email may have gone when the email service did not answer, and never that it failed (correctness#5)', async () => {
    attachmentClient({ category_name: 'Payslip', email_on_upload: true })
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend request timed out', uncertain: true })

    const result = await addEmployeeAttachment(null, uploadForm())

    expect(result).toMatchObject({ type: 'success', email: { status: 'uncertain' } })
    expect(result?.message).toBe(
      'Attachment uploaded. We did not hear back from the email service, so the email to the employee may have gone. Check with them before sending it again.',
    )
    expect(result?.message).not.toContain('did not accept')
    expect(result?.message).not.toContain('send it another way')
    expect(result?.message).not.toContain('Resend')
    // Sent once only: an uncertain send is never retried here.
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const audit = mockedLogAuditEvent.mock.calls.map((call) => call[0]).find((entry) => entry.resource_type === 'employee_attachment')
    expect(audit?.additional_info).toMatchObject({ send_outcome_uncertain: true })
  })

  it('sends nothing for a category that does not email', async () => {
    attachmentClient({ category_name: 'Notes', email_on_upload: false })

    const result = await addEmployeeAttachment(null, uploadForm())

    expect(result).toMatchObject({ type: 'success', message: 'Attachment uploaded.', email: { status: 'not_required' } })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })
})
