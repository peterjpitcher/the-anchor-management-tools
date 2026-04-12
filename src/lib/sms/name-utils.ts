const PLACEHOLDER_NAMES = new Set([
  'unknown',
  'guest',
  'customer',
  'client',
  'user',
  'admin',
])

export function isPlaceholderName(value: string | null | undefined): boolean {
  const cleaned = value?.trim().toLowerCase()
  return !cleaned || PLACEHOLDER_NAMES.has(cleaned)
}

export function getSmartFirstName(firstName: string | null | undefined): string {
  const trimmed = firstName?.trim() || ''
  return isPlaceholderName(trimmed) ? 'there' : trimmed
}

export function buildSmartFullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  const smartFirst = isPlaceholderName(firstName) ? '' : (firstName?.trim() || '')
  const smartLast = isPlaceholderName(lastName) ? '' : (lastName?.trim() || '')
  const full = [smartFirst, smartLast].filter(Boolean).join(' ')
  return full || 'Customer'
}
