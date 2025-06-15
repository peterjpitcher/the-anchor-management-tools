# Troubleshooting Guide

This guide helps diagnose and resolve common issues with The Anchor Management Tools.

## Quick Diagnostics

Before diving into specific issues, run these checks:

1. **Check Environment Variables**
   ```bash
   # Verify all required variables are set
   npm run check-env
   ```

2. **Test Database Connection**
   ```bash
   # In Supabase Dashboard
   # SQL Editor → Run: SELECT 1;
   ```

3. **Verify Build**
   ```bash
   npm run build
   ```

4. **Check Logs**
   - Browser Console (F12)
   - Vercel Function Logs
   - Supabase Logs
   - GitHub Actions

## Common Issues

### Authentication Issues

#### Cannot Log In
**Symptoms:**
- Login form doesn't submit
- "Invalid credentials" error
- Redirects back to login

**Solutions:**
1. Verify user exists in Supabase Auth
2. Check email is confirmed
3. Reset password if needed
4. Clear browser cookies
5. Check Supabase Auth settings

```bash
# Check environment variables
echo $NEXT_PUBLIC_SUPABASE_URL
echo $NEXT_PUBLIC_SUPABASE_ANON_KEY
```

#### Session Not Persisting
**Symptoms:**
- Logged out after refresh
- Random logouts
- Session errors

**Solutions:**
1. Check middleware configuration
2. Verify cookie settings
3. Ensure proper domain configuration
4. Check session duration in Supabase

```typescript
// Verify in middleware.ts
const { data: { session } } = await supabase.auth.getSession()
console.log('Session:', session)
```

### Database Issues

#### Tables Not Found
**Symptoms:**
- "Relation does not exist" errors
- 404 errors from Supabase

**Solutions:**
1. Run all migrations in order
2. Check table names match code
3. Verify RLS policies exist
4. Check database connection

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';
```

#### Permission Denied
**Symptoms:**
- "permission denied for table" errors
- Can read but not write
- Inconsistent access

**Solutions:**
1. Check RLS policies
2. Verify user authentication
3. Use service role key for admin operations
4. Review policy conditions

```sql
-- Check RLS policies
SELECT * FROM pg_policies 
WHERE tablename = 'your_table';
```

### SMS Issues

#### Messages Not Sending
**Symptoms:**
- No SMS received
- No errors shown
- Twilio dashboard shows no activity

**Solutions:**
1. Verify Twilio credentials
2. Check phone number format
3. Ensure Twilio account has credits
4. Test with Twilio console
5. Check logs for errors

```typescript
// Test Twilio connection
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
console.log('Twilio configured:', !!accountSid && !!authToken);
```

#### Cron Job Not Running
**Symptoms:**
- Daily reminders not sent
- GitHub Actions shows no runs
- Manual trigger works

**Solutions:**
1. Check cron schedule syntax
2. Verify GitHub Actions enabled
3. Check repository secrets
4. Review workflow file
5. Test manual execution

```yaml
# Test cron expression
# Should be: '0 9 * * *' for 9 AM daily
```

### File Upload Issues

#### Upload Fails
**Symptoms:**
- "Failed to upload" error
- File appears to upload but not saved
- Size or type errors

**Solutions:**
1. Check file size (<10MB)
2. Verify file type allowed
3. Check storage bucket exists
4. Review bucket policies
5. Test with small file

```typescript
// Debug upload
console.log('File size:', file.size);
console.log('File type:', file.type);
console.log('Bucket:', 'employee-attachments');
```

#### Cannot Download Files
**Symptoms:**
- 404 errors on download
- "Object not found" errors
- Signed URL expired

**Solutions:**
1. Verify file exists in storage
2. Check storage path matches database
3. Ensure signed URL not expired
4. Review bucket RLS policies

```typescript
// Check storage path
const { data } = await supabase.storage
  .from('employee-attachments')
  .list(employeeId);
