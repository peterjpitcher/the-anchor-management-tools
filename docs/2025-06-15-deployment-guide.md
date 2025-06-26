# Deployment and Configuration Guide

**Generated on:** 2025-06-15 (consolidated from source files dated 2025-06-15 to 2025-06-22)
**Consolidated from:** 6 files

---


# Deployment Guide

*Source: deployment.md*

# Deployment Guide

This guide covers deploying The Anchor Management Tools to production using Vercel, along with setting up all required services and configurations.

## Prerequisites

Before deploying, ensure you have:
- GitHub repository with the application code
- Vercel account (free tier works)
- Supabase project configured
- Twilio account with SMS credits
- Domain name (optional)

## Deployment Overview

The application uses:
- **Vercel** for hosting and serverless functions
- **Supabase** for database and authentication
- **Twilio** for SMS messaging
- **GitHub Actions** for scheduled tasks

## Step-by-Step Deployment

### 1. Prepare Your Repository

Ensure your repository includes:
- All application code
- `.gitignore` file (excluding `.env.local`)
- `package.json` with all dependencies
- Database migrations in `supabase/migrations/`
- No sensitive data or secrets

### 2. Set Up Vercel

1. **Connect to Vercel**
   ```bash
   npm i -g vercel
   vercel login
   ```

2. **Import Project**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository
   - Select the repository
   - Configure project settings

3. **Configure Build Settings**
   - Framework Preset: Next.js
   - Build Command: `npm run build`
   - Output Directory: `.next`
   - Install Command: `npm install`

### 3. Configure Environment Variables

In Vercel Dashboard → Settings → Environment Variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+44xxxxxxxxxx

# Application
NEXT_PUBLIC_APP_URL=https://management.orangejelly.co.uk
CRON_SECRET=generate-a-secure-random-string
```

### 4. Deploy Initial Version

1. **Trigger Deployment**
   - Push to main branch
   - Or click "Deploy" in Vercel
   - Wait for build completion

2. **Verify Deployment**
   - Check build logs
   - Test application URL
   - Verify environment variables
   - Test basic functionality

### 5. Set Up Database

1. **Run Migrations**
   - Access Supabase SQL Editor
   - Run each migration file in order
   - Verify tables created
   - Check RLS policies

2. **Configure Storage**
   - Create `employee-attachments` bucket
   - Set to private access
   - Configure RLS policies
   - Test file upload

3. **Create Admin User**
   - Go to Authentication → Users
   - Create initial admin account
   - Verify email if required
   - Test login

### 6. Configure GitHub Actions

1. **Set Repository Secrets**
   - Go to Settings → Secrets
   - Add `VERCEL_URL`: Your production URL
   - Add `CRON_SECRET`: Same as in Vercel

2. **Enable Workflow**
   - Check `.github/workflows/reminders.yml`
   - Verify cron schedule
   - Test manual execution
   - Monitor runs

### 7. Custom Domain (Optional)

1. **Add Domain in Vercel**
   - Go to Project Settings → Domains
   - Add your custom domain
   - Follow DNS instructions

2. **Update Environment**
   - Change `NEXT_PUBLIC_APP_URL`
   - Redeploy application
   - Update any hardcoded URLs

3. **Configure SSL**
   - Automatic with Vercel
   - Force HTTPS redirect
   - Test certificate

## Production Configuration

### Performance Optimization

1. **Enable Caching**
   ```javascript
   // next.config.js
   module.exports = {
     images: {
       domains: ['your-supabase-url.supabase.co'],
     },
     headers: async () => [
       {
         source: '/:path*',
         headers: [
           {
             key: 'X-DNS-Prefetch-Control',
             value: 'on'
           },
         ],
       },
     ],
   }
   ```

2. **Database Indexes**
   - Ensure all migrations ran
   - Verify index creation
   - Monitor query performance

### Security Hardening

1. **Environment Variables**
   - Use strong secrets
   - Rotate regularly
   - Never commit to git

2. **API Security**
   - Verify CRON_SECRET
   - Check RLS policies
   - Monitor access logs

3. **Content Security Policy**
   ```javascript
   // Add to next.config.js
   {
     key: 'Content-Security-Policy',
     value: "default-src 'self'; script-src 'self' 'unsafe-eval';"
   }
   ```

### Monitoring Setup

1. **Vercel Analytics**
   - Enable in dashboard
   - Monitor performance
   - Track errors
   - Review metrics

2. **Function Logs**
   - Check function execution
   - Monitor errors
   - Set up alerts
   - Review regularly

3. **Database Monitoring**
   - Supabase dashboard
   - Query performance
   - Storage usage
   - Connection pool

## Deployment Checklist

### Pre-Deployment
- [ ] All code committed
- [ ] Environment variables ready
- [ ] Database migrations tested
- [ ] No hardcoded secrets
- [ ] Dependencies updated

### Deployment
- [ ] Connect to Vercel
- [ ] Configure environment
- [ ] Deploy application
- [ ] Run migrations
- [ ] Create admin user

### Post-Deployment
- [ ] Test authentication
- [ ] Verify SMS sending
- [ ] Check cron jobs
- [ ] Monitor errors
- [ ] Document URLs

## Troubleshooting

### Build Failures
```bash
# Check build logs
vercel logs

