import { sendEmail } from './emailService';

const MANAGER_EMAIL = 'manager@the-anchor.pub';

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
    `Click the link below to create a password and complete your profile:\n${onboardingUrl}\n\n` +
    `This link will expire in 7 days. If you have any questions, please speak to your manager.\n\n` +
    `Kind regards,\nThe Anchor Management Team`;

  return { subject, text, cc: [MANAGER_EMAIL] };
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
