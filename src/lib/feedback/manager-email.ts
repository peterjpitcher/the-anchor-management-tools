import { formatDateInLondon } from '@/lib/dateUtils'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export interface ManagerFeedbackEmailInput {
  rating: number
  comments?: string | null
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  contactConsent: boolean
  submittedAt?: Date
}

export function buildManagerFeedbackEmail(input: ManagerFeedbackEmailInput): {
  subject: string
  html: string
} {
  const subject = 'New guest feedback — The Anchor'

  const submittedLabel = formatDateInLondon(input.submittedAt ?? new Date(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  const comments = input.comments?.trim()

  const details = [
    `<li><strong>Rating:</strong> ${escapeHtml(String(input.rating))} / 5</li>`,
    `<li><strong>Comments:</strong> ${comments ? escapeHtml(comments) : '—'}</li>`,
    `<li><strong>Submitted:</strong> ${escapeHtml(submittedLabel)}</li>`
  ]

  const parts = [
    '<p>A guest has left feedback via the review page.</p>',
    '<ul>',
    ...details,
    '</ul>'
  ]

  if (input.contactConsent) {
    const name = input.customerName?.trim()
    const email = input.customerEmail?.trim()
    const phone = input.customerPhone?.trim()

    parts.push(
      '<p><strong>Contact details</strong></p>',
      '<ul>',
      `<li><strong>Name:</strong> ${name ? escapeHtml(name) : '—'}</li>`,
      `<li><strong>Email:</strong> ${email ? escapeHtml(email) : '—'}</li>`,
      `<li><strong>Phone:</strong> ${phone ? escapeHtml(phone) : '—'}</li>`,
      '</ul>'
    )
  } else {
    parts.push('<p>Guest did not leave contact details.</p>')
  }

  return { subject, html: parts.join('') }
}