# Run build locally
npm run build

# Clear cache
vercel --force
```

### Environment Issues
- Verify all variables set
- Check for typos
- Ensure proper formatting
- No trailing spaces
- Correct scoping

### Database Connection
- Check Supabase status
- Verify credentials
- Test connection pooling
- Review RLS policies
- Check migrations

### SMS Not Sending
- Verify Twilio credentials
- Check phone number format
- Review account balance
- Test with Twilio console
- Check error logs

## Rollback Procedure

If issues arise:

1. **Immediate Rollback**
   - Vercel Dashboard → Deployments
   - Find previous working version
   - Click "..." → Promote to Production
   - Instant rollback

2. **Database Rollback**
   - Prepare rollback scripts
   - Test in development
   - Execute carefully
   - Verify data integrity

3. **Full Recovery**
   - Restore from backups
   - Rerun migrations
   - Verify functionality
   - Monitor closely

## Maintenance

### Regular Tasks
- Monitor deployment health
- Review error logs
- Check performance metrics
- Update dependencies
- Rotate secrets

### Updates
1. Test in development
2. Create staging deployment
3. Verify functionality
4. Deploy to production
5. Monitor for issues

### Backup Strategy
- Database: Automatic via Supabase
- Code: Git repository
- Configurations: Document all
- Secrets: Secure storage
- Files: Regular exports

## Scaling

### Vertical Scaling
- Upgrade Vercel plan
- Increase Supabase tier
- Optimize functions
- Improve caching

### Horizontal Scaling
- Edge functions
- CDN optimization
- Database replicas
- Load balancing

## Support

### Getting Help
- Vercel support
- Supabase community
- GitHub issues
- Documentation
- Error tracking

### Monitoring Resources
- [Vercel Status](https://vercel-status.com)
- [Supabase Status](https://status.supabase.com)
- [Twilio Status](https://status.twilio.com)
- Application logs
- User reports

---


# Staging Environment Deployment Guide

*Source: staging-deployment.md*

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
CRON_SECRET_KEY=generate-secure-key
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

2. Ensure `CRON_SECRET_KEY` is set and matches

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
   - Verify `CRON_SECRET_KEY` matches
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

---


# Configuration Guide

*Source: configuration.md*

# Configuration Guide

This guide covers all configuration options for The Anchor Management Tools, including environment variables, service setup, and application settings.

## Environment Variables

All environment variables should be set in `.env.local` for local development or in your hosting platform's environment settings for production.

### Required Variables

#### Supabase Configuration
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

- **NEXT_PUBLIC_SUPABASE_URL**: Your Supabase project URL (found in project settings)
- **NEXT_PUBLIC_SUPABASE_ANON_KEY**: Public anonymous key for client-side operations
- **SUPABASE_SERVICE_ROLE_KEY**: Secret key for server-side operations (keep this secure!)

#### Twilio Configuration
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

- **TWILIO_ACCOUNT_SID**: Your Twilio account identifier
- **TWILIO_AUTH_TOKEN**: Secret authentication token
- **TWILIO_PHONE_NUMBER**: Your Twilio phone number (must include country code)

#### Application Configuration
```env
NEXT_PUBLIC_APP_URL=https://management.orangejelly.co.uk
CRON_SECRET=your-very-secure-random-string
```

- **NEXT_PUBLIC_APP_URL**: Full URL where your app is hosted
- **CRON_SECRET**: Secret key to secure cron job endpoints (generate a random string)

## Database Configuration

### Initial Setup

The database schema is managed through migration files in `supabase/migrations/`. Run these in order:

1. Employee tables and structure
2. Attachment categories and storage
3. RLS (Row Level Security) policies
4. Performance indexes

### Row Level Security (RLS)

Ensure RLS is enabled for all tables:
- `events` - Only authenticated users can CRUD
- `customers` - Only authenticated users can CRUD
- `bookings` - Only authenticated users can CRUD
- `employees` - Only authenticated users can CRUD
- `employee_notes` - Only authenticated users can CRUD
- `employee_attachments` - Only authenticated users can CRUD

### Storage Configuration

The `employee-attachments` bucket requires specific policies:
- Authenticated users can upload files
- Authenticated users can view files
- Authenticated users can delete files
- Files are organized by employee ID

## SMS Configuration

### Message Templates

SMS templates are defined in `src/lib/smsTemplates.ts`. The system uses three templates:

1. **Booking Confirmation** - Sent immediately when a booking is created
2. **7-Day Reminder** - Sent to all customers 7 days before an event
3. **24-Hour Reminder** - Sent to booked customers 24 hours before an event

### Twilio Settings

Configure your Twilio account:
1. Verify your phone number can send SMS to your target regions
2. Set up a messaging service if needed
3. Configure webhook URLs for delivery status (optional)

### SMS Scheduling

The cron job runs daily at 9:00 AM UTC. Adjust in `.github/workflows/reminders.yml` if needed:
```yaml
schedule:
  - cron: '0 9 * * *'  # 9 AM UTC daily
