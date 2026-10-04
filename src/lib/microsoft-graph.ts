import { invoiceBalanceDue } from '@/lib/invoices/balance'
import { buildReceiptEmail, type InvoiceEmailKind } from '@/lib/invoices/email-copy'
import { buildDefaultInvoiceEmailDraft } from '@/lib/invoices/email-drafts'
// import { Client } from '@microsoft/microsoft-graph-client'
// import { ClientSecretCredential } from '@azure/identity'
import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'
import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'
import type { InvoiceDepositNotice, InvoiceDocumentKind, InvoiceRemittanceDetails } from '@/lib/invoice-template-compact'
import { getErrorMessage, getErrorStatusCode } from '@/lib/errors'

// Quote emails only. Invoice emails sign off with the fixed INVOICE_SIGN_OFF in
// `invoices/email-copy.ts`: COMPANY_CONTACT_PHONE holds the pub landline in production, which
// is how 35 of 36 receipts came to carry the wrong number.
const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07990587315'

// Initialize Microsoft Graph client
async function getGraphClient() {
  // Check if Graph is configured
  if (!isGraphConfigured()) {
    throw new Error('Microsoft Graph is not configured. Please check environment variables.')
  }

  const { Client } = await import('@microsoft/microsoft-graph-client')
  const { ClientSecretCredential } = await import('@azure/identity')

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

type InvoiceEmailOptions = {
  documentKind?: InvoiceDocumentKind
  remittance?: InvoiceRemittanceDetails
  pdfFilename?: string
  /** Private booking deposit statement, printed on the PDF. Never a total. */
  deposit?: InvoiceDepositNotice
  /**
   * What this email is (invoice, reminder, chase, receipt), saved with it as
   * `metadata.email_kind`. The reminder job and the invoice history read it. Defaults to
   * 'receipt' for a receipt and 'invoice' otherwise.
   */
  emailKind?: InvoiceEmailKind
  /**
   * The first name to greet, from `resolveInvoiceGreetingName`. Only read when the caller
   * passes no body, so the default wording still greets a person. Nothing means "Hi there":
   * the default never falls back to the company name.
   */
  greetingName?: string | null
}

/**
 * Checks each copied address against the block list and drops the blocked ones.
 *
 * `sendEmail` checks the block list for the To address only, so a copied address that had
 * bounced or complained kept being mailed on every invoice. The To address is deliberately
 * not touched here: `sendEmail` already refuses a blocked one and records why.
 *
 * FAILS OPEN, the same default `sendEmail` uses: if the list cannot be read the address is
 * kept. An accounts contact missing an invoice because of a database wobble is worse than
 * one more email to an address that may have bounced.
 */
async function screenCopiedAddresses(
  ccRecipients: string[] | undefined
): Promise<{ proposed: string[]; kept: string[]; dropped: string[] }> {
  const proposed = (ccRecipients ?? []).map((address) => String(address ?? '').trim()).filter(Boolean)
  if (proposed.length === 0) return { proposed, kept: [], dropped: [] }

  // A failed check keeps the address. The message is logged without the address, which is
  // personal data.
  const keepUnchecked = (error: unknown): false => {
    console.warn('Could not check a copied invoice address against the block list; keeping it:', getErrorMessage(error))
    return false
  }

  let blocked: boolean[]
  try {
    // Loaded once, before the addresses are checked side by side, and lazily like the other
    // email modules in this file.
    const { getEmailSuppressionStatus } = await import('@/lib/email/logging')
    blocked = await Promise.all(
      proposed.map(async (address) => {
        try {
          return (await getEmailSuppressionStatus(address)) === 'suppressed'
        } catch (error: unknown) {
          return keepUnchecked(error)
        }
      })
    )
  } catch (error: unknown) {
    keepUnchecked(error)
    blocked = proposed.map(() => false)
  }

  return {
    proposed,
    kept: proposed.filter((_, index) => !blocked[index]),
    dropped: proposed.filter((_, index) => blocked[index]),
  }
}

// Send invoice email
export async function sendInvoiceEmail(
  invoice: InvoiceWithDetails,
  recipientEmail: string,
  subject?: string,
  body?: string,
  ccRecipients?: string[],
  additionalAttachments?: Array<{ name: string; contentType: string; buffer: Buffer }>,
  emailOptions?: InvoiceEmailOptions
): Promise<{ success: boolean; error?: string; messageId?: string; pdfBuffer?: Buffer }> {
  try {
    // Generate invoice PDF with 'sent' status if currently draft
    const invoiceForPDF = invoice.status === 'draft'
      ? { ...invoice, status: 'sent' as const }
      : invoice
    const documentKind = emailOptions?.documentKind ?? 'invoice'
    const isRemittanceAdvice = documentKind === 'remittance_advice'
    const remittanceData = emailOptions?.remittance
    const pdfBuffer = await generateInvoicePDF(invoiceForPDF, {
      documentKind,
      remittance: remittanceData,
      deposit: emailOptions?.deposit,
    })

    // Default subject and body, used only for whichever of the two the caller did not pass.
    // They come from the shared wording module so an email nobody drafted still greets a
    // person by first name, quotes only what is still to pay (never the total on a part-paid
    // invoice) and signs off the same way as every other invoice email.
    const defaultDraft = isRemittanceAdvice
      ? buildReceiptEmail({
          firstName: emailOptions?.greetingName,
          invoiceNumber: invoice.invoice_number,
          paymentAmount: Number(remittanceData?.paymentAmount ?? invoice.paid_amount) || 0,
          balance: invoiceBalanceDue(invoice),
        })
      : buildDefaultInvoiceEmailDraft(invoice, emailOptions?.greetingName)
    const emailSubject = subject || defaultDraft.subject
    const emailBody = body || defaultDraft.body

    const attachments = [
      {
        name: emailOptions?.pdfFilename
          ?? (isRemittanceAdvice
            ? `receipt-${invoice.invoice_number}.pdf`
            : `invoice-${invoice.invoice_number}.pdf`),
        contentType: 'application/pdf',
        content: pdfBuffer,
      }
    ]

    for (const extra of additionalAttachments || []) {
      if (!extra?.name || !extra?.buffer) continue
      attachments.push({
        name: extra.name,
        contentType: extra.contentType || 'application/octet-stream',
        content: extra.buffer,
      })
    }

    // Every invoice email that may offer online payment passes through the
    // vendor eligibility check here. The manual send, the chase and the automatic
    // runs all funnel through this path, so enabled vendors receive the link
    // consistently and disabled vendors never receive it.
    //
    // Appended here rather than in the operator's draft because the draft is
    // composed in the browser and the signed token must never be minted there.
    // Receipts are excluded: they confirm money already received.
    const { withInvoicePaymentLink } = await import('@/lib/invoices/payment-link-footer')
    const bodyWithPaymentLink = isRemittanceAdvice
      ? emailBody
      : withInvoicePaymentLink(emailBody, invoice)

    const copied = await screenCopiedAddresses(ccRecipients)
    if (copied.dropped.length > 0) {
      // Addresses are personal data, so only the count is logged. The addresses themselves
      // are saved with the email, in `metadata.cc_dropped`.
      console.warn(
        `Invoice ${invoice.invoice_number}: ${copied.dropped.length} copied address(es) left off because they are on the block list`
      )
    }

    // Owner decision 2026-08-28: an invoice comes from Orange Jelly Limited, never from the
    // venue. Passing no sender let all 80 invoices and receipts in the last 120 days go out
    // as "The Anchor" while signing off as Orange Jelly in the body. `invoiceEmailRouting`
    // also carries the pin to the Orange Jelly mailbox once INVOICE_EMAIL_PROVIDER=graph is
    // set, and adds nothing while it is not. See `invoice-sender.ts`.
    const { invoiceEmailRouting } = await import('@/lib/email/invoice-sender')
    const { sendEmail } = await import('@/lib/email/emailService')
    // No `requireLog` here, on purpose. With it, `sendEmail` reports a send the provider has
    // already accepted as a failure when its log row cannot be written, and every caller of
    // this function retries a failure: the customer would get the invoice twice. Sent and
    // recorded are two different things, and only "sent" decides `success` below.
    const result = await sendEmail({
      to: recipientEmail,
      subject: emailSubject,
      text: bodyWithPaymentLink,
      // An array is passed only when the caller passed one, as before this check existed.
      cc: ccRecipients ? copied.kept : undefined,
      attachments,
      ...invoiceEmailRouting(),
      commType: isRemittanceAdvice ? 'invoice_receipt' : 'invoice',
      invoiceId: invoice.id,
      metadata: {
        invoice_number: invoice.invoice_number,
        document_kind: documentKind,
        email_kind: emailOptions?.emailKind ?? (isRemittanceAdvice ? 'receipt' : 'invoice'),
        // Who was asked for, who was left off, and who the email was actually submitted to.
        cc_proposed: copied.proposed,
        cc_dropped: copied.dropped,
        cc: copied.kept,
      },
    })

    return {
      success: result.success,
      error: result.error,
      messageId: result.messageId,
      // Returned so a caller can archive the exact bytes the customer
      // received, rather than regenerating a document that may since have
      // drifted.
      pdfBuffer
    }
  } catch (error: unknown) {
    console.error('Error sending invoice email:', error)
    return {
      success: false,
      error: getErrorMessage(error)
    }
  }
}

// Send quote email
export async function sendQuoteEmail(
  quote: QuoteWithDetails,
  recipientEmail: string,
  subject?: string,
  body?: string,
  ccRecipients?: string[]
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    const totalAmount = Number(quote.total_amount ?? 0)
    const formattedTotalAmount = `£${(Number.isFinite(totalAmount) ? totalAmount : 0).toFixed(2)}`
    // Generate quote PDF
    const pdfBuffer = await generateQuotePDF(quote)

    // Default subject and body
    const emailSubject = subject || `Quote ${quote.quote_number} from Orange Jelly Limited`
    const emailBody = body || `Hi ${quote.vendor?.contact_name || quote.vendor?.name || 'there'},

Thanks for getting in touch!

I've attached quote ${quote.quote_number} for your review:

Total Amount: ${formattedTotalAmount}
Quote Valid Until: ${new Date(quote.valid_until).toLocaleDateString('en-GB')}

${quote.notes ? `${quote.notes}\n\n` : ''}Please take your time to review everything, and don't hesitate to reach out if you have any questions or would like to discuss anything.

Looking forward to hearing from you!

Best wishes,
${CONTACT_NAME}
Orange Jelly Limited
${CONTACT_PHONE}

P.S. The quote is attached as a PDF for your convenience.`

    // A quote is the same document class as an invoice, and the same owner decision applies.
    const { invoiceReplyToAddress, invoiceSenderIdentity } = await import('@/lib/email/invoice-sender')
    const { sendEmail } = await import('@/lib/email/emailService')
    const result = await sendEmail({
      to: recipientEmail,
      subject: emailSubject,
      text: emailBody,
      cc: ccRecipients,
      from: invoiceSenderIdentity(),
      replyTo: invoiceReplyToAddress(),
      attachments: [
        {
          name: `quote-${quote.quote_number}.pdf`,
          contentType: 'application/pdf',
          content: pdfBuffer,
        }
      ],
      commType: 'quote',
      quoteId: quote.id,
      metadata: {
        quote_number: quote.quote_number,
      },
    })

    return {
      success: result.success,
      error: result.error,
      messageId: result.messageId
    }
  } catch (error: unknown) {
    console.error('Error sending quote email:', error)
    return {
      success: false,
      error: getErrorMessage(error)
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

    const client = await getGraphClient()
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
  } catch (error: unknown) {
    console.error('Error sending internal reminder:', error)
    return {
      success: false,
      error: getErrorMessage(error)
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

    const client = await getGraphClient()
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
  } catch (error: unknown) {
    console.error('Email connection test failed:', error)

    let errorMessage = 'Failed to connect to Microsoft Graph'
    const details = { error: getErrorMessage(error) }
    const statusCode = getErrorStatusCode(error)

    if (statusCode === 401) {
      errorMessage = 'Authentication failed. Check your client credentials.'
    } else if (statusCode === 403) {
      errorMessage = 'Permission denied. Ensure the app has Mail.Send permission.'
    } else if (statusCode === 404) {
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
function getGraphConfigurationHelp(): string {
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
