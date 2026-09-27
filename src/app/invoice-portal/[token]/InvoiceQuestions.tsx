import { GUEST_CONTACT } from '@/lib/guest-contact'
import { invoiceReplyToAddress } from '@/lib/email/invoice-sender'

/**
 * Where invoice questions go: the Orange Jelly reply-to mailbox the invoice emails use, or the
 * company record when that is not configured. Never an invented address.
 */
export function questionsEmail(): string {
  const configured = invoiceReplyToAddress()
  if (!configured) return GUEST_CONTACT.email
  return configured.match(/<([^<>]+)>/)?.[1]?.trim() ?? configured
}

/** The line under every invoice payment screen that says how to reach us. */
export function InvoiceQuestions(): React.JSX.Element {
  const contactEmail = questionsEmail()
  return (
    <p className="text-center text-ui leading-relaxed text-text-muted">
      Questions about this invoice? Email{' '}
      <a href={`mailto:${contactEmail}`} className="text-primary underline underline-offset-2">
        {contactEmail}
      </a>{' '}
      or call {GUEST_CONTACT.phoneDisplay}.
    </p>
  )
}
