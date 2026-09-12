import { sendEmail } from './emailService';
import { logger } from '@/lib/logger';
import { bookingCalendarInviteSequence, generateBookingCalendarInvite } from './calendar-invite';
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils';
import { getSmartFirstName } from '@/lib/sms/name-utils';
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection';
import { buildPrivateBookingPortalUrl } from '@/lib/private-bookings/booking-token';
import { formatPrivateBookingAmount } from '@/lib/private-bookings/messages';
import {
  describePaymentMethod,
  type PrivateBookingPaymentStatement,
} from '@/lib/private-bookings/payment-statement';
import type { PaymentHistoryEntry } from '@/types/private-bookings';

const VENUE_ADDRESS = 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ';
const PRIVACY_NOTICE_URL = 'https://www.the-anchor.pub/privacy-policy';

// Applied to every text element so emails render in one font everywhere. Outlook
// does not inherit font-family from the wrapper div, so headings, body and tables
// would otherwise fall back to a serif font.
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

// Shared small-print footer (SOP §26/§27: privacy notice link + complaints
// contact on customer communications).
const EMAIL_FOOTER_HTML = `<p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 0;">${VENUE_ADDRESS}</p>
  <p style="font-family: ${FONT_FAMILY}; color: #999999; font-size: 12px; margin: 4px 0 0 0;">How we use your data: <a href="${PRIVACY_NOTICE_URL}" style="color: #999999;">${PRIVACY_NOTICE_URL}</a><br>Questions or complaints: <a href="mailto:manager@the-anchor.pub" style="color: #999999;">manager@the-anchor.pub</a> or write to us at the address above.</p>`;

/**
 * The wrapper every private booking email opens with.
 *
 * 16px of padding rather than 20, and no label column that refuses to wrap: five of these emails
 * measured 383 to 411px of content on a 375px phone, so the amounts sat off the right edge.
 */
const EMAIL_CONTAINER_STYLE = `font-family: ${FONT_FAMILY}; max-width: 600px; margin: 0 auto; padding: 16px; color: #1a1a1a;`;

/**
 * The one-line summary a mail client shows beside the subject. Hidden in the body, because without
 * one the client shows whatever the email opens with, which was "Hi Alex,".
 */
