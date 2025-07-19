import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateInvoiceHTML } from '@/lib/invoice-template'
import JSZip from 'jszip'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const startDate = searchParams.get('start_date')
  const endDate = searchParams.get('end_date')
  const exportType = searchParams.get('type') || 'all'
  
  if (!startDate || !endDate) {
    return new NextResponse('Start and end dates required', { status: 400 })
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
      invoice.subtotal_amount.toFixed(2),
      invoice.discount_amount.toFixed(2),
      invoice.vat_amount.toFixed(2),
      invoice.total_amount.toFixed(2),
      invoice.paid_amount.toFixed(2),
      (invoice.total_amount - invoice.paid_amount).toFixed(2)
    ])

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    zip.file('invoice-summary.csv', csvContent)

    // Generate PDFs for each invoice
    for (const invoice of invoices) {
      const html = generateInvoiceHTML({
        invoice,
        logoUrl: '/logo-black.png'
      })

      // Add HTML file to ZIP (would need server-side PDF generation for true PDFs)
      zip.file(
        `invoices/${invoice.invoice_number}.html`,
        html
      )
    }

    // Add a README file
    const readme = `Invoice Export
Generated: ${new Date().toISOString()}
Period: ${startDate} to ${endDate}
Total Invoices: ${invoices.length}
Export Type: ${exportType}

Files included:
- invoice-summary.csv: Summary of all invoices
- invoices/: Individual invoice files

Note: Open HTML files in a browser and use Print > Save as PDF for PDF versions.
`
    zip.file('README.txt', readme)

    // Generate ZIP file
    const zipContent = await zip.generateAsync({ type: 'arraybuffer' })

    // Log export
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      operation_type: 'export',
      resource_type: 'invoices',
      operation_status: 'success',
      additional_info: {
        start_date: startDate,
        end_date: endDate,
        export_type: exportType,
        invoice_count: invoices.length,
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
      }
    })

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