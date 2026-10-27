/**
 * A phone number with all but its last three digits hidden, for logs (BK-206).
 *
 * Guests' numbers were written in full to the production logs whenever a text failed or was
 * blocked, where anyone with access to the logs could read them. The last three digits are enough
 * to tell two guests apart when matching a log line to a customer record; log the customer id
 * alongside for the rest.
 *
 * '+447123456789' becomes '+*********789'. Anything without at least four digits is fully hidden.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (typeof phone !== 'string') return null
  const trimmed = phone.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  const prefix = trimmed.startsWith('+') || trimmed.startsWith('whatsapp:+') ? '+' : ''
  if (digits.length < 4) return `${prefix}${'*'.repeat(Math.max(digits.length, 3))}`
  return `${prefix}${'*'.repeat(digits.length - 3)}${digits.slice(-3)}`
}

/** maskPhone over a list, for logs that name several numbers. */
export function maskPhones(phones: ReadonlyArray<string | null | undefined>): Array<string | null> {
  return phones.map((phone) => maskPhone(phone))
}
