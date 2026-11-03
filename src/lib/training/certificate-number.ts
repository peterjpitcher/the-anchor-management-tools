/**
 * Certificate numbers (build contract section 3, "Finishing"): `AT-` and 10 random base32
 * characters from `crypto`, stored unique on `training_assignments.certificate_number` before the
 * pack is made, so the certificate and the record always agree. Random and non-sequential, so a
 * number says nothing about how many have been issued.
 *
 * The alphabet is Crockford base32 (no I, L, O or U), so a number read aloud or typed from paper
 * cannot be confused.
 */

const CERTIFICATE_NUMBER_PREFIX = 'AT-'

export const CERTIFICATE_NUMBER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const CERTIFICATE_NUMBER_LENGTH = 10

export const CERTIFICATE_NUMBER_PATTERN = /^AT-[0-9A-HJKMNP-TV-Z]{10}$/

/**
 * A new certificate number. `randomBytes` is for tests; production uses `crypto.getRandomValues`.
 * Uniqueness is enforced by the database; the caller retries on a unique violation.
 */
export function generateCertificateNumber(randomBytes?: (length: number) => Uint8Array): string {
  const bytes = (randomBytes ?? cryptoRandomBytes)(CERTIFICATE_NUMBER_LENGTH)
  if (bytes.length < CERTIFICATE_NUMBER_LENGTH) {
    throw new Error(`Certificate number needs ${CERTIFICATE_NUMBER_LENGTH} random bytes, got ${bytes.length}`)
  }
  let body = ''
  for (let index = 0; index < CERTIFICATE_NUMBER_LENGTH; index += 1) {
    // 256 is a multiple of 32, so the low five bits of a uniform byte are uniform: no bias.
    body += CERTIFICATE_NUMBER_ALPHABET[bytes[index] & 31]
  }
  return `${CERTIFICATE_NUMBER_PREFIX}${body}`
}

function cryptoRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

/** Whether `value` has the shape of a certificate number. */
export function isCertificateNumber(value: string): boolean {
  return typeof value === 'string' && CERTIFICATE_NUMBER_PATTERN.test(value)
}