function preheader(text: string): string {
  return `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(text)}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * "Saturday, 20 September 2026", in London.
 *
 * The weekday is the part a guest checks against their own diary. Anything that is not a date is
 * passed through, because callers hand this the words "Date to be confirmed" for a booking that
 * has no date yet.
 */
function formatDate(isoDate: string): string {
  const parsed = new Date(isoDate)
  if (!Number.isFinite(parsed.getTime())) return isoDate || 'Date to be confirmed'
  return formatDateInLondon(parsed, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "7:30pm", never "19:30" and never a single-digit midnight hour such as "0:30". */
function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  return formatTime12Hour(time.slice(0, 5));
}

/**
 * Whether this booking has a date the guest actually chose.
 *
 * `event_date` is NOT NULL, so a booking taken without a date is stored with the day it was
 * created, at 12:00. Callers also hand these templates the words "Date to be confirmed" in place
 * of a date, which is not a date either (review PB-1, PB-21).
 */
function hasFirmDate(booking: {
  event_date?: string | null;
  date_tbd?: boolean | null;
  internal_notes?: string | null;
}): boolean {
  if (!booking.event_date) return false;
  if (isBookingDateTbd(booking)) return false;
  return Number.isFinite(new Date(booking.event_date).getTime());
}

/** "7:30pm to 12:30am (the next day)", so an overnight end time is not read as the same evening. */
function formatTimeRange(booking: {
  start_time?: string | null;
  end_time?: string | null;
  end_time_next_day?: boolean | null;
}): string | null {
  if (!booking.start_time) return null;
  const start = formatTime(booking.start_time);
  if (!booking.end_time) return `From ${start}`;
  const end = formatTime(booking.end_time);
  return booking.end_time_next_day ? `${start} to ${end} (the next day)` : `${start} to ${end}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="font-family: ${FONT_FAMILY}; padding: 8px 12px 8px 0; border-bottom: 1px solid #eeeeee; color: #666666; vertical-align: top;">${label}</td>
      <td style="font-family: ${FONT_FAMILY}; padding: 8px 0; border-bottom: 1px solid #eeeeee; vertical-align: top; word-break: break-word;">${value}</td>
    </tr>`;
}

/** The rows of a detail table, built once so the HTML and the text part can never disagree. */
type DetailRow = [label: string, value: string];

function rowsHtml(rows: DetailRow[]): string {
  return rows.map(([label, value]) => row(escapeHtml(label), escapeHtml(value))).join('');
}

function rowsText(rows: DetailRow[]): string[] {
  return rows.map(([label, value]) => `${label}: ${value}`);
}

/**
 * The plain-text part of a legacy private booking email.
 *
 * `sendEmail` derives one from the HTML when a caller passes none, but a table-based email derives
 * badly: `</td>` is not a block end, so "Event" and "Birthday party" run together. These are
 * written out instead.
 */
function legacyEmailText(input: {
  heading: string;
  firstName: string;
  paragraphs: string[];
  rows?: DetailRow[];
  links?: Array<[label: string, url: string]>;
  notes?: string[];
}): string {
  return [
    input.heading,
    '',
    `Hi ${input.firstName},`,
    '',
    ...input.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(input.rows && input.rows.length > 0 ? [...rowsText(input.rows), ''] : []),
    ...(input.links ?? []).flatMap(([label, url]) => [`${label}: ${url}`, '']),
    ...(input.notes ?? []).flatMap((note) => [note, '']),
    'Kind regards,',
    'The Anchor Events Team',
    'Orange Jelly Limited, trading as The Anchor',
    '',
    VENUE_ADDRESS,
    `How we use your data: ${PRIVACY_NOTICE_URL}`,
    'Questions or complaints: manager@the-anchor.pub or write to us at the address above.',
  ].join('\n');
}

/**
 * Whether there is a deposit being held as a separate booking and damage deposit, and so something
 * to refund after the event.
 *
 * False for a waived deposit, one never paid, and one applied to the booking's invoice
 * (`invoice_deposit_treatment = 'deducted'`), where the contract says it is not a refundable bond
 * and `refundActions` blocks refunding it.
 */
function isDepositHeldSeparately(booking: {
  deposit_amount?: number | string | null;
  deposit_paid_date?: string | null;
  invoice_deposit_treatment?: string | null;
}): boolean {
  if (!booking.deposit_paid_date) return false;
  if (booking.invoice_deposit_treatment === 'deducted') return false;
  const amount = Number(booking.deposit_amount ?? 0);
  return Number.isFinite(amount) && amount > 0;
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
 * Send the confirmation email when a booking status changes to 'confirmed'.
 *
 * The copy follows the deposit, not the status change. This email used to call every confirmation
 * a "Provisional Booking Hold" that "is not confirmed until we receive your deposit", which was
 * sent to guests whose deposit was already paid or had been waived to zero (review PB-3): a guest
 * who had paid £250 on the Thursday was asked for it again on the Friday.
 *
 * Fire-and-forget: never throws; errors are logged only.
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
  end_time_next_day?: boolean | null;
  guest_count?: number | null;
  deposit_amount?: number | null;
  total_amount?: number | null;
  hold_expiry?: string | null;
  deposit_paid_date?: string | null;
  deposit_waived?: boolean | null;
  date_tbd?: boolean | null;
  internal_notes?: string | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    // A booking with no date yet holds the placeholder it was created with (review PB-1).
    const dateKnown = hasFirmDate(booking);
    const dateFormatted = dateKnown ? formatDate(booking.event_date) : 'Date to be confirmed';
    const depositState = resolveConfirmationDepositState(booking);
    const depositAmount = Number(booking.deposit_amount ?? 0);
    const totalAmount = Number(booking.total_amount ?? 0);
    // Only assert a concrete deposit deadline while it is still a live deadline: a past expiry, or
    // a deposit already paid, would state something untrue. With no deadline the email says
    // nothing about one, rather than pointing at "the hold expiry date we've given you", which a
    // website enquiry was never given (review PB-13).
    const holdExpiryIsLive =
      Boolean(booking.hold_expiry) &&
      depositState === 'due' &&
      new Date(booking.hold_expiry as string).getTime() > Date.now();
    const holdExpiryFormatted = holdExpiryIsLive ? formatDate(booking.hold_expiry as string) : null;
    const paymentLink = depositState === 'due' ? buildPrivateBookingPortalUrl(booking.id) : null;

    const heading = depositState === 'due' ? 'Provisional booking hold' : 'Booking confirmed';
    const subject =
      depositState === 'due'
        ? `Provisional booking hold: ${eventLabel} on ${dateFormatted}`
        : `Booking confirmed: ${eventLabel} on ${dateFormatted}`;

    const paragraphs =
      depositState === 'due'
        ? [
            'We have placed a provisional hold for your event at The Anchor.',
            'Your date is on temporary hold. The hold is provisional only, and your booking is not confirmed until we receive your deposit in cleared funds.',
          ]
        : depositState === 'paid'
          ? [
              'We have received your deposit, so your booking at The Anchor is confirmed.',
              "We'll be in touch closer to the date with final details.",
            ]
          : [
              'Your booking at The Anchor is confirmed. There is no deposit to pay on this booking.',
              "We'll be in touch closer to the date with final details.",
            ];

    // No date means no time either: the stored 12:00 was never chosen (review PB-21).
    const timeRange = dateKnown ? formatTimeRange(booking) : null;
    const rows: DetailRow[] = [['Event', eventLabel], ['Date', dateFormatted]];
    if (timeRange) rows.push(['Time', timeRange]);
    if (booking.guest_count != null) rows.push(['Guests', String(booking.guest_count)]);
    if (depositState === 'due' && depositAmount > 0) rows.push(['Deposit due', formatCurrency(depositAmount)]);
    if (holdExpiryFormatted) rows.push(['Deposit due by', holdExpiryFormatted]);
    if (depositState === 'paid' && depositAmount > 0) rows.push(['Deposit paid', formatCurrency(depositAmount)]);
    // One row, not two: "Total event cost" and "Event balance due" printed the same figure twice.
    if (totalAmount > 0) rows.push(['Total event cost', formatCurrency(totalAmount)]);

    const notes: string[] = [];
    if (depositState === 'due') {
      if (holdExpiryFormatted) {
        notes.push(`Unless we agree otherwise in writing, the hold may be released if the deposit is not received in cleared funds by ${holdExpiryFormatted}.`);
      }
      notes.push('Paying the deposit confirms that you accept the booking terms and conditions set out in your contract, including the cancellation and refund policy.');
    }
    if (depositState !== 'none') notes.push(DEPOSIT_TERMS_NOTE);
    if (totalAmount > 0) notes.push('Your event balance is separate from the deposit and payable nearer the time.');

    const buttonHtml = paymentLink
      ? `
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${escapeHtml(paymentLink)}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 12px 24px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold;">Open your booking and pay the deposit</a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Or copy this link into your browser:<br><a href="${escapeHtml(paymentLink)}" style="color: #1a1a1a; word-break: break-all;">${escapeHtml(paymentLink)}</a></p>`
      : '';

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(depositState === 'due' ? `Your date is held. ${depositAmount > 0 ? formatCurrency(depositAmount) : 'The'} deposit confirms it.` : `Your booking on ${dateFormatted} is confirmed.`)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rowsHtml(rows)}
  </table>${buttonHtml}
  ${notes.map((note) => `<p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">${escapeHtml(note)}</p>`).join('\n  ')}
  <p style="font-family: ${FONT_FAMILY};">If you have any questions, please get in touch.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const text = legacyEmailText({
      heading,
      firstName,
      paragraphs,
      rows,
      links: paymentLink ? [['Open your booking and pay the deposit', paymentLink]] : [],
      notes: [...notes, 'If you have any questions, please get in touch.'],
    });

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      text,
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
 * Send the deposit received email (booking and damage deposit).
 *
 * `bookingConfirmed` is false when the SOP gate has held the booking back as a draft needing GM
 * approval, a space conflict resolving or a capacity check: the deposit has still been taken, so
 * the receipt goes, but the email must not say the booking is confirmed (review PB-2).
 *
 * Fire-and-forget: never throws; errors are logged only.
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
  end_time_next_day?: boolean | null;
  guest_count?: number | null;
  deposit_amount?: number | null;
  deposit_payment_method?: string | null;
  balance_due_date?: string | null;
  total_amount?: number | null;
  bookingConfirmed?: boolean;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const confirmed = booking.bookingConfirmed !== false;
    const eventLabel = booking.event_type || 'your event';
    const dateKnown = hasFirmDate(booking);
    const dateFormatted = dateKnown ? formatDate(booking.event_date) : 'Date to be confirmed';
    const heading = 'Deposit received';
    const subject = confirmed
      ? `Deposit received, booking confirmed: ${eventLabel} on ${dateFormatted}`
      : `Deposit received: ${eventLabel} on ${dateFormatted}`;

    const depositAmount = Number(booking.deposit_amount ?? 0);
    const totalAmount = Number(booking.total_amount ?? 0);
    const timeRange = dateKnown ? formatTimeRange(booking) : null;
    const balanceDueDate = booking.balance_due_date
      ? formatDate(booking.balance_due_date)
      : null;

    const paragraphs = [
      'Thank you. We have received your deposit.',
      confirmed
        ? 'Your private event booking at The Anchor is confirmed.'
        : "We're just finishing our checks on this booking, and we'll confirm it shortly.",
      "We'll be in touch closer to the date with final details.",
    ];

    const rows: DetailRow[] = [['Event', eventLabel], ['Date', dateFormatted]];
    if (timeRange) rows.push(['Time', timeRange]);
    if (booking.guest_count != null) rows.push(['Guests', String(booking.guest_count)]);
    if (depositAmount > 0) rows.push(['Deposit paid', formatCurrency(depositAmount)]);
    // Zero is not a price: a deposit taken to secure a date before anything is priced left this
    // email reading "Total event cost £0.00, Event balance due £0.00" (review PB-7).
    if (totalAmount > 0) rows.push(['Total event cost', formatCurrency(totalAmount)]);
    if (balanceDueDate) rows.push(['Balance and final guest numbers due', balanceDueDate]);

    const notes = [
      DEPOSIT_TERMS_NOTE,
      'We refund it within 48 hours after the event, once all charges have been settled.',
      'Your event balance is separate from the deposit and cannot be paid with it. It is payable by the date above.',
      'Our full cancellation, refund and date-change policy is set out in your contract. Date changes are subject to availability and must be requested at least 14 calendar days before the event, so please tell us as early as you can.',
    ];

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(confirmed ? `Your deposit is in and your booking on ${dateFormatted} is confirmed.` : 'Your deposit is in. We will confirm your booking shortly.')}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rowsHtml(rows)}
  </table>
  ${notes.map((note) => `<p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">${escapeHtml(note)}</p>`).join('\n  ')}
  <p style="font-family: ${FONT_FAMILY};">If you have any questions in the meantime, please get in touch.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const text = legacyEmailText({
      heading,
      firstName,
      paragraphs,
      rows,
      notes: [...notes, 'If you have any questions in the meantime, please get in touch.'],
    });

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      text,
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
 *
 * The deposit row and the refund promise appear only when a deposit was actually received and is
 * being held. This email promised "your deposit ... will be refunded within 48 hours after the
 * event" to guests whose deposit was waived, never paid, or applied to their invoice, where the
 * contract says it is not a refundable bond and the refund route is blocked (review PB-8).
 *
 * Fire-and-forget: never throws; errors are logged only.
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
  deposit_paid_date?: string | null;
  invoice_deposit_treatment?: string | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = hasFirmDate(booking) ? formatDate(booking.event_date) : 'Date to be confirmed';
    const heading = 'Payment complete';
    const subject = `Payment complete: ${eventLabel} on ${dateFormatted}`;

    const totalAmount = Number(booking.total_amount ?? 0);
    const depositHeld = isDepositHeldSeparately(booking);
    const depositAmount = Number(booking.deposit_amount ?? 0);

    const paragraphs = [
      `Thank you. We have received your event balance payment, so your booking for ${eventLabel} on ${dateFormatted} is fully paid.`,
      'Everything is all set. We are looking forward to welcoming you and your guests to The Anchor.',
    ];

    const rows: DetailRow[] = [['Event', eventLabel], ['Date', dateFormatted]];
    if (totalAmount > 0) rows.push(['Event balance paid', formatCurrency(totalAmount)]);
    if (depositHeld) rows.push(['Deposit held', formatCurrency(depositAmount)]);

    const notes = depositHeld
      ? [DEPOSIT_TERMS_NOTE, 'We refund it within 48 hours after the event, once all charges have been settled.']
      : [];

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(`Your balance is paid in full for ${dateFormatted}.`)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rowsHtml(rows)}
  </table>
  ${notes.map((note) => `<p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">${escapeHtml(note)}</p>`).join('\n  ')}
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const text = legacyEmailText({ heading, firstName, paragraphs, rows, notes });

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      text,
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