```

## Application Settings

### Time Zone
The application assumes London timezone for all operations. To change:
1. Update SMS sending logic in `src/app/actions/sms.ts`
2. Adjust cron schedule in GitHub Actions
3. Update date display formatting

### File Upload Limits
Default limits for employee attachments:
- Maximum file size: 10MB
- Allowed file types: PDF, PNG, JPG, JPEG
- Storage path pattern: `{employee_id}/{filename}`

### Session Configuration
Supabase Auth session settings:
- Session duration: 7 days (default)
- Refresh token rotation: Enabled
- JWT expiry: 3600 seconds

## Production Configuration

### Vercel Deployment

Set environment variables in Vercel Dashboard:
1. Go to Project Settings → Environment Variables
2. Add all variables from `.env.local`
3. Ensure variables are available for Production environment

### GitHub Actions

Configure secrets for automated SMS reminders:
1. Go to Repository Settings → Secrets
2. Add `VERCEL_URL` (your production URL)
3. Add `CRON_SECRET` (same as in Vercel)

### Domain Configuration

1. Add your custom domain in Vercel
2. Update `NEXT_PUBLIC_APP_URL` to match
3. Configure SSL certificate (automatic with Vercel)

## Security Configuration

### API Security
- All API routes require authentication
- Cron endpoints validate `CRON_SECRET`
- Server actions use Supabase RLS

### CORS Settings
Next.js handles CORS automatically. For custom API routes:
```typescript
headers: {
  'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL,
  'Access-Control-Allow-Methods': 'POST, GET',
}
```

### Content Security Policy
Add CSP headers for production in `next.config.js`:
```javascript
headers: [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline';"
  }
]
```

## Performance Configuration

### Database Indexes
Critical indexes are created via migrations:
- `bookings.event_id` for event queries
- `bookings.customer_id` for customer queries
- `employee_notes.employee_id` for note lookups
- `employee_attachments.employee_id` for file queries

### Image Optimization
Next.js image optimization is enabled by default:
- Automatic WebP conversion
- Responsive image sizing
- Lazy loading

### Caching
- Static pages are cached at edge
- API responses use appropriate cache headers
- Database queries use Supabase's built-in caching

## Monitoring Configuration

### Error Tracking
Consider adding error tracking in production:
- Sentry for error monitoring
- Vercel Analytics for performance
- Custom logging for SMS operations

### Health Checks
Monitor critical services:
- Database connectivity
- Twilio API status
- Storage bucket availability

## Backup Configuration

### Database Backups
Supabase provides automatic backups:
- Point-in-time recovery (Pro plan)
- Daily backups (Free plan)
- Manual backup option via dashboard

### File Storage Backups
Employee attachments should be backed up:
- Use Supabase's backup features
- Consider external backup solution
- Implement retention policies

---


# Vercel Environment Variables

*Source: vercel-environment-variables.md*

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

# Temporarily disable rate limiting if needed (emergency use only)
# DISABLE_RATE_LIMITING=true
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

---


# Installation Guide

*Source: installation.md*

# Installation Guide

This guide will walk you through setting up The Anchor Management Tools on your local development environment.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18.17 or later ([Download](https://nodejs.org/))
- **npm** 9.6.7 or later (comes with Node.js)
- **Git** for version control ([Download](https://git-scm.com/))
- A code editor (VS Code recommended)

You'll also need accounts for:
- **Supabase** ([Sign up](https://supabase.com))
- **Twilio** ([Sign up](https://www.twilio.com))
- **Vercel** (for deployment) ([Sign up](https://vercel.com))
- **GitHub** (for version control and CI/CD)

## Step-by-Step Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/EventPlanner3.0.git
cd EventPlanner3.0
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including:
- Next.js and React
- Supabase client libraries
- Tailwind CSS
- Twilio SDK
- Other project dependencies

### 3. Set Up Supabase

1. Create a new project in [Supabase Dashboard](https://app.supabase.com)
2. Navigate to Settings → API to find your project credentials
3. Run the database migrations:
   - Go to SQL Editor in Supabase Dashboard
   - Execute each migration file in order from `supabase/migrations/`
   - Start with the earliest timestamp and proceed chronologically

### 4. Configure Environment Variables

Create a `.env.local` file in the root directory:

```bash
cp .env.example .env.local
```

Then edit `.env.local` with your credentials:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Twilio Configuration
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=your-secure-cron-secret
```

