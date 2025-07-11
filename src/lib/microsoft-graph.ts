import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'
import { generateInvoiceHTML } from '@/lib/invoice-template'
import { generateQuoteHTML } from '@/lib/quote-template'
import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'

// Initialize Microsoft Graph client
function getGraphClient() {
  // Check if Graph is configured
  if (!isGraphConfigured()) {
    throw new Error('Microsoft Graph is not configured. Please check environment variables.')
  }

  // Create credential using client secret
  const credential = new ClientSecretCredential(
    process.env.MICROSOFT_TENANT_ID!,
    process.env.MICROSOFT_CLIENT_ID!,
    process.env.MICROSOFT_CLIENT_SECRET!
  )

  // Create Graph client
  const client = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default')
        return token?.token || ''
      }
    }
  })

  return client
}

// Check if Microsoft Graph is configured
export function isGraphConfigured(): boolean {
  return !!(
    process.env.MICROSOFT_TENANT_ID &&
    process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_SECRET &&
    process.env.MICROSOFT_USER_EMAIL
  )
}

// Convert Buffer to base64 for email attachment
function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64')
}

// Send invoice email
export async function sendInvoiceEmail(
  invoice: InvoiceWithDetails,
  recipientEmail: string,
  subject?: string,
  body?: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    if (!isGraphConfigured()) {
      return {
        success: false,
        error: 'Email service is not configured'
      }
    }

    const client = getGraphClient()
    const senderEmail = process.env.MICROSOFT_USER_EMAIL!

    // Generate invoice PDF with 'sent' status if currently draft
    const invoiceForPDF = invoice.status === 'draft' 
      ? { ...invoice, status: 'sent' as const }
      : invoice
    const pdfBuffer = await generateInvoicePDF(invoiceForPDF)

    // Default subject and body
    const emailSubject = subject || `Invoice ${invoice.invoice_number} from Orange Jelly Limited`
    const emailBody = body || `Hi ${invoice.vendor?.contact_name || invoice.vendor?.name || 'there'},

I hope you're doing well!

Please find attached invoice ${invoice.invoice_number} with the following details:

Amount Due: £${invoice.total_amount.toFixed(2)}
Due Date: ${new Date(invoice.due_date).toLocaleDateString('en-GB')}

${invoice.notes ? `${invoice.notes}\n\n` : ''}If you have any questions or need anything at all, just let me know - I'm always happy to help!

Many thanks,
Peter Pitcher
Orange Jelly Limited
07995087315

P.S. The invoice is attached as a PDF for easy viewing and printing.`

    // Create email message
    const message = {
      subject: emailSubject,
      body: {
        contentType: 'Text',
        content: emailBody
      },
      toRecipients: [
        {
          emailAddress: {
            address: recipientEmail
          }
        }
      ],
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: `invoice-${invoice.invoice_number}.pdf`,
          contentType: 'application/pdf',
          contentBytes: bufferToBase64(pdfBuffer)
        }
      ]
    }

    // Send email
    const response = await client
      .api(`/users/${senderEmail}/sendMail`)
      .post({
        message,
        saveToSentItems: true
      })

    return {
      success: true,
      messageId: response?.id
    }
  } catch (error: any) {
    console.error('Error sending invoice email:', error)
    return {
      success: false,
      error: error.message || 'Failed to send email'
    }
  }
}

// Send quote email
export async function sendQuoteEmail(
  quote: QuoteWithDetails,
  recipientEmail: string,
  subject?: string,
  body?: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    if (!isGraphConfigured()) {
      return {
        success: false,
        error: 'Email service is not configured'
      }
    }

    const client = getGraphClient()
    const senderEmail = process.env.MICROSOFT_USER_EMAIL!

    // Generate quote PDF
    const pdfBuffer = await generateQuotePDF(quote)

    // Default subject and body
    const emailSubject = subject || `Quote ${quote.quote_number} from Orange Jelly Limited`
    const emailBody = body || `Hi ${quote.vendor?.contact_name || quote.vendor?.name || 'there'},

Thanks for getting in touch!

I've attached quote ${quote.quote_number} for your review:

Total Amount: £${quote.total_amount.toFixed(2)}
Quote Valid Until: ${new Date(quote.valid_until).toLocaleDateString('en-GB')}

${quote.notes ? `${quote.notes}\n\n` : ''}Please take your time to review everything, and don't hesitate to reach out if you have any questions or would like to discuss anything.

Looking forward to hearing from you!

Best wishes,
Peter Pitcher
Orange Jelly Limited
07995087315

P.S. The quote is attached as a PDF for your convenience.`

    // Create email message
    const message = {
      subject: emailSubject,
      body: {
        contentType: 'Text',
        content: emailBody
      },
      toRecipients: [
        {
          emailAddress: {
            address: recipientEmail
          }
        }
      ],
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: `quote-${quote.quote_number}.pdf`,
          contentType: 'application/pdf',
          contentBytes: bufferToBase64(pdfBuffer)
        }
      ]
    }

    // Send email
    const response = await client
      .api(`/users/${senderEmail}/sendMail`)
      .post({
        message,
        saveToSentItems: true
      })

    return {
      success: true,
      messageId: response?.id
    }
  } catch (error: any) {
    console.error('Error sending quote email:', error)
    return {
      success: false,
      error: error.message || 'Failed to send email'
    }
  }
}

