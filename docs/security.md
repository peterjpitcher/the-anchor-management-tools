# Security Guide

This document outlines security measures, best practices, and policies for The Anchor Management Tools.

## Security Overview

The application implements multiple layers of security:
- Authentication via Supabase Auth
- Row Level Security (RLS) on all database tables
- Secure file storage with signed URLs
- Environment variable protection
- HTTPS enforcement
- Input validation and sanitization

## Authentication & Authorization

### Authentication System
- **Provider**: Supabase Auth with JWT tokens
- **Method**: Email/password authentication
- **Session**: Secure HTTP-only cookies
- **Duration**: 7-day refresh token rotation

### Access Control
- All routes protected by middleware
- No public access to data
- Single user role (full access)
- Future: Role-based access control (RBAC)

### Password Policy
- Minimum 6 characters (Supabase default)
- Recommended: 12+ characters with mixed case
- No password reuse tracking (yet)
- Secure reset via email link

## Database Security

### Row Level Security (RLS)

All tables have RLS enabled with authenticated-only access:

```sql
-- Example RLS policy
CREATE POLICY "Authenticated users can view employees"
ON employees FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert employees"
ON employees FOR INSERT
TO authenticated
WITH CHECK (true);
```

### Service Role Key
- Only used server-side
- Never exposed to client
- Required for admin operations
- Rotate regularly

### SQL Injection Prevention
- Parameterized queries via Supabase client
- No raw SQL execution
- Input validation before queries
- TypeScript type safety

## File Storage Security

### Storage Policies
```sql
-- Authenticated users can upload
CREATE POLICY "Authenticated users can upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'employee-attachments');

-- Authenticated users can view files
CREATE POLICY "Authenticated users can view files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'employee-attachments');
```

### File Security Measures
- 10MB size limit enforced
- File type validation (PDF, PNG, JPG, JPEG)
- Organized by employee ID
- Signed URLs expire after 1 hour
- No public bucket access

### Upload Security
```typescript
// Validation before upload
const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
const maxSize = 10 * 1024 * 1024; // 10MB

if (!allowedTypes.includes(file.type)) {
  throw new Error('Invalid file type');
}
if (file.size > maxSize) {
  throw new Error('File too large');
}
```

## API Security

### Server Actions
- All actions require authentication
- Input validation with Zod
- Error messages don't leak sensitive data
- Rate limiting planned

### Cron Job Security
- Protected by secret key
- Validates authorization header
- Logs all executions
- No public access

```typescript
// Cron endpoint protection
if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
  return new Response('Unauthorized', { status: 401 });
}
```

## Input Validation

### Form Validation
- Client-side validation for UX
- Server-side validation for security
- Zod schemas for type safety
- Sanitization of all inputs

### Common Validations
```typescript
// Email validation
const emailSchema = z.string().email();

// Phone validation
const phoneSchema = z.string().regex(/^\+?[1-9]\d{1,14}$/);

// UUID validation
const uuidSchema = z.string().uuid();
```

## Environment Variables

### Security Practices
- Never commit `.env` files
- Use `.env.example` for templates
- Different values per environment
- Rotate secrets regularly

### Critical Variables
```env
# Never expose these
SUPABASE_SERVICE_ROLE_KEY=keep-secret
TWILIO_AUTH_TOKEN=keep-secret
CRON_SECRET=keep-secret

# Safe to expose
NEXT_PUBLIC_SUPABASE_URL=can-be-public
NEXT_PUBLIC_SUPABASE_ANON_KEY=can-be-public
```

## Network Security

### HTTPS Enforcement
- Automatic via Vercel
- HSTS headers recommended
- No mixed content
- Secure cookies only

### CORS Configuration
- Restricted to application domain
- No wildcard origins
- Credentials included
- Preflight handling

### Content Security Policy
```javascript
// Recommended CSP headers
{
  'Content-Security-Policy': 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://*.supabase.co"
}
```

## Data Protection

### Personal Data
- Minimal data collection
- No unnecessary PII storage
- Encrypted at rest (Supabase)
- Encrypted in transit (HTTPS)

### Data Retention
- Follow local regulations
- Document retention policies
- Implement data purging
- Right to deletion

### Backup Security
- Automated daily backups
- Encrypted backup storage
- Test restore procedures
- Access logging

## Security Monitoring

### Logging Strategy
- Authentication attempts
- Failed operations
- File uploads/downloads
- API access patterns

### Alerts to Implement
- Multiple failed logins
- Unusual access patterns
- Large file uploads
- Error rate spikes

### Audit Trail
```typescript
// Example audit logging
async function logSecurityEvent(event: {
  type: string;
  userId?: string;
  details: any;
}) {
  await supabase.from('security_logs').insert({
    event_type: event.type,
    user_id: event.userId,
    details: event.details,
    ip_address: request.ip,
    timestamp: new Date().toISOString()
  });
}
```

## Incident Response

### Security Incident Steps
1. **Identify** - Detect and verify the incident
2. **Contain** - Limit damage and prevent spread
3. **Investigate** - Determine scope and impact
4. **Remediate** - Fix vulnerabilities
5. **Recover** - Restore normal operations
6. **Review** - Document and improve

### Emergency Contacts
- Supabase Support
- Vercel Support
- Twilio Security Team
- Internal escalation chain

## Security Checklist

### Development
- [ ] Validate all inputs
- [ ] Use parameterized queries
- [ ] Handle errors safely
- [ ] Log security events
- [ ] Review dependencies

### Deployment
- [ ] Set strong secrets
- [ ] Enable HTTPS only
- [ ] Configure CSP headers
- [ ] Test authentication
- [ ] Monitor access logs

### Maintenance
- [ ] Rotate secrets quarterly
- [ ] Review access logs
- [ ] Update dependencies
- [ ] Test backups
- [ ] Audit permissions

## Compliance Considerations

### GDPR Compliance
- Privacy by design
- Data minimization
- User consent
- Right to access
- Right to deletion

### Security Standards
- OWASP Top 10 awareness
- Regular security reviews
- Dependency scanning
- Penetration testing (planned)

## Future Security Enhancements

### Planned Improvements
1. **Multi-Factor Authentication (MFA)**
   - TOTP support
   - SMS verification
   - Backup codes

2. **Advanced Monitoring**
   - Real-time alerts
   - Anomaly detection
   - Security dashboard

3. **File Security**
   - Virus scanning
   - Content analysis
   - Watermarking

4. **Access Control**
   - Role-based permissions
   - API key management
   - Session management

5. **Compliance Tools**
   - Audit reports
   - Data export
   - Retention automation

## Security Resources

### Documentation
- [OWASP Security Guide](https://owasp.org)
- [Supabase Security](https://supabase.com/docs/guides/auth/security)
- [Next.js Security](https://nextjs.org/docs/authentication)

### Tools
- [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit)
- [OWASP ZAP](https://www.zaproxy.org/)
- [Snyk](https://snyk.io/)

### Reporting Security Issues
If you discover a security vulnerability:
1. Do NOT create a public issue
2. Email security contact immediately
3. Provide detailed information
4. Allow time for patching
5. Coordinate disclosure