/** What happened to a calendar invite, so a staff action can say so rather than assume it went. */
export type CalendarInviteSendResult =
  | { sent: true }
  | { sent: false; reason: 'no_email' | 'date_to_be_confirmed'; error?: undefined }
  | { sent: false; reason: 'send_failed'; error: string };

/**
 * Send a calendar invite (.ics attachment) for a confirmed private booking.
 *
 * Never throws, and never invents a date: a booking whose date is still to be confirmed gets no
 * invite, because `event_date` then holds the placeholder the booking was created with, and the
 * guest's calendar would gain a real event on the day they enquired (review PB-1). Google Calendar
 * sync already skips these bookings for the same reason.
 *
 * Returns what happened so a staff-initiated resend can report it (review PB-11).
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
  status?: string | null;
  date_tbd?: boolean | null;
  internal_notes?: string | null;
  updated_at?: string | null;
}): Promise<CalendarInviteSendResult> {
  if (!booking.contact_email) return { sent: false, reason: 'no_email' };

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const heading = 'Your calendar invite';

    const ics = generateBookingCalendarInvite(booking, {
      sequence: bookingCalendarInviteSequence(booking.updated_at),
    });
    if (!ics) return { sent: false, reason: 'date_to_be_confirmed' };

    const paragraphs = [
      `Your calendar invite is attached for ${eventLabel} on ${dateFormatted}.`,
      'Open the attached file to add the event to your calendar.',
      'If you have any questions, please get in touch.',
    ];

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(`Add ${eventLabel} on ${dateFormatted} to your calendar.`)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject: `Your event at The Anchor: ${dateFormatted}`,
      html,
      text: legacyEmailText({ heading, firstName, paragraphs }),
      attachments: [
        {
          name: 'booking.ics',
          content: Buffer.from(ics),
          // PUBLISH, not REQUEST: an invite with no ATTENDEE is not a meeting request, and clients
          // showed guests RSVP buttons that replied to a mailbox nobody reads (review PB-12).
          contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
        },
      ],
      ...privateBookingEmailLog(booking, 'private_booking_calendar_invite'),
    });

    if (!result.success) {
      logger.error('Private booking calendar invite email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
      return { sent: false, reason: 'send_failed', error: result.error || 'Unknown email error' };
    }
    return { sent: true };
  } catch (e) {
    logger.error('Unexpected error sending booking calendar invite', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
    return { sent: false, reason: 'send_failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/** What happened to a guest email a member of staff pressed a button to send. */
export type StaffEmailSendResult = { sent: true } | { sent: false; error: string };

