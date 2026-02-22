import { parsePhoneNumberFromString } from 'libphonenumber-js'

const DEFAULT_COUNTRY_CODE = '44'

export type PhoneNormalizationOptions = {
  defaultCountryCode?: string
}

function sanitizePhoneInput(phone: string): string {
  const trimmed = phone.trim()
  if (!trimmed) return ''

  let normalized = trimmed.replace(/[^\d+]/g, '')
  normalized = normalized.replace(/(?!^)\+/g, '')

  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`
  }

  return normalized
}

function sanitizeCountryCode(defaultCountryCode?: string): string {
  const digitsOnly = (defaultCountryCode ?? DEFAULT_COUNTRY_CODE).replace(/\D/g, '')
  if (digitsOnly.length === 0) {
    return DEFAULT_COUNTRY_CODE
  }

  // Calling codes are at most 4 digits.
  return digitsOnly.slice(0, 4)
}

function toE164Candidate(cleaned: string, defaultCountryCode: string): string {
  if (cleaned.startsWith('+')) {
    return cleaned
  }

  const localDigits = cleaned.replace(/\D/g, '')
  if (!localDigits) {
    throw new Error('Invalid phone number format')
  }

  if (localDigits.startsWith(defaultCountryCode)) {
    return `+${localDigits}`
  }

  if (localDigits.startsWith('0')) {
    return `+${defaultCountryCode}${localDigits.replace(/^0+/, '')}`
  }

  return `+${defaultCountryCode}${localDigits}`
}

function validateAndFormatE164(candidate: string): string {
  const parsed = parsePhoneNumberFromString(candidate)
  if (!parsed || !parsed.isValid()) {
    throw new Error('Invalid phone number format')
  }

  return parsed.number
}

export function formatPhoneForStorage(
  phone: string,
  options: PhoneNormalizationOptions = {}
): string {
  const cleaned = sanitizePhoneInput(phone)
  if (!cleaned) {
    throw new Error('Invalid phone number format')
  }

  const defaultCountryCode = sanitizeCountryCode(options.defaultCountryCode)
  const candidate = toE164Candidate(cleaned, defaultCountryCode)
  return validateAndFormatE164(candidate)
}

export function generatePhoneVariants(
  phone: string,
  options: PhoneNormalizationOptions = {}
): string[] {
  const variants = new Set<string>()
  const raw = phone.trim()
  const cleaned = sanitizePhoneInput(phone)

  if (raw) {
    variants.add(raw)
  }

  if (cleaned) {
    variants.add(cleaned)
    const cleanedDigits = cleaned.replace(/^\+/, '')
    if (cleanedDigits) {
      variants.add(cleanedDigits)
      variants.add(`+${cleanedDigits}`)
      variants.add(`00${cleanedDigits}`)
    }
  }

  try {
    const canonical = formatPhoneForStorage(phone, options)
    variants.add(canonical)

    const canonicalDigits = canonical.slice(1)
    variants.add(canonicalDigits)
    variants.add(`00${canonicalDigits}`)

    const parsed = parsePhoneNumberFromString(canonical)
    if (parsed) {
      const countryCallingCode = parsed.countryCallingCode
      const nationalNumber = parsed.nationalNumber
      const joinedDigits = `${countryCallingCode}${nationalNumber}`
      variants.add(joinedDigits)
      variants.add(`+${joinedDigits}`)
      variants.add(`00${joinedDigits}`)

      // Legacy UK storage variants.
      if (countryCallingCode === '44') {
        variants.add(`0${nationalNumber}`)
      }
    }
  } catch {
    // Keep inferred variants from raw input if canonical formatting fails.
  }

  return [...variants]
}

