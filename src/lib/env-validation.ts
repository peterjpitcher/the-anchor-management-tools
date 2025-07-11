import { z } from 'zod'

/**
 * Environment variable validation schema
 * Ensures all required environment variables are present and valid
 */

// Define the schema for environment variables
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  
  // Supabase (Required)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  
  // Twilio (Optional but validated if present)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+[1-9]\d{1,14}$/).optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  
  // Contact Information
  NEXT_PUBLIC_CONTACT_PHONE_NUMBER: z.string().default('01753682707'),
  
  // Security
  CRON_SECRET: z.union([
    z.string().min(32),
    z.string().length(0),
    z.undefined()
  ]).optional(),
  SKIP_TWILIO_SIGNATURE_VALIDATION: z.enum(['true', 'false']).optional(),
  
  // Vercel
  VERCEL: z.enum(['1']).optional(),
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_REGION: z.string().optional(),
})

// Add refinements for conditional requirements
const refinedEnvSchema = envSchema
  .refine(
    (data) => {
      // If one Twilio var is set, core ones must be set
      if (data.TWILIO_ACCOUNT_SID || data.TWILIO_AUTH_TOKEN) {
        return !!(data.TWILIO_ACCOUNT_SID && data.TWILIO_AUTH_TOKEN)
      }
      return true
    },
    {
      message: 'Both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set together',
    }
  )
  .refine(
    (data) => {
      // If Twilio is configured, must have either phone number or messaging service
      if (data.TWILIO_ACCOUNT_SID) {
        return !!(data.TWILIO_PHONE_NUMBER || data.TWILIO_MESSAGING_SERVICE_SID)
      }
      return true
    },
    {
      message: 'Either TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID must be set when Twilio is configured',
    }
  )

// Export the parsed and validated environment
export type Env = z.infer<typeof envSchema>

let env: Env | undefined

/**
 * Validates environment variables and returns typed environment object
 * Throws an error if validation fails
 */
export function validateEnv(): Env {
  if (env) return env
  
  try {
    env = refinedEnvSchema.parse(process.env)
    return env
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:')
      console.error(formatZodError(error))
      throw new Error('Invalid environment configuration')
    }
    throw error
  }
}

/**
 * Formats Zod validation errors for better readability
 */
function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.join('.')
      return `  - ${path}: ${err.message}`
    })
    .join('\n')
}

/**
 * Checks if a feature is properly configured
 */
export function isFeatureConfigured(feature: 'twilio'): boolean {
  const env = validateEnv()
  
  switch (feature) {
    case 'twilio':
      return !!(
        env.TWILIO_ACCOUNT_SID &&
        env.TWILIO_AUTH_TOKEN &&
        (env.TWILIO_PHONE_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID)
      )
    default:
      return false
  }
}

/**
 * Get environment info for debugging
 */
export function getEnvInfo(): Record<string, string> {
  const env = validateEnv()
  
  return {
    NODE_ENV: env.NODE_ENV,
    APP_URL: env.NEXT_PUBLIC_APP_URL,
    SUPABASE_CONFIGURED: 'Yes',
    TWILIO_CONFIGURED: isFeatureConfigured('twilio') ? 'Yes' : 'No',
    VERCEL_ENV: env.VERCEL_ENV || 'Not on Vercel',
  }
}

/**
 * Runtime environment check - call this early in your app
 */
export function checkEnvironment(): void {
  try {
    const env = validateEnv()
    const info = getEnvInfo()
    
    console.log('✅ Environment validation passed')
    console.log('📋 Configuration:', info)
    
    // Warnings for optional features
    if (!isFeatureConfigured('twilio')) {
      console.warn('⚠️  Twilio not configured - SMS features will be disabled')
    }
  } catch (error) {
    console.error('❌ Environment check failed:', error)
    
    // In development, log the error but don't crash
    if (process.env.NODE_ENV === 'development') {
      console.error('Continuing in development mode despite environment errors')
      console.error('Fix these errors before deploying to production')
    } else {
      // In production, fail fast
      throw error
    }
  }
}