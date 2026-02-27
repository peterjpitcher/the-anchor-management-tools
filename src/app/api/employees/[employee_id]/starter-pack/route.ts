import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateEmployeeStarterHTML } from '@/lib/employee-starter-template'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { formatDateDdMmmmYyyy, getTodayIsoDate } from '@/lib/dateUtils'

function sanitizeFilename(value: string, fallback: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  return trimmed
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 120) || fallback
}

function mimeTypeFromPath(storagePath: string): string {
  const ext = storagePath.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  return 'application/octet-stream'
}

async function fetchRtwDocument(storagePath: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const adminClient = createAdminClient()
    const { data, error } = await adminClient.storage
      .from('employee-attachments')
      .download(storagePath)

    if (error || !data) {
      console.error('[starter-pack] RTW document download failed:', error)
      return null
    }

    const arrayBuffer = await data.arrayBuffer()
    return {
      bytes: Buffer.from(arrayBuffer),
      mimeType: mimeTypeFromPath(storagePath),
    }
  } catch (err) {
    console.error('[starter-pack] RTW document fetch error:', err)
    return null
  }
}

async function mergePdfs(mainPdf: Buffer, appendPdf: Buffer): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib')
  const mainDoc = await PDFDocument.load(mainPdf)
  const appendDoc = await PDFDocument.load(appendPdf)
  const copiedPages = await mainDoc.copyPages(appendDoc, appendDoc.getPageIndices())
  for (const page of copiedPages) {
    mainDoc.addPage(page)
  }
  const merged = await mainDoc.save()
  return Buffer.from(merged)
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

  const [hasViewPermission, hasDocPermission] = await Promise.all([
    checkUserPermission('employees', 'view'),
    checkUserPermission('employees', 'view_documents'),
  ])

  if (!hasViewPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  // Fetch core employee record
  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select(
      'employee_id, first_name, last_name, email_address, job_title, status, employment_start_date, first_shift_date, date_of_birth, address, post_code, phone_number, mobile_number'
    )
    .eq('employee_id', employeeId)
    .single()

  if (empError || !employee) {
    return new NextResponse('Employee not found', { status: 404 })
  }

  // Fetch related data in parallel
  const [
    { data: financialDetails },
    { data: rightToWorkRaw },
  ] = await Promise.all([
    supabase
      .from('employee_financial_details')
      .select('ni_number')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    supabase
      .from('employee_right_to_work')
      .select('document_type, verification_date, document_expiry_date, document_reference, check_method, verified_by_user_id, photo_storage_path')
      .eq('employee_id', employeeId)
      .maybeSingle(),
  ])

  // Resolve verified_by user name if present
  let verifiedByName: string | null = null
  if (rightToWorkRaw?.verified_by_user_id) {
    const { data: verifierProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', rightToWorkRaw.verified_by_user_id)
      .maybeSingle()
    verifiedByName = verifierProfile?.full_name ?? null
  }

  // Fetch the RTW document from storage if available and user has doc permission
  let rtwImageDataUrl: string | undefined
  let rtwPdfBytes: Buffer | undefined

  if (hasDocPermission && rightToWorkRaw?.photo_storage_path) {
    const doc = await fetchRtwDocument(rightToWorkRaw.photo_storage_path)
    if (doc) {
      if (doc.mimeType === 'application/pdf') {
        rtwPdfBytes = doc.bytes
      } else if (doc.mimeType === 'image/jpeg' || doc.mimeType === 'image/png') {
        rtwImageDataUrl = `data:${doc.mimeType};base64,${doc.bytes.toString('base64')}`
      }
    }
  }

  const rightToWork = rightToWorkRaw
    ? {
        document_type: rightToWorkRaw.document_type,
        verification_date: rightToWorkRaw.verification_date,
        document_expiry_date: rightToWorkRaw.document_expiry_date,
        document_reference: rightToWorkRaw.document_reference,
        check_method: rightToWorkRaw.check_method,
        verified_by_name: verifiedByName,
      }
    : null

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const logoUrl = `${appUrl}/logo-oj.jpg`
    const footerText = `${COMPANY_DETAILS.legalName} trading as ${COMPANY_DETAILS.tradingName} • ${COMPANY_DETAILS.fullAddress}`

    const html = generateEmployeeStarterHTML({
      employee,
      niDetails: financialDetails ?? null,
      rightToWork,
      rtwImageDataUrl,
      logoUrl,
      generatedDate: formatDateDdMmmmYyyy(getTodayIsoDate()),
    })

    let pdfBuffer = await generatePDFFromHTML(html, {
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

    // Append RTW PDF pages if the stored document is a PDF
    if (rtwPdfBytes) {
      pdfBuffer = await mergePdfs(pdfBuffer, rtwPdfBytes)
    }

    const safeName = sanitizeFilename(
      `new-starter-${employee.last_name}-${employee.first_name}.pdf`,
      `new-starter-${employee.employee_id}.pdf`
    )

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error generating starter pack PDF:', error)
    return new NextResponse('Failed to generate starter pack PDF', { status: 500 })
  }
}
