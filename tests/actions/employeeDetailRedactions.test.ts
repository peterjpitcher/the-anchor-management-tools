// What the employee record withholds from a viewer without employees edit (FF-13, FF-15).
//
// The right to work document number and its notes were shown to anyone who could view the
// record, though the NI number beside them was withheld. And a withheld section came through as
// null, which the tabs showed as "N/A" or a page of "No" answers, the same as a record that does
// not exist. The data now says which sections were withheld.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/services/employees', () => ({
  EmployeeService: { getEmployeeByIdWithDetails: vi.fn() },
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { EmployeeService } from '@/services/employees'
import { getEmployeeDetailData } from '@/app/actions/employeeDetails'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedDetails = EmployeeService.getEmployeeByIdWithDetails as unknown as Mock

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

function serviceData() {
  return {
    employee: { employee_id: EMPLOYEE_ID },
    financialDetails: { employee_id: EMPLOYEE_ID, ni_number: 'QQ123456C' },
    healthRecord: { employee_id: EMPLOYEE_ID, recent_treatment: 'Physiotherapy' },
    rightToWork: {
      employee_id: EMPLOYEE_ID,
      document_type: 'Passport',
      document_reference: '123456789',
      document_details: 'British passport',
      verification_date: '2026-01-02',
    },
    attachments: [],
    attachmentCategories: [],
    loadErrors: {
      financial: 'The financial details could not be loaded.',
      notes: 'The notes could not be loaded.',
    },
  }
}

function permissions(granted: string[]) {
  mockedPermission.mockImplementation(async (_module: string, action: string) => granted.includes(action))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedDetails.mockResolvedValue(serviceData())
})

describe('getEmployeeDetailData redactions', () => {
  it('withholds the right to work document number from a viewer, and says what was withheld', async () => {
    permissions(['view'])

    const result = await getEmployeeDetailData(EMPLOYEE_ID)
    if (!('data' in result) || !result.data) throw new Error('Expected employee data')

    expect(result.data.rightToWork).toEqual(expect.objectContaining({
      document_type: 'Passport',
      verification_date: '2026-01-02',
      document_reference: null,
      document_details: null,
    }))
    expect(result.data.financialDetails).toBeNull()
    expect(result.data.healthRecord).toBeNull()
    expect(result.data.redacted).toEqual({ financial: true, health: true, rightToWorkDocument: true })
    // A withheld section has no load error to report; the others keep theirs.
    expect(result.data.loadErrors).toEqual({ notes: 'The notes could not be loaded.' })
  })

  it('shows everything to an editor', async () => {
    permissions(['view', 'edit'])

    const result = await getEmployeeDetailData(EMPLOYEE_ID)
    if (!('data' in result) || !result.data) throw new Error('Expected employee data')

    expect(result.data.rightToWork).toEqual(expect.objectContaining({ document_reference: '123456789' }))
    expect(result.data.financialDetails).toEqual(expect.objectContaining({ ni_number: 'QQ123456C' }))
    expect(result.data.redacted).toEqual({ financial: false, health: false, rightToWorkDocument: false })
    expect(result.data.loadErrors).toEqual({
      notes: 'The notes could not be loaded.',
      financial: 'The financial details could not be loaded.',
    })
  })
})
