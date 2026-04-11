import { sendEmail } from './emailService';
import { logger } from '@/lib/logger';
import { generateBookingCalendarInvite } from './calendar-invite';

const VENUE_ADDRESS = 'The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ';

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB', {
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
      <td style="padding: 8px 12px 8px 0; border-bottom: 1px solid #eeeeee; color: #666666; white-space: nowrap; vertical-align: top;">${label}</td>
      <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee; vertical-align: top;">${value}</td>
    </tr>`;
}

/**
 * Send a booking confirmation email when a booking status changes to 'confirmed'.
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendBookingConfirmationEmail(booking: {
  id: string;
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
    const subject = `Booking Confirmed — ${eventLabel} on ${dateFormatted}`;

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
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="margin-top: 0; color: #1a1a1a;">Booking Confirmed</h2>
  <p>Hi ${firstName},</p>
  <p>Great news — your private event booking at The Anchor has been confirmed. We're looking forward to hosting you!</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${timeRow}
    ${booking.guest_count != null ? row('Guests', String(booking.guest_count)) : ''}
    ${booking.deposit_amount != null ? row('Deposit due', formatCurrency(booking.deposit_amount)) : ''}
    ${booking.total_amount != null ? row('Total amount', formatCurrency(booking.total_amount)) : ''}
  </table>
  <p>If you have any questions or need to make changes, please don't hesitate to get in touch.</p>
  <p>We look forward to seeing you!</p>
  <p style="margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  <p style="color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
</div>`;

    const result = await sendEmail({ to: booking.contact_email, subject, html });
    if (!result.success) {
      logger.error('Private booking confirmation email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending booking confirmation email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send a deposit received email when a deposit is recorded as paid.
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendDepositReceivedEmail(booking: {
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
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
    const subject = `Deposit Received — ${eventLabel} on ${dateFormatted}`;

    const depositPaid = booking.deposit_amount != null ? formatCurrency(booking.deposit_amount) : '—';
    // Security deposit is a returnable bond — the full event total is still owed.
    const remainingBalance =
      booking.total_amount != null
        ? formatCurrency(booking.total_amount)
        : null;

    const balanceDueRow =
      booking.balance_due_date
        ? row('Balance due date', formatDate(booking.balance_due_date))
        : '';

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="margin-top: 0; color: #1a1a1a;">Deposit Received</h2>
  <p>Hi ${firstName},</p>
  <p>Thank you — we've received your deposit and your booking for <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong> is now fully confirmed.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${row('Deposit paid', depositPaid)}
    ${remainingBalance != null ? row('Remaining balance', remainingBalance) : ''}
    ${balanceDueRow}
  </table>
  <p>We'll be in touch closer to the date with final details. If you have any questions in the meantime, please feel free to contact us.</p>
  <p style="margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  <p style="color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
</div>`;

    const result = await sendEmail({ to: booking.contact_email, subject, html });
    if (!result.success) {
      logger.error('Private booking deposit email send failed', {
        error: new Error(result.error || 'Unknown email error'),
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending deposit received email', {
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }
}

/**
 * Send a balance paid email when the booking is fully paid.
 * Fire-and-forget — never throws; errors are logged only.
 */
export async function sendBalancePaidEmail(booking: {
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
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
    const subject = `Payment Complete — ${eventLabel} on ${dateFormatted}`;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="margin-top: 0; color: #1a1a1a;">Payment Complete</h2>
  <p>Hi ${firstName},</p>
  <p>Thank you — we've received your final payment and your booking for <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong> is now fully paid.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${row('Event', eventLabel)}
    ${row('Date', dateFormatted)}
    ${booking.total_amount != null ? row('Total paid', formatCurrency(booking.total_amount)) : ''}
  </table>
  <p>Everything is all set — we're really looking forward to welcoming you and your guests to The Anchor!</p>
  <p style="margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  <p style="color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
</div>`;

    const result = await sendEmail({ to: booking.contact_email, subject, html });
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
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="margin-top: 0; color: #1a1a1a;">Your Calendar Invite</h2>
  <p>Hi ${firstName},</p>
  <p>Please find your calendar invite attached for your upcoming event — <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong>.</p>
  <p>Open the attached file to add the event to your calendar.</p>
  <p>If you have any questions, please don't hesitate to get in touch.</p>
  <p style="margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  <p style="color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
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
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  deposit_amount?: number | null;
}, paypalApproveUrl: string): Promise<void> {
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

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <h2 style="margin-top: 0; color: #1a1a1a;">Deposit Payment</h2>
  <p>Hi ${firstName},</p>
  <p>To secure your booking for <strong>${eventLabel}</strong> on <strong>${dateFormatted}</strong>, please pay your deposit of <strong>${depositFormatted}</strong> using the button below.</p>
  <p>
    <a href="${paypalApproveUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0070ba; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">
      Pay deposit via PayPal
    </a>
  </p>
  <p style="font-size: 13px; color: #666666;">Or copy this link into your browser:<br><a href="${paypalApproveUrl}" style="color: #0070ba; word-break: break-all;">${paypalApproveUrl}</a></p>
  <p>If you have any questions about your booking, please don't hesitate to get in touch.</p>
  <p style="margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  <p style="color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
</div>`;

    const result = await sendEmail({ to: booking.contact_email, subject, html });
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
