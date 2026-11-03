// The new starter pack's right to work and NI lines (FF-37).
//
// The pack printed "Verified" for any right to work record, including an expired document or an
// overdue repeat check, and printed a missing NI number the same way whether we hold none or the
// downloader may not see it.
import { describe, expect, it } from 'vitest'
import { generateEmployeeStarterHTML, type StarterPackTemplateData } from '@/lib/employee-starter-template'

const EM_DASH = String.fromCharCode(0x2014)

const employee: StarterPackTemplateData['employee'] = {
  employee_id: '00000000-0000-4000-8000-000000000001',
  first_name: 'Alex',
  last_name: 'Rowe',
  email_address: 'alex@example.com',
  job_title: 'Bar staff',
  status: 'Active',
  employment_start_date: '2026-01-05',
  first_shift_date: null,
  date_of_birth: '2000-01-01',
  address: null,
  post_code: null,
  phone_number: null,
  mobile_number: null,
}

function rightToWork(overrides: Partial<NonNullable<StarterPackTemplateData['rightToWork']>> = {}) {
  return {
    document_type: 'Passport',
    verification_date: '2026-01-02',
    document_expiry_date: null,
    document_reference: null,
    check_method: null,
    verified_by_name: null,
    follow_up_date: null,
    ...overrides,
  }
}

function html(overrides: Partial<StarterPackTemplateData>): string {
  return generateEmployeeStarterHTML({
    employee,
    niDetails: { ni_number: 'QQ123456C' },
    rightToWork: rightToWork(),
    generatedDate: '02 November 2026',
    todayIso: '2026-11-02',
    ...overrides,
  })
}

describe('generateEmployeeStarterHTML right to work status', () => {
  it('says the document has expired', () => {
    const page = html({ rightToWork: rightToWork({ document_expiry_date: '2026-10-31' }) })

    expect(page).toContain('Expired on 31 October 2026')
    expect(page).not.toContain('>Verified<')
  })

  it('says a repeat check is due once its date arrives', () => {
    const page = html({ rightToWork: rightToWork({ document_expiry_date: '2027-06-01', follow_up_date: '2026-11-02' }) })

    expect(page).toContain('Follow-up check due since 02 November 2026')
    expect(page).toContain('class="rtw-warning"')
  })

  it('says Verified for a current check', () => {
    const page = html({ rightToWork: rightToWork({ document_expiry_date: '2027-06-01', follow_up_date: '2026-12-01' }) })

    expect(page).toContain('>Verified<')
  })
})

describe('generateEmployeeStarterHTML NI number and blanks', () => {
  it('prints Withheld, not "Not recorded", when the downloader may not see the NI number', () => {
    const page = html({ niDetails: null, niWithheld: true })

    expect(page).toContain('Withheld')
    expect(page).not.toContain('QQ123456C')
  })

  it('prints Not recorded for an NI number we do not hold', () => {
    const page = html({ niDetails: null })

    expect(page).toContain('Not recorded')
  })

  it('contains no em dash', () => {
    expect(html({ niDetails: null, rightToWork: null })).not.toContain(EM_DASH)
  })
})
