import { z } from 'zod';

// Define the schema for environment variables
const envSchema = z.object({
  // Public variables (available to client and server)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL must be a valid URL'),
  NEXT_PUBLIC_CONTACT_PHONE_NUMBER: z.string().optional(),
  
  // Server-only variables
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required').optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SUSPEND_EVENT_SMS: z.string().optional(),
  SUSPEND_ALL_SMS: z.string().optional(),
  SMS_SAFETY_GUARDS_ENABLED: z.string().optional(),
  SMS_SAFETY_GLOBAL_HOURLY_LIMIT: z.string().optional(),
  SMS_SAFETY_RECIPIENT_HOURLY_LIMIT: z.string().optional(),
  SMS_SAFETY_RECIPIENT_DAILY_LIMIT: z.string().optional(),
  SMS_SAFETY_IDEMPOTENCY_TTL_HOURS: z.string().optional(),
  EVENT_ENGAGEMENT_SEND_GUARD_WINDOW_MINUTES: z.string().optional(),
  EVENT_ENGAGEMENT_HOURLY_SEND_GUARD_LIMIT: z.string().optional(),
  SUNDAY_PREORDER_SEND_GUARD_WINDOW_MINUTES: z.string().optional(),
  SUNDAY_PREORDER_SEND_GUARD_LIMIT: z.string().optional(),
  MAX_SUNDAY_PREORDER_SMS_PER_RUN: z.string().optional(),
  PARKING_SEND_GUARD_WINDOW_MINUTES: z.string().optional(),
  PARKING_SEND_GUARD_LIMIT: z.string().optional(),
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required').optional(),
  
  // Webhook configuration
  WEBHOOK_BASE_URL: z.string().url().optional(),
  VERCEL_URL: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  SKIP_TWILIO_SIGNATURE_VALIDATION: z.string().optional(),
});

// Create a type from the schema
type Env = z.infer<typeof envSchema>;

// Validate environment variables
function validateEnv(): Env {
  const withTestDefaults =
    process.env.NODE_ENV === 'test'
      ? {
          NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
          ...process.env,
        }
      : process.env;

  try {
    return envSchema.parse(withTestDefaults);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`Environment validation failed:\n${issues.join('\n')}`);
    }
    throw error;
  }
}

// Export validated environment variables
export const env = validateEnv();

// Webhook configuration with smart defaults
export const WEBHOOK_BASE_URL = 
  env.WEBHOOK_BASE_URL || 
  env.NEXT_PUBLIC_SITE_URL ||
  env.NEXT_PUBLIC_APP_URL ||
  (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000');

// Twilio webhook endpoints
export const TWILIO_STATUS_CALLBACK = `${WEBHOOK_BASE_URL}/api/webhooks/twilio`;
export const TWILIO_STATUS_CALLBACK_METHOD = 'POST' as const;

// Export helper functions for optional features
export const isSmsEnabled = () => {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
};

export const isServerActionEnabled = () => {
  return !!env.SUPABASE_SERVICE_ROLE_KEY;
};

// Check if Twilio signature validation should be skipped (development only)
export const skipTwilioSignatureValidation = () => {
  return process.env.NODE_ENV === 'development' && env.SKIP_TWILIO_SIGNATURE_VALIDATION === 'true';
};
