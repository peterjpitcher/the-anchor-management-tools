import { GUEST, STAFF } from '@/lib/brand/palette'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { formatDateInLondon } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { escapeHtml } from './template-render'
import type { SigningBrand, SigningMode } from './types'

/**
 * The four emails signing sends. Pure builders: they return subject, text and HTML and send
 * nothing, so each can be rendered with fixture data in a test before it ever reaches a person.
 */

export interface SigningEmail {
  subject: string
  text: string
  html: string
}

interface BrandVoice {
  /** Who the email is from, in the body and the sign-off. */
  from: string
  contactLine: string
  accent: string
  text: string
  muted: string
  buttonBg: string
  buttonText: string
}

function voiceFor(brand: SigningBrand): BrandVoice {
  if (brand === 'guest') {
    return {
      from: COMPANY_DETAILS.tradingName,
      contactLine: `Any questions, call us on ${GUEST_CONTACT.phoneDisplay} or reply to this email.`,
      accent: GUEST.green,
      text: GUEST.text,
      muted: GUEST.textMuted,
      buttonBg: GUEST.buttonBg,
      buttonText: GUEST.buttonText,
    }
  }
  return {
    from: COMPANY_DETAILS.legalName,
    contactLine: 'Any questions, reply to this email.',
    accent: STAFF.primary,
    text: STAFF.text,
    muted: STAFF.textMuted,
    buttonBg: STAFF.primary,
    buttonText: STAFF.primaryFg,
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim()
}

function layout(voice: BrandVoice, paragraphs: string[], button?: { label: string; url: string }): string {
  const body = paragraphs
    .map((paragraph) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:${voice.text}">${paragraph}</p>`)
    .join('\n')
  const cta = button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:${voice.buttonBg};color:${voice.buttonText};font-size:16px;font-weight:bold;text-decoration:none">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:${voice.muted}">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(button.url)}</span></p>`
    : ''
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:16px">
${body}
${cta}
<p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:${voice.muted}">${escapeHtml(voice.contactLine)}</p>
<p style="margin:14px 0 0;font-size:16px;line-height:1.5;color:${voice.text}">${escapeHtml(voice.from)}</p>
</div>`
}

function actionWords(mode: SigningMode): { verb: string; noun: string; button: string } {
  return mode === 'acknowledge'
    ? { verb: 'read and confirm', noun: 'confirmation', button: 'Read and confirm' }
    : { verb: 'read and sign', noun: 'signature', button: 'Read and sign' }
}

export interface SigningRequestEmailInput {
  brand: SigningBrand
  mode: SigningMode
  recipientName: string
  title: string
  signingUrl: string
  /** ISO instant the link stops working. */
  expiresAt: string
  /** True for the 3 and 7 day chasers. */
  isReminder?: boolean
}

export function buildSigningRequestEmail(input: SigningRequestEmailInput): SigningEmail {
  const voice = voiceFor(input.brand)
  const words = actionWords(input.mode)
  const expires = formatDateInLondon(input.expiresAt, { day: 'numeric', month: 'long', year: 'numeric' })
  const name = firstName(input.recipientName)
  const opening = input.isReminder
    ? `A reminder that "${input.title}" is still waiting for your ${words.noun}.`
    : `${voice.from} has sent you "${input.title}" to ${words.verb}.`
  const how = 'It takes a couple of minutes on a phone or computer. You will see the full document before you agree to anything.'
  const expiry = `The link is personal to you, so please do not forward it. It works until ${expires}.`

  return {
    subject: input.isReminder ? `Reminder: ${input.title}` : `Please ${words.verb}: ${input.title}`,
    text: [
      `Hi ${name},`,
      '',
      opening,
      '',
      how,
      '',
      `${words.button} here:`,
      input.signingUrl,
      '',
      expiry,
      '',
      voice.contactLine,
      '',
      voice.from,
    ].join('\n'),
    html: layout(
      voice,
      [`Hi ${escapeHtml(name)},`, escapeHtml(opening), escapeHtml(how), escapeHtml(expiry)],
      { label: words.button, url: input.signingUrl }
    ),
  }
}

export function buildSigningCompletedEmail(input: {
  brand: SigningBrand
  mode: SigningMode
  recipientName: string
  title: string
}): SigningEmail {
  const voice = voiceFor(input.brand)
  const name = firstName(input.recipientName)
  const done = input.mode === 'acknowledge'
    ? `Thank you. "${input.title}" has been confirmed.`
    : `Thank you. "${input.title}" has been signed by everyone who needed to sign it.`
  const attached = 'Your copy is attached. Its last page is the signing record, which shows who signed and when. Please keep it somewhere safe.'

  return {
    subject: input.mode === 'acknowledge' ? `Confirmed: ${input.title}` : `Signed: ${input.title}`,
    text: [`Hi ${name},`, '', done, '', attached, '', voice.contactLine, '', voice.from].join('\n'),
    html: layout(voice, [`Hi ${escapeHtml(name)},`, escapeHtml(done), escapeHtml(attached)]),
  }
}

/** To the staff member who sent it: someone signed, declined, or the request lapsed. */
export function buildSigningStaffNoticeEmail(input: {
  outcome: 'completed' | 'declined' | 'expired'
  title: string
  /** Who the document is about, such as the employee or the booking's customer. */
  subjectLabel: string
  partyName?: string | null
  declineReason?: string | null
  recordUrl: string
}): SigningEmail {
  const voice = voiceFor('staff')
  const headline = {
    completed: `"${input.title}" for ${input.subjectLabel} is fully signed.`,
    declined: `${input.partyName ?? 'A signer'} declined "${input.title}" for ${input.subjectLabel}.`,
    expired: `"${input.title}" for ${input.subjectLabel} was not signed in time and has expired.`,
  }[input.outcome]
  const detail = {
    completed: 'The signed copy, with its signing record, is on the record.',
    declined: input.declineReason
      ? `The reason they gave: ${input.declineReason}`
      : 'They did not give a reason.',
    expired: 'Send it again from the record if it is still needed.',
  }[input.outcome]
  const subject = {
    completed: `Signed: ${input.title} (${input.subjectLabel})`,
    declined: `Declined: ${input.title} (${input.subjectLabel})`,
    expired: `Not signed: ${input.title} (${input.subjectLabel})`,
  }[input.outcome]

  return {
    subject,
    text: [headline, '', detail, '', 'Open the record:', input.recordUrl].join('\n'),
    html: layout(voice, [escapeHtml(headline), escapeHtml(detail)], { label: 'Open the record', url: input.recordUrl }),
  }
}
