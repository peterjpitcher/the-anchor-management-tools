import { sendEmail } from './emailService';
import { logger } from '@/lib/logger';
import { generateBookingCalendarInvite } from './calendar-invite';
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils';
import { getSmartFirstName } from '@/lib/sms/name-utils';
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection';
import { formatPrivateBookingAmount } from '@/lib/private-bookings/messages';

const VENUE_ADDRESS = 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ';
const PRIVACY_NOTICE_URL = 'https://www.the-anchor.pub/privacy-policy';

// Applied to every text element so emails render in one font everywhere — Outlook
// does not inherit font-family from the wrapper div, so headings/body/tables would
// otherwise fall back to a serif font.
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

// Shared small-print footer (SOP §26/§27: privacy notice link + complaints
// contact on customer communications).
const EMAIL_FOOTER_HTML = `<p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 4px 0 0 0;">How we use your data: <a href="${PRIVACY_NOTICE_URL}" style="color: #999999;">${PRIVACY_NOTICE_URL}</a><br>Questions or complaints: <a href="mailto:manager@the-anchor.pub" style="color: #999999;">manager@the-anchor.pub</a> or write to us at the address above.</p>`;

function formatDate(isoDate: string): string {
  const parsed = new Date(isoDate)
  if (!Number.isFinite(parsed.getTime())) return isoDate || 'Date to be confirmed'
  return formatDateInLondon(parsed, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  return new Date(`1970-01-01T${time}`).toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="font-family: ${FONT_FAMILY}; padding: 8px 12px 8px 0; border-bottom: 1px solid #eeeeee; color: #666666; white-space: nowrap; vertical-align: top;">${label}</td>
      <td style="font-family: ${FONT_FAMILY}; padding: 8px 0; border-bottom: 1px solid #eeeeee; vertical-align: top;">${value}</td>
    </tr>`;
}

function privateBookingEmailLog(
  booking: { id: string; customer_id?: string | null },
  commType: string
) {
  return {
    requireLog: true,
    customerId: booking.customer_id ?? null,
    privateBookingId: booking.id,
    commType,
    metadata: { template_key: `${commType}_email` },
  }
}

/**
 * Send a provisional booking hold email when a booking status changes to 'confirmed'
 * but deposit has not yet been paid.
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendBookingConfirmationEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  guest_count?: number | null;
  deposit_amount?: number | null;
  total_amount?: number | null;
  hold_expiry?: string | null;
  deposit_paid_date?: string | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'Your Event';
    const dateFormatted = formatDate(booking.event_date);
    // Only assert a concrete deposit deadline while it is still a live deadline:
    // a past expiry, or a deposit already paid, would state something untrue.
    const holdExpiryIsLive =
      Boolean(booking.hold_expiry) &&
      !booking.deposit_paid_date &&
      new Date(booking.hold_expiry as string).getTime() > Date.now();
    const holdExpiryFormatted = holdExpiryIsLive ? formatDate(booking.hold_expiry as string) : null;
    const subject = `Provisional Booking Hold — ${eventLabel} on ${dateFormatted}`;

    const timeRow =
      booking.start_time
        ? row(
            'Time',
            booking.end_time
              ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
              : formatTime(booking.start_time),
          )
        : '';

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Provisional Booking Hold</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">We have placed a provisional hold for your event at The Anchor.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${timeRow}
    ${booking.guest_count != null ? row('Guests', String(booking.guest_count)) : ''}
    ${booking.deposit_amount != null ? row('Deposit due', formatCurrency(booking.deposit_amount)) : ''}
    ${booking.total_amount != null ? row('Total event cost', formatCurrency(booking.total_amount)) : ''}
    ${booking.total_amount != null ? row('Event balance due', formatCurrency(booking.total_amount)) : ''}
  </table>
  <p style="font-family: ${FONT_FAMILY};">Your date is currently on temporary hold. This hold is provisional only and your booking is not confirmed until we receive your deposit in cleared funds.</p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Unless we agree otherwise in writing, the temporary hold may be released if the deposit is not received in cleared funds by ${holdExpiryFormatted ?? "the hold expiry date we've given you"}.</p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Paying the deposit confirms that you accept the booking Terms and Conditions set out in your contract, including the cancellation and refund policy. The deposit is separate from your event balance, which is payable separately nearer the time.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      ...privateBookingEmailLog(booking, 'private_booking_provisional_hold'),
    });
    if (!result.success) {
      logger.error('Private booking provisional hold email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending provisional booking hold email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send a booking confirmed email when deposit is received (booking and damage deposit).
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendDepositReceivedEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  guest_count?: number | null;
  deposit_amount?: number | null;
  deposit_payment_method?: string | null;
  balance_due_date?: string | null;
  total_amount?: number | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const subject = `Booking Confirmed — ${eventLabel} on ${dateFormatted}`;

    const depositPaid = booking.deposit_amount != null ? formatCurrency(booking.deposit_amount) : '—';
    const eventBalance =
      booking.total_amount != null
        ? formatCurrency(booking.total_amount)
        : null;

    const timeRow =
      booking.start_time
        ? row(
            'Time',
            booking.end_time
              ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
              : formatTime(booking.start_time),
          )
        : '';

    const balanceDueDate = booking.balance_due_date
      ? formatDate(booking.balance_due_date)
      : null;

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Booking Confirmed</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">Thank you. We have received your deposit and your private event booking at The Anchor is now confirmed.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${timeRow}
    ${booking.guest_count != null ? row('Guests', String(booking.guest_count)) : ''}
    ${row('Deposit paid', depositPaid)}
    ${eventBalance != null ? row('Total event cost', eventBalance) : ''}
    ${eventBalance != null ? row('Event balance due', eventBalance) : ''}
    ${balanceDueDate != null ? row('Balance due date', balanceDueDate) : ''}
    ${balanceDueDate != null ? row('Final guest numbers due', balanceDueDate) : ''}
  </table>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666; border-top: 1px solid #eeeeee; padding-top: 12px; margin-top: 8px;">Your deposit is separate from the event balance and cannot be used towards payment of the event balance. The full event balance remains payable separately by the balance due date shown above.</p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">If the event goes ahead as booked, your deposit will be refunded within 48 hours after the event, provided that all charges have been settled and no deductions are required.</p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Our full cancellation, refund and date-change policy is set out in your contract. If you need to change your date, please contact us as early as possible — date changes are subject to availability and must be requested at least 14 calendar days before the event.</p>
  <p style="font-family: ${FONT_FAMILY};">We'll be in touch closer to the date with final details. If you have any questions in the meantime, please feel free to contact us.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      ...privateBookingEmailLog(booking, 'private_booking_deposit_received'),
    });
    if (!result.success) {
      logger.error('Private booking confirmed email send failed', {
        error: new Error(result.error || 'Unknown email error'),
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending booking confirmed email', {
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }
}

/**
 * Send a balance paid email when the event balance is fully paid.
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendBalancePaidEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  total_amount?: number | null;
  deposit_amount?: number | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const subject = `Payment Complete — ${eventLabel} on ${dateFormatted}`;

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Payment Complete</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">Thank you. We have received your event balance payment and your booking for <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong> is now fully paid.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${booking.total_amount != null ? row('Event balance paid', formatCurrency(booking.total_amount)) : ''}
    ${booking.deposit_amount != null ? row('Deposit held', formatCurrency(booking.deposit_amount)) : ''}
  </table>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Your deposit is held separately and will be refunded within 48 hours after the event, provided that all charges have been settled and no deductions are required.</p>
  <p style="font-family: ${FONT_FAMILY};">Everything is all set. We are looking forward to welcoming you and your guests to The Anchor.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      ...privateBookingEmailLog(booking, 'private_booking_balance_paid'),
    });
    if (!result.success) {
      logger.error('Private booking balance paid email send failed', {
        error: new Error(result.error || 'Unknown email error'),
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending balance paid email', {
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }
}

/**
 * Send a calendar invite (.ics attachment) for a confirmed private booking.
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendBookingCalendarInvite(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  start_time?: string | null;
  end_time?: string | null;
  end_time_next_day?: boolean | null;
  event_type?: string | null;
  guest_count?: number | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'Your Event';
    const dateFormatted = formatDate(booking.event_date);

    const ics = generateBookingCalendarInvite(booking);

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Your Calendar Invite</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">Please find your calendar invite attached for your upcoming event — <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong>.</p>
  <p style="font-family: ${FONT_FAMILY};">Open the attached file to add the event to your calendar.</p>
  <p style="font-family: ${FONT_FAMILY};">If you have any questions, please don't hesitate to get in touch.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject: `Your Event at The Anchor — ${dateFormatted}`,
      html,
      attachments: [
        {
          name: 'booking.ics',
          content: Buffer.from(ics),
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        },
      ],
      ...privateBookingEmailLog(booking, 'private_booking_calendar_invite'),
    });

    if (!result.success) {
      logger.error('Private booking calendar invite email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending booking calendar invite', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send a deposit payment link email with a PayPal "Pay now" button.
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendDepositPaymentLinkEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  deposit_amount?: number | null;
}, paypalApproveUrl: string, freshLinkUrl?: string): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'Your Private Event';
    const dateFormatted = formatDate(booking.event_date);
    const depositFormatted = formatCurrency(booking.deposit_amount ?? null);
    const subject = `Deposit payment — ${eventLabel} on ${dateFormatted}`;
    const freshLinkHtml = freshLinkUrl
      ? `
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">PayPal payment links usually expire 6 hours after this email is sent. If the PayPal button no longer works, open your secure booking page below and choose Pay deposit via PayPal.</p>
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${freshLinkUrl}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 10px 18px; background-color: #f3f4f6; color: #1f2937; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 14px;">
      Open your booking and pay
    </a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Secure booking page:<br><a href="${freshLinkUrl}" style="font-family: ${FONT_FAMILY}; color: #0070ba; word-break: break-all;">${freshLinkUrl}</a></p>`
      : `
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">PayPal payment links usually expire 6 hours after this email is sent. If the PayPal button no longer works, please contact us and we can send a fresh payment link.</p>`;

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Deposit Payment</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">To secure your booking for <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong>, please pay your deposit of <strong>${depositFormatted}</strong> using the button below.</p>
  <p style="font-family: ${FONT_FAMILY}; margin: 12px 0;">Your booking is confirmed once we've received your deposit, and the deposit is separate from your event balance (payable nearer the time). If you cancel 30 days or more before the event, your deposit is refunded less a 5% administration deduction and any costs already incurred. If you cancel less than 30 days before the event, we may retain up to the full deposit to cover reasonable losses and committed costs — we won't retain more than is reasonable in the circumstances. Paying the deposit confirms that you accept the booking Terms and Conditions set out in your contract.</p>
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${paypalApproveUrl}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 12px 24px; background-color: #0070ba; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">
      Pay deposit via PayPal
    </a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Or copy this link into your browser:<br><a href="${paypalApproveUrl}" style="font-family: ${FONT_FAMILY}; color: #0070ba; word-break: break-all;">${paypalApproveUrl}</a></p>
  ${freshLinkHtml}
  <p style="font-family: ${FONT_FAMILY};">If you have any questions about your booking, please don't hesitate to get in touch.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      ...privateBookingEmailLog(booking, 'private_booking_deposit_payment_link'),
    });
    if (!result.success) {
      logger.error('Deposit payment link email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending deposit payment link email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send a deposit refund email after the event (full refund, no deductions).
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendDepositRefundEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  refund_amount: number;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const subject = `Deposit Refunded — ${eventLabel} on ${dateFormatted}`;

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Deposit Refunded</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">Thank you for holding your event with us at The Anchor.</p>
  <p style="font-family: ${FONT_FAMILY};">We have completed our post-event checks and your deposit has now been refunded.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${row('Deposit refunded', formatCurrency(booking.refund_amount))}
  </table>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      ...privateBookingEmailLog(booking, 'private_booking_deposit_refund'),
    });
    if (!result.success) {
      logger.error('Deposit refund email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending deposit refund email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send a deposit refund email with deductions after the event.
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendDepositRefundWithDeductionsEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  deposit_amount: number;
  deduction_amount: number;
  deduction_reason: string;
  refund_amount: number;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const subject = `Deposit Refund Update — ${eventLabel} on ${dateFormatted}`;

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Deposit Refund Update</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">Thank you for holding your event with us at The Anchor.</p>
  <p style="font-family: ${FONT_FAMILY};">Following our post-event checks, deductions have been made from your deposit in accordance with the booking terms.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${row('Deposit paid', formatCurrency(booking.deposit_amount))}
    ${row('Deductions', formatCurrency(booking.deduction_amount))}
    ${row('Reason for deductions', booking.deduction_reason)}
    ${row('Deposit refunded', formatCurrency(booking.refund_amount))}
  </table>
  ${booking.deduction_amount > booking.deposit_amount ? `<p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Where the deductions exceed the deposit held, the remaining amount is payable on request.</p>` : ''}
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      ...privateBookingEmailLog(booking, 'private_booking_deposit_refund_deductions'),
    });
    if (!result.success) {
      logger.error('Deposit refund with deductions email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending deposit refund with deductions email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send a cancellation confirmation email with the refund/retention outcome
 * (SOP §14.9). Sent alongside the cancellation SMS so email-only customers
 * are not left uninformed. Fire-and-forget — never throws.
 */
export async function sendBookingCancelledEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  refund_amount: number;
  retained_amount: number;
  retention_reason?: string | null;
  outcome: string;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const subject = `Booking Cancelled — ${eventLabel} on ${dateFormatted}`;

    let outcomeHtml = '';
    if (booking.outcome === 'manual_review' || booking.outcome === 'gm_review_required') {
      outcomeHtml = `<p style="font-family: ${FONT_FAMILY};">We're reviewing the payments on your booking and will confirm any refund shortly.</p>`;
    } else {
      const parts: string[] = [];
      if (booking.refund_amount > 0) {
        parts.push(`${formatCurrency(booking.refund_amount)} will be refunded to you within 10 working days, back to the payment method you used where possible.`);
      }
      if (booking.retained_amount > 0) {
        parts.push(`${formatCurrency(booking.retained_amount)} of your deposit has been retained to cover reasonable costs arising from the cancellation${booking.retention_reason ? ` (${booking.retention_reason})` : ''}. We're happy to provide a breakdown on request.`);
      }
      if (parts.length === 0) {
        parts.push('No money had been paid on this booking, so there is nothing to refund.');
      }
      outcomeHtml = parts.map((p) => `<p style="font-family: ${FONT_FAMILY};">${p}</p>`).join('\n  ');
    }

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Booking Cancelled</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">Your booking for <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong> has been cancelled.</p>
  ${outcomeHtml}
  <p style="font-family: ${FONT_FAMILY};">If anything here doesn't look right, just reply to this email or call us on 01753 682707.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      ...privateBookingEmailLog(booking, 'private_booking_cancelled'),
    });
    if (!result.success) {
      logger.error('Booking cancelled email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending booking cancelled email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send the contract + terms to the customer with the PDF attached (SOP §11:
 * the contract and terms must be provided before the deposit is paid, and the
 * send must be recorded). The caller records contract_sent_at/sent_to.
 * Throws on failure so the caller can surface the error to staff.
 */
export async function sendContractEmailToCustomer(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  deposit_amount?: number | null;
  deposit_paid_date?: string | null;
}, contract: {
  version: number;
  pdf: Buffer;
}): Promise<void> {
  if (!booking.contact_email) {
    throw new Error('This booking has no contact email address');
  }

  const firstName =
    booking.customer_first_name ||
    booking.customer_name?.split(' ')[0] ||
    'there';

  const eventLabel = booking.event_type || 'your event';
  const dateFormatted = formatDate(booking.event_date);
  const subject = `Your booking contract — ${eventLabel} on ${dateFormatted}`;

  // Three cases, because asking someone to pay a deposit they have already paid
  // reads as though we have lost their money. `deposit_paid_date` is the record
  // of receipt, so it decides the wording rather than the amount alone.
  const hasDeposit = Boolean(booking.deposit_amount && booking.deposit_amount > 0);
  const depositPaidOn = booking.deposit_paid_date ? formatDate(booking.deposit_paid_date) : null;

  const depositLine = !hasDeposit
    ? `<p style="font-family: ${FONT_FAMILY};">Please have a read and let us know that you're happy with everything — we're glad to answer any questions.</p>`
    : depositPaidOn
      ? `<p style="font-family: ${FONT_FAMILY};">We received your ${formatCurrency(booking.deposit_amount!)} booking and damage deposit on ${depositPaidOn}, so there's nothing to pay to hold your date. Paying it confirmed that you accept these terms, so please do have a read, and ask us anything that isn't clear.</p>`
      : `<p style="font-family: ${FONT_FAMILY};">Paying the ${formatCurrency(booking.deposit_amount!)} booking and damage deposit confirms that you accept these terms — so please do have a read first, and ask us anything that isn't clear.</p>`;

  const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Your Booking Contract</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">Attached is the contract and terms for <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong> (contract version ${contract.version}).</p>
  ${depositLine}
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

  const result = await sendEmail({
    to: booking.contact_email,
    subject,
    html,
    attachments: [{
      name: `The-Anchor-booking-contract-v${contract.version}.pdf`,
      content: contract.pdf,
      contentType: 'application/pdf',
    }],
    ...privateBookingEmailLog(booking, 'private_booking_contract'),
  });
  if (!result.success) {
    throw new Error(result.error || 'Failed to send contract email');
  }
}

