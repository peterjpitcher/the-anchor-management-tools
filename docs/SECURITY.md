# Security Guide

This document provides comprehensive security guidelines, best practices, and implementation details for The Anchor Management Tools.

## Table of Contents

1. [Security Overview](#security-overview)
2. [Authentication & Authorization](#authentication--authorization)
3. [Data Protection & Encryption](#data-protection--encryption)
4. [API Security](#api-security)
5. [Input Validation & Sanitization](#input-validation--sanitization)
6. [Audit Logging](#audit-logging)
7. [Security Best Practices](#security-best-practices)
8. [Vulnerability Reporting](#vulnerability-reporting)
9. [Event Access Security](#event-access-security)

## Security Overview

The Anchor Management Tools implements defense-in-depth security with multiple layers:

- **Authentication**: Supabase Auth with JWT tokens and secure session management
- **Authorization**: Role-Based Access Control (RBAC) with granular permissions
- **Database Security**: Row Level Security (RLS) on all tables
- **Network Security**: HTTPS enforcement, secure headers, CORS protection
- **Application Security**: Input validation, parameterized queries, error handling
- **Monitoring**: Comprehensive audit logging and security event tracking

### Security Architecture

```
┌─────────────────┐
│   Client App    │
├─────────────────┤
│  HTTPS + CSP    │
├─────────────────┤
│   Middleware    │ ← Authentication, Rate Limiting
├─────────────────┤
│ Server Actions  │ ← Permission Checks, Validation
├─────────────────┤
│   Supabase      │ ← RLS Policies, Encrypted Storage
└─────────────────┘
```

## Authentication & Authorization

### Authentication System

**Provider**: Supabase Auth
- JWT-based authentication
- Secure HTTP-only cookies
- 7-day refresh token rotation
- Email/password authentication
- Password reset via secure email links

**Password Policy**:
- Minimum 6 characters (Supabase default)
- Recommended: 12+ characters with mixed case, numbers, and symbols
- No password history tracking (planned feature)

### Role-Based Access Control (RBAC)

The application uses a comprehensive RBAC system with predefined roles and granular permissions.

#### Default Roles

1. **Super Admin** (`super_admin`)
   - Full system access
   - Cannot be deleted or modified
   - Can manage roles and permissions

2. **Manager** (`manager`)
   - Access to most modules
   - Cannot manage system settings or roles
   - Suitable for supervisory staff

3. **Staff** (`staff`)
   - Limited read-only access
   - Basic module access only
   - Ideal for regular employees

#### Permission Structure

Each module supports specific actions:

```typescript
// Core Modules
events: ['view', 'create', 'edit', 'delete', 'manage']
customers: ['view', 'create', 'edit', 'delete', 'export']
employees: ['view', 'create', 'edit', 'delete', 'view_documents', 'upload_documents']
bookings: ['view', 'create', 'edit', 'delete', 'export']
messages: ['view', 'send', 'delete', 'view_templates', 'manage_templates']

// Admin Modules
settings: ['view', 'manage']
users: ['view', 'manage_roles']
roles: ['view', 'manage']
```

#### Implementation Pattern

```typescript
// Server-side permission check
import { checkUserPermission } from '@/app/actions/rbac';

export async function sensitiveAction() {
  const hasPermission = await checkUserPermission('module_name', 'action');
  if (!hasPermission) {
    await logAuditEvent(supabase, {
      action: 'unauthorized_access_attempt',
      entity_type: 'module_name',
      details: { attempted_action: 'action' }
    });
    return { error: 'Insufficient permissions' };
  }
  // Proceed with action
}
```

### Multi-Factor Authentication (Planned)

Future enhancement includes:
- TOTP (Time-based One-Time Password) support
- SMS verification as second factor
- Backup recovery codes
- Hardware token support

## Data Protection & Encryption

### Encryption Standards

**At Rest**:
- Database encryption via Supabase (AES-256)
- File storage encryption in Supabase Storage
- Environment variables encrypted in Vercel

**In Transit**:
- TLS 1.2+ for all connections
- HTTPS enforcement on all endpoints
- Secure WebSocket connections for real-time features

### Sensitive Data Handling

**Personal Identifiable Information (PII)**:
- Minimal data collection principle
- No unnecessary PII storage
- Customer phone numbers stored in E.164 format
- Email addresses validated and normalized

**Data Retention**:
- Audit logs: 90 days (configurable)
- SMS messages: 30 days
- Deleted records: Soft delete with 30-day recovery
- Compliance with GDPR requirements

### File Storage Security

**Storage Policies**:
```sql
-- Authenticated upload only
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'employee-attachments');

-- Authenticated view only  
CREATE POLICY "Authenticated users can view"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'employee-attachments');
```

**Security Measures**:
- 10MB file size limit
- Allowed types: PDF, PNG, JPG, JPEG
- Files organized by entity ID
- Signed URLs with 1-hour expiration
- No public bucket access

## API Security

### API Authentication

All API endpoints require authentication except:
- Health check endpoints
- Webhook receivers (validated separately)
- Public event listings (if enabled)

### Rate Limiting

**Critical Implementation Required**:
```typescript
// Recommended implementation using Upstash
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '15 m'), // 100 requests per 15 minutes
});

// Special limits for sensitive endpoints
const smsRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 h'), // 10 SMS per hour
});
```

### Webhook Security

**Twilio Webhook Validation**:
```typescript
// Always validate signatures in production
if (process.env.NODE_ENV === 'production') {
  const signature = request.headers.get('X-Twilio-Signature');
  if (!validateTwilioSignature(signature, body, url)) {
    await logSecurityEvent({
      type: 'invalid_webhook_signature',
      details: { source: 'twilio', url }
    });
    return new Response('Unauthorized', { status: 401 });
  }
}
```

### CORS Configuration

```typescript
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  'https://management.orangejelly.co.uk'
];

// Strict CORS policy
headers.set('Access-Control-Allow-Origin', origin);
headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
headers.set('Access-Control-Allow-Credentials', 'true');
```

## Input Validation & Sanitization

### Validation Framework

All inputs are validated using Zod schemas:

```typescript
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

// String sanitization
export const sanitizeString = (input: string) => {
  return DOMPurify.sanitize(input, { 
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [] 
  });
};

// Common validation schemas
export const schemas = {
  email: z.string().email().max(255),
  phone: z.string().regex(/^(\+44|0)[0-9]{10}$/),
  uuid: z.string().uuid(),
  url: z.string().url(),
  date: z.string().datetime(),
};

// File upload validation
export const fileSchema = z.object({
  size: z.number().max(10 * 1024 * 1024), // 10MB
  type: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
});
```

### SQL Injection Prevention

- All database queries use Supabase's parameterized queries
- No raw SQL execution allowed
- Input validation before query construction
- TypeScript type safety throughout

### XSS Prevention

- React's automatic escaping for all rendered content
- Content Security Policy headers
- Sanitization of user-generated content
- No `dangerouslySetInnerHTML` usage

## Audit Logging

### Comprehensive Audit Trail

All sensitive operations are logged:

```typescript
interface AuditEvent {
  action: string;
  entity_type: string;
  entity_id?: string;
  user_id: string;
  ip_address?: string;
  user_agent?: string;
  details: Record<string, any>;
  created_at: string;
}

// Events logged:
- Authentication (login/logout/failed attempts)
- Authorization (permission checks/failures)
- Data modifications (create/update/delete)
- File operations (upload/download/delete)
- Settings changes
- Bulk operations
- API key usage
- Export operations
```

### Security Event Monitoring

Monitor for:
- Multiple failed login attempts (>5 in 10 minutes)
- Unusual access patterns
- Permission escalation attempts
- Large data exports
- Rapid API usage
- File upload anomalies

## Security Best Practices

### Development Security Checklist

**For Every Feature**:
- [ ] Implement authentication checks
- [ ] Add authorization/permission validation
- [ ] Validate all inputs with Zod schemas
- [ ] Handle errors without information leakage
- [ ] Add audit logging for sensitive operations
- [ ] Test with different user roles
- [ ] Review for timing attacks
- [ ] Check for race conditions

**For API Endpoints**:
- [ ] Implement rate limiting
- [ ] Add request size limits
- [ ] Validate content types
- [ ] Set security headers
- [ ] Log access patterns
- [ ] Handle CORS properly
- [ ] Implement request timeouts

**For File Operations**:
- [ ] Validate file types and sizes
- [ ] Generate unique file names
- [ ] Use signed URLs (1-hour expiry)
- [ ] Store outside web root
- [ ] Log all file access
- [ ] Implement virus scanning (future)

### Security Headers

```javascript
// Recommended security headers
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-eval' 'unsafe-inline';"
  }
];
```

### Environment Security

**Critical Variables** (Never expose):
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_AUTH_TOKEN`
- `CRON_SECRET`
- `DATABASE_URL`

**Public Variables** (Safe to expose):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

### Dependency Management

- Run `npm audit` regularly
- Use `npm audit fix` for automatic fixes
- Review and update dependencies monthly
- Use Dependabot or similar for automated updates
- Avoid dependencies with known vulnerabilities

### Incident Response Plan

1. **Identify**: Detect and verify the security incident
2. **Contain**: Isolate affected systems, revoke compromised credentials
3. **Investigate**: Determine scope, impact, and root cause
4. **Remediate**: Fix vulnerabilities, patch systems
5. **Recover**: Restore normal operations, verify integrity
6. **Review**: Document lessons learned, update procedures

### Emergency Contacts

- Supabase Support: [support.supabase.com](https://support.supabase.com)
- Vercel Support: [vercel.com/support](https://vercel.com/support)
- Twilio Security: [twilio.com/security](https://twilio.com/security)

## Vulnerability Reporting

### Responsible Disclosure

If you discover a security vulnerability:

1. **DO NOT** create a public GitHub issue
2. **DO NOT** exploit the vulnerability
3. Email security details to: [security contact email]
4. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
5. Allow reasonable time for patching (30-90 days)
6. Coordinate public disclosure

### Security Resources

**Documentation**:
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/auth/security)
- [Next.js Security](https://nextjs.org/docs/authentication)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)

**Security Tools**:
- [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit) - Dependency scanning
- [OWASP ZAP](https://www.zaproxy.org/) - Security testing
- [Snyk](https://snyk.io/) - Vulnerability monitoring
- [GitGuardian](https://www.gitguardian.com/) - Secret scanning

**Compliance Standards**:
- GDPR - Data protection and privacy
- PCI DSS - Payment card security (if applicable)
- SOC 2 - Service organization controls
- ISO 27001 - Information security management

## Event Access Security

### Overview

All event-related endpoints and pages in The Anchor Management Tools require authentication. There is currently no public or anonymous access to event information.

### Current Implementation

**Authentication Requirement**:
- All event routes are under `/(authenticated)/` which requires a valid session
- Event API endpoints use Supabase Auth for authentication
- Row Level Security (RLS) policies enforce permission checks

**Permission Model**:
Events use the RBAC system with the following permissions:
- `events.view` - View event listings and details
- `events.create` - Create new events
- `events.edit` - Edit existing events  
- `events.delete` - Delete events
- `events.manage` - Full administrative access

**Database Security**:
- The events table has RLS enabled and access revoked from the `anon` role.
- Authenticated users require explicit role permissions to read or mutate records.
- Policies live in the Supabase migrations (`supabase/migrations/`); review them before altering event access.

Only authenticated users with appropriate permissions can access events.

### Implementing Public Event Access (Future Enhancement)

If public/anonymous event access is needed in the future, follow these guidelines:

#### 1. Public Events Page
Create a new route outside `/(authenticated)/` for public event listings:
```typescript
// app/events/public/page.tsx
// Shows limited event information without authentication
```

#### 2. Database Changes
Add a public visibility flag to events:
```sql
ALTER TABLE events ADD COLUMN is_public BOOLEAN DEFAULT false;
```

#### 3. RLS Policy for Public Access
Create a policy allowing anonymous read access to public events:
```sql
CREATE POLICY "Public events are viewable by everyone"
    ON public.events FOR SELECT
    TO anon
    USING (is_public = true);
```

#### 4. API Endpoint
Create a public API endpoint for event data:
```typescript
// app/api/events/public/route.ts
// Returns only public event information
```

#### Security Considerations for Public Access

1. **Minimal Information**: Expose only necessary fields (name, date, time, capacity)
2. **No Personal Data**: Never expose customer or booking information publicly
3. **Rate Limiting**: Implement rate limiting on public endpoints
4. **Caching**: Use caching to reduce database load from public requests
5. **Monitoring**: Track public API usage for abuse detection

### Current Status

✅ **Secure by Default**: All event data requires authentication
✅ **RBAC Integration**: Fine-grained permission control
✅ **No Data Leakage**: No accidental public exposure of events

This is the intended behavior for a management system where all data should be protected.

## Authentication Hardening Checklist

These controls are live in production and must remain in place when modifying auth flows:

- **Password recovery**: Supabase redirect whitelist includes `/auth/recover`. The recovery page handles both `type=recovery` fragments and one-time codes, preserves `redirectedFrom`, and validates that users land back on first-party routes. If users report “link not recognised”, confirm the token survived email relay.
- **Session refresh**: `src/middleware.ts` refreshes Supabase sessions on every request. Unexpected logouts generally point to revoked refresh tokens or cookies stripped by the browser.
- **Audit logging**: Login and logout go through server actions that raise `login`, `login_failed`, and `logout` audit events. Maintain these hooks when refactoring auth screens.
- **Rate limiting**: Authentication endpoints use a 5 attempts/minute per-IP cap through the shared rate limiter. Adjustments should go through `src/lib/rate-limit.ts`.
- **QA checklist**: Smoke test login, failure states, password reset, and logout on both desktop and mobile after auth changes.
- **Monitoring**: Supabase auth logs plus audit tables should be reviewed for bursts of password reset failures or unusual login patterns. Consider adding Playwright coverage when credentials are available in CI.

## GDPR & Privacy Compliance

The Anchor is subject to GDPR. Keep these practices in mind when shipping changes:

- **Privacy policy**: The `/privacy` route must remain up to date with contact details, lawful bases, and data usage. Update it whenever data collection changes.
- **Data subject rights**: Support access, rectification, erasure, portability, and objection. When implementing new features, document how users can exercise each right or which team handles the request.
- **Consent tracking**: Marketing SMS/e-mail requires explicit consent with timestamps. The SMS reminder pipeline stores opt-in status and should not send marketing messages without it.
- **Retention**: Follow current retention guidance—customer bookings retained for seven years for tax, audit logs retained for at least ninety days, marketing consent until withdrawn. Capture any deviation in release notes.
- **Breach response**: Ensure there is a documented escalation path for incidents; log actions in the audit table and notify stakeholders within the legal time frame.
- **Third parties**: Maintain data processing agreements with Twilio, Supabase, Microsoft, and any other processors. Document integrations in the deployment guide.

---

*Last Updated: October 2025*
*Version: 1.1*
