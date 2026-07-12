import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateWorkerAgreementHTML } from '@/lib/worker-agreement-template'
import {
  assembleWorkerAgreementData,
  computeAgeAt,
  AGREEMENT_ISSUING_MANAGER,
} from '@/lib/worker-agreement'
import { getHourlyRate } from '@/lib/rota/pay-calculator'
import { CONTRACT_LOGO_DATA_URI } from '@/lib/private-bookings/contract-logo'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { normalizePersonName } from '@/lib/names'

function sanitizeFilename(value: string, fallback: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  return trimmed
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 120) || fallback
}

/** Resolve the NMW age-band label for the worker's age on the agreement date. */
async function resolveNmwBandLabel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dateOfBirth: string | null,
  agreementDate: string,
): Promise<string | null> {
  const age = computeAgeAt(dateOfBirth, agreementDate)
  if (age === null) return null

  const { data: bands } = await supabase
    .from('pay_age_bands')
    .select('label, min_age, max_age')
    .eq('is_active', true)

  const match = (bands ?? []).find(
    (band) => age >= band.min_age && (band.max_age === null || age <= band.max_age),
  )
  return match?.label ?? null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employee_id: string }> }
) {
  const { employee_id: employeeId } = await params

  if (!employeeId) {
    return new NextResponse('Employee ID required', { status: 400 })
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const hasPermission = await checkUserPermission('employees', 'view')
  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  const { data: employee, error } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name, job_title, address, post_code, date_of_birth, employment_start_date')
    .eq('employee_id', employeeId)
    .single()

  if (error || !employee) {
    return new NextResponse('Employee not found', { status: 404 })
  }

  try {
    // Normalise the worker's name capitalisation and persist it before producing
    // the contract, so the document (and the record) always reads correctly.
    const normalizedFirst = normalizePersonName(employee.first_name)
    const normalizedLast = normalizePersonName(employee.last_name)
    const firstChanged = normalizedFirst && normalizedFirst !== employee.first_name
    const lastChanged = normalizedLast && normalizedLast !== employee.last_name
    if (firstChanged || lastChanged) {
      try {
        const admin = createAdminClient()
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

    // Resolve pay rate and NMW band in parallel.
    const [rateResult, nmwBandLabel] = await Promise.all([
      getHourlyRate(employee.employee_id, agreementDate),
      resolveNmwBandLabel(supabase, employee.date_of_birth, agreementDate),
    ])

    const data = assembleWorkerAgreementData({
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

    const html = generateWorkerAgreementHTML(data)

    // The design owns the A4 page geometry (@page size:A4 margin:0 + mm-based
    // .sheet padding), so render at CSS page size with zero puppeteer margins
    // and no puppeteer header/footer (the template supplies its own running ones).
    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })

    const safeName = sanitizeFilename(
      `zero-hours-worker-agreement-${employee.last_name}-${employee.first_name}.pdf`,
      `zero-hours-worker-agreement-${employee.employee_id}.pdf`
    )

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error generating worker agreement PDF:', error)
    return new NextResponse('Failed to generate contract PDF', { status: 500 })
  }
}
