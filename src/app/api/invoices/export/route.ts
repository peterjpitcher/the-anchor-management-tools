import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'

export const runtime = 'nodejs'
export const maxDuration = 300

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { closePdfBrowser, createPdfBrowser, generateInvoicePDF } from '@/lib/pdf-generator'
import { logAuditEvent } from '@/app/actions/audit'
import type { InvoiceWithDetails } from '@/types/invoices'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_EXPORT_WINDOW_DAYS = 366

function parseIsoDateUtcStart(value: string): Date | null {
  if (!ISO_DATE_RE.test(value)) return null
  const dt = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function safeMoney(value: unknown): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const startDate = searchParams.get('start_date')
  const endDate = searchParams.get('end_date')
  const exportType = searchParams.get('type') || 'all'
  
  if (!startDate || !endDate) {
    return new NextResponse('Start and end dates required', { status: 400 })
  }

  if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
    return new NextResponse('Dates must use YYYY-MM-DD format', { status: 400 })
  }

  if (!['all', 'paid', 'unpaid'].includes(exportType)) {
    return new NextResponse('Invalid export type', { status: 400 })
  }

  const startDateObj = parseIsoDateUtcStart(startDate)
  const endDateObj = parseIsoDateUtcStart(endDate)
  if (!startDateObj || !endDateObj) {
    return new NextResponse('Invalid date range', { status: 400 })
  }

  if (startDateObj > endDateObj) {
    return new NextResponse('start_date cannot be after end_date', { status: 400 })
  }

  const rangeDays = Math.floor((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24))
  if (rangeDays > MAX_EXPORT_WINDOW_DAYS) {
    return new NextResponse('Date range too large. Please export 12 months or less per request.', { status: 400 })
  }

  const supabase = await createClient()
  
  // Check authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Check permissions
  const hasPermission = await checkUserPermission('invoices', 'export')
  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  try {
    // Build query
    let query = supabase
      .from('invoices')
      .select(`
        *,
        vendor:invoice_vendors(*),
        line_items:invoice_line_items(*)
      `)
      .gte('invoice_date', startDate)
      .lte('invoice_date', endDate)
      .is('deleted_at', null)
      .order('invoice_date', { ascending: true })

    // Apply status filter
    if (exportType === 'paid') {
      query = query.eq('status', 'paid')
    } else if (exportType === 'unpaid') {
      query = query.in('status', ['draft', 'sent', 'partially_paid', 'overdue'])
    }

    const { data: invoices, error } = await query

    if (error) {
      console.error('Error fetching invoices:', error)
      return new NextResponse('Failed to fetch invoices', { status: 500 })
    }

    if (!invoices || invoices.length === 0) {
      return new NextResponse('No invoices found for the selected criteria', { status: 404 })
    }

    // Create ZIP file
    const zip = new JSZip()

    // Generate CSV summary
    const csvHeaders = [
      'Invoice Number',
      'Date',
      'Due Date',
      'Vendor',
      'Reference',
      'Status',
      'Subtotal',
      'Discount',
      'VAT',
      'Total',
      'Paid',
      'Outstanding'
    ]

    const csvRows = invoices.map(invoice => [
      invoice.invoice_number,
      invoice.invoice_date,
      invoice.due_date,
      invoice.vendor?.name || '',
      invoice.reference || '',
      invoice.status,
      safeMoney(invoice.subtotal_amount).toFixed(2),
      safeMoney(invoice.discount_amount).toFixed(2),
      safeMoney(invoice.vat_amount).toFixed(2),
      safeMoney(invoice.total_amount).toFixed(2),
      safeMoney(invoice.paid_amount).toFixed(2),
      Math.max(0, safeMoney(invoice.total_amount) - safeMoney(invoice.paid_amount)).toFixed(2)
    ])

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    zip.file('invoice-summary.csv', csvContent)

    const browser = await createPdfBrowser()

    try {
      // Generate PDFs for each invoice
      for (const invoice of invoices) {
        const typedInvoice = invoice as InvoiceWithDetails

        const pdfBuffer = await generateInvoicePDF(typedInvoice, { browser })

        zip.file(`invoices/${invoice.invoice_number}.pdf`, pdfBuffer)
      }
    } finally {
      await closePdfBrowser(browser)
    }

    // Add a README file
    const readme = `Invoice Export
Generated: ${new Date().toISOString()}
Period: ${startDate} to ${endDate}
Total Invoices: ${invoices.length}
Export Type: ${exportType}

Files included:
- invoice-summary.csv: Summary of all invoices
- invoices/: Individual invoice PDFs
`
    zip.file('README.txt', readme)

    // Generate ZIP file
    const zipContent = await zip.generateAsync({ type: 'arraybuffer' })

    // Best-effort logging: do not fail export delivery on telemetry issues.
    try {
      await logAuditEvent({
        user_id: user.id,
        operation_type: 'export',
        resource_type: 'invoices',
        operation_status: 'success',
        additional_info: {
          start_date: startDate,
          end_date: endDate,
          export_type: exportType,
          invoice_count: invoices.length,
        },
      })
    } catch (auditError) {
      console.error('[Invoice Export] Failed to write audit log:', auditError)
    }

    // Return ZIP file
    return new NextResponse(zipContent, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="invoices-${startDate}-to-${endDate}.zip"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return new NextResponse('Export failed', { status: 500 })
  }
}
