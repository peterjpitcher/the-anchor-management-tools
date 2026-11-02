// Who may download an employee's starter pack or worker agreement, and that it is recorded
// (FF-37, FF-39/40 button half).
//
// Both documents print the home address and date of birth (the pack adds the NI number and the
// right to work reference, the agreement the hourly rate), which the record only shows to
// employees edit. Either could be downloaded with employees view alone, and neither download
// was audited.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML: vi.fn() }))
vi.mock('@/lib/pdf/document-logo', () => ({ getDocumentLogoDataUri: () => 'data:image/png;base64,' }))
vi.mock('@/lib/signing/documents/worker-agreement', () => ({ buildWorkerAgreementDocument: vi.fn() }))

import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { buildWorkerAgreementDocument } from '@/lib/signing/documents/worker-agreement'
import { GET as getStarterPack } from '@/app/api/employees/[employee_id]/starter-pack/route'
import { GET as getEmploymentContract } from '@/app/api/employees/[employee_id]/employment-contract/route'

const mockedCreateClient = createClient as unknown as Mock
const mockedPermission = checkUserPermission as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedBuildAgreement = buildWorkerAgreementDocument as unknown as Mock
const mockedGeneratePdf = generatePDFFromHTML as unknown as Mock

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'
const params = { params: Promise.resolve({ employee_id: EMPLOYEE_ID }) }
const request = new Request('http://localhost/api/employees') as unknown as NextRequest

function permissions(granted: string[]) {
  mockedPermission.mockImplementation(async (_module: string, action: string) => granted.includes(action))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } }) },
    from: vi.fn(() => {
      throw new Error('No employee data should be read without permission')
    }),
  })
})

describe('starter pack download', () => {
  /** The session client the route reads with, one result per table. */
  function sessionReads(reads: { financial?: { data: unknown; error: unknown }; rightToWork?: { data: unknown; error: unknown } }) {
    const result = (value: { data: unknown; error: unknown } | undefined) => value ?? { data: null, error: null }
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'manager@example.com' } } }) },
      from: vi.fn((table: string) => {
        if (table === 'employees') {
          return {
            select: () => ({
              eq: () => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    employee_id: EMPLOYEE_ID, first_name: 'Alex', last_name: 'Rowe', email_address: 'alex@example.com',
                    job_title: 'Bar Staff', status: 'Active', employment_start_date: '2026-10-01', first_shift_date: null,
                    date_of_birth: '1990-05-01', address: '1 High Street', post_code: 'TW19 6AQ',
                    phone_number: null, mobile_number: '+447700900123',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        const value = table === 'employee_financial_details' ? reads.financial : reads.rightToWork
        return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue(result(value)) }) }) }
      }),
    })
  }

  it('is refused with employees view alone', async () => {
    permissions(['view', 'view_documents'])

    const response = await getStarterPack(request, params)

    expect(response.status).toBe(403)
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('is recorded on the employee when it is downloaded', async () => {
    permissions(['view', 'view_documents', 'edit'])
    sessionReads({ financial: { data: { ni_number: 'QQ123456C' }, error: null } })
    mockedGeneratePdf.mockResolvedValue(Buffer.from('%PDF-1.4'))

    const response = await getStarterPack(request, params)

    expect(response.status).toBe(200)
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      operation_type: 'download',
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      additional_info: expect.objectContaining({ action: 'download_starter_pack', includes_right_to_work_scan: false }),
    }))
  })

  it('is refused, not printed with blanks, when the NI number or right to work read fails', async () => {
    permissions(['view', 'view_documents', 'edit'])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sessionReads({ rightToWork: { data: null, error: { message: 'timeout' } } })

    const response = await getStarterPack(request, params)

    expect(response.status).toBe(500)
    expect(mockedGeneratePdf).not.toHaveBeenCalled()
    expect(mockedAudit).not.toHaveBeenCalled()
  })
})

describe('worker agreement download', () => {
  it('is refused with employees view alone', async () => {
    permissions(['view'])

    const response = await getEmploymentContract(request, params)

    expect(response.status).toBe(403)
    expect(mockedBuildAgreement).not.toHaveBeenCalled()
  })

  it('is recorded on the employee when it is downloaded', async () => {
    permissions(['view', 'edit'])
    mockedBuildAgreement.mockResolvedValue({
      employee: { employee_id: EMPLOYEE_ID, first_name: 'Alex', last_name: 'Rowe' },
      pdf: Buffer.from('%PDF-1.4'),
    })

    const response = await getEmploymentContract(request, params)

    expect(response.status).toBe(200)
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'download',
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      additional_info: expect.objectContaining({ action: 'download_worker_agreement' }),
    }))
  })
})