/**
 * Send a deposit payment link email with a PayPal "Pay now" button.
 *
 * Returns the outcome rather than swallowing it: this used to log a failure and return nothing, so
 * the action reported success and staff were told "Payment link sent to customer" while the guest
 * had no link and the hold went on running down (review PB-11).
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
  date_tbd?: boolean | null;
  internal_notes?: string | null;
}, paypalApproveUrl: string, freshLinkUrl?: string): Promise<StaffEmailSendResult> {
  if (!booking.contact_email) return { sent: false, error: 'This booking has no contact email address' };

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your private event';
    // A booking with no date yet holds the placeholder date it was created with, so the words go
    // in its place rather than a day the guest never chose (review PB-1).
    const dateFormatted = isBookingDateTbd(booking) ? 'Date to be confirmed' : formatDate(booking.event_date);
    const forBooking = isBookingDateTbd(booking)
      ? `your booking for ${eventLabel} (date to be confirmed)`
      : `your booking for ${eventLabel} on ${dateFormatted}`;
    const depositAmount = Number(booking.deposit_amount ?? 0);
    const depositFormatted = depositAmount > 0 ? formatCurrency(depositAmount) : null;
    const heading = 'Deposit payment';
    const subject = `Deposit payment: ${eventLabel} on ${dateFormatted}`;

    const paragraphs = [
      depositFormatted
        ? `To secure ${forBooking}, please pay your deposit of ${depositFormatted} using the button below.`
        : `To secure ${forBooking}, please pay your deposit using the button below.`,
      "Your booking is confirmed once we've received your deposit, and the deposit is separate from your event balance, which is payable nearer the time.",
      'If you cancel 30 days or more before the event, your deposit is refunded less a 5% administration deduction and any costs already incurred. If you cancel less than 30 days before the event, we may retain up to the full deposit to cover reasonable losses and committed costs, and we will not retain more than is reasonable in the circumstances.',
      'Paying the deposit confirms that you accept the booking terms and conditions set out in your contract.',
    ];

    const freshLinkHtml = freshLinkUrl
      ? `
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">PayPal payment links usually expire 6 hours after this email is sent. If the PayPal button no longer works, open your secure booking page below and choose Pay deposit via PayPal.</p>
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${escapeHtml(freshLinkUrl)}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 12px 24px; background-color: #f3f4f6; color: #1f2937; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">Open your booking and pay</a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Secure booking page:<br><a href="${escapeHtml(freshLinkUrl)}" style="font-family: ${FONT_FAMILY}; color: #0070ba; word-break: break-all;">${escapeHtml(freshLinkUrl)}</a></p>`
      : `
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">PayPal payment links usually expire 6 hours after this email is sent. If the PayPal button no longer works, please contact us and we can send a fresh payment link.</p>`;

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(depositFormatted ? `Pay your ${depositFormatted} deposit to secure the date.` : 'Pay your deposit to secure the date.')}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${escapeHtml(paypalApproveUrl)}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 12px 24px; background-color: #0070ba; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">Pay deposit via PayPal</a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Or copy this link into your browser:<br><a href="${escapeHtml(paypalApproveUrl)}" style="font-family: ${FONT_FAMILY}; color: #0070ba; word-break: break-all;">${escapeHtml(paypalApproveUrl)}</a></p>
  ${freshLinkHtml}
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">${escapeHtml(DEPOSIT_TERMS_NOTE)}</p>
  <p style="font-family: ${FONT_FAMILY};">If you have any questions about your booking, please get in touch.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const text = legacyEmailText({
      heading,
      firstName,
      paragraphs,
      rows: depositFormatted ? [['Deposit', depositFormatted], ['Date', dateFormatted]] : [['Date', dateFormatted]],
      links: [
        ['Pay deposit via PayPal', paypalApproveUrl],
        ...(freshLinkUrl ? ([['Open your booking and pay', freshLinkUrl]] as Array<[string, string]>) : []),
      ],
      notes: [
        freshLinkUrl
          ? 'PayPal payment links usually expire 6 hours after this email is sent. If the PayPal button no longer works, open your secure booking page and choose Pay deposit via PayPal.'
          : 'PayPal payment links usually expire 6 hours after this email is sent. If the PayPal button no longer works, please contact us and we can send a fresh payment link.',
        DEPOSIT_TERMS_NOTE,
        'If you have any questions about your booking, please get in touch.',
      ],
    });

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      text,
      ...privateBookingEmailLog(booking, 'private_booking_deposit_payment_link'),
    });
    if (!result.success) {
      logger.error('Deposit payment link email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
      return { sent: false, error: result.error || 'Unknown email error' };
    }
    return { sent: true };
  } catch (e) {
    logger.error('Unexpected error sending deposit payment link email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Send a deposit refund email after the event: the deposit has been returned in full.
 *
 * `total_refunded` is every completed refund on the booking, not just this payment, so a deposit
 * returned in two payments says the whole deposit is back rather than restating one part of it.
 *
 * Fire-and-forget: never throws; errors are logged only.
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
  total_refunded?: number;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const heading = 'Deposit refunded';
    const subject = `Deposit refunded: ${eventLabel} on ${dateFormatted}`;
    const totalRefunded = booking.total_refunded ?? booking.refund_amount;
    const paidInParts = totalRefunded - booking.refund_amount > 0.005;

    const paragraphs = [
      'Thank you for holding your event with us at The Anchor.',
      paidInParts
        ? `We have refunded a further ${formatCurrency(booking.refund_amount)}, so your deposit of ${formatCurrency(totalRefunded)} is now fully refunded.`
        : 'We have completed our post-event checks and your deposit has been refunded in full.',
      'It goes back to the payment method you used, where that is possible.',
    ];

    const rows: DetailRow[] = [
      ['Event', eventLabel],
      ['Date', dateFormatted],
      ...(paidInParts ? ([['This refund', formatCurrency(booking.refund_amount)]] as DetailRow[]) : []),
      ['Deposit refunded', formatCurrency(totalRefunded)],
    ];

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(`Your ${formatCurrency(totalRefunded)} deposit has been refunded.`)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rowsHtml(rows)}
  </table>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      text: legacyEmailText({ heading, firstName, paragraphs, rows }),
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
 * Send a deposit refund email where part of the deposit has been returned and part has not.
 *
 * Every figure is the position across all completed refunds on the booking. The email this
 * replaces worked out the "deductions" as the deposit minus the refund in front of it, ignoring
 * earlier refunds, so a £250 deposit returned as £100 then £150 produced two emails claiming
 * deductions of £150 and then £100 when the guest had the whole £250 back (review PB-4).
 *
 * It states no reason. The reason field staff fill in is labelled "internal only" in the refund
 * dialog, and it was going to the guest verbatim and unescaped (review PB-6), so the email offers
 * a breakdown instead and a person writes it.
 *
 * Fire-and-forget: never throws; errors are logged only.
 */
export async function sendDepositPartRefundEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  deposit_amount: number;
  /** This refund on its own. */
  refund_amount: number;
  /** Every completed refund on this booking, including this one. */
  total_refunded: number;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateFormatted = formatDate(booking.event_date);
    const heading = 'Deposit refund';
    const subject = `Deposit refund: ${eventLabel} on ${dateFormatted}`;
    const notRefunded = Math.round((booking.deposit_amount - booking.total_refunded) * 100) / 100;
    const paidInParts = booking.total_refunded - booking.refund_amount > 0.005;

    const paragraphs = [
      'Thank you for holding your event with us at The Anchor.',
      paidInParts
        ? `We have refunded a further ${formatCurrency(booking.refund_amount)} of your ${formatCurrency(booking.deposit_amount)} booking and damage deposit, which brings the total refunded to ${formatCurrency(booking.total_refunded)}.`
        : `Following our post-event checks, we have refunded ${formatCurrency(booking.refund_amount)} of your ${formatCurrency(booking.deposit_amount)} booking and damage deposit.`,
      notRefunded > 0
        ? `${formatCurrency(notRefunded)} has been held back under the booking terms. Just ask and we will send you a breakdown.`
        : 'Just ask and we will send you a breakdown.',
    ];

    const rows: DetailRow[] = [
      ['Event', eventLabel],
      ['Date', dateFormatted],
      ['Deposit paid', formatCurrency(booking.deposit_amount)],
      ...(paidInParts ? ([['This refund', formatCurrency(booking.refund_amount)]] as DetailRow[]) : []),
      ['Refunded', formatCurrency(booking.total_refunded)],
      ...(notRefunded > 0 ? ([['Held back', formatCurrency(notRefunded)]] as DetailRow[]) : []),
    ];

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(`${formatCurrency(booking.total_refunded)} of your deposit has been refunded.`)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rowsHtml(rows)}
  </table>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      text: legacyEmailText({ heading, firstName, paragraphs, rows }),
      ...privateBookingEmailLog(booking, 'private_booking_deposit_refund_deductions'),
    });
    if (!result.success) {
      logger.error('Deposit part refund email send failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending deposit part refund email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
  }
}