### 5. Set Up Storage Buckets

In your Supabase Dashboard:

1. Go to Storage
2. Create a new bucket called `employee-attachments`
3. Set the bucket to private (authenticated access only)
4. Configure RLS policies as defined in the migration files

### 6. Create Initial User

Since there's no public registration:

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Invite User"
3. Enter the email address for the initial admin user
4. The user will receive an email to set their password

### 7. Run the Development Server

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## Verification Steps

After installation, verify everything is working:

1. **Authentication**: Try logging in with your created user
2. **Database**: Check that all tables exist in Supabase
3. **Storage**: Verify the employee-attachments bucket is created
4. **SMS**: Test SMS functionality with a test booking (ensure Twilio is configured)

## Common Installation Issues

### Node Version Issues
If you encounter errors, ensure you're using Node.js 18.17 or later:
```bash
node --version
```

### Database Migration Errors
- Ensure migrations are run in chronological order
- Check that your Supabase service role key has sufficient permissions
- Verify all foreign key relationships are properly established

### Environment Variable Issues
- Double-check all environment variables are correctly set
- Ensure there are no trailing spaces in the `.env.local` file
- Verify Supabase and Twilio credentials are valid

### Port Conflicts
If port 3000 is already in use:
```bash
npm run dev -- -p 3001
```

## Next Steps

Once installation is complete:
1. Review the [Configuration Guide](./configuration.md) for detailed setup options
2. Check the [Development Guide](./development/README.md) for coding standards
3. Read the [Architecture Overview](./architecture/README.md) to understand the system design

## Getting Help

If you encounter issues during installation:
1. Check the [Troubleshooting Guide](./troubleshooting.md)
2. Review the error logs in the console
3. Ensure all prerequisites are properly installed
4. Verify your environment variables are correct

