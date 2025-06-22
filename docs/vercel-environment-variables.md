# Vercel Environment Variables

This document lists all the environment variables that need to be configured in your Vercel project settings.

## Required Environment Variables

These variables **MUST** be set for the application to build and run:

```bash
# Application URL (your production URL)
NEXT_PUBLIC_APP_URL=https://management.orangejelly.co.uk

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Optional Environment Variables

These variables enable additional features:

### SMS Features (Twilio)
```bash
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+447700106752
NEXT_PUBLIC_CONTACT_PHONE_NUMBER=+447700106752
```

### Security
```bash
# Generate with: openssl rand -hex 32
CRON_SECRET_KEY=your_cron_secret_key
```

### Google Calendar Integration
```bash
GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
```

### Rate Limiting (Upstash Redis)
```bash
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
```

### Error Tracking (Sentry)
```bash
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn
SENTRY_ORG=your_sentry_org
SENTRY_PROJECT=your_sentry_project
SENTRY_AUTH_TOKEN=your_sentry_auth_token
```

## How to Add Environment Variables to Vercel

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Navigate to "Settings" → "Environment Variables"
4. Add each variable with the appropriate value
5. Select the environments where each variable should be available:
   - Production
   - Preview
   - Development (optional)

## Important Notes

- `NEXT_PUBLIC_*` variables are exposed to the browser, so don't put secrets in them
- Service role keys and auth tokens should only be added to server-side variables
- After adding/updating variables, you need to redeploy for changes to take effect
- Use the "Encrypt" option for sensitive values like API keys and tokens