// Send internal reminder email
export async function sendInternalReminder(
  subject: string,
  body: string,
  attachmentHtml?: string,
  attachmentName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isGraphConfigured()) {
      return {
        success: false,
        error: 'Email service is not configured'
      }
    }

    const client = getGraphClient()
    const senderEmail = process.env.MICROSOFT_USER_EMAIL!

    // Create email message
    const message: any = {
      subject: `[REMINDER] ${subject}`,
      body: {
        contentType: 'Text',
        content: body
      },
      toRecipients: [
        {
          emailAddress: {
            address: senderEmail // Send to self
          }
        }
      ]
    }

    // Add attachment if provided
    if (attachmentHtml && attachmentName) {
      message.attachments = [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachmentName,
          contentType: 'text/html',
          contentBytes: bufferToBase64(Buffer.from(attachmentHtml))
        }
      ]
    }

    // Send email
    await client
      .api(`/users/${senderEmail}/sendMail`)
      .post({
        message,
        saveToSentItems: true
      })

    return { success: true }
  } catch (error: any) {
    console.error('Error sending internal reminder:', error)
    return {
      success: false,
      error: error.message || 'Failed to send reminder'
    }
  }
}

// Test email connection
export async function testEmailConnection(): Promise<{
  success: boolean
  message: string
  details?: any
}> {
  try {
    if (!isGraphConfigured()) {
      return {
        success: false,
        message: 'Microsoft Graph is not configured',
        details: {
          hasTenantId: !!process.env.MICROSOFT_TENANT_ID,
          hasClientId: !!process.env.MICROSOFT_CLIENT_ID,
          hasClientSecret: !!process.env.MICROSOFT_CLIENT_SECRET,
          hasUserEmail: !!process.env.MICROSOFT_USER_EMAIL
        }
      }
    }

    const client = getGraphClient()
    const userEmail = process.env.MICROSOFT_USER_EMAIL!

    // Try to get user profile to verify connection
    const user = await client
      .api(`/users/${userEmail}`)
      .select('displayName,mail,id')
      .get()

    return {
      success: true,
      message: 'Email connection successful',
      details: {
        displayName: user.displayName,
        email: user.mail || user.userPrincipalName,
        userId: user.id
      }
    }
  } catch (error: any) {
    console.error('Email connection test failed:', error)
    
    let errorMessage = 'Failed to connect to Microsoft Graph'
    let details = { error: error.message }

    if (error.statusCode === 401) {
      errorMessage = 'Authentication failed. Check your client credentials.'
    } else if (error.statusCode === 403) {
      errorMessage = 'Permission denied. Ensure the app has Mail.Send permission.'
    } else if (error.statusCode === 404) {
      errorMessage = 'User not found. Check MICROSOFT_USER_EMAIL.'
    }

    return {
      success: false,
      message: errorMessage,
      details
    }
  }
}

// Format configuration help
export function getGraphConfigurationHelp(): string {
  return `
Microsoft Graph Email Configuration

Required Environment Variables:
1. MICROSOFT_TENANT_ID - Your Azure AD tenant ID
2. MICROSOFT_CLIENT_ID - Your app registration client ID
3. MICROSOFT_CLIENT_SECRET - Your app registration client secret
4. MICROSOFT_USER_EMAIL - The email address to send from (must be in your tenant)

Setup Steps:
1. Go to Azure Portal (https://portal.azure.com)
2. Navigate to Azure Active Directory > App registrations
3. Create a new registration or use existing
4. Note the Application (client) ID and Directory (tenant) ID
5. Under Certificates & secrets, create a new client secret
6. Under API permissions, add Microsoft Graph > Application permissions:
   - Mail.Send
   - User.Read.All (optional, for testing)
7. Grant admin consent for the permissions
8. Add the values to your .env.local file

Example .env.local:
MICROSOFT_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=your-client-secret-value
MICROSOFT_USER_EMAIL=peter@orangejelly.co.uk
`
}