// ---------------------------------------------------------------------------
// Email versions of the private booking texts (email first, owner decision 11 September 2026).
//
// Sent by src/lib/private-bookings/messenger.ts when the flag private_booking_email_first is on
// and the booking has a usable address. Each builder takes the same inputs as the text it
// replaces (src/lib/private-bookings/messages.ts) and states every fact that text states, with
// amounts and deadlines printed exactly as the text prints them, plus the booking reference, the
// event date with its weekday, the times and the guest numbers. Nothing promotional: these are
// service messages. The builders are pure, so fixture tests can render them in any time zone.
// ---------------------------------------------------------------------------

/** Venue contact details, from the website SSOT §2. */
const VENUE_PHONE_DISPLAY = '01753 682707';
const VENUE_PHONE_TEL = '+441753682707';
const VENUE_EMAIL = 'manager@the-anchor.pub';

export type PrivateBookingEmailContent = {
  subject: string;
  html: string;
  text: string;
};

/** The booking fields the email versions read. */
export type PrivateBookingMessageEmailBooking = {
  id: string;
  event_type?: string | null;
  event_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  end_time_next_day?: boolean | null;
  guest_count?: number | null;
  date_tbd?: boolean | null;
  internal_notes?: string | null;
  setup_date?: string | null;
  setup_time?: string | null;
};