/**
 * Send a cancellation confirmation email with the refund or retention outcome (SOP §14.9), sent
 * alongside the cancellation text so email-only customers are not left uninformed.
 *
 * The copy follows `variant`, the same variant the text uses, not the financial outcome.
 * `gm_review_required` is the outcome both before and after a manager has decided the retention,
 * so keying on it meant a guest whose manager had decided to keep £100 of £250 was emailed "we're
 * reviewing the payments on your booking", and nothing afterwards told them (review PB-5).
 *
 * Fire-and-forget: never throws.
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
  /** The cancellation administration deduction, for the 30-days-or-more variant. */
  deduction_amount?: number;
  retention_reason?: string | null;
  variant: PrivateBookingCancellationVariant;
  date_tbd?: boolean | null;
  internal_notes?: string | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    // No date yet means the stored date is the placeholder from the day the enquiry arrived, so
    // the email never prints it (review PB-1).
    const dateTbd = isBookingDateTbd(booking);
    const dateFormatted = dateTbd ? 'Date to be confirmed' : formatDate(booking.event_date);
    const isHold = booking.variant === 'private_booking_cancelled_hold';
    const thing = isHold ? 'hold' : 'booking';
    const forEvent = dateTbd
      ? `Your ${thing} for ${eventLabel} (date to be confirmed)`
      : `Your ${thing} for ${eventLabel} on ${dateFormatted}`;

    const heading = isHold ? 'Your hold is cancelled' : 'Your booking is cancelled';
    const subject = isHold
      ? `Your hold at The Anchor is cancelled: ${eventLabel}`
      : `Your booking at The Anchor is cancelled: ${eventLabel}`;

    const paragraphs: string[] = [`${forEvent} has been cancelled.`];
    const rows: DetailRow[] = [['Event', eventLabel], ['Date', dateFormatted]];

    switch (booking.variant) {
      case 'private_booking_cancelled_hold':
        paragraphs.push('No money changed hands, so there is nothing to refund.');
        paragraphs.push("Just get in touch if you'd like another date.");
        break;
      case 'private_booking_cancelled_refundable':
        paragraphs.push(`We will refund ${formatCurrency(booking.refund_amount)} within 10 working days, back to the payment method you used where possible.`);
        rows.push(['Refund', formatCurrency(booking.refund_amount)]);
        break;
      case 'private_booking_cancelled_partial_refund': {
        const deduction = booking.deduction_amount ?? 0;
        if (deduction > 0) {
          paragraphs.push(`Your deposit will be refunded less the ${formatCurrency(deduction)} cancellation administration deduction.`);
          rows.push(['Cancellation administration deduction', formatCurrency(deduction)]);
        }
        paragraphs.push(`We will refund ${formatCurrency(booking.refund_amount)} within 10 working days.`);
        rows.push(['Refund', formatCurrency(booking.refund_amount)]);
        break;
      }
      case 'private_booking_cancelled_retention':
        paragraphs.push(`Following review, ${formatCurrency(booking.retained_amount)} of your deposit has been retained to cover costs from the cancellation.`);
        if (booking.refund_amount > 0) {
          paragraphs.push(`${formatCurrency(booking.refund_amount)} will be refunded within 10 working days.`);
        }
        paragraphs.push('We will send a breakdown on request.');
        rows.push(['Deposit retained', formatCurrency(booking.retained_amount)]);
        if (booking.retention_reason) rows.push(['Reason', booking.retention_reason]);
        if (booking.refund_amount > 0) rows.push(['Refund', formatCurrency(booking.refund_amount)]);
        break;
      case 'private_booking_cancelled_review_pending':
        paragraphs.push("We're reviewing payments and your deposit, and will confirm any refund shortly.");
        break;
      case 'private_booking_cancelled_manual_review':
      default:
        paragraphs.push('A member of our team will be in touch shortly to confirm next steps on payment.');
        break;
    }

    const closing = "If anything here doesn't look right, please call us on 01753 682707 or email manager@the-anchor.pub.";

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(`${forEvent} has been cancelled.`)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rowsHtml(rows)}
  </table>
  <p style="font-family: ${FONT_FAMILY};">If anything here doesn't look right, please call us on <a href="tel:+441753682707" style="color: #1a1a1a;">01753 682707</a> or email <a href="mailto:manager@the-anchor.pub" style="color: #1a1a1a;">manager@the-anchor.pub</a>.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    // The .ics that takes the event out of the guest's calendar, for a booking that had one.
    const cancelInvite = isHold ? null : buildCalendarCancellation({ ...booking, event_date: booking.event_date });

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      text: legacyEmailText({ heading, firstName, paragraphs, rows, notes: [closing] }),
      ...(cancelInvite ? { attachments: [cancelInvite] } : {}),
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
  date_tbd?: boolean | null;
  internal_notes?: string | null;
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
  // The attached contract already prints "Date to be confirmed" for a booking with no date; this
  // email printed the placeholder date instead, so the two disagreed (review PB-1).
  const dateTbd = isBookingDateTbd(booking);
  const dateFormatted = dateTbd ? 'Date to be confirmed' : formatDate(booking.event_date);
  const forEvent = dateTbd ? `${eventLabel} (date to be confirmed)` : `${eventLabel} on ${dateFormatted}`;
  const heading = 'Your booking contract';
  const subject = `Your booking contract: ${eventLabel} on ${dateFormatted}`;

  // Three cases, because asking someone to pay a deposit they have already paid
  // reads as though we have lost their money. `deposit_paid_date` is the record
  // of receipt, so it decides the wording rather than the amount alone.
  const hasDeposit = Boolean(booking.deposit_amount && booking.deposit_amount > 0);
  const depositPaidOn = booking.deposit_paid_date ? formatDate(booking.deposit_paid_date) : null;

  const depositLine = !hasDeposit
    ? 'Please have a read and let us know you are happy with everything. We are glad to answer any questions.'
    : depositPaidOn
      ? `We received your ${formatCurrency(booking.deposit_amount!)} booking and damage deposit on ${depositPaidOn}, so there is nothing to pay to hold your date. Paying it confirmed that you accept these terms, so please do have a read, and ask us anything that is not clear.`
      : `Paying the ${formatCurrency(booking.deposit_amount!)} booking and damage deposit confirms that you accept these terms, so please do have a read first, and ask us anything that is not clear.`;

  const paragraphs = [`Attached is the contract and terms for ${forEvent}.`, depositLine];

  const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(`The contract and terms for ${forEvent} are attached.`)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

  const result = await sendEmail({
    to: booking.contact_email,
    subject,
    html,
    text: legacyEmailText({ heading, firstName, paragraphs }),
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

/**
 * Confirm to the guest that a refund on a cancelled booking has been sent.
 *
 * The cancellation email tells them "we'll refund £150 within 10 working days and confirm once
 * it's on the way", and nothing kept that promise: the post-event refund email only ever went to
 * completed bookings, and a cash or bank transfer refund sent nothing at all (review PB-BR-4). It
 * also replaces the generic refund confirmation, which had no contact details, addressed the
 * guest by their full booking name and was logged against no booking (review PB-19).
 *
 * Fire-and-forget: never throws; errors are logged only.
 */
export async function sendPrivateBookingRefundSentEmail(booking: {
  id: string;
  customer_id?: string | null;
  contact_email?: string | null;
  customer_first_name?: string | null;
  customer_name?: string | null;
  event_date: string;
  event_type?: string | null;
  refund_amount: number;
  /** 'paypal' goes back to the card or PayPal balance; cash and bank transfer do not. */
  refund_method?: string | null;
  date_tbd?: boolean | null;
  internal_notes?: string | null;
}): Promise<void> {
  if (!booking.contact_email) return;

  try {
    const firstName =
      booking.customer_first_name ||
      booking.customer_name?.split(' ')[0] ||
      'there';

    const eventLabel = booking.event_type || 'your event';
    const dateTbd = isBookingDateTbd(booking);
    const dateFormatted = dateTbd ? 'Date to be confirmed' : formatDate(booking.event_date);
    const heading = 'Your refund is on its way';
    const subject = `Refund sent: ${eventLabel} on ${dateFormatted}`;
    const amount = formatCurrency(booking.refund_amount);

    const paragraphs = [
      `We have sent your ${amount} refund for the cancelled booking${dateTbd ? '' : ` on ${dateFormatted}`}.`,
      booking.refund_method === 'paypal'
        ? 'It goes back to the payment method you used. Allow up to 10 working days for it to appear.'
        : 'Allow up to 10 working days for it to reach you.',
    ];

    const rows: DetailRow[] = [
      ['Event', eventLabel],
      ['Date', dateFormatted],
      ['Refund sent', amount],
    ];

    const closing = 'If it has not arrived by then, please call us on 01753 682707 or email manager@the-anchor.pub.';

    const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(`Your ${amount} refund has been sent.`)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${heading}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(firstName)},</p>
  ${paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rowsHtml(rows)}
  </table>
  <p style="font-family: ${FONT_FAMILY};">If it has not arrived by then, please call us on <a href="tel:+441753682707" style="color: #1a1a1a;">01753 682707</a> or email <a href="mailto:manager@the-anchor.pub" style="color: #1a1a1a;">manager@the-anchor.pub</a>.</p>
  <p style="font-family: ${FONT_FAMILY}; margin-bottom: 0;">Kind regards,<br><strong>The Anchor Events Team</strong><br><span style="color: #666666;">Orange Jelly Limited, trading as The Anchor</span></p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eeeeee;">
  ${EMAIL_FOOTER_HTML}
</div>`;

    const result = await sendEmail({
      to: booking.contact_email,
      subject,
      html,
      text: legacyEmailText({ heading, firstName, paragraphs, rows, notes: [closing] }),
      ...privateBookingEmailLog(booking, 'private_booking_refund_sent'),
    });
    if (!result.success) {
      logger.error('Private booking refund sent email failed', {
        error: new Error(result.error || 'Unknown email error'),
        metadata: { bookingId: booking.id },
      });
    }
  } catch (e) {
    logger.error('Unexpected error sending private booking refund sent email', {
      error: e instanceof Error ? e : new Error(String(e)),
      metadata: { bookingId: booking.id },
    });
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
  /** Files the message carries, such as the .ics that cancels the guest's calendar entry. */
  attachments?: Array<{ name: string; content: Buffer; contentType: string }>;
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
  /** The line a mail client shows beside the subject. The first paragraph when not given. */
  preheader?: string;
  /** The message itself, as plain sentences. */
  paragraphs: string[];
  /** Facts particular to this message, shown after the booking's own details. */
  rows?: Array<[string, string]>;
  link?: { label: string; url: string };
  /** Smaller print under the table. */
  notes?: string[];
  /** Further titled tables after the main one, such as the payments already made. */
  sections?: Array<{ heading: string; rows: Array<[string, string]> }>;
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

  const sections = spec.sections ?? [];
  const sectionsHtml = sections
    .map(
      (section) => `
  <h3 style="font-family: ${FONT_FAMILY}; margin: 24px 0 0 0; font-size: 16px; color: #1a1a1a;">${escapeHtml(section.heading)}</h3>
  <table style="width: 100%; border-collapse: collapse; margin: 8px 0 20px 0;">
    ${section.rows.map(([label, value]) => row(escapeHtml(label), escapeHtml(value))).join('')}
  </table>`
    )
    .join('');

  const linkHtml = spec.link
    ? `
  <p style="font-family: ${FONT_FAMILY};">
    <a href="${escapeHtml(spec.link.url)}" style="font-family: ${FONT_FAMILY}; display: inline-block; padding: 12px 24px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: bold;">${escapeHtml(spec.link.label)}</a>
  </p>
  <p style="font-family: ${FONT_FAMILY}; font-size: 13px; color: #666666;">Or copy this link into your browser:<br><a href="${escapeHtml(spec.link.url)}" style="color: #1a1a1a; word-break: break-all;">${escapeHtml(spec.link.url)}</a></p>`
    : '';

  const html = `
<div style="${EMAIL_CONTAINER_STYLE}">
  ${preheader(spec.preheader ?? spec.paragraphs[0] ?? spec.heading)}
  <h2 style="font-family: ${FONT_FAMILY}; margin-top: 0; color: #1a1a1a;">${escapeHtml(spec.heading)}</h2>
  <p style="font-family: ${FONT_FAMILY};">Hi ${escapeHtml(name)},</p>
  ${spec.paragraphs.map((paragraph) => `<p style="font-family: ${FONT_FAMILY};">${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    ${rows.map(([label, value]) => row(escapeHtml(label), escapeHtml(value))).join('')}
  </table>${sectionsHtml}${linkHtml}
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
    ...sections.flatMap((section) => [section.heading, ...section.rows.map(([label, value]) => `${label}: ${value}`), '']),
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

/**
 * The guest's booking page, where one button pays the deposit by PayPal.
 *
 * Resolved from the booking when the caller passes nothing, because the emails that ask for the
 * deposit gave no way to pay it (review PB-BR-2) and one of their senders, the monitor cron, has
 * only the booking row to hand. Pass `null` to leave the button out on purpose.
 */
function resolvePaymentLink(bookingId: string, provided: string | null | undefined): string | null {
  return provided !== undefined ? provided : buildPrivateBookingPortalUrl(bookingId);
}

/** "Pay the deposit by PayPal", the label the guest's booking page uses for the same button. */
const PAY_DEPOSIT_LINK_LABEL = 'Pay the deposit by PayPal';

/** Mirrors privateBookingCreatedMessage. */
export function buildPrivateBookingCreatedEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  depositAmount: number;
  /** The hold expiry exactly as the text prints it, or null when there is none. */
  holdExpiry: string | null;
  /** The guest's booking page. Resolved from the booking when not given. */
  paymentLink?: string | null;
}): PrivateBookingEmailContent {
  const secures = input.holdExpiry
    ? `A ${money(input.depositAmount)} deposit secures it by ${input.holdExpiry}.`
    : `A ${money(input.depositAmount)} deposit secures it.`;
  const paymentLink = resolvePaymentLink(input.booking.id, input.paymentLink);
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    // No date yet means no date in the subject: "pencilled in: Date to be confirmed" read as a
    // mistake rather than as a state (review PB-BR-5).
    subject: isDateOnly(input.booking)
      ? 'Your date at The Anchor is pencilled in'
      : `Your date at The Anchor is pencilled in: ${formatPrivateBookingEventDate(input.booking)}`,
    heading: 'Your date is pencilled in',
    paragraphs: [
      `Your date at The Anchor ${onEventDate(input.booking)} is pencilled in.`,
      secures,
      ...(paymentLink ? ['You can pay it in cash at the bar, or by PayPal using the button below.'] : []),
      "We'll be in touch with next steps.",
    ],
    rows: [
      ['Deposit to secure the date', money(input.depositAmount)],
      ...(input.holdExpiry ? ([['Deposit due by', input.holdExpiry]] as Array<[string, string]>) : []),
    ],
    ...(paymentLink ? { link: { label: PAY_DEPOSIT_LINK_LABEL, url: paymentLink } } : {}),
    notes: [DEPOSIT_TERMS_NOTE],
  });
}

/**
 * Mirrors depositRequestMessage: the deposit request Confirm deposit sends. The amount is the one
 * staff confirmed; the guest can pay in cash at the bar or by PayPal from their booking page.
 */
export function buildDepositRequestEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  depositAmount: number;
  /** The deadline exactly as the text prints it, or null when there is none. */
  holdExpiry: string | null;
  /** The guest's booking page, where one button pays the deposit by PayPal. */
  paymentLink: string;
}): PrivateBookingEmailContent {
  const deposit = money(input.depositAmount);
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: input.holdExpiry
      ? `Your deposit for The Anchor: ${deposit} by ${input.holdExpiry}`
      : `Your deposit for The Anchor: ${deposit}`,
    heading: 'Your deposit',
    paragraphs: [
      `The deposit for your booking ${onEventDate(input.booking)} is ${deposit}.`,
      ...(input.holdExpiry ? [`Please pay it by ${input.holdExpiry}.`] : []),
      'You can pay it in cash at the bar, or by PayPal using the button below.',
    ],
    rows: [
      ['Deposit', deposit],
      ...(input.holdExpiry ? ([['Pay by', input.holdExpiry]] as Array<[string, string]>) : []),
      ['How to pay', 'Cash at the bar, or PayPal'],
    ],
    link: { label: 'Pay the deposit by PayPal', url: input.paymentLink },
    notes: [
      'The button opens your booking page, where you can pay securely by PayPal.',
      DEPOSIT_TERMS_NOTE,
      ...(input.holdExpiry
        ? [`Unless we agree otherwise in writing, the hold may be released if the deposit isn't received in cleared funds by ${input.holdExpiry}.`]
        : []),
      'Paying the deposit confirms that you accept the booking terms and conditions set out in your contract, including the cancellation and refund policy.',
    ],
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
  /** The guest's booking page. Resolved from the booking when not given. */
  paymentLink?: string | null;
}): PrivateBookingEmailContent {
  const deposit = money(input.depositAmount);
  const date = onEventDate(input.booking);
  const paymentLink = resolvePaymentLink(input.booking.id, input.paymentLink);
  let paragraphs: string[];
  let subject: string;

  if (input.stage === '7day') {
    const days = input.daysRemaining ?? 7;
    const dayWord = days === 1 ? 'day' : 'days';
    const expires = input.holdExpiry
      ? `expires in ${days} ${dayWord}, on ${input.holdExpiry}`
      : `expires in ${days} ${dayWord}`;
    subject = input.holdExpiry
      ? `Your hold at The Anchor expires on ${input.holdExpiry}`
      : `Your hold at The Anchor expires in ${days} ${dayWord}`;
    paragraphs = [`A quick nudge. Your hold ${date} ${expires}.`, `Pay the ${deposit} deposit and the date's yours.`];
  } else if (input.stage === '3day') {
    const expires = input.holdExpiry ? `expires on ${input.holdExpiry}` : 'is expiring soon';
    subject = input.holdExpiry ? `Your hold at The Anchor expires on ${input.holdExpiry}` : 'Your hold at The Anchor is expiring soon';
    paragraphs = [`Your hold ${date} ${expires}.`, `A ${deposit} deposit locks the date in before it's released.`];
  } else {
    const dated = input.holdExpiry ? ` (${input.holdExpiry})` : '';
    // The date, not just "tomorrow": a subject naming only a relative day is unreadable the
    // morning after it arrives, and read out of order it is simply wrong (review PB-BR-1).
    subject = input.holdExpiry
      ? `Your hold at The Anchor expires tomorrow, ${input.holdExpiry}`
      : 'Your hold at The Anchor expires tomorrow';
    paragraphs = [`Your hold ${date} expires tomorrow${dated}.`, `Pay the ${deposit} deposit today and you're locked in.`];
  }

  if (paymentLink) paragraphs.push('You can pay it in cash at the bar, or by PayPal using the button below.');

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
    ...(paymentLink ? { link: { label: PAY_DEPOSIT_LINK_LABEL, url: paymentLink } } : {}),
    notes: [DEPOSIT_TERMS_NOTE],
  });
}

