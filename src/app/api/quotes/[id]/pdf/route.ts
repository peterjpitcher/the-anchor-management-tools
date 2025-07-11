import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateQuoteHTML } from '@/lib/quote-template'
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
      vendor:vendors(*),
      line_items:quote_line_items(*)
    `)
    .eq('id', quoteId)
    .single()

  if (error || !quote) {
    return new NextResponse('Quote not found', { status: 404 })
  }

  // Generate HTML quote
  const html = generateQuoteHTML({
    quote,
    logoUrl: '/logo-black.png'
  })
  
  // Log quote generation
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

  // Return HTML with appropriate headers
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Disposition': `inline; filename="quote-${quote.quote_number}.html"`,
    },
  })
}