/**
 * The email delivery state that belongs to an ADDRESS, not to a person.
 *
 * `email_status`, `email_deactivated_at`, `email_delivery_failures` and
 * `last_email_failure_reason` all describe one mailbox. Put a different address on the
 * record and every one of them is about somebody else's mailbox, so all four have to go.
 *
 * WHY THIS EXISTS. `isEmailUsable` refuses to email a customer whose `email_deactivated_at`
 * is set. Nothing cleared it when the address changed: not the staff edit in
 * `src/services/customers.ts`, not the guest's own capture link, which reset `email_status`
 * and left the deactivation stamp behind. On 12 September 2026 two customers whose addresses
 * had been corrected were still being texted instead of emailed, because a bounce from the
 * old typo was still blocking the new address.
 *
 * A cleared block is not a claim the new address works. It is 'unknown', which is what it
 * genuinely is until the first send: the next delivered event sets 'valid' and the next
 * permanent bounce sets 'bounced', both from the Resend webhook.
 *
 * DELIBERATELY NOT TOUCHED: `marketing_email_opt_in` and `marketing_email_opted_out_at`.
 * Consent belongs to the person and survives a change of address. Only the guest, staff on
 * the guest's instruction, or an unsubscribe may move those.
 */

export type EmailAddressResetFields = {
  email_status: 'unknown'
  email_deactivated_at: null
  email_delivery_failures: 0
  last_email_failure_reason: null
}

/**
 * The patch to merge into a `customers` update whenever `email` changes.
 *
 * Spread it into the same update as the address so the two can never disagree: a separate
 * follow-up write would leave a window where the new address carries the old block.
 */
export function emailAddressResetFields(): EmailAddressResetFields {
  return {
    email_status: 'unknown',
    email_deactivated_at: null,
    email_delivery_failures: 0,
    last_email_failure_reason: null,
  }
}

/**
 * Is this an actual change of address?
 *
 * Compared the way the suppression list and the webhook compare: trimmed and lower-cased.
 * Recasing an address is not a new mailbox, so it must not clear a real bounce.
 */
export function isEmailAddressChange(
  previous: string | null | undefined,
  next: string | null | undefined
): boolean {
  const before = (previous ?? '').trim().toLowerCase()
  const after = (next ?? '').trim().toLowerCase()
  return before !== after
}