/** Mirrors holdExtendedMessage. */
export function buildHoldExtendedEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  newExpiryDate: string;
  /** The guest's booking page. Resolved from the booking when not given. */
  paymentLink?: string | null;
}): PrivateBookingEmailContent {
  const paymentLink = resolvePaymentLink(input.booking.id, input.paymentLink);
  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: `We've extended your hold at The Anchor to ${input.newExpiryDate}`,
    heading: 'Your hold has been extended',
    paragraphs: [
      `Good news. We've extended your hold ${onEventDate(input.booking)}.`,
      `New deadline: ${input.newExpiryDate}.`,
      ...(paymentLink ? ['You can pay the deposit in cash at the bar, or by PayPal using the button below.'] : []),
    ],
    rows: [['New deadline', input.newExpiryDate]],
    ...(paymentLink ? { link: { label: PAY_DEPOSIT_LINK_LABEL, url: paymentLink } } : {}),
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

/** "Payment by cash, £300" or "Deposit by PayPal, £250 (held separately from your bill)". */
function describeStatementEntry(entry: PaymentHistoryEntry): string {
  const paid = money(Number(entry.amount));
  const method = describePaymentMethod(entry.method);
  if (entry.type === 'balance') return `Payment by ${method}, ${paid}`;
  const applied = Number(entry.appliedAmount ?? 0);
  const treatment =
    applied <= 0
      ? 'held separately from your bill'
      : applied >= Number(entry.amount)
        ? 'put towards your bill'
        : `${money(applied)} of it put towards your bill`;
  return `Deposit by ${method}, ${paid} (${treatment})`;
}

/**
 * The money part of a balance reminder email (owner decision, 11 September 2026): each payment
 * made with its date, method and amount, then the event total, what has been paid towards the bill
 * and the balance due. Null when the statement does not agree with the balance the text states,
 * so an email never shows two different balances.
 */
function balanceStatementParts(statement: PrivateBookingPaymentStatement, balanceAmount: number): {
  rows: Array<[string, string]>;
  section: { heading: string; rows: Array<[string, string]> };
  heldDeposit: boolean;
} | null {
  if (Math.abs(statement.balanceDue - balanceAmount) > 0.005) return null;
  const paidTowardsBill = statement.paidTowardsBill > 0 ? money(statement.paidTowardsBill) : 'Nothing yet';
  const entries = statement.entries.map(
    (entry): [string, string] => [
      formatDateInLondon(entry.date, { day: 'numeric', month: 'long', year: 'numeric' }),
      describeStatementEntry(entry),
    ]
  );
  return {
    rows: [
      ['Event total', money(statement.eventTotal)],
      ['Paid towards your bill so far', paidTowardsBill],
    ],
    section: {
      heading: 'Payments received',
      rows: entries.length > 0 ? entries : [['Payments', 'None received yet']],
    },
    heldDeposit: statement.entries.some((entry) => entry.type === 'deposit' && Number(entry.appliedAmount ?? 0) <= 0),
  };
}

/** Mirrors the four balance and final-details reminders. */
export function buildBalanceReminderEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  stage: BalanceReminderStage;
  balanceAmount: number;
  /** The deadline exactly as the text prints it. */
  balanceDueDate: string;
  /**
   * The payments already made and how they add up (flag private_booking_balance_email_auto). The
   * email lists them above the balance; without it the email is as it has always been.
   */
  payments?: PrivateBookingPaymentStatement | null;
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

  const statement = input.payments ? balanceStatementParts(input.payments, input.balanceAmount) : null;

  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject,
    heading: 'Balance and final details',
    paragraphs,
    rows: [
      ...(statement ? statement.rows : []),
      ['Balance due', balance],
      ['Due by', input.balanceDueDate],
    ],
    sections: statement ? [statement.section] : [],
    notes: statement?.heldDeposit ? [DEPOSIT_TERMS_NOTE] : [],
  });
}