---


# Monitoring Guide

*Source: monitoring.md*

# Monitoring Guide

This guide covers monitoring strategies, tools, and best practices for maintaining The Anchor Management Tools in production.

## Monitoring Overview

Effective monitoring ensures:
- High availability and performance
- Early problem detection
- Data-driven optimization
- Compliance and auditing
- User experience insights

## Available Monitoring Tools

### Vercel Analytics
Built-in analytics for Next.js applications:
- Real User Monitoring (RUM)
- Web Vitals tracking
- Performance metrics
- Error tracking
- Function execution logs

**Setup:**
1. Enable in Vercel Dashboard
2. Add to project settings
3. Review metrics regularly

### Supabase Dashboard
Comprehensive database and service monitoring:
- Query performance
- Storage usage
- Authentication metrics
- API request logs
- Database connections

**Key Metrics:**
- Active connections
- Query execution time
- Storage growth rate
- Auth success/failure rates

### Twilio Console
SMS delivery and communication metrics:
- Message delivery status
- Error rates
- Cost tracking
- Phone number health
- Geographic distribution

### GitHub Actions
Workflow execution monitoring:
- Cron job success/failure
- Execution duration
- Error logs
- Trigger history

## Key Metrics to Monitor

### Application Performance

**Response Times**
- Page load time (target: <3s)
- API response time (target: <500ms)
- Database query time (target: <100ms)
- Function execution time

**Error Rates**
- 4xx errors (client errors)
- 5xx errors (server errors)
- JavaScript errors
- Failed API calls

**Traffic Patterns**
- Daily active users
- Peak usage times
- Page views
- User flow

### Database Metrics

**Performance**
- Query execution time
- Slow query log
- Index usage
- Connection pool utilization

**Storage**
- Database size growth
- File storage usage
- Backup size
- Table row counts

**Health**
- Connection count
- Failed queries
- Deadlocks
- Replication lag

### SMS Metrics

**Delivery**
- Success rate (target: >95%)
- Delivery time
- Failed messages
- Retry attempts

**Cost**
- Messages per day
- Cost per message
- Monthly spend
- Geographic distribution

### Security Metrics

**Authentication**
- Login attempts
- Failed logins
- Session duration
- Password resets

**Access Patterns**
- API usage by endpoint
- File access logs
- Unusual activity
- Geographic anomalies

## Setting Up Monitoring

### Basic Monitoring Setup

1. **Enable Vercel Analytics**
   ```javascript
   // In app/layout.tsx
   import { Analytics } from '@vercel/analytics/react';
   
   export default function RootLayout({ children }) {
     return (
       <html>
         <body>
           {children}
           <Analytics />
         </body>
       </html>
     );
   }
   ```

2. **Custom Event Tracking**
   ```typescript
   // Track custom events
   import { track } from '@vercel/analytics';
   
   // Track booking creation
   track('booking_created', {
     event_id: eventId,
     seats: seatCount
   });
   ```

3. **Error Boundary Setup**
   ```typescript
   // app/error.tsx
   'use client';
   
   export default function Error({
     error,
     reset,
   }: {
     error: Error;
     reset: () => void;
   }) {
     // Log error to monitoring service
     console.error('Application error:', error);
     
     return (
       <div>
         <h2>Something went wrong!</h2>
         <button onClick={reset}>Try again</button>
       </div>
     );
   }
   ```

### Advanced Monitoring

1. **Custom Logging**
   ```typescript
   // lib/logger.ts
   export function logEvent(event: {
     type: string;
     level: 'info' | 'warn' | 'error';
     details: any;
   }) {
     const timestamp = new Date().toISOString();
     
     // Console log for development
     console.log(`[${timestamp}] ${event.level}: ${event.type}`, event.details);
     
     // Send to monitoring service in production
     if (process.env.NODE_ENV === 'production') {
       // Send to logging service
     }
   }
   ```

