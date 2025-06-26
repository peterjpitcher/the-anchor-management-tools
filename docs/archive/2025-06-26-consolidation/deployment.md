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