/** The reference printed on the contract (src/lib/contract-template.ts), so the two always match. */
export function formatPrivateBookingReference(bookingId: string): string {
  return `PB-${bookingId.slice(0, 8).toUpperCase()}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isDateOnly(booking: PrivateBookingMessageEmailBooking): boolean {
  return !booking.event_date || isBookingDateTbd(booking);
}

/** "Saturday, 3 October 2026", with the weekday computed in London, or "Date to be confirmed". */
export function formatPrivateBookingEventDate(booking: PrivateBookingMessageEmailBooking): string {
  if (isDateOnly(booking)) return 'Date to be confirmed';
  return formatDateInLondon(booking.event_date as string, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "on Saturday, 3 October 2026", or "(date to be confirmed)" for a booking with no firm date. */
function onEventDate(booking: PrivateBookingMessageEmailBooking): string {
  return isDateOnly(booking) ? '(date to be confirmed)' : `on ${formatPrivateBookingEventDate(booking)}`;
}

function formatEventTimes(booking: PrivateBookingMessageEmailBooking): string | null {
  if (isDateOnly(booking) || !booking.start_time) return null;
  const start = formatTime12Hour(booking.start_time);
  if (!booking.end_time) return `From ${start}`;
  const end = formatTime12Hour(booking.end_time);
  return booking.end_time_next_day ? `${start} to ${end} (the next day)` : `${start} to ${end}`;
}

type MessageEmailSpec = {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  subject: string;
  heading: string;
  /** The message itself, as plain sentences. */
  paragraphs: string[];
  /** Facts particular to this message, shown after the booking's own details. */
  rows?: Array<[string, string]>;
  link?: { label: string; url: string };
  /** Smaller print under the table. */
  notes?: string[];
};

function composeMessageEmail(spec: MessageEmailSpec): PrivateBookingEmailContent {
  const name = getSmartFirstName(spec.firstName);
  const times = formatEventTimes(spec.booking);
  const rows: Array<[string, string]> = [
    ['Booking reference', formatPrivateBookingReference(spec.booking.id)],
    ...(spec.booking.event_type ? ([['Event', spec.booking.event_type]] as Array<[string, string]>) : []),
    ['Date', formatPrivateBookingEventDate(spec.booking)],
    ...(times ? ([['Time', times]] as Array<[string, string]>) : []),
    ...(spec.booking.guest_count ? ([['Guests', String(spec.booking.guest_count)]] as Array<[string, string]>) : []),
    ...(spec.rows ?? []),
  ];
  const contactHtml = `Questions? Call us on <a href="tel:${VENUE_PHONE_TEL}" style="color: #1a1a1a;">${VENUE_PHONE_DISPLAY}</a> or email <a href="mailto:${VENUE_EMAIL}" style="color: #1a1a1a;">${VENUE_EMAIL}</a>.`;
  const contactText = `Questions? Call us on ${VENUE_PHONE_DISPLAY} or email ${VENUE_EMAIL}.`;

  const linkHtml = spec.link
    ? `
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${escapeHtml(spec.link.url)}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 12px 24px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold;">${escapeHtml(spec.link.label)}</a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Or copy this link into your browser:<br><a href="${escapeHtml(spec.link.url)}" style="color: #1a1a1a; word-break: break-all;">${escapeHtml(spec.link.url)}</a></p>`
    : '';

  const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${escapeHtml(spec.heading)}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(name)},</p>
  ${spec.paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rows.map(([label, value]) => row(escapeHtml(label), escapeHtml(value))).join('')}
  </table>${linkHtml}
  ${(spec.notes ?? []).map((note) => `<p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">${escapeHtml(note)}</p>`).join('\n  ')}
  <p style="font-family: ${FONT_FAMILY};">${contactHtml}</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

  const text = [
    spec.heading,
    '',
    `Hi ${name},`,
    '',
    ...spec.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    ...(spec.link ? [`${spec.link.label}: ${spec.link.url}`, ''] : []),
    ...(spec.notes ?? []).flatMap((note) => [note, '']),
    contactText,
    '',
    'Kind regards,',
    'The Anchor Events Team',
    'Orange Jelly Limited, trading as The Anchor',
    '',
    VENUE_ADDRESS,
    `How we use your data: ${PRIVACY_NOTICE_URL}`,
    `Questions or complaints: ${VENUE_EMAIL} or write to us at the address above.`,
  ].join('\n');

  return { subject: spec.subject, html, text };
}

