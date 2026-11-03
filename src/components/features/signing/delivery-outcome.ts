import type { PartyDelivery } from '@/lib/signing/service'

/**
 * What staff are told when a signing link email did not definitely go. Every screen that sends a
 * document for signature uses this, so they all say the same thing and name the same buttons
 * (SignaturePanel's "Send New Link" and "Sign in Person"):
 *
 * - Email is switched off (`email_suspended`): nothing was emailed, so they sign in person.
 * - The address has bounced before (`recipient_suppressed`): the provider will not send to it,
 *   and Send New Link would be refused the same way, so the address is what to check.
 * - No definite answer (`uncertain` true, or not saying): the email may have reached them. A new
 *   link cancels the one they may be holding, so staff check with them first. A warning, never an
 *   error that says to send again.
 * - Definitely refused (`uncertain: false`): not sent, so Send New Link or Sign in Person.
 *
 * The provider's own text never reaches the screen; the server logs it.
 */

export type DeliveryProblem = 'email_off' | 'bounced_before' | 'may_have_gone' | 'not_sent'

export interface DeliveryToast {
  kind: 'warning' | 'error'
  message: string
}

export interface DeliveryToastOptions {
  /** What was created, as it starts a sentence: "Food agreement", "Offer". Left out, "Created". */
  noun?: string
  /** Who the email was for. Left out, it says "the email". */
  recipient?: string | null
}

/** Which of the four outcomes a failed link email is. */
export function deliveryProblem(delivery: Pick<PartyDelivery, 'code' | 'uncertain'>): DeliveryProblem {
  // Both codes are definite: the provider was never asked, so nothing went.
  if (delivery.code === 'email_suspended') return 'email_off'
  if (delivery.code === 'recipient_suppressed') return 'bounced_before'
  // Only a definite refusal is called not sent. Anything else may have reached them.
  return delivery.uncertain === false ? 'not_sent' : 'may_have_gone'
}

/** The toast for one outcome. */
function deliveryProblemToast(problem: DeliveryProblem, options: DeliveryToastOptions = {}): DeliveryToast {
  const created = options.noun?.trim() ? `${options.noun.trim()} created` : 'Created'
  const to = options.recipient?.trim() ? ` to ${options.recipient.trim()}` : ''
  switch (problem) {
    case 'email_off':
      return { kind: 'warning', message: `${created}, but email is switched off, so no link was emailed${to}. Use "Sign in Person".` }
    case 'bounced_before':
      return {
        kind: 'error',
        message: `${created}, but the email${to} was not sent because their address has bounced before. Check the address on their record, or use "Sign in Person".`,
      }
    case 'may_have_gone':
      return {
        kind: 'warning',
        message: `${created}, but we could not confirm the email${to} went. It may have reached them, so check with them before sending a new link.`,
      }
    case 'not_sent':
      return { kind: 'error', message: `${created}, but the email${to} was not sent. Use "Send New Link" or "Sign in Person".` }
  }
}

/** The toast for one failed link email. */
export function failedDeliveryToast(delivery: Pick<PartyDelivery, 'code' | 'uncertain'>, options: DeliveryToastOptions = {}): DeliveryToast {
  return deliveryProblemToast(deliveryProblem(delivery), options)
}

// What may already have reached someone is said first.
const PROBLEM_ORDER: readonly DeliveryProblem[] = ['may_have_gone', 'email_off', 'bounced_before', 'not_sent']

/**
 * One toast for each kind of problem across a send's link emails, naming who each is about.
 * Empty when no link email failed: every one went, or there was no address to send to.
 */
export function failedDeliveryToasts(
  deliveries: ReadonlyArray<Pick<PartyDelivery, 'name' | 'email_status' | 'code' | 'uncertain'>>,
  options: Pick<DeliveryToastOptions, 'noun'> = {}
): DeliveryToast[] {
  const names = new Map<DeliveryProblem, string[]>()
  for (const delivery of deliveries) {
    if (delivery.email_status !== 'failed') continue
    const problem = deliveryProblem(delivery)
    names.set(problem, [...(names.get(problem) ?? []), delivery.name])
  }
  return PROBLEM_ORDER.flatMap((problem) => {
    const people = names.get(problem)
    return people ? [deliveryProblemToast(problem, { noun: options.noun, recipient: people.join(', ') })] : []
  })
}
