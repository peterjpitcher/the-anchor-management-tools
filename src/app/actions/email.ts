'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { sendInvoiceEmail, sendQuoteEmail, testEmailConnection, isGraphConfigured } from '@/lib/microsoft-graph'
import { getInvoice } from './invoices'
import { getQuote } from './quotes'
import { z } from 'zod'

// Email validation schema
const SendInvoiceEmailSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID'),
  recipientEmail: z.string().email('Invalid email address'),
  subject: z.string().optional(),
  body: z.string().optional()
})

const SendQuoteEmailSchema = z.object({
  quoteId: z.string().uuid('Invalid quote ID'),
  recipientEmail: z.string().email('Invalid email address'),
  subject: z.string().optional(),
  body: z.string().optional()
})

// Send invoice via email
export async function sendInvoiceViaEmail(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to send invoices' }
    }

    // Check if email is configured
    if (!isGraphConfigured()) {
      return { error: 'Email service is not configured. Please contact your administrator.' }
    }

    // Validate input
    const validatedData = SendInvoiceEmailSchema.parse({
      invoiceId: formData.get('invoiceId'),
      recipientEmail: formData.get('recipientEmail'),
      subject: formData.get('subject') || undefined,
      body: formData.get('body') || undefined
    })

    // Get invoice details
    const invoiceResult = await getInvoice(validatedData.invoiceId)
    if (invoiceResult.error || !invoiceResult.invoice) {
      return { error: 'Invoice not found' }
    }

    const invoice = invoiceResult.invoice

    // Send email
    const result = await sendInvoiceEmail(
      invoice,
      validatedData.recipientEmail,
      validatedData.subject,
      validatedData.body
    )

    if (!result.success) {
      return { error: result.error || 'Failed to send email' }
    }

    // Log email sent
    const { error: logError } = await supabase
      .from('invoice_email_logs')
      .insert({
        invoice_id: validatedData.invoiceId,
        sent_to: validatedData.recipientEmail,
        sent_by: (await supabase.auth.getUser()).data.user?.id,
        subject: validatedData.subject || `Invoice ${invoice.invoice_number} from Orange Jelly Limited`,
        body: validatedData.body || 'Default invoice email template used',
        status: 'sent' as const
      })

    if (logError) {
      console.error('Error logging email:', logError)
    }

    // Update invoice status if it was draft
    if (invoice.status === 'draft') {
      const { error: updateError } = await supabase
        .from('invoices')
        .update({ 
          status: 'sent' as const,
          updated_at: new Date().toISOString()
        })
        .eq('id', validatedData.invoiceId)

      if (updateError) {
        console.error('Error updating invoice status:', updateError)
      }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: validatedData.invoiceId,
      operation_status: 'success',
      additional_info: { 
        action: 'email_sent',
        recipient: validatedData.recipientEmail,
        invoice_number: invoice.invoice_number
      }
    })

    return { success: true, messageId: result.messageId }
  } catch (error) {
    console.error('Error in sendInvoiceViaEmail:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

// Send quote via email
export async function sendQuoteViaEmail(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to send quotes' }
    }

    // Check if email is configured
    if (!isGraphConfigured()) {
      return { error: 'Email service is not configured. Please contact your administrator.' }
    }

    // Validate input
    const validatedData = SendQuoteEmailSchema.parse({
      quoteId: formData.get('quoteId'),
      recipientEmail: formData.get('recipientEmail'),
      subject: formData.get('subject') || undefined,
      body: formData.get('body') || undefined
    })

    // Get quote details
    const quoteResult = await getQuote(validatedData.quoteId)
    if (quoteResult.error || !quoteResult.quote) {
      return { error: 'Quote not found' }
    }

    const quote = quoteResult.quote

    // Send email
    const result = await sendQuoteEmail(
      quote,
      validatedData.recipientEmail,
      validatedData.subject,
      validatedData.body
    )

    if (!result.success) {
      return { error: result.error || 'Failed to send email' }
    }

    // Log email sent (using invoice_email_logs table for quotes too)
    const { error: logError } = await supabase
      .from('invoice_email_logs')
      .insert({
        invoice_id: validatedData.quoteId, // We can use this for quotes too
        sent_to: validatedData.recipientEmail,
        sent_by: (await supabase.auth.getUser()).data.user?.id,
        subject: validatedData.subject || `Quote ${quote.quote_number} from Orange Jelly Limited`,
        body: validatedData.body || 'Default quote email template used',
        status: 'sent' as const
      })

    if (logError) {
      console.error('Error logging email:', logError)
    }

    // Update quote status if it was draft
    if (quote.status === 'draft') {
      const { error: updateError } = await supabase
        .from('quotes')
        .update({ 
          status: 'sent' as const,
          updated_at: new Date().toISOString()
        })
        .eq('id', validatedData.quoteId)

      if (updateError) {
        console.error('Error updating quote status:', updateError)
      }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'quote',
      resource_id: validatedData.quoteId,
      operation_status: 'success',
      additional_info: { 
        action: 'email_sent',
        recipient: validatedData.recipientEmail,
        quote_number: quote.quote_number
      }
    })

    return { success: true, messageId: result.messageId }
  } catch (error) {
    console.error('Error in sendQuoteViaEmail:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

// Test email configuration
export async function testEmailConfiguration() {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'manage')
    if (!hasPermission) {
      return { error: 'You do not have permission to test email configuration' }
    }

    const result = await testEmailConnection()
    
    return result
  } catch (error) {
    console.error('Error testing email configuration:', error)
    return { 
      success: false, 
      message: 'Failed to test email configuration',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}

// Get email configuration status
export async function getEmailConfigStatus() {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view email configuration' }
    }

    return {
      configured: isGraphConfigured(),
      senderEmail: process.env.MICROSOFT_USER_EMAIL || 'Not configured'
    }
  } catch (error) {
    console.error('Error getting email config status:', error)
    return { error: 'Failed to get email configuration status' }
  }
}