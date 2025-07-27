# GitHub Secrets Setup Guide

## URGENT: Add CRON_SECRET to GitHub Repository

The GitHub Actions are failing because CRON_SECRET is not set in your repository secrets. Here's how to fix it:

### Steps to Add CRON_SECRET:

1. **Get the CRON_SECRET value from Vercel:**
   - Go to your Vercel project dashboard
   - Navigate to Settings → Environment Variables
   - Find and copy the value of `CRON_SECRET`

2. **Add to GitHub Repository:**
   - Go to your GitHub repository: https://github.com/peterjpitcher/the-anchor-management-tools
   - Click on "Settings" tab
   - In the left sidebar, click "Secrets and variables" → "Actions"
   - Click "New repository secret"
   - Name: `CRON_SECRET`
   - Value: Paste the value from Vercel
   - Click "Add secret"

### Other Secrets You Should Add (for complete functionality):

While you're there, add these secrets from your Vercel environment variables:

1. **SUPABASE_SERVICE_ROLE_KEY** - Required for database operations
2. **TWILIO_ACCOUNT_SID** - Required for SMS sending
3. **TWILIO_AUTH_TOKEN** - Required for SMS sending
4. **TWILIO_PHONE_NUMBER** - Required for SMS sending
5. **NEXT_PUBLIC_SUPABASE_URL** - Required for database connection
6. **NEXT_PUBLIC_SUPABASE_ANON_KEY** - Required for database connection
7. **NEXT_PUBLIC_APP_URL** - Should be: https://management.orangejelly.co.uk

### Verification:

After adding the secrets, you can manually trigger the reminder workflow to test:
1. Go to Actions tab in GitHub
2. Select "Daily SMS Reminders" workflow
3. Click "Run workflow"
4. Check the logs to ensure it runs successfully