2. **Performance Monitoring**
   ```typescript
   // Monitor database queries
   async function timedQuery(queryFn: () => Promise<any>, queryName: string) {
     const start = performance.now();
     
     try {
       const result = await queryFn();
       const duration = performance.now() - start;
       
       if (duration > 100) {
         logEvent({
           type: 'slow_query',
           level: 'warn',
           details: { queryName, duration }
         });
       }
       
       return result;
     } catch (error) {
       logEvent({
         type: 'query_error',
         level: 'error',
         details: { queryName, error }
       });
       throw error;
     }
   }
   ```

## Alerting Strategy

### Critical Alerts (Immediate Response)
- Application down
- Database connection lost
- Authentication service failure
- SMS service failure
- Security breach detected

### Warning Alerts (Within Hours)
- High error rate (>5%)
- Slow response times
- Low SMS delivery rate
- Storage near capacity
- Unusual traffic patterns

### Information Alerts (Daily Review)
- Daily SMS count
- New user registrations
- Backup completion
- Performance trends
- Cost thresholds

## Monitoring Dashboards

### Operations Dashboard
Key widgets:
- Application health status
- Current error rate
- Active users
- Recent deployments
- System resources

### Performance Dashboard
- Page load times
- API response times
- Database query performance
- Cache hit rates
- CDN performance

### Business Dashboard
- Daily bookings
- SMS sent/delivered
- User activity
- Feature usage
- Cost tracking

## Incident Response

### Detection
1. Automated alerts trigger
2. User reports issue
3. Routine monitoring check
4. Performance degradation

### Investigation
1. Check monitoring dashboards
2. Review recent changes
3. Analyze error logs
4. Reproduce issue
5. Identify root cause

### Resolution
1. Implement fix
2. Test thoroughly
3. Deploy carefully
4. Monitor closely
5. Document incident

### Post-Mortem
1. Timeline of events
2. Root cause analysis
3. Impact assessment
4. Preventive measures
5. Process improvements

## Log Management

### What to Log
- Authentication events
- API requests
- Database operations
- File operations
- Errors and exceptions
- Security events

### Log Format
```json
{
  "timestamp": "2024-01-20T10:30:00Z",
  "level": "error",
  "service": "api",
  "event": "database_error",
  "details": {
    "query": "SELECT * FROM events",
    "error": "timeout",
    "duration": 5000
  },
  "context": {
    "user_id": "uuid",
    "request_id": "uuid"
  }
}
```

### Log Retention
- Error logs: 90 days
- Access logs: 30 days
- Debug logs: 7 days
- Security logs: 1 year
- Audit logs: 7 years

## Performance Optimization

### Identifying Issues
1. Monitor Web Vitals
2. Track slow queries
3. Analyze bundle size
4. Review network requests
5. Profile React components

### Common Optimizations
- Add database indexes
- Implement caching
- Optimize images
- Reduce bundle size
- Lazy load components

## Maintenance Windows

### Planning Maintenance
1. Schedule during low usage
2. Notify users in advance
3. Prepare rollback plan
4. Monitor during window
5. Verify post-maintenance

### Health Checks
```typescript
// api/health/route.ts
export async function GET() {
  try {
    // Check database
    await supabase.from('events').select('id').limit(1);
    
    // Check storage
    const { data } = await supabase.storage.getBucket('employee-attachments');
    
    return Response.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'operational',
        storage: 'operational',
        auth: 'operational'
      }
    });
  } catch (error) {
    return Response.json({
      status: 'unhealthy',
      error: error.message
    }, { status: 503 });
  }
}
```

## Best Practices

### Do's
- ✅ Set up alerts for critical metrics
- ✅ Review dashboards daily
- ✅ Document incidents
- ✅ Test monitoring systems
- ✅ Keep historical data

### Don'ts
- ❌ Ignore warning signs
- ❌ Alert on everything
- ❌ Skip log rotation
- ❌ Neglect security logs
- ❌ Delay incident response

## Future Monitoring Enhancements

### Planned Additions
1. Real-time monitoring dashboard
2. AI-powered anomaly detection
3. Predictive alerting
4. Custom metric tracking
5. Mobile monitoring app

### Tool Considerations
- Sentry for error tracking
- DataDog for APM
- Grafana for visualization
- ELK stack for logs
- Prometheus for metrics

---

