/**
 * @deprecated Use '@/lib/api/auth' directly.
 * This file is kept as a compatibility shim.
 */

import { validateApiKey } from '@/lib/api/auth'

export {
  hashApiKey,
  generateApiKey,
  checkRateLimit,
  logApiUsage,
  createApiResponse,
  createErrorResponse,
  withApiAuth,
} from '@/lib/api/auth'

export async function verifyApiKey(apiKey: string, requiredScope?: string) {
  const apiKeyData = await validateApiKey(apiKey)
  if (!apiKeyData) {
    return { valid: false, error: 'Invalid API key' as const }
  }

  if (requiredScope) {
    const allowed =
      apiKeyData.permissions.includes(requiredScope) ||
      apiKeyData.permissions.includes('*')

    if (!allowed) {
      return { valid: false, error: 'Insufficient permissions' as const }
    }
  }

  return { valid: true, apiKeyData }
}