/** The SSOT §16 wording for the private hire deposit, without the default amount. */
const DEPOSIT_TERMS_NOTE =
  "The deposit is a booking and damage deposit. It's held separately from your bill and refunded after the event, less any documented deductions.";

const money = (amount: number): string => formatPrivateBookingAmount(amount);

/** Mirrors privateBookingCreatedMessage. */
export function buildPrivateBookingCreatedEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  depositAmount: number;
  /** The hold expiry exactly as the text prints it, or null when there is none. */
  holdExpiry: string | null;
}): PrivateBookingEmailContent {
  const secures = input.holdExpiry
    ? `A ${money(input.depositAmount)} deposit secures it by ${input.holdExpiry}.`
    : `A ${money(input.depositAmount)} deposit secures it.`;
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: `Your date at The Anchor is pencilled in: ${formatPrivateBookingEventDate(input.booking)}`,
    heading: 'Your date is pencilled in',
    paragraphs: [
      `Your date at The Anchor ${onEventDate(input.booking)} is pencilled in.`,
      secures,
      "We'll be in touch with next steps.",
    ],
    rows: [
      ['Deposit to secure the date', money(input.depositAmount)],
      ...(input.holdExpiry ? ([['Deposit due by', input.holdExpiry]] as Array<[string, string]>) : []),
    ],
    notes: [DEPOSIT_TERMS_NOTE],
  });
}

