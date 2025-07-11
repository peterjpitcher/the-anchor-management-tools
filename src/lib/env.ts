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
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required').optional(),
});

// Create a type from the schema
type Env = z.infer<typeof envSchema>;

// Validate environment variables
function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
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

// Export helper functions for optional features
export const isSmsEnabled = () => {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
};

export const isServerActionEnabled = () => {
  return !!env.SUPABASE_SERVICE_ROLE_KEY;
};