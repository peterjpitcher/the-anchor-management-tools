# Staging Environment Deployment Guide

This guide explains how to set up and deploy a staging environment for The Anchor Management Tools.

## Overview

The staging environment provides a safe space to test new features and updates before deploying to production. It should mirror production as closely as possible while using separate resources.

## Prerequisites

- Vercel account with access to create new projects
- Supabase account for staging database
- Twilio test account credentials
- GitHub repository access

## Setup Steps

### 1. Create Staging Supabase Project

1. Log in to Supabase Dashboard
2. Create a new project named `anchor-management-staging`
3. Note down:
   - Project URL
   - Anon Key
   - Service Role Key

### 2. Configure Database

1. Run all migrations from `/supabase/migrations/` in order
2. Set up initial data:
   ```sql
   -- Insert test event categories
   INSERT INTO event_categories (name, description, standardized_name) VALUES
   ('Quiz Night', 'Weekly quiz events', 'quiz_night'),
   ('Live Music', 'Live music performances', 'live_music'),
   ('Private Events', 'Private bookings and parties', 'private_event');
   
   -- Insert test employees
   INSERT INTO employees (first_name, last_name, job_role, status) VALUES
   ('Test', 'Manager', 'Manager', 'active'),
   ('Test', 'Staff', 'Bar Staff', 'active');
   ```

### 3. Set Up Twilio Test Account

1. Use Twilio test credentials (not production)
2. Configure test phone numbers:
   - `+15005550006` - Valid test number
   - Use Twilio's test numbers for different scenarios

### 4. Create Vercel Staging Project

1. Create new Vercel project: `anchor-management-staging`
2. Connect to same GitHub repository
3. Configure deployment settings:
   - Framework: Next.js
   - Build Command: `npm run build`
   - Output Directory: `.next`
   - Install Command: `npm install`

### 5. Configure Environment Variables

In Vercel project settings, add all environment variables from `.env.staging.example`:

```bash
# Critical variables to configure:
NEXT_PUBLIC_APP_URL=https://anchor-management-staging.vercel.app
NEXT_PUBLIC_SUPABASE_URL=your-staging-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-staging-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-staging-service-role-key
TWILIO_ACCOUNT_SID=your-test-sid
TWILIO_AUTH_TOKEN=your-test-token
TWILIO_PHONE_NUMBER=+15005550006
CRON_SECRET=generate-secure-key
SKIP_TWILIO_SIGNATURE_VALIDATION=true
```

### 6. Set Up Staging Branch

1. Create a `staging` branch in Git:
   ```bash
   git checkout -b staging
   git push -u origin staging
   ```

2. Configure Vercel to deploy from `staging` branch:
   - Go to Project Settings > Git
   - Set Production Branch to `staging`

### 7. Configure Cron Jobs

1. In Vercel, add cron jobs to `vercel.json`:
   ```json
   {
     "crons": [{
       "path": "/api/cron/reminders",
       "schedule": "0 9 * * *"
     }]
   }
   ```

2. Ensure `CRON_SECRET` is set and matches

### 8. Test Webhooks

Configure Twilio test webhooks:
- Status Callback URL: `https://your-staging-url.vercel.app/api/webhooks/twilio`
- Message Status Callback: Same URL

## Deployment Workflow

### 1. Feature Development
```bash
# Create feature branch from main
git checkout main
git pull origin main
git checkout -b feature/new-feature

# Make changes and test locally
npm run dev

# Commit changes
git add .
git commit -m "Add new feature"
git push origin feature/new-feature
```

### 2. Deploy to Staging
```bash
# Merge to staging branch
git checkout staging
git merge feature/new-feature
git push origin staging

# Vercel will automatically deploy
```

### 3. Test in Staging
- Run through test scenarios
- Check error logs in Vercel
- Monitor Supabase logs
- Test SMS functionality with Twilio test numbers

### 4. Deploy to Production
```bash
# After staging tests pass
git checkout main
git merge staging
git push origin main
```

## Testing Checklist

### Core Functionality
- [ ] User authentication
- [ ] Event CRUD operations
- [ ] Customer management
- [ ] Booking creation and management
- [ ] Employee management with attachments

### SMS Features
- [ ] Booking confirmations
- [ ] Event reminders (7-day and 24-hour)
- [ ] Bulk SMS sending
- [ ] Two-way messaging
- [ ] Opt-out handling

### Background Jobs
- [ ] Job queue processing
- [ ] Retry logic for failures
- [ ] Job monitoring dashboard

### Security
- [ ] RBAC permissions
- [ ] Audit logging
- [ ] Rate limiting
- [ ] GDPR compliance features

## Monitoring

### Vercel Dashboard
- Function logs
- Build logs
- Analytics
- Error tracking

### Supabase Dashboard
- Database logs
- Query performance
- Storage usage

### Application Monitoring
- Background jobs page: `/settings/background-jobs`
- Audit logs: `/settings/audit-logs`
- SMS health: `/settings/sms-health`

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Check Supabase service is running
   - Verify environment variables
   - Check connection pooling limits

2. **SMS Not Sending**
   - Verify Twilio test credentials
   - Check webhook signature validation is disabled
   - Review Twilio logs

3. **Cron Jobs Not Running**
   - Verify `CRON_SECRET` matches
   - Check Vercel cron configuration
   - Review function logs

### Debug Mode

Enable debug logging by setting:
```bash
DEBUG=true
LOG_LEVEL=debug
```

## Rollback Procedure

If issues are found in staging:

1. Revert staging branch:
   ```bash
   git checkout staging
   git revert HEAD
   git push origin staging
   ```

2. Or reset to main:
   ```bash
   git checkout staging
   git reset --hard origin/main
   git push --force origin staging
   ```

## Security Considerations

### Staging-Specific Settings
- Use test API keys only
- Enable `SKIP_TWILIO_SIGNATURE_VALIDATION` for webhook testing
- Use separate Supabase project
- Don't use production data

### Data Protection
- Regularly clean test data
- Use anonymized data for testing
- Don't copy production database

## Maintenance

### Regular Tasks
- Weekly: Clear old test data
- Monthly: Update dependencies in staging first
- Quarterly: Review and update staging configuration

### Database Maintenance
```sql
-- Clean old test messages (monthly)
DELETE FROM messages 
WHERE created_at < NOW() - INTERVAL '30 days'
AND customer_id IN (
  SELECT id FROM customers 
  WHERE first_name = 'Test' 
  OR first_name = 'Unknown'
);

-- Clean old background jobs
DELETE FROM background_jobs
WHERE status IN ('completed', 'failed')
AND created_at < NOW() - INTERVAL '7 days';
```

## Contact

For staging environment issues:
- Check Vercel status page
- Review Supabase status
- Contact: support@orangejelly.co.uk