export type DepositReminderStage = '7day' | '3day' | '1day';

/** Mirrors depositReminder7DayMessage, depositReminder3DayMessage and depositReminder1DayMessage. */
export function buildDepositReminderEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  stage: DepositReminderStage;
  depositAmount: number;
  /** The hold expiry exactly as the text prints it. */
  holdExpiry: string | null;
  /** Whole days left on the hold, as the 7-day text states it. */
  daysRemaining?: number;
}): PrivateBookingEmailContent {
  const deposit = money(input.depositAmount);
  const date = onEventDate(input.booking);
  let paragraphs: string[];
  let subject: string;

  if (input.stage === '7day') {
    const days = input.daysRemaining ?? 7;
    const dayWord = days === 1 ? 'day' : 'days';
    const expires = input.holdExpiry
      ? `expires in ${days} ${dayWord}, on ${input.holdExpiry}`
      : `expires in ${days} ${dayWord}`;
    subject = `Your hold at The Anchor expires in ${days} ${dayWord}`;
    paragraphs = [`A quick nudge. Your hold ${date} ${expires}.`, `Pay the ${deposit} deposit and the date's yours.`];
  } else if (input.stage === '3day') {
    const expires = input.holdExpiry ? `expires on ${input.holdExpiry}` : 'is expiring soon';
    subject = input.holdExpiry ? `Your hold at The Anchor expires on ${input.holdExpiry}` : 'Your hold at The Anchor is expiring soon';
    paragraphs = [`Your hold ${date} ${expires}.`, `A ${deposit} deposit locks the date in before it's released.`];
  } else {
    const dated = input.holdExpiry ? ` (${input.holdExpiry})` : '';
    subject = 'Your hold at The Anchor expires tomorrow';
    paragraphs = [`Your hold ${date} expires tomorrow${dated}.`, `Pay the ${deposit} deposit today and you're locked in.`];
  }

  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject,
    heading: 'Deposit reminder',
    paragraphs,
    rows: [
      ['Deposit due', deposit],
      ...(input.holdExpiry ? ([['Hold expires', input.holdExpiry]] as Array<[string, string]>) : []),
    ],
    notes: [DEPOSIT_TERMS_NOTE],
  });
}

