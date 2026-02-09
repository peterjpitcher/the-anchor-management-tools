import { env, isSmsEnabled } from '@/lib/env'

export type Env = typeof env

/**
 * @deprecated Use '@/lib/env' directly.
 */
export function validateEnv(): Env {
  return env
}

export function isFeatureConfigured(feature: 'twilio'): boolean {
  if (feature === 'twilio') {
    return isSmsEnabled()
  }
  return false
}

export function getEnvInfo(): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    APP_URL: env.NEXT_PUBLIC_APP_URL,
    SUPABASE_CONFIGURED: env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Yes' : 'No',
    TWILIO_CONFIGURED: isFeatureConfigured('twilio') ? 'Yes' : 'No',
    VERCEL_ENV: process.env.VERCEL_ENV || 'Not on Vercel',
  }
}

export function checkEnvironment(): void {
  validateEnv()
}
