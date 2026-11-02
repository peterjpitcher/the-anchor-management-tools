import { sendEmail, type EmailOptions } from './emailService';
import { formatDateFull, formatTime12Hour, formatTimeInLondon } from '@/lib/dateUtils';

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || 'manager@the-anchor.pub';
const BILLY_EMAIL = 'billy@orangejelly.co.uk';

function uniqueEmails(emails: string[]): string[] {
  return [...new Set(emails.map((email) => email.trim()).filter(Boolean))];
}

export interface SeparationShiftSummary {
  shiftDate: string;
  startTime: string;
  endTime: string;
  department?: string | null;
}

export interface SeparationStartedEmailInput {
  email: string;
  employeeName?: string | null;
  employmentEndDate?: string;
  todayIso: string;
  shiftPolicy: 'work_remaining' | 'release_remaining';
  remainingShifts?: SeparationShiftSummary[];
}

function firstNameFrom(employeeName?: string | null): string | null {
  return employeeName?.trim().split(/\s+/)[0] || null;
}

function formatDepartment(department?: string | null): string {
  const cleaned = department?.trim().replace(/[_-]+/g, ' ');
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatShiftLine(shift: SeparationShiftSummary): string {
  const timeRange = `${formatTime12Hour(shift.startTime)} - ${formatTime12Hour(shift.endTime)}`;
  const department = formatDepartment(shift.department);
  return `- ${formatDateFull(shift.shiftDate)}, ${timeRange}${department ? ` (${department})` : ''}`;
}

function buildLastWorkingDayText(employmentEndDate: string | undefined, todayIso: string): string {
  if (!employmentEndDate) {
    return 'We will confirm your final working day separately.';
  }

  const formattedEndDate = formatDateFull(employmentEndDate);
  if (employmentEndDate > todayIso) {
    return `Your last scheduled working day is ${formattedEndDate}.`;
  }
  if (employmentEndDate < todayIso) {
    return `Your last working day was ${formattedEndDate}.`;
  }
  return `Your last working day is today, ${formattedEndDate}.`;
}

function buildRemainingShiftsText(input: SeparationStartedEmailInput): string | null {
  if (input.shiftPolicy === 'release_remaining') {
    return 'You are not expected to attend any further scheduled shifts.';
  }

  if (!input.employmentEndDate || input.employmentEndDate <= input.todayIso) {
    return null;
  }

  const shifts = input.remainingShifts ?? [];
  if (shifts.length === 0) {
    return 'You do not currently have any remaining shifts scheduled up to and including that date.';
  }

  return [
    'You are currently scheduled for the following shifts up to and including that date:',
    ...shifts.map(formatShiftLine),
    '',
    'Please continue to attend any remaining scheduled shifts unless Billy or I confirm otherwise.',
  ].join('\n');
}

// Emails carrying an onboarding or portal link are NOT copied to the shared
// manager mailbox. Those links set the new starter's password, so anyone with
// access to that mailbox could open the link first and take over the account.
// Purely informational emails (separation, onboarding complete) still copy in.
// Every step of the onboarding form, in the order the starter meets them, and what to have ready.
// The welcome email once listed four of the six, so starters met the time off and right to work
// steps cold, and went looking for bank details halfway through.
const ONBOARDING_STEPS_TEXT =
  `The form has six parts:\n` +
  `- Personal details: your name, date of birth, address and phone numbers\n` +
  `- Time off already booked: any holidays or dates you cannot work\n` +
  `- Emergency contacts: someone we can call, with their phone number\n` +
  `- Financial details: your bank sort code and account number, and your National Insurance number if you have it to hand\n` +
  `- Health information: your GP's name and address, and a few health questions you do not have to answer\n` +
  `- Right to work: what to bring so a manager can check your documents before your first shift\n\n` +
  `Each part is saved when you press Save & Continue, so you can stop and come back to it.\n\n`;

/**
 * When a link stops working, on the London clock: "3:15pm on Friday, 6 November 2026". Read from
 * the token's own expiry rather than worked out from when it was sent, so a reminder that goes out
 * late still tells the truth.
 */
function formatLinkExpiry(expiresAtIso: string): string | null {
  const expires = new Date(expiresAtIso);
  if (Number.isNaN(expires.getTime())) return null;
  return `${formatTime12Hour(formatTimeInLondon(expires))} on ${formatDateFull(expires)}`;
}

function buildWelcomeEmail(email: string, onboardingUrl: string) {
  const subject = 'Welcome to The Anchor -- Complete Your Profile';
  const text =
    `Hi there,\n\n` +
    `Welcome to The Anchor! We're excited to have you joining the team.\n\n` +
    `To get started, please complete your employee profile using the link below. ` +
    `You'll be asked to create a password first, then to fill in the form.\n\n` +
    ONBOARDING_STEPS_TEXT +
    `Complete your profile here:\n${onboardingUrl}\n\n` +
    `This link will expire in 7 days. If you have any questions, please contact your manager.\n\n` +
    `Kind regards,\nThe Anchor Management Team`;

  return { subject, text };
}

function buildChaseEmail(email: string, onboardingUrl: string, dayNumber: number, expiresAt?: string | null) {
  const expiry = expiresAt ? formatLinkExpiry(expiresAt) : null;
  const lastReminder = dayNumber >= 6;
  const subject = lastReminder
    ? 'Last Reminder: Your Profile Link Expires Soon'
    : 'Reminder: Please Complete Your Profile';
  const expiryText = expiry
    ? lastReminder
      ? `Your link stops working at ${expiry}, so please finish before then. If it runs out, ask your manager to send you a new one.\n\n`
      : `Your link stops working at ${expiry}.\n\n`
    : '';
  const text =
    `Hi there,\n\n` +
    `This is a friendly reminder that your employee profile at The Anchor is still incomplete.\n\n` +
    `Please take a few minutes to complete your profile:\n${onboardingUrl}\n\n` +
    expiryText +
    `If you have any questions or need help, please contact your manager.\n\n` +
    `Kind regards,\nThe Anchor Management Team`;

  return { subject, text };
}

interface OnboardingCompleteTimeOffBlock {
  startDate: string;
  endDate: string;
  leaveType: string | null;
  note: string | null;
}

export interface OnboardingCompleteEmailInput {
  employeeName: string;
  employeeEmail: string;
  /** A link to their profile in the app. */
  profileUrl?: string | null;
  /** 'none' when they said nothing is booked; null when the answer could not be read. */
  timeOffAnswer: 'none' | 'has_dates' | null;
  timeOffBlocks: OnboardingCompleteTimeOffBlock[];
  /** The date of a right to work check already on their record, if there is one. */
  rightToWorkCheckedOn?: string | null;
  /** True when their right to work record could not be read, so whether a check exists is unknown. */
  rightToWorkUnknown?: boolean;
  /** Their age today when they are under 18, otherwise null. */
  ageIfUnder18?: number | null;
  /** True when their date of birth could not be read, so whether they are under 18 is unknown. */
  ageUnknown?: boolean;
}

const LEAVE_TYPE_TEXT: Record<string, string> = {
  holiday: 'holiday',
  unavailable: 'cannot work, not holiday',
};

function buildTimeOffText(input: OnboardingCompleteEmailInput): string {
  if (input.timeOffAnswer === 'none') {
    return 'Time off already booked: none. They told us they have nothing booked.';
  }
  if (input.timeOffBlocks.length === 0) {
    return 'Time off already booked: we could not read their answer. Check their holiday on their profile.';
  }
  const lines = input.timeOffBlocks.map((block) => {
    const range = block.startDate === block.endDate
      ? formatDateFull(block.startDate)
      : `${formatDateFull(block.startDate)} to ${formatDateFull(block.endDate)}`;
    const type = LEAVE_TYPE_TEXT[block.leaveType ?? ''] ?? block.leaveType ?? 'time off';
    const note = block.note?.trim() ? `: ${block.note.trim()}` : '';
    return `- ${range} (${type})${note}`;
  });
  return [
    'Time off already booked (saved as approved time off, so plan the rota around it):',
    ...lines,
  ].join('\n');
}

function buildOnboardingCompleteEmail(input: OnboardingCompleteEmailInput) {
  const { employeeName, employeeEmail } = input;
  const subject = `${employeeName} has completed their profile`;
  const rightToWorkText = input.rightToWorkCheckedOn
    ? `Right to work: a check is recorded on their profile, dated ${formatDateFull(input.rightToWorkCheckedOn)}.`
    : input.rightToWorkUnknown
      ? 'Right to work: we could not read their record. Check it on their profile before their first shift.'
      : 'Right to work: still to check. See their documents in person, or check their share code online, before their first shift.';
  const sections = [
    'Hi,',
    '',
    `${employeeName} (${employeeEmail}) has completed their employee profile and is now Active.`,
    '',
    buildTimeOffText(input),
    '',
    rightToWorkText,
    typeof input.ageIfUnder18 === 'number'
      ? `\nUnder 18: they are ${input.ageIfUnder18}. Check the rules for young workers before you put them on the rota.`
      : input.ageUnknown
        ? '\nAge: we could not check their date of birth. Check it on their profile before you put them on the rota, in case they are under 18.'
        : null,
    '',
    input.profileUrl
      ? `View their profile: ${input.profileUrl}`
      : 'You can view their profile in the employee management system.',
    '',
    'Kind regards,',
    'The Anchor Management System',
  ].filter((section): section is string => section !== null);

  return { subject, text: sections.join('\n') };
}

function buildPortalInviteEmail(email: string, onboardingUrl: string, expiresAt?: string | null) {
  const subject = 'Set Up Your Staff Portal Access -- The Anchor';
  // A reminder re-sends this email part way through the link's life, so it gives the real expiry
  // rather than "7 days".
  const expiry = expiresAt ? formatLinkExpiry(expiresAt) : null;
  const text =
    `Hi there,\n\n` +
    `We've launched a new staff portal and you've been invited to set up your access.\n\n` +
    `Click the link below to create your staff portal password:\n${onboardingUrl}\n\n` +
    (expiry ? `This link stops working at ${expiry}.` : `This link will expire in 7 days.`) +
    ` If you have any questions, please speak to your manager.\n\n` +
    `Kind regards,\nThe Anchor Management Team`;

  return { subject, text };
}

export function buildSeparationStartedEmail(input: SeparationStartedEmailInput) {
  const subject = 'Formal separation process started - Orange Jelly Limited';
  const greeting = firstNameFrom(input.employeeName) ? `Hi ${firstNameFrom(input.employeeName)},` : 'Hi there,';
  const remainingShiftsText = buildRemainingShiftsText(input);
  const sections = [
    greeting,
    '',
    "I am writing to confirm that we've started the formal process of separating you from Orange Jelly Limited.",
    '',
    buildLastWorkingDayText(input.employmentEndDate, input.todayIso),
    remainingShiftsText ? `\n${remainingShiftsText}` : null,
    '',
    'You will be paid in the next normal pay cycle for any shifts worked, together with any other amounts due. Your final payslip will show the final payment and any deductions.',
    '',
    'I will provide your P45 once the next pay cycle is complete.',
    '',
    'Please return your keys and any company property you have been provided with before you leave, or arrange their return with Billy or me.',
    '',
    input.shiftPolicy === 'work_remaining'
      ? 'Any questions during your shifts can be raised with Billy. Anything relating to this process can be raised with me directly.'
      : 'Anything relating to this process can be raised with me directly.',
    '',
    'Thank you for your service. We wish you the best of luck for the future.',
    '',
    'Kind regards,',
    'Peter & Billy',
  ].filter((section): section is string => section !== null);

  return { subject, text: sections.join('\n'), cc: uniqueEmails([MANAGER_EMAIL, BILLY_EMAIL]) };
}

/**
 * Sends one of these emails and throws if it did not go.
 *
 * sendEmail catches its own errors and returns { success: false }, so a helper that handed that
 * result back left every caller unable to tell a send from a failure: the invite actions reported
 * "Invite sent" on a failed email, and the chase cron stamped a chase that never went (found 11
 * September 2026). Throwing is the contract the callers were already written for, and the one
 * sendSeparationStartedEmail has always used.
 */
async function sendInviteEmailOrThrow(options: EmailOptions, whatFailed: string) {
  const result = await sendEmail(options);
  if (!result.success) {
    throw new Error(result.error || `Failed to send ${whatFailed}.`);
  }
  return result;
}

export async function sendPortalInviteEmail(email: string, onboardingUrl: string, expiresAt?: string | null) {
  const { subject, text } = buildPortalInviteEmail(email, onboardingUrl, expiresAt);
  return sendInviteEmailOrThrow({ to: email, subject, text }, 'the portal invite email');
}

export async function sendWelcomeEmail(email: string, onboardingUrl: string) {
  const { subject, text } = buildWelcomeEmail(email, onboardingUrl);
  return sendInviteEmailOrThrow({ to: email, subject, text }, 'the invite email');
}

export async function sendChaseEmail(email: string, onboardingUrl: string, dayNumber: number, expiresAt?: string | null) {
  const { subject, text } = buildChaseEmail(email, onboardingUrl, dayNumber, expiresAt);
  return sendInviteEmailOrThrow({ to: email, subject, text }, 'the reminder email');
}

export async function sendOnboardingCompleteEmail(input: OnboardingCompleteEmailInput) {
  const { subject, text } = buildOnboardingCompleteEmail(input);
  return sendInviteEmailOrThrow({ to: MANAGER_EMAIL, subject, text }, 'the onboarding complete email');
}

export async function sendSeparationStartedEmail(input: SeparationStartedEmailInput) {
  const { subject, text, cc } = buildSeparationStartedEmail(input);
  const result = await sendEmail({ to: input.email, subject, text, cc });
  if (!result.success) {
    throw new Error(result.error || 'Failed to send separation email.');
  }
  return result;
}
