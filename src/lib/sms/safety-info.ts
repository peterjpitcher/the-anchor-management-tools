/**
 * Safely extract optional `code` and `logFailure` properties from SMS result
 * or thrown error objects. This avoids `as any` casts when accessing these
 * properties on unknown-shaped objects returned by sendSMS/sendSms.
 */
export function extractSmsSafetyInfo(obj: unknown): { code: string | null; logFailure: boolean } {
  if (!obj || typeof obj !== 'object') return { code: null, logFailure: false }
  const record = obj as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : null
  const logFailure = record.logFailure === true || code === 'logging_failed'
  return { code, logFailure }
}

/**
 * Safely extract an error message string from an unknown-shaped object.
 * Useful for Supabase or webhook error objects that may or may not have a `.message` property.
 */
export function extractErrorMessage(obj: unknown): string {
  if (obj instanceof Error) return obj.message
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
  }
  return String(obj)
}