console.log('Files:', data);
```

### Build and Deployment Issues

#### Build Fails Locally
**Symptoms:**
- TypeScript errors
- Module not found
- Build hangs

**Solutions:**
1. Clear node_modules and reinstall
2. Check TypeScript errors
3. Verify all imports
4. Update dependencies

```bash
# Clean install
rm -rf node_modules .next
npm install
npm run build
```

#### Deployment Fails on Vercel
**Symptoms:**
- Build error in Vercel
- Environment variable errors
- Function size too large

**Solutions:**
1. Check build logs
2. Verify all env vars set
3. Test build locally first
4. Check function size limits

```bash
# Test production build
npm run build
npm start
```

### Performance Issues

#### Slow Page Load
**Symptoms:**
- Long initial load time
- Slow navigation
- High Time to First Byte

**Solutions:**
1. Check database queries
2. Add appropriate indexes
3. Implement pagination
4. Optimize images
5. Review bundle size

```typescript
// Add query logging
console.time('query');
const data = await supabase.from('table').select();
console.timeEnd('query');
```

#### Database Queries Slow
**Symptoms:**
- Timeouts on large tables
- Slow list pages
- Loading spinners hang

**Solutions:**
1. Add missing indexes
2. Limit select fields
3. Implement pagination
4. Use query optimization

```sql
-- Check query performance
EXPLAIN ANALYZE
SELECT * FROM events
ORDER BY date;
```

## Error Messages

### Common Error Codes

#### `PGRST116`
**Meaning:** No rows returned
**Solution:** Use `.maybeSingle()` instead of `.single()`

#### `PGRST301`
**Meaning:** JWT expired
**Solution:** Refresh session or re-login

#### `23505`
**Meaning:** Unique constraint violation
**Solution:** Check for duplicates before insert

#### `42501`
**Meaning:** Insufficient privileges
**Solution:** Check RLS policies

### JavaScript Errors

#### "Cannot read property of undefined"
**Common Causes:**
- Data not loaded yet
- Null/undefined not handled
- Async race condition

**Solution:**
```typescript
// Add null checks
if (data?.property) {
  // Safe to use
}
```

#### "Hydration failed"
**Common Causes:**
- Server/client mismatch
- Dynamic content issues
- Date formatting differences

**Solution:**
```typescript
// Use consistent rendering
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return null;
```

## Debug Techniques

### Client-Side Debugging

1. **Console Logging**
   ```typescript
   console.log('Data:', data);
   console.error('Error:', error);
   console.table(arrayData);
   ```

2. **React Developer Tools**
   - Inspect component props
   - Check component state
   - Profile performance

3. **Network Tab**
   - Check API calls
   - Verify payloads
   - Monitor response times

### Server-Side Debugging

1. **Server Action Logs**
   ```typescript
   export async function serverAction(formData: FormData) {
     console.log('FormData:', Object.fromEntries(formData));
     // Action logic
   }
   ```

2. **Vercel Logs**
   - Real-time function logs
   - Error tracking
   - Performance metrics

3. **Supabase Logs**
   - Query logs
   - Auth logs
   - Storage logs

## Getting Help

### Self-Help Resources

1. **Check Documentation**
   - Review relevant guides
   - Check API reference
   - Read architecture docs

2. **Search Error Messages**
   - Include exact error text
   - Check GitHub issues
   - Search Stack Overflow

3. **Review Recent Changes**
   - Check git history
   - Review deployments
   - Test previous versions

### Escalation Path

1. **Internal Team**
   - Check with team members
   - Review similar implementations
   - Pair debugging session

2. **Community Support**
   - Supabase Discord
   - Next.js GitHub Discussions
   - Vercel Support

3. **Professional Support**
   - Supabase Pro support
   - Vercel Pro support
   - Twilio support

## Preventive Measures

### Development Best Practices

1. **Test Thoroughly**
   - Test all CRUD operations
   - Verify error handling
   - Check edge cases
   - Test on mobile

2. **Monitor Regularly**
   - Check error logs daily
   - Monitor performance
   - Review user feedback
   - Track SMS delivery

3. **Document Issues**
   - Log recurring problems
   - Document solutions
   - Update this guide
   - Share with team

### Maintenance Checklist

Weekly:
- [ ] Check error logs
- [ ] Monitor SMS delivery
- [ ] Review performance
- [ ] Test critical paths

Monthly:
- [ ] Update dependencies
- [ ] Review security
- [ ] Check backups
- [ ] Audit access logs

## Emergency Procedures

### System Down

1. **Immediate Actions**
   - Check Vercel status
   - Check Supabase status
   - Verify domain/DNS
   - Test with different network

2. **Communication**
   - Notify team
   - Update status page
   - Inform users if needed
   - Document timeline

3. **Recovery**
   - Identify root cause
   - Implement fix
   - Test thoroughly
   - Deploy carefully
   - Monitor closely

### Data Loss

1. **Stop Changes**
   - Disable writes if possible
   - Document what's missing
   - Check backups

2. **Recovery Options**
   - Restore from Supabase backup
   - Use transaction logs
   - Rebuild from audit trail

3. **Prevention**
   - Regular backup testing
   - Implement soft deletes
   - Add audit logging
   - Test recovery procedures