/** Mirrors eventReminder1DayMessage: the guest count comes from the booking, as the text's does. */
export function buildEventReminderEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
}): PrivateBookingEmailContent {
  const ready = input.booking.guest_count
    ? `Everything's ready for your ${input.booking.guest_count} ${input.booking.guest_count === 1 ? 'guest' : 'guests'}.`
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
  const content = composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: isHold ? 'Your hold at The Anchor is cancelled' : 'Your booking at The Anchor is cancelled',
    heading: isHold ? 'Your hold is cancelled' : 'Your booking is cancelled',
    paragraphs,
    rows,
  });
  const cancelInvite = isHold ? null : buildCalendarCancellation(input.booking);
  return cancelInvite ? { ...content, attachments: [cancelInvite] } : content;
}

/**
 * The .ics that takes a cancelled event out of the guest's calendar.
 *
 * Nothing used to: the invite went once with SEQUENCE 0 and was never updated or withdrawn, so a
 * cancelled booking sat in the guest's diary indefinitely (review PB-12). Null for a booking that
 * never had an invite to withdraw, which is any booking with no firm date.
 */
function buildCalendarCancellation(booking: PrivateBookingMessageEmailBooking): {
  name: string;
  content: Buffer;
  contentType: string;
} | null {
  const ics = generateBookingCalendarInvite(
    {
      id: booking.id,
      event_date: booking.event_date ?? '',
      start_time: booking.start_time ?? null,
      end_time: booking.end_time ?? null,
      end_time_next_day: booking.end_time_next_day ?? null,
      event_type: booking.event_type ?? null,
      guest_count: booking.guest_count ?? null,
      date_tbd: booking.date_tbd ?? null,
      internal_notes: booking.internal_notes ?? null,
    },
    {
      method: 'CANCEL',
      // Later than any invite already sent, so the client applies the withdrawal.
      sequence: bookingCalendarInviteSequence(new Date().toISOString()),
    }
  );
  if (!ics) return null;
  return {
    name: 'booking-cancelled.ics',
    content: Buffer.from(ics),
    contentType: 'text/calendar; charset=utf-8; method=CANCEL',
  };
}

