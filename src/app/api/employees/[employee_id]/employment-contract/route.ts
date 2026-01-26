import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@/lib/supabase/server'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateEmploymentContractHTML } from '@/lib/employment-contract-template'
import { COMPANY_DETAILS } from '@/lib/company-details'

function sanitizeFilename(value: string, fallback: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  return trimmed
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 120) || fallback
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
    .select('employee_id, first_name, last_name, job_title, address, post_code, employment_start_date')
    .eq('employee_id', employeeId)
    .single()

  if (error || !employee) {
    return new NextResponse('Employee not found', { status: 404 })
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const logoUrl = `${appUrl}/logo-oj.jpg`
    const footerText = `${COMPANY_DETAILS.legalName} trading as ${COMPANY_DETAILS.tradingName} • ${COMPANY_DETAILS.fullAddress}`

    const html = generateEmploymentContractHTML({
      employee,
      logoUrl,
    })

    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '22mm',
        left: '15mm',
      },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width: 100%; font-size: 8px; color: #6b7280; text-align: center; padding: 0 15mm;">
          ${footerText}
        </div>
      `,
    })

    const safeName = sanitizeFilename(
      `employment-contract-${employee.last_name}-${employee.first_name}.pdf`,
      `employment-contract-${employee.employee_id}.pdf`
    )

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error generating employment contract PDF:', error)
    return new NextResponse('Failed to generate contract PDF', { status: 500 })
  }
}
