import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateInvoiceHTML } from '@/lib/invoice-template'
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
      vendor:vendors(*),
      line_items:invoice_line_items(*),
      payments:invoice_payments(*)
    `)
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .single()

  if (error || !invoice) {
    return new NextResponse('Invoice not found', { status: 404 })
  }

  // Generate HTML invoice
  const html = generateInvoiceHTML({
    invoice,
    logoUrl: '/logo-black.png'
  })
  
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

  // Return HTML with appropriate headers
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Disposition': `inline; filename="invoice-${invoice.invoice_number}.html"`,
    },
  })
}