import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'
import { generateInvoiceHTML } from '@/lib/invoice-template'
import { generateQuoteHTML } from '@/lib/quote-template'

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

// Convert HTML to base64 for email attachment
function htmlToBase64(html: string): string {
  return Buffer.from(html).toString('base64')
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

    // Generate invoice HTML
    const invoiceHtml = generateInvoiceHTML({
      invoice,
      logoUrl: `${process.env.NEXT_PUBLIC_APP_URL}/logo-black.png`
    })

    // Default subject and body
    const emailSubject = subject || `Invoice ${invoice.invoice_number} from Orange Jelly Limited`
    const emailBody = body || `Dear ${invoice.vendor?.contact_name || invoice.vendor?.name || 'Customer'},

Please find attached invoice ${invoice.invoice_number} for your records.

Amount Due: £${invoice.total_amount.toFixed(2)}
Due Date: ${new Date(invoice.due_date).toLocaleDateString('en-GB')}

${invoice.notes ? `Notes: ${invoice.notes}\n\n` : ''}
If you have any questions about this invoice, please don't hesitate to contact us.

Best regards,
Orange Jelly Limited`

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
          name: `invoice-${invoice.invoice_number}.html`,
          contentType: 'text/html',
          contentBytes: htmlToBase64(invoiceHtml)
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

    // Generate quote HTML
    const quoteHtml = generateQuoteHTML({
      quote,
      logoUrl: `${process.env.NEXT_PUBLIC_APP_URL}/logo-black.png`
    })

    // Default subject and body
    const emailSubject = subject || `Quote ${quote.quote_number} from Orange Jelly Limited`
    const emailBody = body || `Dear ${quote.vendor?.contact_name || quote.vendor?.name || 'Customer'},

Please find attached quote ${quote.quote_number} for your consideration.

Total Amount: £${quote.total_amount.toFixed(2)}
Valid Until: ${new Date(quote.valid_until).toLocaleDateString('en-GB')}

${quote.notes ? `Notes: ${quote.notes}\n\n` : ''}
If you have any questions about this quote or would like to proceed, please let us know.

Best regards,
Orange Jelly Limited`

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
          name: `quote-${quote.quote_number}.html`,
          contentType: 'text/html',
          contentBytes: htmlToBase64(quoteHtml)
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
          contentBytes: htmlToBase64(attachmentHtml)
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