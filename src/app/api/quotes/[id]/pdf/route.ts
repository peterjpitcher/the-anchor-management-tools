import { NextRequest, NextResponse } from 'next/server'

// Ensure Node.js runtime for Puppeteer usage
export const runtime = 'nodejs'
export const maxDuration = 60
import { createClient } from '@/lib/supabase/server'
import { generateQuotePDF } from '@/lib/pdf-generator'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: quoteId } = await params
  
  if (!quoteId) {
    return new NextResponse('Quote ID required', { status: 400 })
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

  // Fetch quote with all details
  const { data: quote, error } = await supabase
    .from('quotes')
    .select(`
      *,
      vendor:invoice_vendors(*),
      line_items:quote_line_items(*)
    `)
    .eq('id', quoteId)
    .single()

  if (error || !quote) {
    return new NextResponse('Quote not found', { status: 404 })
  }

  const quoteRecord = quote as Record<string, unknown>
  if ('deleted_at' in quoteRecord && quoteRecord.deleted_at) {
    return new NextResponse('Quote not found', { status: 404 })
  }

  try {
    // Generate PDF
    const pdfBuffer = await generateQuotePDF(quote)
    
    // Best-effort logging: do not fail PDF generation on telemetry issues.
    try {
      await logAuditEvent({
        operation_type: 'read',
        resource_type: 'quote',
        resource_id: quoteId,
        operation_status: 'success',
        additional_info: { 
          action: 'pdf_generated',
          quote_number: quote.quote_number,
          ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
        }
      })
    } catch (auditError) {
      console.error('[Quotes PDF] Failed to write audit log:', auditError)
    }

    // Return PDF with appropriate headers
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="quote-${quote.quote_number}.pdf"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error generating quote PDF:', error)
    return new NextResponse('Failed to generate PDF', { status: 500 })
  }
}