/** Mirrors holdExtendedMessage. */
export function buildHoldExtendedEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  newExpiryDate: string;
}): PrivateBookingEmailContent {
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: `We've extended your hold at The Anchor to ${input.newExpiryDate}`,
    heading: 'Your hold has been extended',
    paragraphs: [
      `Good news. We've extended your hold ${onEventDate(input.booking)}.`,
      `New deadline: ${input.newExpiryDate}.`,
    ],
    rows: [['New deadline', input.newExpiryDate]],
  });
}

/** Mirrors bookingExpiredMessage. */
export function buildHoldLapsedEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
}): PrivateBookingEmailContent {
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: 'Your hold at The Anchor has lapsed',
    heading: 'Your hold has lapsed',
    paragraphs: [
      `Your hold ${onEventDate(input.booking)} has lapsed.`,
      "No worries. Just get in touch if you'd like to rebook.",
    ],
  });
}

/** Mirrors dateChangedMessage. The booking passed in carries the new date. */
export function buildDateChangedEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  /** Included, exactly as the text prints it, when the deadline moved with the event. */
  balanceDueDate: string | null;
}): PrivateBookingEmailContent {
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: `Your booking at The Anchor has moved to ${formatPrivateBookingEventDate(input.booking)}`,
    heading: 'Your booking has moved',
    paragraphs: [
      `Your booking has moved to ${formatPrivateBookingEventDate(input.booking)}.`,
      ...(input.balanceDueDate ? [`Your balance and final details are now due by ${input.balanceDueDate}.`] : []),
      "It's all sorted our end.",
    ],
    rows: input.balanceDueDate ? [['Balance and final details due by', input.balanceDueDate]] : [],
  });
}

/** Mirrors balanceDueDateChangedMessage. */
export function buildBalanceDueDateChangedEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  balanceDueDate: string;
}): PrivateBookingEmailContent {
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: `New deadline for your balance and final details: ${input.balanceDueDate}`,
    heading: 'Your balance deadline has changed',
    paragraphs: [
      `A quick update for your booking ${onEventDate(input.booking)}: your balance and final details are now due by ${input.balanceDueDate}.`,
      'Everything else stays the same.',
    ],
    rows: [['Balance and final details due by', input.balanceDueDate]],
  });
}

/** Mirrors setupReminderMessage, and adds the setup date and time the change was about. */
export function buildSetupReminderEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
}): PrivateBookingEmailContent {
  const setupRows: Array<[string, string]> = [];
  if (input.booking.setup_date) {
    setupRows.push(['Setup date', formatDateInLondon(input.booking.setup_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })]);
  }
  if (input.booking.setup_time) {
    setupRows.push(['Setup from', formatTime12Hour(input.booking.setup_time)]);
  }
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: `Your event at The Anchor is nearly here: ${formatPrivateBookingEventDate(input.booking)}`,
    heading: 'Your event is nearly here',
    paragraphs: [
      `Your event ${onEventDate(input.booking)} is nearly here.`,
      'Send any final setup details our way so we can make it perfect.',
    ],
    rows: setupRows,
  });
}

export type BalanceReminderStage = '21day' | '16day' | '15day' | 'due';

/** Mirrors the four balance and final-details reminders. */
export function buildBalanceReminderEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  stage: BalanceReminderStage;
  balanceAmount: number;
  /** The deadline exactly as the text prints it. */
  balanceDueDate: string;
}): PrivateBookingEmailContent {
  const balance = money(input.balanceAmount);
  const date = onEventDate(input.booking);
  let subject: string;
  let paragraphs: string[];

  if (input.stage === '21day') {
    subject = `Balance and final details due by ${input.balanceDueDate}`;
    paragraphs = [
      `Your ${balance} balance and your final details (numbers, menus, suppliers) are due by ${input.balanceDueDate} for your booking ${date}.`,
    ];
  } else if (input.stage === '16day') {
    subject = `2 days to go: balance and final details due by ${input.balanceDueDate}`;
    paragraphs = [`2 days to go: your ${balance} balance and final details are due by ${input.balanceDueDate} for your booking ${date}.`];
  } else if (input.stage === '15day') {
    subject = `Balance and final details due tomorrow (${input.balanceDueDate})`;
    paragraphs = [`Your ${balance} balance and final details for your booking ${date} are due tomorrow (${input.balanceDueDate}).`];
  } else {
    subject = `Balance and final details due today (${input.balanceDueDate})`;
    paragraphs = [
      `Your ${balance} balance and your final details for your booking ${date} are due today (${input.balanceDueDate}).`,
      "Get them to us and you're all set.",
    ];
  }

  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject,
    heading: 'Balance and final details',
    paragraphs,
    rows: [
      ['Balance due', balance],
      ['Due by', input.balanceDueDate],
    ],
  });
}

