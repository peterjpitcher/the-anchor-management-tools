# Deployment Guide

This comprehensive guide covers deploying The Anchor Management Tools across different environments, including development, staging, and production.

## Table of Contents

1. [Deployment Overview](#deployment-overview)
2. [Environment Setup](#environment-setup)
3. [Environment Variables](#environment-variables)
4. [Vercel Deployment](#vercel-deployment)
5. [Supabase Setup](#supabase-setup)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Monitoring and Logging](#monitoring-and-logging)
8. [Rollback Procedures](#rollback-procedures)
9. [Security Considerations](#security-considerations)
10. [Troubleshooting](#troubleshooting)

## Deployment Overview

The Anchor Management Tools uses a modern serverless architecture:

- **Hosting**: Vercel (serverless functions and edge network)
- **Database**: Supabase (PostgreSQL with RLS)
- **Authentication**: Supabase Auth
- **File Storage**: Supabase Storage
- **SMS**: Twilio
- **Email**: Microsoft Graph API
- **CI/CD**: GitHub Actions
- **Monitoring**: Vercel Analytics, Supabase Dashboard

### Infrastructure Requirements

- Node.js 20.x (LTS)
- npm 9.6.7 or later
- Git for version control
- Accounts for: Vercel, Supabase, Twilio, GitHub

## Environment Setup

### Development Environment

1. **Clone Repository**
   ```bash
   git clone https://github.com/your-username/anchor-management-tools.git
   cd anchor-management-tools
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your development credentials
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   # Access at http://localhost:3000
   ```

### Staging Environment

Staging mirrors production but uses separate resources for safe testing.

1. **Create Staging Branch**
   ```bash
   git checkout -b staging
   git push -u origin staging
   ```

2. **Create Staging Resources**
   - Supabase: Create project named `anchor-management-staging`
   - Vercel: Create project `anchor-management-staging`
   - Twilio: Use test credentials

3. **Configure Staging Deploy**
   - Set Vercel production branch to `staging`
   - Configure staging-specific environment variables
   - Enable `SKIP_TWILIO_SIGNATURE_VALIDATION=true` for testing

### Production Environment

Production URL: https://management.orangejelly.co.uk

1. **Production Branch**: `main`
2. **Auto-deploy**: Enabled on push to main
3. **Environment**: Production variables in Vercel

## Environment Variables

### Required Variables

```bash
# Application
NEXT_PUBLIC_APP_URL=https://management.orangejelly.co.uk

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Security
CRON_SECRET=your-very-secure-random-string  # Generate with: openssl rand -hex 32
```

### Optional Features

```bash
# SMS (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+447700106752
NEXT_PUBLIC_CONTACT_PHONE_NUMBER=+447700106752

# Email (Microsoft Graph)
MICROSOFT_TENANT_ID=your-tenant-id
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_USER_EMAIL=sender@domain.com

# Google Calendar Integration
GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
GOOGLE_CALENDAR_INTERVIEW_ID=your_ops_calendar_id@group.calendar.google.com
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'

# Rate Limiting (Upstash Redis)
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token

# Error Tracking (Sentry)
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn
SENTRY_ORG=your_sentry_org
SENTRY_PROJECT=your_sentry_project
SENTRY_AUTH_TOKEN=your_sentry_auth_token

# Development/Testing
SKIP_TWILIO_SIGNATURE_VALIDATION=true  # Staging only
DEBUG=true  # Enable debug logging
LOG_LEVEL=debug
```

### Environment Variable Security

- `NEXT_PUBLIC_*` variables are exposed to the browser (no secrets!)
- Service keys and tokens are server-side only
- Use Vercel's encryption for sensitive values
- Rotate secrets regularly
- Never commit `.env.local` to Git

## Vercel Deployment

### Initial Setup

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   vercel login
   ```

2. **Import Project**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import GitHub repository
   - Configure build settings:
     - Framework Preset: Next.js
     - Build Command: `npm run build`
     - Output Directory: `.next`
     - Install Command: `npm install`

3. **Configure Environment Variables**
   - Navigate to Settings → Environment Variables
   - Add all required variables
   - Select appropriate environments (Production/Preview/Development)

4. **Deploy**
   ```bash
   vercel --prod  # Manual production deploy
   # Or push to main branch for auto-deploy
   ```

### Build Configuration

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
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload'
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff'
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY'
        },
        {
          key: 'X-XSS-Protection',
          value: '1; mode=block'
        },
        {
          key: 'Referrer-Policy',
          value: 'origin-when-cross-origin'
        }
      ],
    },
  ],
}
```

### Function Configuration

```json
// vercel.json
{
  "functions": {
    "api/cron/reminders.ts": {
      "maxDuration": 60
    },
    "api/jobs/process.ts": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/reminders",
      "schedule": "0 10 * * *"
    },
    {
      "path": "/api/jobs/process",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Note: the reminder cron must run **after 10:00 Europe/London**. If `CRON_SECRET` is set, the endpoint requires an `Authorization: Bearer <CRON_SECRET>` header.

### Custom Domain Setup

1. **Add Domain in Vercel**
   - Project Settings → Domains
   - Add custom domain
   - Configure DNS:
     ```
     Type  Name    Value
     A     @       76.76.21.21
     CNAME www     cname.vercel-dns.com
     ```

2. **Update Environment**
   - Change `NEXT_PUBLIC_APP_URL` to custom domain
   - Redeploy application

3. **SSL Certificate**
   - Automatic with Vercel
   - Force HTTPS enabled by default

## Supabase Setup

### Database Migration Strategy

The project uses **placeholder migrations** to maintain sync with production:

1. **Migration Files Location**: `/supabase/migrations/`
2. **Naming Convention**: `YYYYMMDDHHMMSS_description.sql`
3. **Placeholder Files**: `*_remote_placeholder.sql` (DO NOT DELETE)

### Running Migrations

1. **Access SQL Editor** in Supabase Dashboard
2. **Execute Migrations** in chronological order
3. **Verify Success** by checking tables and RLS policies

### Creating New Migrations

```bash
# Create new migration
supabase migration new feature_name

# Edit the file following this template:
```

```sql
-- Description: What this migration does

-- Create table (idempotent)
CREATE TABLE IF NOT EXISTS table_name (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Add policies
CREATE POLICY "Users can view based on permissions" ON table_name
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'module_name', 'view')
  );

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_table_name_created_at 
  ON table_name(created_at DESC);

-- Add column (with check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_name' AND column_name = 'new_column'
  ) THEN
    ALTER TABLE table_name ADD COLUMN new_column VARCHAR(255);
  END IF;
END $$;
```

### Storage Configuration

1. **Create Buckets**
   - `employee-attachments` (private)
   - Configure RLS policies

2. **File Organization**
   - Pattern: `{employee_id}/{filename}`
   - Max size: 10MB
   - Allowed types: PDF, PNG, JPG, JPEG

### Initial Admin User

1. Supabase Dashboard → Authentication → Users
2. Click "Invite User"
3. Enter admin email address
4. User receives email to set password

## CI/CD Pipeline

### GitHub Actions Configuration

1. **Repository Secrets**
   ```
   VERCEL_URL=https://management.orangejelly.co.uk
   CRON_SECRET=same-as-vercel-env
   ```

2. **Workflows**
   ```yaml
   # .github/workflows/reminders.yml
   name: Send Event Reminders
   on:
    schedule:
       - cron: '0 10 * * *'  # 10 AM UTC daily (after 10:00 London)
    workflow_dispatch:  # Manual trigger
   
   jobs:
     send-reminders:
       runs-on: ubuntu-latest
       steps:
         - name: Trigger reminder job
           run: |
             curl -X POST "${{ secrets.VERCEL_URL }}/api/cron/reminders" \
               -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"

### Reminder Pipelines Safety

- Production runs only the scheduled reminder pipeline; the legacy sender has been removed.
- Ensure no ad-hoc direct-sending scripts are executed against production.
   ```

### Deployment Workflow

1. **Feature Development**
   ```bash
   git checkout -b feature/new-feature
   # Make changes
   git add .
   git commit -m "feat: add new feature"
   git push origin feature/new-feature
   ```

2. **Staging Deployment**
   ```bash
   git checkout staging
   git merge feature/new-feature
   git push origin staging
   # Automatic deploy to staging
   ```

3. **Production Deployment**
   ```bash
   git checkout main
   git merge staging
   git push origin main
   # Automatic deploy to production
   ```

### Pre-Deployment Checklist

- [ ] Run `npm run lint` - must pass
- [ ] Run `npm run build` - must succeed
- [ ] Test all user roles
- [ ] Verify mobile responsiveness
- [ ] Check error handling
- [ ] Review environment variables
- [ ] Database migrations prepared
- [ ] Backup production database

## Monitoring and Logging

### Vercel Analytics

1. **Enable Analytics**
   ```javascript
   // app/layout.tsx
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

2. **Track Custom Events**
   ```typescript
   import { track } from '@vercel/analytics';
   
   track('booking_created', {
     event_id: eventId,
     seats: seatCount
   });
   ```

### Application Monitoring

- **Vercel Dashboard**: Function logs, build logs, performance metrics
- **Supabase Dashboard**: Query performance, storage usage, auth metrics
- **Twilio Console**: SMS delivery status, error rates, costs
- **Application Pages**:
  - Background Jobs: `/settings/background-jobs`
  - Audit Logs: `/settings/audit-logs`
  - SMS Health: `/settings/sms-health`

### Health Check Endpoint

```typescript
// app/api/health/route.ts
export async function GET() {
  try {
    // Check critical services
    const checks = await Promise.all([
      checkDatabase(),
      checkStorage(),
      checkAuth(),
    ]);
    
    return Response.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: checks[0] ? 'operational' : 'down',
        storage: checks[1] ? 'operational' : 'down',
        auth: checks[2] ? 'operational' : 'down'
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

### Alert Configuration

**Critical Alerts** (Immediate Response):
- Application down
- Database connection lost
- Authentication failure
- SMS service failure

**Warning Alerts** (Within Hours):
- High error rate (>5%)
- Slow response times
- Low SMS delivery rate
- Storage near capacity

**Information Alerts** (Daily Review):
- Daily usage statistics
- Cost tracking
- Performance trends

## Rollback Procedures

### Vercel Rollback

1. **Immediate Rollback**
   - Vercel Dashboard → Deployments
   - Find previous working version
   - Click "..." → Promote to Production
   - Instant rollback complete

2. **Git-Based Rollback**
   ```bash
   # Revert last commit
   git revert HEAD
   git push origin main
   
   # Or reset to specific commit
   git reset --hard <commit-hash>
   git push --force origin main
   ```

### Database Rollback

1. **Prepare Rollback Scripts**
   ```sql
   -- Example rollback
   DROP TABLE IF EXISTS new_table;
   ALTER TABLE existing_table DROP COLUMN IF EXISTS new_column;
   ```

2. **Execute Rollback**
   - Test in development first
   - Run in production SQL editor
   - Verify data integrity

3. **Restore from Backup**
   - Supabase provides automatic backups
   - Point-in-time recovery (Pro plan)
   - Contact support for restoration

### Emergency Procedures

1. **Service Degradation**
   ```typescript
   // Enable maintenance mode
   export const config = {
     maintenance: true,
     message: 'System maintenance in progress'
   };
   ```

2. **Disable Features**
   ```bash
   # Temporarily disable SMS
   DISABLE_SMS=true
   
   # Disable rate limiting
   DISABLE_RATE_LIMITING=true
   ```

## Security Considerations

### Production Security Checklist

- [ ] All secrets rotated from development
- [ ] RLS policies enabled and tested
- [ ] RBAC permissions configured
- [ ] Audit logging enabled
- [ ] Rate limiting active
- [ ] CORS properly configured
- [ ] CSP headers set
- [ ] SSL/TLS enforced
- [ ] Webhook signatures validated
- [ ] File upload restrictions in place

### API Security

```typescript
// Validate webhook signatures
import { validateWebhookSignature } from '@/lib/security';

export async function POST(request: Request) {
  if (!validateWebhookSignature(request)) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Process webhook
}
```

### Data Protection

- Personal data encrypted at rest
- Secure session management
- GDPR compliance features enabled
- Regular security audits
- Automated vulnerability scanning

## Troubleshooting

### Common Issues

#### Build Failures
```bash
# Check build logs
vercel logs

# Run build locally
npm run build

# Clear cache and rebuild
vercel --force
```

#### Database Connection Errors
- Check Supabase service status
- Verify connection string
- Check connection pool limits
- Review RLS policies

#### SMS Not Sending
- Verify Twilio credentials
- Check phone number format (+44...)
- Review account balance
- Check webhook logs
- Verify customer messaging health

#### Environment Variable Issues
- Check for typos
- Ensure proper formatting (no trailing spaces)
- Verify correct scoping (NEXT_PUBLIC_*)
- Confirm variables are set in correct environment

### Debug Mode

Enable detailed logging:
```bash
DEBUG=true
LOG_LEVEL=debug
```

### Performance Issues

1. **Check Database Queries**
   ```sql
   -- Find slow queries
   SELECT query, mean_time, calls
   FROM pg_stat_statements
   ORDER BY mean_time DESC
   LIMIT 10;
   ```

2. **Optimize Bundle Size**
   ```bash
   npm run analyze
   ```

3. **Monitor Function Duration**
   - Check Vercel function logs
   - Identify timeout issues
   - Optimize long-running operations

### Support Resources

- **Vercel**: [vercel.com/support](https://vercel.com/support)
- **Supabase**: [supabase.com/docs](https://supabase.com/docs)
- **Status Pages**:
  - [Vercel Status](https://vercel-status.com)
  - [Supabase Status](https://status.supabase.com)
  - [Twilio Status](https://status.twilio.com)

## Maintenance

### Regular Tasks

**Daily**:
- Monitor error logs
- Check SMS delivery rates
- Review performance metrics

**Weekly**:
- Clear old test data (staging)
- Review security alerts
- Check backup status

**Monthly**:
- Update dependencies
- Rotate API keys
- Review cost optimization
- Clean old job records

**Quarterly**:
- Security audit
- Performance review
- Disaster recovery test
- Documentation update

### Database Maintenance

```sql
-- Clean old messages (monthly)
DELETE FROM messages 
WHERE created_at < NOW() - INTERVAL '90 days'
AND status = 'delivered';

-- Clean old jobs
DELETE FROM jobs
WHERE status IN ('completed', 'failed')
AND created_at < NOW() - INTERVAL '30 days';

-- Vacuum and analyze
VACUUM ANALYZE;
```

### Scaling Considerations

**Vertical Scaling**:
- Upgrade Vercel plan for more resources
- Increase Supabase tier for performance
- Optimize database queries
- Implement caching strategies

**Horizontal Scaling**:
- Enable Vercel Edge Functions
- Implement CDN for static assets
- Use database read replicas
- Distribute background jobs

---

For detailed feature documentation, see the `/docs` directory. For development guidelines, refer to `docs/CONTRIBUTING.md`.
