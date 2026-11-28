import { escapeHtml } from '@/lib/cron/alerting'
import { STAFF } from '@/lib/brand/palette'
import { sendEmail } from '@/lib/email/emailService'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { maskPhone } from '@/lib/phone/mask'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Tells a manager that a guest asked us to stop in their own words.
 *
 * The request has already been honoured as a marketing opt-out (texts and email) by the time
 * this runs. A manager still needs to read it: "please stop messaging me" may mean every text,
 * including booking confirmations, and "wrong number" means the booker's texts are going to a
 * stranger. Before November 2026 these replies were stored and nobody was told.
 *
 * Goes to COMMS_ALERT_EMAIL (falling back to CRON_ALERT_EMAIL), the address that already gets
 * communications alerts. Never throws: the opt-out stands whether or not the email goes.
 */
export async function alertManagerToWrittenOptOut(input: {
  customerId: string
  fromNumber: string
  body: string
  channel: string
}): Promise<boolean> {
  try {
    const alertEmail = process.env.COMMS_ALERT_EMAIL || process.env.CRON_ALERT_EMAIL
    if (!alertEmail) {
      logger.error('A guest asked to stop in their own words but no alert email is configured', {
        metadata: { customerId: input.customerId },
      })
      return false
    }

    const db = createAdminClient()
    const { data: customer } = await db
      .from('customers')
      .select('first_name, last_name')
      .eq('id', input.customerId)
      .maybeSingle()

    const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim() || 'A guest'
    const link = `${getAppUrl()}/customers/${input.customerId}`

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;">
        <h2 style="color:${STAFF.warningFg};">A guest asked us to stop messaging them</h2>
        <p>${escapeHtml(name)} (${escapeHtml(maskPhone(input.fromNumber) ?? 'number not shown')}) replied by ${escapeHtml(input.channel === 'whatsapp' ? 'WhatsApp' : 'text')}:</p>
        <blockquote style="background:${STAFF.surface2};border-left:4px solid ${STAFF.border};margin:0;padding:12px;">${escapeHtml(input.body)}</blockquote>
        <p>We have stopped event and offer texts and marketing emails to them. Booking confirmations still go.</p>
        <p>If they want every text stopped, or this is a wrong number, change it on their record: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
      </div>
    `.trim()

    const result = await sendEmail({
      to: alertEmail,
      subject: `${name} asked us to stop messaging them`,
      html,
    })

    if (!result.success) {
      logger.error('Could not email a manager about a written opt-out', {
        metadata: { customerId: input.customerId, error: result.error || null },
      })
      return false
    }
    return true
  } catch (error) {
    logger.error('Could not email a manager about a written opt-out', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId: input.customerId },
    })
    return false
  }
}