/** Mirrors eventReminder1DayMessage: the guest count comes from the booking, as the text's does. */
export function buildEventReminderEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
}): PrivateBookingEmailContent {
  const ready = input.booking.guest_count
    ? `Everything's ready for your ${input.booking.guest_count} guests.`
    : "Everything's ready.";
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: `See you tomorrow: ${formatPrivateBookingEventDate(input.booking)}`,
    heading: "Tomorrow's the day",
    paragraphs: ["Tomorrow's the day.", ready, 'See you then.'],
  });
}

/** Mirrors bookingCompletedThanksMessage. */
export function buildThankYouEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
}): PrivateBookingEmailContent {
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: 'Thank you for choosing The Anchor',
    heading: 'Thank you',
    paragraphs: ['Thanks for choosing The Anchor.', 'We hope it was everything you wanted.'],
  });
}

/** Mirrors reviewRequestMessage, with the same review link. */
export function buildReviewRequestEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  reviewLink: string;
}): PrivateBookingEmailContent {
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: 'Could you leave The Anchor a Google review?',
    heading: 'A quick favour',
    paragraphs: [
      `We're glad your event ${onEventDate(input.booking)} went well.`,
      "If you've got 30 seconds, a Google review would mean a lot.",
    ],
    link: { label: 'Leave a Google review', url: input.reviewLink },
  });
}

export type PrivateBookingCancellationVariant =
  | 'private_booking_cancelled_hold'
  | 'private_booking_cancelled_refundable'
  | 'private_booking_cancelled_partial_refund'
  | 'private_booking_cancelled_retention'
  | 'private_booking_cancelled_review_pending'
  | 'private_booking_cancelled_manual_review';

/** Mirrors the six cancellation texts, variant for variant. */
export function buildCancellationEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  variant: PrivateBookingCancellationVariant;
  refundAmount: number;
  retainedAmount: number;
  /** The administration deduction the partial-refund text states. */
  deductionAmount: number;
  /** The manager's recorded reason, shown with a retention when there is one. */
  retentionReason?: string | null;
}): PrivateBookingEmailContent {
  const date = onEventDate(input.booking);
  const refund = money(input.refundAmount);
  let paragraphs: string[];
  let rows: Array<[string, string]> = [];

  switch (input.variant) {
    case 'private_booking_cancelled_hold':
      paragraphs = [`Your hold ${date} is cancelled.`, 'No money changed hands.', "Just get in touch if you'd like another date."];
      break;
    case 'private_booking_cancelled_refundable':
      paragraphs = [
        `Your booking ${date} is cancelled.`,
        `We'll refund ${refund} within 10 working days and confirm once it's on the way.`,
      ];
      rows = [['Refund', refund]];
      break;
    case 'private_booking_cancelled_partial_refund':
      paragraphs = [
        `Your booking ${date} is cancelled.`,
        `Your deposit will be refunded less the ${money(input.deductionAmount)} cancellation administration deduction.`,
        `We'll refund ${refund} within 10 working days.`,
      ];
      rows = [
        ['Cancellation administration deduction', money(input.deductionAmount)],
        ['Refund', refund],
      ];
      break;
    case 'private_booking_cancelled_retention':
      paragraphs = [
        `Your booking ${date} is cancelled.`,
        `Following review, ${money(input.retainedAmount)} of your deposit has been retained to cover costs from the cancellation.`,
        ...(input.refundAmount > 0 ? [`${refund} will be refunded within 10 working days.`] : []),
        "We'll send a breakdown on request.",
      ];
      rows = [
        ['Deposit retained', money(input.retainedAmount)],
        ...(input.retentionReason ? ([['Reason', input.retentionReason]] as Array<[string, string]>) : []),
        ...(input.refundAmount > 0 ? ([['Refund', refund]] as Array<[string, string]>) : []),
      ];
      break;
    case 'private_booking_cancelled_review_pending':
      paragraphs = [
        `Your booking ${date} is cancelled.`,
        "We're reviewing payments and your deposit, and will confirm any refund shortly.",
      ];
      break;
    case 'private_booking_cancelled_manual_review':
    default:
      paragraphs = [
        `Your booking ${date} is cancelled.`,
        'A member of our team will be in touch shortly to confirm next steps on payment.',
      ];
      break;
  }

  const isHold = input.variant === 'private_booking_cancelled_hold';
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: isHold ? 'Your hold at The Anchor is cancelled' : 'Your booking at The Anchor is cancelled',
    heading: isHold ? 'Your hold is cancelled' : 'Your booking is cancelled',
    paragraphs,
    rows,
  });
}

/**
 * Mirrors depositReceivedMessage, and carries the facts of the "Booking Confirmed" email that has
 * always gone alongside it (sendDepositReceivedEmail), so one email now does both jobs.
 */
export function buildDepositReceivedMessageEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  depositAmount: number | null;
  /** VAT-inclusive total, when known. */
  totalAmount?: number | null;
  /** The balance and final-details deadline, as a date. */
  balanceDueDate?: string | null;
}): PrivateBookingEmailContent {
  const dueDate = input.balanceDueDate
    ? formatDateInLondon(input.balanceDueDate, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const rows: Array<[string, string]> = [];
  if (input.depositAmount != null && input.depositAmount > 0) rows.push(['Deposit paid', money(input.depositAmount)]);
  if (input.totalAmount != null && input.totalAmount > 0) rows.push(['Total event cost', money(input.totalAmount)]);
  if (dueDate) rows.push(['Balance and final guest numbers due', dueDate]);

  const date = isDateOnly(input.booking) ? 'Your date' : formatPrivateBookingEventDate(input.booking);
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: 'Deposit received: your booking at The Anchor is confirmed',
    heading: 'Deposit received',
    paragraphs: [
      'Thank you. We have received your deposit.',
      `${date} is yours, and your private event booking at The Anchor is confirmed.`,
      "We'll be in touch closer to the time.",
    ],
    rows,
    notes: [
      DEPOSIT_TERMS_NOTE,
      'Your event balance is payable separately, by the balance due date shown above.',
      'Our full cancellation, refund and date-change policy is set out in your contract.',
    ],
  });
}

export type ConfirmationDepositState = 'due' | 'paid' | 'none';

/** Which confirmation a booking needs: a provisional hold while a deposit is owed, otherwise confirmed. */
export function resolveConfirmationDepositState(booking: {
  deposit_amount?: number | string | null;
  deposit_paid_date?: string | null;
  deposit_waived?: boolean | null;
}): ConfirmationDepositState {
  if (booking.deposit_paid_date) return 'paid';
  const amount = Number(booking.deposit_amount ?? 0);
  if (booking.deposit_waived === true || !Number.isFinite(amount) || amount <= 0) return 'none';
  return 'due';
}

/**
 * Mirrors bookingConfirmedMessage, and replaces the confirmation email that has always gone with it
 * (sendBookingConfirmationEmail). That email called every confirmation a "Provisional Booking Hold"
 * that "is not confirmed until we receive your deposit", even when the deposit had been waived or
 * paid. This one says provisional only while a deposit is still owed.
 */
export function buildBookingConfirmedMessageEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  depositState: ConfirmationDepositState;
  depositAmount: number | null;
  /** The hold expiry as a timestamp; quoted only while it is still in the future. */
  holdExpiry?: string | null;
  totalAmount?: number | null;
  now?: Date;
}): PrivateBookingEmailContent {
  const eventLabel = input.booking.event_type || 'your event';
  const totalRows: Array<[string, string]> =
    input.totalAmount != null && input.totalAmount > 0 ? [['Total event cost', money(input.totalAmount)]] : [];

  if (input.depositState === 'due') {
    const now = input.now ?? new Date();
    const expiryLive = Boolean(input.holdExpiry) && Date.parse(input.holdExpiry as string) > now.getTime();
    const expiry = expiryLive
      ? formatDateInLondon(input.holdExpiry as string, { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    return composeMessageEmail({
      booking: input.booking,
      firstName: input.firstName,
      subject: `Provisional booking hold: ${eventLabel} ${onEventDate(input.booking)}`,
      heading: 'Provisional booking hold',
      paragraphs: [
        'We have placed a provisional hold for your event at The Anchor.',
        "Your booking isn't confirmed until we receive your deposit in cleared funds.",
      ],
      rows: [
        ...(input.depositAmount != null && input.depositAmount > 0 ? ([['Deposit due', money(input.depositAmount)]] as Array<[string, string]>) : []),
        ...(expiry ? ([['Deposit due by', expiry]] as Array<[string, string]>) : []),
        ...totalRows,
      ],
      notes: [
        `Unless we agree otherwise in writing, the hold may be released if the deposit isn't received in cleared funds by ${expiry ?? "the hold expiry date we've given you"}.`,
        'Paying the deposit confirms that you accept the booking terms and conditions set out in your contract, including the cancellation and refund policy.',
        DEPOSIT_TERMS_NOTE,
      ],
    });
  }

  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: `Booking confirmed: ${eventLabel} ${onEventDate(input.booking)}`,
    heading: 'Booking confirmed',
    paragraphs: [
      `You're all confirmed for ${isDateOnly(input.booking) ? 'your booking at The Anchor (date to be confirmed)' : formatPrivateBookingEventDate(input.booking)}.`,
      input.depositState === 'paid' ? 'We have received your deposit.' : 'There is no deposit to pay for this booking.',
      "We can't wait.",
    ],
    rows: totalRows,
    notes: totalRows.length > 0 ? ['Your event balance is payable separately, nearer the time.'] : [],
  });
}

/**
 * Mirrors finalPaymentMessage, and carries the facts of the "Payment Complete" email that has
 * always gone alongside it (sendBalancePaidEmail).
 */
export function buildBalancePaidMessageEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  totalAmount?: number | null;
  depositAmount?: number | null;
}): PrivateBookingEmailContent {
  const rows: Array<[string, string]> = [];
  if (input.totalAmount != null && input.totalAmount > 0) rows.push(['Event balance paid', money(input.totalAmount)]);
  if (input.depositAmount != null && input.depositAmount > 0) rows.push(['Deposit held', money(input.depositAmount)]);
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: "Balance paid in full: you're all set",
    heading: 'Balance paid in full',
    paragraphs: [
      'Thank you. Your balance is paid in full.',
      `You're all set for ${isDateOnly(input.booking) ? 'your booking (date to be confirmed)' : formatPrivateBookingEventDate(input.booking)}. See you then.`,
    ],
    rows,
    notes: input.depositAmount != null && input.depositAmount > 0 ? [DEPOSIT_TERMS_NOTE] : [],
  });
}
