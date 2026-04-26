import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'

export type NotificationStatus = 'email_sent' | 'sms_sent' | 'skipped' | 'failed'

interface RefundNotificationParams {
  customerName: string
  email: string | null
  phone: string | null
  amount: number
}

function formatAmount(amount: number): string {
  return `\u00a3${amount.toFixed(2)}`
}

function buildEmailHtml(customerName: string, amount: string): string {
  return `
    <p>Hi ${customerName},</p>
    <p>We've initiated a refund of ${amount} to your original payment method.</p>
    <p>Please allow up to 5 business days for this to appear in your account.</p>
    <p>If you have any questions, please don't hesitate to contact us.</p>
    <p>Kind regards,<br/>The Anchor Team</p>
  `.trim()
}

function buildSmsBody(customerName: string, amount: string): string {
  return `Hi ${customerName}, we've initiated a refund of ${amount} to your original payment method. Please allow up to 5 business days for this to appear. \u2014 The Anchor`
}

export async function sendRefundNotification(
  params: RefundNotificationParams
): Promise<NotificationStatus> {
  const amount = formatAmount(params.amount)

  // Try email first
  if (params.email) {
    const emailResult = await sendEmail({
      to: params.email,
      subject: 'Refund Confirmation \u2014 The Anchor',
      html: buildEmailHtml(params.customerName, amount),
    })
    if (emailResult.success) return 'email_sent'
  }

  // Fall back to SMS
  if (params.phone) {
    const smsResult = await sendSMS(
      params.phone,
      buildSmsBody(params.customerName, amount),
      {}
    )
    if (smsResult.success) return 'sms_sent'
  }

  // No contact info or both failed
  if (!params.email && !params.phone) return 'skipped'
  return 'failed'
}
