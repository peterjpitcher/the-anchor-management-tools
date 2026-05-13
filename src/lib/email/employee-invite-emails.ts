import { sendEmail } from './emailService';
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils';

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

export function buildWelcomeEmail(email: string, onboardingUrl: string) {
  const subject = 'Welcome to The Anchor -- Complete Your Profile';
  const text =
    `Hi there,\n\n` +
    `Welcome to The Anchor! We're excited to have you joining the team.\n\n` +
    `To get started, please complete your employee profile by clicking the link below. ` +
    `You'll be asked to create a password and fill in your personal details, emergency contacts, financial information, and health information.\n\n` +
    `Complete your profile here:\n${onboardingUrl}\n\n` +
    `This link will expire in 7 days. If you have any questions, please contact your manager.\n\n` +
    `Kind regards,\nThe Anchor Management Team`;

  return { subject, text, cc: [MANAGER_EMAIL] };
}

export function buildChaseEmail(email: string, onboardingUrl: string, dayNumber: number) {
  const subject = 'Reminder: Please Complete Your Profile';
  const text =
    `Hi there,\n\n` +
    `This is a friendly reminder that your employee profile at The Anchor is still incomplete.\n\n` +
    `Please take a few minutes to complete your profile:\n${onboardingUrl}\n\n` +
    `If you have any questions or need help, please contact your manager.\n\n` +
    `Kind regards,\nThe Anchor Management Team`;

  return { subject, text, cc: [MANAGER_EMAIL] };
}

export function buildOnboardingCompleteEmail(employeeName: string, employeeEmail: string) {
  const subject = `${employeeName} has completed their profile`;
  const text =
    `Hi,\n\n` +
    `${employeeName} (${employeeEmail}) has completed their employee profile and is now Active.\n\n` +
    `You can view their profile in the employee management system.\n\n` +
    `Kind regards,\nThe Anchor Management System`;

  return { subject, text };
}

export function buildPortalInviteEmail(email: string, onboardingUrl: string) {
  const subject = 'Set Up Your Staff Portal Access -- The Anchor';
  const text =
    `Hi there,\n\n` +
    `We've launched a new staff portal and you've been invited to set up your access.\n\n` +
    `Click the link below to create your staff portal password:\n${onboardingUrl}\n\n` +
    `This link will expire in 7 days. If you have any questions, please speak to your manager.\n\n` +
    `Kind regards,\nThe Anchor Management Team`;

  return { subject, text, cc: [MANAGER_EMAIL] };
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
    'Any questions during your shifts can be raised with Billy. Anything relating to this process can be raised with me directly.',
    '',
    'Thank you for your service. We wish you the best of luck for the future.',
    '',
    'Kind regards,',
    'Peter & Billy',
  ].filter((section): section is string => section !== null);

  return { subject, text: sections.join('\n'), cc: uniqueEmails([MANAGER_EMAIL, BILLY_EMAIL]) };
}

export async function sendPortalInviteEmail(email: string, onboardingUrl: string) {
  const { subject, text, cc } = buildPortalInviteEmail(email, onboardingUrl);
  return sendEmail({ to: email, subject, text, cc });
}

export async function sendWelcomeEmail(email: string, onboardingUrl: string) {
  const { subject, text, cc } = buildWelcomeEmail(email, onboardingUrl);
  return sendEmail({ to: email, subject, text, cc });
}

export async function sendChaseEmail(email: string, onboardingUrl: string, dayNumber: number) {
  const { subject, text, cc } = buildChaseEmail(email, onboardingUrl, dayNumber);
  return sendEmail({ to: email, subject, text, cc });
}

export async function sendOnboardingCompleteEmail(employeeName: string, employeeEmail: string) {
  const { subject, text } = buildOnboardingCompleteEmail(employeeName, employeeEmail);
  return sendEmail({ to: MANAGER_EMAIL, subject, text });
}

export async function sendSeparationStartedEmail(input: SeparationStartedEmailInput) {
  const { subject, text, cc } = buildSeparationStartedEmail(input);
  const result = await sendEmail({ to: input.email, subject, text, cc });
  if (!result.success) {
    throw new Error(result.error || 'Failed to send separation email.');
  }
  return result;
}
