# Troubleshooting Guide

This comprehensive guide helps diagnose and resolve common issues with The Anchor Management Tools.

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Authentication Issues](#authentication-issues)
3. [Database Issues](#database-issues)
4. [SMS and Messaging Issues](#sms-and-messaging-issues)
5. [File Upload and Storage Issues](#file-upload-and-storage-issues)
6. [Google Calendar Integration](#google-calendar-integration)
7. [Build and Deployment Issues](#build-and-deployment-issues)
8. [Performance Issues](#performance-issues)
9. [API and Integration Issues](#api-and-integration-issues)
10. [Common Error Messages](#common-error-messages)
11. [Debugging Techniques](#debugging-techniques)
12. [Support Resources](#support-resources)

## Quick Diagnostics

Before diving into specific issues, run these checks:

### 1. System Health Check
```bash
# Run comprehensive system check
echo "=== System Health Check ===" > health-check-$(date +%Y%m%d-%H%M%S).log
npm run lint >> health-check-*.log 2>&1
npm run build >> health-check-*.log 2>&1
tsx scripts/test-connectivity.ts >> health-check-*.log 2>&1
cat health-check-*.log
```

### 2. Environment Variables Check
```bash
# Verify all required variables are set
tsx scripts/check-env-vars.ts
```

### 3. Database Connection Test
```bash
# Test database connectivity
tsx scripts/test-connectivity.ts
```

### 4. Critical Flows Test
```bash
# Test critical application flows
tsx scripts/test-critical-flows.ts
```

## Authentication Issues

### Cannot Log In

**Symptoms:**
- Login form doesn't submit
- "Invalid credentials" error
- Redirects back to login page
- Session not persisting

**Solutions:**

1. **Verify User Exists**
   ```sql
   -- Check user in Supabase Auth
   SELECT email, confirmed_at, last_sign_in_at 
   FROM auth.users 
   WHERE email = 'user@example.com';
   ```

2. **Check Email Confirmation**
   - Ensure user's email is confirmed
   - Check `confirmed_at` field is not null

3. **Clear Browser Data**
   ```javascript
   // In browser console
   localStorage.clear();
   sessionStorage.clear();
   // Clear cookies for the domain
   ```

4. **Verify Environment Variables**
   ```bash
   echo $NEXT_PUBLIC_SUPABASE_URL
   echo $NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```

5. **Check Middleware Configuration**
   ```typescript
   // Verify in middleware.ts
   const { data: { session } } = await supabase.auth.getSession()
   console.log('Session:', session)
   ```

### Session Not Persisting

**Solutions:**

1. **Check Cookie Settings**
   - Ensure cookies are enabled in browser
   - Verify domain configuration matches

2. **Review Session Duration**
   - Check Supabase Auth settings
   - Default session duration is 1 week

3. **Test Different Browsers**
   - Rule out browser-specific issues
   - Check for extensions blocking cookies

## Database Issues

### Tables Not Found

**Symptoms:**
- "Relation does not exist" errors
- 404 errors from Supabase
- "Table not found" in logs

**Solutions:**

1. **Run All Migrations**
   ```bash
   # Check migration status
   supabase migration list
   
   # Apply pending migrations
   supabase db push
   ```

2. **Verify Table Names**
   ```sql
   -- List all tables
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public'
   ORDER BY table_name;
   ```

3. **Check RLS Policies**
   ```sql
   -- Check if RLS is enabled
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE schemaname = 'public';
   ```

### Permission Denied Errors

**Symptoms:**
- "permission denied for table" errors
- Can read but not write data
- Inconsistent access between roles

**Solutions:**

1. **Review RLS Policies**
   ```sql
   -- Check policies for a table
   SELECT * FROM pg_policies 
   WHERE tablename = 'your_table';
   ```

2. **Verify User Authentication**
   ```typescript
   // Check auth in server action
   const supabase = await createClient();
   const { data: { user } } = await supabase.auth.getUser();
   console.log('Authenticated user:', user?.id);
   ```

3. **Use Service Role for Admin Operations**
   ```typescript
   // For admin operations only
   const supabase = await createAdminClient();
   ```

### Database Migration Issues

**Common Problems:**
- Migration files out of sync
- Remote migrations not found locally
- "Migration not found" errors

**Solutions:**

1. **Use Placeholder Strategy**
   - The project uses placeholder migrations for sync
   - Never delete `*_remote_placeholder.sql` files
   - Create new migrations instead of modifying existing

2. **Create New Migration**
   ```bash
   # Always create new migrations
   supabase migration new feature_name
   
   # Edit the file
   # Then push to remote
   supabase db push
   ```

3. **Reference Schema**
   ```bash
   # View current schema for reference
   cat schema.sql
   ```

## SMS and Messaging Issues

### Messages Not Sending

**Symptoms:**
- No SMS received by customers
- No errors shown in UI
- Twilio dashboard shows no activity
- Templates not being used

**Solutions:**

1. **Verify Twilio Credentials**
   ```bash
   # Check environment variables
   echo $TWILIO_ACCOUNT_SID
   echo $TWILIO_AUTH_TOKEN
   echo $TWILIO_PHONE_NUMBER
   ```

2. **Check Phone Number Format**
   ```typescript
   // Numbers must be in E.164 format
   // Convert UK numbers: 07123456789 → +447123456789
   ```

3. **Test Twilio Connection**
   ```bash
   # Run SMS test script
   tsx scripts/test-sms-connection.ts
   ```

4. **Check SMS Templates**
   ```bash
   # Verify templates are active
   tsx scripts/verify-message-templates.ts
   
   # Check template loading
   tsx scripts/test-template-loading.ts
   ```

5. **Monitor Job Queue**
   ```sql
   -- Check SMS jobs
   SELECT * FROM jobs 
   WHERE type LIKE '%sms%' 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

### Bulk SMS Not Working

**Symptoms:**
- Bulk messages queued but not sent
- Small batches not sending immediately
- Jobs stuck in pending state

**Solutions:**

1. **Check Bulk SMS Status**
   ```bash
   tsx scripts/check-bulk-sms-jobs.ts
   ```

2. **Process Jobs Manually**
   ```bash
   tsx scripts/process-sms-jobs.ts
   ```

3. **View Pending Messages**
   ```bash
   tsx scripts/show-pending-bulk-sms.ts
   ```

### SMS Templates Not Loading

**Symptoms:**
- Using hard-coded templates instead of database templates
- Templates exist but aren't being used

**Solutions:**

1. **Disable Template Cache**
   ```bash
   # Add to environment variables
   DISABLE_TEMPLATE_CACHE=true
   ```

2. **Verify Templates Configuration**
   ```bash
   tsx scripts/check-production-templates.ts
   ```

3. **Check Template Defaults**
   ```sql
   -- Ensure templates are marked as default
   SELECT * FROM message_templates 
   WHERE is_default = true AND is_active = true;
   ```

## File Upload and Storage Issues

### Upload Fails

**Symptoms:**
- "Failed to upload" error
- File appears to upload but not saved
- Size or type restriction errors

**Solutions:**

1. **Check File Constraints**
   - Max size: 10MB
   - Allowed types vary by feature
   - Check browser console for details

2. **Verify Storage Bucket**
   ```sql
   -- Check bucket exists
   SELECT * FROM storage.buckets;
   ```

3. **Test with Small File**
   ```javascript
   // Debug upload
   console.log('File size:', file.size);
   console.log('File type:', file.type);
   ```

4. **Check Storage Policies**
   ```sql
   -- Review bucket policies
   SELECT * FROM storage.policies 
   WHERE bucket_id = 'employee-attachments';
   ```

### Cannot Download Files

**Symptoms:**
- 404 errors on download
- "Object not found" errors
- Signed URL expired

**Solutions:**

1. **Verify File Exists**
   ```typescript
   const { data } = await supabase.storage
     .from('employee-attachments')
     .list(employeeId);
   console.log('Files:', data);
   ```

2. **Check Storage Path**
   ```sql
   -- Verify path in database matches storage
   SELECT file_path FROM employee_attachments 
   WHERE id = 'attachment-id';
   ```

3. **Generate Fresh URL**
   - Signed URLs expire after 1 hour
   - Regenerate if expired

## Google Calendar Integration

### Calendar Not Configured

**Symptoms:**
- "Calendar not configured" errors
- Events not appearing in calendar
- Authentication failures

**Solutions:**

1. **Check Configuration**
   ```bash
   # Run calendar debug script
   tsx scripts/debug-google-calendar.ts
   ```

2. **Test Calendar Connection**
   - Navigate to `/settings/calendar-test`
   - Click "Test Connection"
   - Review detailed results

3. **Verify Environment Variables**
   ```bash
   echo $GOOGLE_CALENDAR_ID
   echo $GOOGLE_SERVICE_ACCOUNT_KEY | jq .
   ```

### Permission Denied (403)

**Solutions:**

1. **Share Calendar with Service Account**
   - Go to Google Calendar settings
   - Find your calendar → "Settings and sharing"
   - Add service account email under "Share with specific people"
   - Grant "Make changes to events" permission

2. **Verify Service Account Email**
   ```bash
   # Extract from service account key
   echo $GOOGLE_SERVICE_ACCOUNT_KEY | jq -r .client_email
   ```

### Birthday Events Not Syncing

**Solutions:**

1. **Run Birthday Sync Test**
   ```bash
   tsx scripts/test-birthday-calendar-sync.ts
   ```

2. **Check Employee Status**
   - Only active employees sync
   - Verify date of birth is set

3. **Migrate Old Events**
   ```bash
   # Convert to recurring events
   tsx scripts/migrate-birthday-events-to-recurring.ts
   ```

## Build and Deployment Issues

### Build Fails Locally

**Symptoms:**
- TypeScript errors
- Module not found errors
- Build process hangs

**Solutions:**

1. **Clean Install**
   ```bash
   rm -rf node_modules .next package-lock.json
   npm install
   npm run build
   ```

2. **Check TypeScript Errors**
   ```bash
   npm run type-check
   ```

3. **Verify Imports**
   - Check for case sensitivity issues
   - Ensure all imports resolve

### Deployment Fails on Vercel

**Symptoms:**
- Build error in Vercel logs
- Environment variable errors
- Function size too large

**Solutions:**

1. **Check Build Logs**
   - Review detailed Vercel build output
   - Look for specific error messages

2. **Verify Environment Variables**
   - All variables must be set in Vercel dashboard
   - Check for typos or missing values

3. **Test Production Build Locally**
   ```bash
   npm run build
   npm run start
   ```

4. **Check Function Size**
   - Vercel has 50MB limit for functions
   - Consider code splitting if too large

## Performance Issues

### Slow Page Load

**Symptoms:**
- Long initial load time
- Slow navigation between pages
- High Time to First Byte (TTFB)

**Solutions:**

1. **Profile Database Queries**
   ```typescript
   console.time('query');
   const data = await supabase.from('table').select();
   console.timeEnd('query');
   ```

2. **Add Database Indexes**
   ```sql
   -- Check missing indexes
   EXPLAIN ANALYZE
   SELECT * FROM events
   WHERE date >= NOW()
   ORDER BY date;
   ```

3. **Implement Pagination**
   - Limit results to reasonable page size
   - Use cursor-based pagination for large datasets

4. **Optimize Bundle Size**
   ```bash
   # Analyze bundle
   npm run build
   # Check "First Load JS" size in output
   ```

### Database Queries Slow

**Solutions:**

1. **Add Missing Indexes**
   ```sql
   CREATE INDEX idx_events_date ON events(date);
   CREATE INDEX idx_bookings_event_id ON bookings(event_id);
   ```

2. **Optimize Select Statements**
   ```typescript
   // Select only needed columns
   const { data } = await supabase
     .from('events')
     .select('id, title, date')  // Not select('*')
   ```

3. **Use Query Analysis**
   ```sql
   -- Analyze query performance
   EXPLAIN (ANALYZE, BUFFERS)
   SELECT * FROM your_query;
   ```

## API and Integration Issues

### Table Booking API Errors

**Symptoms:**
- 500 error with "DATABASE_ERROR"
- Booking creation fails
- Missing fields in response

**Solutions:**

1. **Check Database Migration**
   ```bash
   # Apply latest migrations
   supabase db push
   ```

2. **Verify Schema**
   ```sql
   -- Check if email column exists
   SELECT column_name 
   FROM information_schema.columns 
   WHERE table_name = 'customers';
   ```

3. **Test API Locally**
   ```bash
   # Use the test script
   tsx scripts/test-table-booking-api.ts
   ```

### Webhook Signature Validation

**Symptoms:**
- Webhook requests rejected
- "Invalid signature" errors
- Works locally but not in production

**Solutions:**

1. **For Development Only**
   ```bash
   # Skip validation in development
   SKIP_TWILIO_SIGNATURE_VALIDATION=true
   ```

2. **Verify Webhook URL**
   - Must match exactly in Twilio console
   - Include protocol (https://)

3. **Check Request Headers**
   - Ensure `X-Twilio-Signature` header present
   - Body must be unchanged

## Common Error Messages

### Database Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `PGRST116` | No rows returned | Use `.maybeSingle()` instead of `.single()` |
| `PGRST301` | JWT expired | Refresh session or re-login |
| `23505` | Unique constraint violation | Check for duplicates before insert |
| `42501` | Insufficient privileges | Check RLS policies |
| `42P01` | Table does not exist | Run migrations |
| `42703` | Column does not exist | Check schema or run migrations |

### JavaScript Errors

#### "Cannot read property of undefined"
```typescript
// Add null checks
if (data?.property) {
  // Safe to use
}

// Or use optional chaining
const value = data?.nested?.property ?? 'default';
```

#### "Hydration failed"
```typescript
// Use consistent rendering
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return null;
```

#### "Invalid hook call"
- Ensure hooks are only called at top level
- Don't call hooks conditionally
- Check for duplicate React versions

## Debugging Techniques

### Client-Side Debugging

1. **Browser DevTools**
   ```javascript
   // Enhanced logging
   console.log('Data:', data);
   console.table(arrayData);
   console.group('API Call');
   console.log('Request:', request);
   console.log('Response:', response);
   console.groupEnd();
   ```

2. **React Developer Tools**
   - Install browser extension
   - Inspect component props and state
   - Profile performance issues

3. **Network Tab Analysis**
   - Check API request/response
   - Verify headers and payload
   - Monitor response times

### Server-Side Debugging

1. **Server Action Logging**
   ```typescript
   'use server';
   
   export async function myAction(formData: FormData) {
     console.log('[MyAction] Started');
     console.log('[MyAction] FormData:', Object.fromEntries(formData));
     
     try {
       // Action logic
     } catch (error) {
       console.error('[MyAction] Error:', error);
       throw error;
     }
   }
   ```

2. **Vercel Function Logs**
   - Real-time logs in Vercel dashboard
   - Filter by function name
   - Download logs for analysis

3. **Database Query Logging**
   ```typescript
   // Enable query logging
   const { data, error } = await supabase
     .from('table')
     .select()
     .explain(); // Shows query plan
   ```

### Useful Debug Scripts

```bash
# System analysis
tsx scripts/analyze-system-health.ts

# Database checks
tsx scripts/check-database-consistency.ts
tsx scripts/analyze-schema-consistency.ts

# Security scan
tsx scripts/security-scan.ts

# Performance analysis
tsx scripts/analyze-performance.ts

# Business logic validation
tsx scripts/validate-business-logic.ts

# API testing
tsx scripts/test-all-endpoints.ts
```

## Support Resources

### Self-Help Resources

1. **Documentation**
   - `/docs` directory for detailed guides
   - `CLAUDE.md` for AI assistance context
   - API documentation in `/docs/api`

2. **Test Scripts**
   - Extensive scripts in `/scripts` directory
   - Run with `tsx scripts/[script-name].ts`

3. **Error Logs**
   - Browser console (F12)
   - Vercel function logs
   - Supabase logs dashboard
   - Application audit logs

### Community Support

1. **Framework Communities**
   - [Next.js Discord](https://discord.gg/nextjs)
   - [Supabase Discord](https://discord.gg/supabase)
   - [Vercel Discord](https://discord.gg/vercel)

2. **Documentation**
   - [Next.js Docs](https://nextjs.org/docs)
   - [Supabase Docs](https://supabase.com/docs)
   - [Vercel Docs](https://vercel.com/docs)

### Professional Support

1. **Paid Support Options**
   - Supabase Pro/Team plans include support
   - Vercel Pro/Enterprise support
   - Twilio support for SMS issues

2. **Escalation Path**
   - Check internal documentation first
   - Search GitHub issues
   - Ask in community Discord
   - Contact professional support

## Emergency Procedures

### System Down

1. **Immediate Actions**
   ```bash
   # Check service status
   curl -I https://management.orangejelly.co.uk
   
   # Check Vercel status
   # https://www.vercel-status.com/
   
   # Check Supabase status
   # https://status.supabase.com/
   ```

2. **Communication**
   - Notify team immediately
   - Update status page if available
   - Document timeline of events

3. **Recovery Steps**
   - Identify root cause from logs
   - Implement fix in staging first
   - Test thoroughly
   - Deploy with monitoring

### Data Recovery

1. **Backup Sources**
   - Supabase automatic backups (Pro plan)
   - Audit logs for reconstruction
   - Transaction logs

2. **Recovery Process**
   ```sql
   -- Check audit logs for recent changes
   SELECT * FROM audit_logs 
   WHERE created_at > NOW() - INTERVAL '1 day'
   ORDER BY created_at DESC;
   ```

3. **Prevention**
   - Regular backup testing
   - Implement soft deletes
   - Comprehensive audit logging

## Preventive Measures

### Daily Checks
- [ ] Review error logs
- [ ] Check SMS delivery status
- [ ] Monitor system performance
- [ ] Review audit logs for anomalies

### Weekly Maintenance
- [ ] Test critical user flows
- [ ] Review and clear old logs
- [ ] Check disk usage
- [ ] Verify backup integrity

### Monthly Tasks
- [ ] Update dependencies (with testing)
- [ ] Security audit
- [ ] Performance review
- [ ] Documentation updates

Remember: When in doubt, check the logs first, then test with the provided scripts, and escalate if needed.