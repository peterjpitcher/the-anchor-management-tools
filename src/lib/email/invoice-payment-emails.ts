import { sendEmail } from './emailService';
import { logger } from '@/lib/logger';
import { formatDateInLondon } from '@/lib/dateUtils';

const VENUE_ADDRESS = 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ';
const PRIVACY_NOTICE_URL = 'https://www.the-anchor.pub/privacy-policy';

// Applied to every text element: Outlook does not inherit font-family from the
// wrapper div, so headings and body would otherwise fall back to a serif font.
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

const EMAIL_FOOTER_HTML = `<p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 4px 0 0 0;">How we use your data: <a href="${PRIVACY_NOTICE_URL}" style="color: #999999;">${PRIVACY_NOTICE_URL}</a><br>Questions or complaints: <a href="mailto:manager@the-anchor.pub" style="color: #999999;">manager@the-anchor.pub</a> or write to us at the address above.</p>`;

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

  const subject = `Invoice ${params.invoiceNumber} — ${amount} due`;

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
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

  try {
    const result = await sendEmail({
      to: params.to,
      cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
      subject,
      html,
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
