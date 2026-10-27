import { generatePhoneVariants } from './index'

const MIN_DIGITS = 6

/**
 * Whether a search term looks like a phone number and matches one of the stored numbers. Numbers
 * are stored as +44..., but staff type them as a guest says them (07...), so the term is widened
 * with the same variants the customer search uses, plus a 0 / 44 swap for part of a number
 * (BK-180). Compared on digits only, so spaces and dashes do not matter.
 */
export function matchesPhoneSearch(term: string, phones: Array<string | null | undefined>): boolean {
  const digits = term.replace(/\D/g, '')
  if (digits.length < MIN_DIGITS) return false
  // A term with letters in it is a name or reference, not a number.
  if (/[a-z]/i.test(term)) return false

  const candidates = new Set<string>([digits])
  if (digits.startsWith('0')) candidates.add(`44${digits.slice(1)}`)
  if (digits.startsWith('44')) candidates.add(`0${digits.slice(2)}`)
  for (const variant of generatePhoneVariants(term)) {
    const variantDigits = variant.replace(/\D/g, '')
    if (variantDigits.length >= MIN_DIGITS) candidates.add(variantDigits.replace(/^00/, ''))
  }

  return phones.some((phone) => {
    const stored = (phone ?? '').replace(/\D/g, '')
    if (!stored) return false
    for (const candidate of candidates) {
      if (stored.includes(candidate)) return true
    }
    return false
  })
}