/**
 * Mirrors depositReceivedMessage, and carries the facts of the "Booking Confirmed" email that has
 * always gone alongside it (sendDepositReceivedEmail), so one email now does both jobs.
 *
 * `bookingConfirmed` is false when the SOP gate has held the booking back: recording the deposit
 * leaves the booking a draft when a space conflict, the capacity check or an outstanding risk
 * review or GM approval blocks confirmation (`finalizeDepositPayment`). The money has still been
 * taken, so the receipt goes, but the email then says the deposit is in and we will confirm
 * shortly. It used to say "your booking at The Anchor is confirmed" and "your date is yours" to
 * every one of them, and `deriveRiskStatus` marks every booking under 30 guests as needing GM
 * approval, so any small party paying before the GM got to it was told its date was secured
 * (review PB-2; it happened to both blocked bookings in the 90 days to 11 September 2026).
 */
export function buildDepositReceivedMessageEmail(input: {
  booking: PrivateBookingMessageEmailBooking;
  firstName: string | null | undefined;
  depositAmount: number | null;
  /** VAT-inclusive total, when known. */
  totalAmount?: number | null;
  /** The balance and final-details deadline, as a date. */
  balanceDueDate?: string | null;
  /** False when the booking is still a draft because the SOP gate blocked its confirmation. */
  bookingConfirmed?: boolean;
}): PrivateBookingEmailContent {
  const confirmed = input.bookingConfirmed !== false;
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
    subject: confirmed
      ? 'Deposit received: your booking at The Anchor is confirmed'
      : 'Deposit received: we will confirm your booking shortly',
    heading: 'Deposit received',
    paragraphs: confirmed
      ? [
          'Thank you. We have received your deposit.',
          `${date} is yours, and your private event booking at The Anchor is confirmed.`,
          "We'll be in touch closer to the time.",
        ]
      : [
          'Thank you. We have received your deposit.',
          "We're just finishing our checks on this booking, and we'll confirm it shortly.",
          "We'll be in touch as soon as it is done.",
        ],
    rows,
    notes: [
      DEPOSIT_TERMS_NOTE,
      ...(dueDate ? ['Your event balance is payable separately, by the balance due date shown above.'] : []),
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
  /** The guest's booking page, for a deposit still owed. Resolved from the booking when not given. */
  paymentLink?: string | null;
}): PrivateBookingEmailContent {
  const totalRows: Array<[string, string]> =
    input.totalAmount != null && input.totalAmount > 0 ? [['Total event cost', money(input.totalAmount)]] : [];
  const dateTbd = isDateOnly(input.booking);

  if (input.depositState === 'due') {
    const now = input.now ?? new Date();
    const expiryLive = Boolean(input.holdExpiry) && Date.parse(input.holdExpiry as string) > now.getTime();
    const expiry = expiryLive
      ? formatDateInLondon(input.holdExpiry as string, { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    const paymentLink = resolvePaymentLink(input.booking.id, input.paymentLink);
    return composeMessageEmail({
      booking: input.booking,
      firstName: input.firstName,
      // The event type lives in the table below, not the subject: with a long one this ran to 79
      // characters and was cut off in the inbox list (review PB-BR-5).
      subject: dateTbd
        ? 'Provisional booking hold at The Anchor'
        : `Provisional booking hold: ${formatPrivateBookingEventDate(input.booking)}`,
      heading: 'Provisional booking hold',
      paragraphs: [
        'We have placed a provisional hold for your event at The Anchor.',
        "Your booking isn't confirmed until we receive your deposit in cleared funds.",
        ...(paymentLink ? ['You can pay it in cash at the bar, or by PayPal using the button below.'] : []),
      ],
      rows: [
        ...(input.depositAmount != null && input.depositAmount > 0 ? ([['Deposit due', money(input.depositAmount)]] as Array<[string, string]>) : []),
        ...(expiry ? ([['Deposit due by', expiry]] as Array<[string, string]>) : []),
        ...totalRows,
      ],
      ...(paymentLink ? { link: { label: PAY_DEPOSIT_LINK_LABEL, url: paymentLink } } : {}),
      notes: [
        // Only when there is a deadline. The fallback pointed at "the hold expiry date we've
        // given you", which a website enquiry was never given (review PB-13).
        ...(expiry
          ? [`Unless we agree otherwise in writing, the hold may be released if the deposit isn't received in cleared funds by ${expiry}.`]
          : []),
        'Paying the deposit confirms that you accept the booking terms and conditions set out in your contract, including the cancellation and refund policy.',
        DEPOSIT_TERMS_NOTE,
      ],
    });
  }

  return composeMessageEmail({
    booking: input.booking,
    firstName: input.firstName,
    subject: dateTbd
      ? 'Your booking at The Anchor is confirmed'
      : `Booking confirmed: ${formatPrivateBookingEventDate(input.booking)}`,
    heading: 'Booking confirmed',
    paragraphs: [
      `You're all confirmed for ${dateTbd ? 'your booking at The Anchor (date to be confirmed)' : formatPrivateBookingEventDate(input.booking)}.`,
      input.depositState === 'paid' ? 'We have received your deposit.' : 'There is no deposit to pay for this booking.',
      "We can't wait.",
    ],
    rows: totalRows,
    notes: [
      ...(input.depositState === 'paid' ? [DEPOSIT_TERMS_NOTE] : []),
      ...(totalRows.length > 0 ? ['Your event balance is payable separately, nearer the time.'] : []),
    ],
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
  /** When the deposit was received. Without it there is no deposit being held. */
  depositPaidDate?: string | null;
  /** 'deducted' means the deposit went onto the invoice, so there is nothing held to refund. */
  invoiceDepositTreatment?: string | null;
}): PrivateBookingEmailContent {
  // A "Deposit held" row went out for deposits that were waived, never paid, or applied to the
  // booking's invoice, where the contract says the money is not a refundable bond (review PB-8).
  const depositHeld = isDepositHeldSeparately({
    deposit_amount: input.depositAmount ?? null,
    deposit_paid_date: input.depositPaidDate ?? null,
    invoice_deposit_treatment: input.invoiceDepositTreatment ?? null,
  });
  const rows: Array<[string, string]> = [];
  if (input.totalAmount != null && input.totalAmount > 0) rows.push(['Event balance paid', money(input.totalAmount)]);
  if (depositHeld) rows.push(['Deposit held', money(Number(input.depositAmount))]);
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
    notes: depositHeld ? [DEPOSIT_TERMS_NOTE] : [],
  });
}
