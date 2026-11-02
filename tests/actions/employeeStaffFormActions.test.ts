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
      addEmployeeAttachment: vi.fn(),
      addEmployeeNote: vi.fn(),
      createEmployee: vi.fn(),
      deleteEmergencyContact: vi.fn(),
      deleteEmployee: vi.fn(),
      deleteRightToWorkPhoto: vi.fn(),
      getRightToWorkPhotoUrl: vi.fn(),
      updateEmployee: vi.fn(),
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
import { EmployeeService, EmployeeServiceError } from '@/services/employees'
import {
  addEmployee,
  addEmployeeAttachment,
  addEmployeeNote,
  createRightToWorkDocumentUploadUrl,
  deleteEmergencyContact,
  deleteEmployee,
  deleteRightToWorkPhoto,
  getRightToWorkPhotoUrl,
  updateEmployee,
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

  it('sends nothing for a category that does not email', async () => {
    attachmentClient({ category_name: 'Notes', email_on_upload: false })

    const result = await addEmployeeAttachment(null, uploadForm())

    expect(result).toMatchObject({ type: 'success', message: 'Attachment uploaded.', email: { status: 'not_required' } })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })
})
