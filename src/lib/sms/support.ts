export function ensureReplyInstruction(message: string, phone?: string | null): string {
  const trimmed = message.trim()
  if (trimmed.length === 0) {
    return trimmed
  }

  const lower = trimmed.toLowerCase()
  if (lower.includes('reply to this message')) {
    return trimmed
  }

  const cleanedPhone = phone?.trim()
  const suffix = cleanedPhone
    ? `Reply to this message if you need any help or call ${cleanedPhone}.`
    : 'Reply to this message if you need any help.'

  const needsPunctuation = !/[.!?]$/.test(trimmed)
  const combined = needsPunctuation ? `${trimmed}. ${suffix}` : `${trimmed} ${suffix}`

  return combined.replace(/\s+/g, ' ').trim()
}
