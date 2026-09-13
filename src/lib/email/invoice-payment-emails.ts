import { sendEmail } from './emailService';
import { logger } from '@/lib/logger';
import { formatDateInLondon } from '@/lib/dateUtils';
import { COMPANY_DETAILS } from '@/lib/company-details';
import { invoiceReplyToAddress, invoiceSenderIdentity } from '@/lib/email/invoice-sender';

const PRIVACY_NOTICE_URL = 'https://www.the-anchor.pub/privacy-policy';

// Applied to every text element: Outlook does not inherit font-family from the
// wrapper div, so headings and body would otherwise fall back to a serif font.
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

/**
 * The invoice footer, in Orange Jelly's name.
 *
 * This email asks for money against a VAT invoice, so the party asking is Orange Jelly
 * Limited (owner decision, 28 August 2026). The old version signed off "The Anchor" with the
 * venue's postal address and the venue manager's mailbox for complaints, which named the
 * wrong legal entity on the one email where the entity matters. The registered details come
 * from the company record, so nothing here is hand-copied.
 */
const COMPANY_POSTAL_LINE = `${COMPANY_DETAILS.legalName}, ${COMPANY_DETAILS.fullAddress}. Company number ${COMPANY_DETAILS.registrationNumber}. VAT ${COMPANY_DETAILS.vatNumber}.`;

const EMAIL_FOOTER_HTML = `<p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${COMPANY_POSTAL_LINE}</p>
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 4px 0 0 0;">How we use your data: <a href="${PRIVACY_NOTICE_URL}" style="color: #999999;">${PRIVACY_NOTICE_URL}</a><br>Questions about this invoice: reply to this email or write to us at the address above.</p>`;

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Email a customer a link to pay an invoice.
 *
 * Two routes on purpose, matching the deposit email: the PayPal button they can
 * press now, and the portal link that still works once PayPal's approval URL
 * has expired a few hours later.
 *
 * Fire-and-forget in spirit but it does surface failures to the caller, because
 * unlike a receipt this email IS the payment request: staff need to know it did
 * not arrive.
 */
export async function sendInvoicePaymentLinkEmail(params: {
  to: string;
  cc?: string[];
  invoiceNumber: string;
  customerName: string | null;
  amountDue: number;
  dueDate: string;
  paypalApproveUrl: string;
  portalUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  const greetingName = (params.customerName || '').trim().split(' ')[0] || 'there';
  const amount = formatCurrency(params.amountDue);
  const due = formatDateInLondon(params.dueDate, { day: 'numeric', month: 'long', year: 'numeric' });
  const invoiceNumber = escapeHtml(params.invoiceNumber);

  // A colon, not a dash: the house style bans em and en dashes, and a hook blocks writes
  // that carry one.
  const subject = `Invoice ${params.invoiceNumber}: ${amount} due`;

  const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Invoice ${invoiceNumber}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(greetingName)},</p>
  <p style="font-family: ${FONT_FAMILY};">There's <strong>${amount}</strong> outstanding on invoice ${invoiceNumber}, due ${due}. You can pay it online using the button below.</p>
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${params.paypalApproveUrl}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 12px 24px; background-color: #0070ba; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">
      Pay ${amount} via PayPal
    </a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Or copy this link into your browser:<br><a href="${params.paypalApproveUrl}" style="font-family: ${FONT_FAMILY}; color: #0070ba; word-break: break-all;">${params.paypalApproveUrl}</a></p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">PayPal links usually stop working a few hours after this email is sent. If the button above no longer works, open your payment page below and it will make you a fresh one.</p>
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${params.portalUrl}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 10px 18px; background-color: #f3f4f6; color: #1f2937; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 14px;">
      Open your payment page
    </a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Payment page:<br><a href="${params.portalUrl}" style="font-family: ${FONT_FAMILY}; color: #0070ba; word-break: break-all;">${params.portalUrl}</a></p>
  <p style="font-family: ${FONT_FAMILY};">If you'd rather pay by bank transfer, or anything on the invoice doesn't look right, just reply to this email and we'll sort it out.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>${COMPANY_DETAILS.legalName}</strong><br><span style="color: #666666;">Trading as ${COMPANY_DETAILS.tradingName}</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

  try {
    const result = await sendEmail({
      to: params.to,
      cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
      subject,
      html,
      // Same sender as the invoice itself, so the payment request and the document it is
      // about do not arrive from two different businesses.
      from: invoiceSenderIdentity(),
      replyTo: invoiceReplyToAddress(),
      commType: 'invoice_payment_link',
    });

    if (!result.success) {
      logger.error('Invoice payment link email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { invoiceNumber: params.invoiceNumber, to: params.to },
      });
      return { success: false, error: result.error || 'The email could not be sent.' };
    }

    return { success: true };
  } catch (e) {
    logger.error('Unexpected error sending invoice payment link email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { invoiceNumber: params.invoiceNumber },
    });
    return { success: false, error: e instanceof Error ? e.message : 'The email could not be sent.' };
  }
}
