import { getTodayIsoDate } from '@/lib/dateUtils'
import { normalizePersonName } from '@/lib/names'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { CONTRACT_LOGO_DATA_URI } from '@/lib/private-bookings/contract-logo'
import { getHourlyRate } from '@/lib/rota/pay-calculator'
import { createAdminClient } from '@/lib/supabase/admin'
import { AGREEMENT_ISSUING_MANAGER, assembleWorkerAgreementData, computeAgeAt } from '@/lib/worker-agreement'
import { generateWorkerAgreementHTML } from '@/lib/worker-agreement-template'

/**
 * The zero-hours casual worker agreement as a PDF, for download and for signing. One builder for
 * both, so the document someone signs is the document staff can download.
 *
 * The caller has already checked who is asking; this reads with the service role.
 */

export interface WorkerAgreementEmployee {
  employee_id: string
  first_name: string | null
  last_name: string | null
  email_address: string | null
  job_title: string | null
  address: string | null
  post_code: string | null
  date_of_birth: string | null
  employment_start_date: string | null
  auth_user_id: string | null
}

export interface WorkerAgreementDocument {
  pdf: Buffer
  employee: WorkerAgreementEmployee
  /** Age on the agreement date, or null when we hold no date of birth. */
  age: number | null
  agreementDate: string
  /**
   * Details the agreement prints as blank lines "for completion by hand" when we do not hold
   * them. Fine on paper; not fine for a document signed online, so sending is refused until
   * these are filled in on the employee record.
   */
  missing: string[]
}

async function resolveNmwBandLabel(
  admin: ReturnType<typeof createAdminClient>,
  dateOfBirth: string | null,
  agreementDate: string
): Promise<string | null> {
  const age = computeAgeAt(dateOfBirth, agreementDate)
  if (age === null) return null
  const { data: bands } = await admin.from('pay_age_bands').select('label, min_age, max_age').eq('is_active', true)
  const match = (bands ?? []).find(
    (band: { min_age: number; max_age: number | null }) => age >= band.min_age && (band.max_age === null || age <= band.max_age)
  ) as { label: string } | undefined
  return match?.label ?? null
}

export async function buildWorkerAgreementDocument(employeeId: string): Promise<WorkerAgreementDocument | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, email_address, job_title, address, post_code, date_of_birth, employment_start_date, auth_user_id')
    .eq('employee_id', employeeId)
    .maybeSingle()
  if (error) throw new Error(`Could not read the employee: ${error.message}`)
  if (!data) return null
  const employee = data as WorkerAgreementEmployee

  // Normalise the worker's name capitalisation and persist it before producing the agreement,
  // so the document (and the record) always reads correctly.
  const normalizedFirst = normalizePersonName(employee.first_name)
  const normalizedLast = normalizePersonName(employee.last_name)
  const firstChanged = Boolean(normalizedFirst) && normalizedFirst !== employee.first_name
  const lastChanged = Boolean(normalizedLast) && normalizedLast !== employee.last_name
  if (firstChanged || lastChanged) {
    try {
      await admin
        .from('employees')
        .update({
          first_name: firstChanged ? normalizedFirst : employee.first_name,
          last_name: lastChanged ? normalizedLast : employee.last_name,
        })
        .eq('employee_id', employee.employee_id)
      if (firstChanged) employee.first_name = normalizedFirst
      if (lastChanged) employee.last_name = normalizedLast
    } catch (persistError) {
      console.error('Failed to persist normalised employee name before contract:', persistError)
    }
  }

  const agreementDate = getTodayIsoDate()
  const [rateResult, nmwBandLabel] = await Promise.all([
    getHourlyRate(employee.employee_id, agreementDate),
    resolveNmwBandLabel(admin, employee.date_of_birth, agreementDate),
  ])

  const missing: string[] = []
  if (!employee.first_name?.trim() || !employee.last_name?.trim()) missing.push('full name')
  if (!employee.address?.trim() || !employee.post_code?.trim()) missing.push('home address and post code')
  if (!employee.date_of_birth) missing.push('date of birth')
  if (!employee.job_title?.trim()) missing.push('job title')
  if (!employee.employment_start_date) missing.push('start date')
  if (rateResult?.rate === null || rateResult?.rate === undefined) missing.push('hourly rate (set it on the Pay tab)')

  const html = generateWorkerAgreementHTML(
    assembleWorkerAgreementData({
      firstName: employee.first_name,
      lastName: employee.last_name,
      address: employee.address,
      postCode: employee.post_code,
      dateOfBirth: employee.date_of_birth,
      jobTitle: employee.job_title,
      employmentStartDate: employee.employment_start_date,
      agreementDate,
      hourlyRate: rateResult?.rate ?? null,
      nmwBandLabel,
      managerName: AGREEMENT_ISSUING_MANAGER.name,
      managerEmail: AGREEMENT_ISSUING_MANAGER.email,
      logoUrl: CONTRACT_LOGO_DATA_URI,
    })
  )

  // The design owns the A4 page geometry (@page size:A4 margin:0 + mm-based .sheet padding), so
  // render at CSS page size with zero puppeteer margins and no puppeteer header/footer (the
  // template supplies its own running ones).
  const pdf = await generatePDFFromHTML(html, {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  })

  return {
    pdf,
    employee,
    age: computeAgeAt(employee.date_of_birth, agreementDate),
    agreementDate,
    missing,
  }
}
