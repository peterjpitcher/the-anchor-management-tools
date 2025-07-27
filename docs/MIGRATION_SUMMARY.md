# SMS and Cron Job Migration Summary

## Issues Fixed

### 1. Phone Number Correction ✅
- **Changed**: NEXT_PUBLIC_CONTACT_PHONE_NUMBER from `+447700106752` to `01753682707`
- **Updated**: SMS templates to use environment variable instead of hardcoded values
- **Note**: SMS messages now correctly show "Call us on 01753682707"

### 2. GitHub Actions Migration ✅
All cron jobs have been migrated from Vercel to GitHub Actions:

| Job | Schedule | Purpose | Status |
|-----|----------|---------|--------|
| SMS Job Processor | Every 5 minutes | Process queued SMS messages | ✅ Created |
| Daily Reminders | 9 AM UTC | Send event reminders | ✅ Exists |
| Recurring Invoices | 8 AM UTC | Process recurring invoices | ✅ Created |
| Invoice Reminders | 10 AM UTC | Send invoice reminders | ✅ Created |
| Customer Labels | 2 AM UTC | Apply customer labels | ✅ Created |
| Birthday Reminders | 8 AM UTC | Send birthday wishes | ✅ Created |
| Table Booking Reminders | Every 4 hours | Send booking reminders | ✅ Created |
| Cleanup Rate Limits | Midnight UTC | Clean rate limit data | ✅ Created |
| Table Booking Monitoring | Every hour | Monitor bookings | ✅ Created |

## URGENT ACTION REQUIRED

### 1. Add GitHub Secrets
**The GitHub Actions are failing because secrets are not set!**

Go to: https://github.com/peterjpitcher/the-anchor-management-tools/settings/secrets/actions

Add these secrets from your Vercel environment:
- `CRON_SECRET` (copy from Vercel - REQUIRED)
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL` (set to: https://management.orangejelly.co.uk)

### 2. Update Vercel Environment Variable
In your Vercel dashboard, update:
- `NEXT_PUBLIC_CONTACT_PHONE_NUMBER` = `01753682707`

### 3. Deploy Changes
```bash
git add -A
git commit -m "Migrate cron jobs to GitHub Actions and fix contact phone number"
git push origin main
```

## Testing the Migration

### Test SMS Job Processing (Most Critical)
1. Go to GitHub Actions tab
2. Select "SMS Job Processor" workflow
3. Click "Run workflow" → "Run workflow"
4. Check logs for success

### Test a Booking SMS
After the job processor is running:
1. Create a test table booking
2. Check if SMS is sent within 5 minutes

### Monitor All Workflows
Check the Actions tab regularly for the first 24 hours to ensure all cron jobs are running successfully.

## Files Changed
- `.env.local` - Updated phone number
- `.github/workflows/` - Added 8 new workflow files
- `src/lib/smsTemplates.ts` - Fixed hardcoded phone numbers
- `docs/` - Added migration documentation

## Next Steps
1. Remove Vercel cron configuration (after confirming GitHub Actions work)
2. Monitor workflows for 24 hours
3. Update any remaining hardcoded phone numbers in UI components

## Troubleshooting
- If workflows fail with "CRON_SECRET not set" - add it to GitHub secrets
- If SMS not sending - check job processor logs
- If phone number wrong in SMS - redeploy after updating Vercel env