import { NextRequest, NextResponse } from 'next/server'

// Ensure Node.js runtime for Puppeteer usage
export const runtime = 'nodejs'
export const maxDuration = 60
import { createClient } from '@/lib/supabase/server'
import { generateInvoicePDF } from '@/lib/pdf-generator'
import { checkUserPermission } from '@/app/actions/rbac'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params
  
  if (!invoiceId) {
    return new NextResponse('Invoice ID required', { status: 400 })
  }

  const supabase = await createClient()
  
  // Check authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Check permissions
  const hasPermission = await checkUserPermission('invoices', 'view')
  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  // Fetch invoice with all details
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`
      *,
      vendor:invoice_vendors(*),
      line_items:invoice_line_items(*),
      payments:invoice_payments(*)
    `)
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (error || !invoice) {
    return new NextResponse('Invoice not found', { status: 404 })
  }

  try {
    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(invoice)
    
    // Log invoice generation
    await supabase.from('invoice_audit_logs').insert({
      invoice_id: invoiceId,
      action: 'pdf_generated',
      performed_by: user.id,
      performed_at: new Date().toISOString(),
      details: { 
        invoice_number: invoice.invoice_number,
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
      }
    })

    // Return PDF with appropriate headers
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${invoice.invoice_number}.pdf"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error generating invoice PDF:', error)
    return new NextResponse('Failed to generate PDF', { status: 500 })
  }
}
