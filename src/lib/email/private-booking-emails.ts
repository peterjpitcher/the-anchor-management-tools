import { sendEmail } from './emailService';
import { logger } from '@/lib/logger';
import { generateBookingCalendarInvite } from './calendar-invite';
import { formatDateInLondon } from '@/lib/dateUtils';

const VENUE_ADDRESS = 'The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ';

// Applied to every text element so emails render in one font everywhere — Outlook
// does not inherit font-family from the wrapper div, so headings/body/tables would
// otherwise fall back to a serif font.
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

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
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'Your Event';
    const dateFormatted = formatDate(booking.event_date);
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
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Unless we agree otherwise in writing, the temporary hold may be released if the deposit is not received within 14 calendar days.</p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Paying the deposit confirms that you accept the booking Terms and Conditions set out in your contract, including the cancellation and refund policy. The deposit is separate from your event balance, which is payable separately nearer the time.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
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
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
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
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
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
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
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
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">PayPal payment links usually expire 6 hours after this email is sent. If the PayPal button no longer works, use the button below to create a fresh payment link.</p>
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${freshLinkUrl}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 10px 18px; background-color: #f3f4f6; color: #1f2937; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 14px;">
      Get a fresh payment link
    </a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Fresh link page:<br><a href="${freshLinkUrl}" style="font-family: ${FONT_FAMILY}; color: #0070ba; word-break: break-all;">${freshLinkUrl}</a></p>`
      : `
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">PayPal payment links usually expire 6 hours after this email is sent. If the PayPal button no longer works, please contact us and we can send a fresh payment link.</p>`;

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Deposit Payment</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">To secure your booking for <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong>, please pay your deposit of <strong>${depositFormatted}</strong> using the button below.</p>
  <p style="font-family: ${FONT_FAMILY}; margin: 12px 0;">Your booking is confirmed once we've received your deposit, and the deposit is separate from your event balance (payable nearer the time). <strong>If you cancel less than 30 days before the event, your deposit is non-refundable.</strong> If you cancel 30 days or more before the event, it's refundable less a 5% administration fee and any costs already incurred. Paying the deposit confirms that you accept the booking Terms and Conditions set out in your contract.</p>
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
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
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
 * Send a balance reminder email before the event balance due date.
 * Fire-and-forget — never throws; errors are logged only.
 */
async function sendBalanceReminderEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  total_amount?: number | null;
  balance_due_date?: string | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const balanceDueDate = booking.balance_due_date
      ? formatDate(booking.balance_due_date)
      : 'the due date';
    const subject = `Event Balance Due — ${eventLabel} on ${dateFormatted}`;

    const html = `
<div style="font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">Event Balance Due</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${firstName},</p>
  <p style="font-family: ${FONT_FAMILY};">This is a reminder that the full event balance for your booking is due no later than <strong>${balanceDueDate}</strong>.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${booking.total_amount != null ? row('Event balance due', formatCurrency(booking.total_amount)) : ''}
    ${row('Final guest numbers due', balanceDueDate)}
  </table>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Please remember that your deposit is separate from the event balance and cannot be used towards payment of the event balance.</p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">If the event balance and final guest numbers are not received by the due date, Orange Jelly Limited may treat the booking as cancelled by you. In that case, the deposit may be retained in accordance with the cancellation policy.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      ...privateBookingEmailLog(booking, 'private_booking_balance_reminder'),
    });
    if (!result.success) {
      logger.error('Balance reminder email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending balance reminder email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send a deposit refund email after the event (full refund, no deductions).
 * Fire-and-forget — never throws; errors are logged only.
 */
async function sendDepositRefundEmail(booking: {
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
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
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
async function sendDepositRefundWithDeductionsEmail(booking: {
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
  ${booking.deduction_amount > booking.deposit_amount ? `<p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #dc2626; font-weight: bold;">If the deductions exceed the deposit held, the remaining amount will be payable on demand.</p>` : ''}
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
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
