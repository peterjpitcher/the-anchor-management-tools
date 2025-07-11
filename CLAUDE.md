# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Anchor Management Tools is a comprehensive venue management system featuring event scheduling, customer management, employee records, and automated SMS notifications.

**Production URL**: https://management.orangejelly.co.uk

## Tech Stack

- **Frontend**: Next.js 15.3.3, React 19.1.0, TypeScript, Tailwind CSS 3.4.0
- **Backend**: Supabase (PostgreSQL with RLS, Auth, Storage)
- **SMS**: Twilio 5.7.0
- **Email**: Microsoft Graph API (Office 365/Outlook)
- **PDF Generation**: Puppeteer 24.12.1
- **Hosting**: Vercel (serverless)
- **Validation**: Zod 3.25.56
- **UI Components**: Custom components with Headless UI, Heroicons, Lucide React

## High-Level Architecture

### Application Structure
- **Next.js 15 App Router** with file-based routing
- **Server Actions** for all data mutations (no API routes)
- **Role-Based Access Control (RBAC)** with super_admin, manager, and staff roles
- **Supabase Context** - Always use existing SupabaseProvider, never create new clients
- **Audit Logging** for all sensitive operations

### Key Directories
- `src/app/(authenticated)/` - Protected routes requiring authentication
- `src/app/actions/` - Server actions for data mutations
- `src/lib/` - Core utilities (Supabase client, SMS, permissions, validation)
- `src/components/` - Reusable UI components
- `src/components/providers/` - React context providers (SupabaseProvider)
- `src/contexts/` - Application contexts (PermissionContext)
- `src/types/` - TypeScript type definitions
- `supabase/migrations/` - Database migrations
- `scripts/` - Utility scripts for maintenance and analysis
- `tests/` - Playwright E2E test suites
- `docs/` - Project documentation

### Critical Patterns
1. **Server Actions**: All mutations use server actions with Zod validation
2. **Permissions**: checkUserPermission() must be called before any operation
3. **Audit Logging**: logAuditEvent() for all create/update/delete operations
4. **File Storage**: Always use returned paths from Supabase storage
5. **SMS**: Phone numbers must be converted to E.164 format (+44...)
6. **Email**: Invoices and quotes are sent as PDF attachments via Microsoft Graph API
7. **PDF Generation**: Uses Puppeteer to convert HTML templates to PDF for professional delivery

### Import Paths to Remember
- **Supabase Client (Server)**: `import { createClient } from '@/lib/supabase/server'`
- **Supabase Admin Client (Server)**: `import { createAdminClient } from '@/lib/supabase/server'`
- **Supabase Client (Client)**: `import { useSupabase } from '@/components/providers/SupabaseProvider'`
- **Permissions (Server)**: `import { checkUserPermission } from '@/app/actions/rbac'`
- **Permissions Context (Client)**: `import { usePermissions } from '@/contexts/PermissionContext'`
- **Audit Logging**: `import { logAuditEvent } from '@/app/actions/audit'`
- **Constants**: `import { UK_PHONE_PATTERN } from '@/lib/constants'`
- **Validation**: `import { z } from 'zod'`
- **Cache Revalidation**: `import { revalidatePath } from 'next/cache'`

## Essential Commands

```bash
# Development
npm run dev              # Start development server (http://localhost:3000)
npm run build           # Build for production
npm run lint            # Run ESLint - MUST pass before marking work complete
npm run start           # Start production server

# Setup
cp .env.example .env.local  # Create environment file
npm install                 # Install dependencies

# Running TypeScript Scripts
tsx scripts/[script-name].ts  # Run any script in the scripts/ directory

# Testing
npm test                        # Run all Playwright tests
npm run test:headed            # Run tests in headed mode
npm run test:debug             # Run tests in debug mode
npm run test:report            # Show test report
npm run test:employees         # Run employee tests only
npm run test:employees:ui      # Run employee tests in UI mode
npm run test:comprehensive     # Run comprehensive test suite

# Playwright test commands
npx playwright test            # Run all tests
npx playwright test --ui       # Run in UI mode for debugging
npx playwright test --debug    # Run in debug mode
npx playwright test employees  # Run specific test file
```

## 🔴 MANDATORY: Pre-Development Discovery Protocol

### MUST RUN BEFORE ANY CODE CHANGES
```bash
# 1. System Health Check
echo "=== System Health Check ===" > discovery-$(date +%Y%m%d-%H%M%S).log
npm run lint >> discovery-*.log 2>&1
npm run build >> discovery-*.log 2>&1

# 2. Database State Verification
echo "=== Database State ===" >> discovery-*.log
tsx scripts/test-connectivity.ts >> discovery-*.log 2>&1
tsx scripts/check-supabase-clients.ts >> discovery-*.log 2>&1
tsx scripts/analyze-schema-consistency.ts >> discovery-*.log 2>&1

# 3. Critical Flows Test
echo "=== Critical Flows ===" >> discovery-*.log
tsx scripts/test-critical-flows.ts >> discovery-*.log 2>&1

# 4. Security Scan
echo "=== Security Scan ===" >> discovery-*.log
tsx scripts/security-scan.ts >> discovery-*.log 2>&1

# 5. Performance Analysis
echo "=== Performance Analysis ===" >> discovery-*.log
tsx scripts/analyze-performance.ts >> discovery-*.log 2>&1

# 6. API Surface Analysis
echo "=== API Surface ===" >> discovery-*.log
tsx scripts/analyze-api-surface.ts >> discovery-*.log 2>&1

# Review the log
cat discovery-*.log
Discovery Report Template
markdown## Discovery Report: [Feature/Fix Name]
Date: [ISO Date]
Branch: [git branch --show-current]

### System State
- [ ] Build successful
- [ ] No ESLint errors
- [ ] Database connection verified
- [ ] Critical flows passing
- [ ] Security scan clean
- [ ] Performance baseline established

### Feature Impact Analysis
**Affected Components:**
Run this to find dependencies
grep -r "ComponentName" src/ --include=".tsx" --include=".ts"

**Database Tables Affected:**
- [ ] events
- [ ] customers
- [ ] bookings
- [ ] employees
- [ ] messages
- [ ] private_bookings
- [ ] event_categories
- [ ] audit_logs

**Server Actions Affected:**
List all server actions that might need updates
ls -la src/app/actions/

**Permissions Required:**
- Module: [events/customers/employees/etc]
- Actions: [view/create/edit/delete/manage]

**Integration Points:**
- [ ] SMS/Twilio
- [ ] File Storage
- [ ] Cron Jobs
- [ ] Webhooks
- [ ] Audit Logging
📋 Quality Standards & Verification
Pre-Implementation Analysis
bash# 1. Check existing patterns
echo "=== Existing Patterns ==="
# Find similar features
find src/app/\(authenticated\) -name "*.tsx" | grep -E "(list|form|detail)" | head -10

# 2. Review server actions
echo "=== Server Actions ==="
grep -l "export async function" src/app/actions/*.ts | head -10

# 3. Check UI components
echo "=== Available Components ==="
ls -la src/components/ui/

# 4. Review types
echo "=== Type Definitions ==="
ls -la src/types/
Implementation Checklist

 Follow server action pattern (no API routes for mutations)
 Use SupabaseProvider context (never create new clients)
 Implement proper RBAC checks
 Add audit logging for sensitive operations
 Handle all error states
 Implement loading states
 Test with different user roles
 Verify RLS policies work correctly
 Check mobile responsiveness
 Validate forms with Zod schemas

Post-Implementation Verification
bash# 1. Lint and Build
npm run lint
npm run build

# 2. Test Critical Flows
tsx scripts/test-critical-flows.ts

# 3. Validate Business Logic
tsx scripts/validate-business-logic.ts

# 4. Check Performance Impact
tsx scripts/analyze-performance.ts

# 5. Security Review
tsx scripts/security-scan.ts

# 6. Manual Testing Checklist
echo "
Manual Testing Required:
- [ ] Test as super_admin role
- [ ] Test as manager role
- [ ] Test as staff role
- [ ] Test error scenarios (network off)
- [ ] Test on mobile device
- [ ] Check audit logs created
- [ ] Verify SMS sends (if applicable)
- [ ] Test file uploads (if applicable)
"
🏗️ Critical Implementation Patterns
Server Action Pattern (ALWAYS USE THIS)
typescript// src/app/actions/[entity].ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

// Define validation schema
const CreateEntitySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  // ... other fields
});

export async function createEntity(formData: FormData) {
  try {
    // 1. Get authenticated client
    const supabase = await createClient();
    
    // 2. Check permissions
    const hasPermission = await checkUserPermission('module_name', 'create');
    if (!hasPermission) {
      return { error: 'You do not have permission to perform this action' };
    }
    
    // 3. Validate input
    const validatedData = CreateEntitySchema.parse({
      name: formData.get('name'),
      // ... other fields
    });
    
    // 4. Perform database operation
    const { data, error } = await supabase
      .from('table_name')
      .insert(validatedData)
      .select()
      .single();
      
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to create entity' };
    }
    
    // 5. Log audit event
    await logAuditEvent(supabase, {
      action: 'create',
      entity_type: 'entity_name',
      entity_id: data.id,
      details: { name: data.name }
    });
    
    // 6. Revalidate cache
    revalidatePath('/entity-list');
    
    return { success: true, data };
  } catch (error) {
    console.error('Server action error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
Component Pattern with Supabase Context
typescript// src/app/(authenticated)/module/page.tsx
'use client';

import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { useState, useEffect } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export default function EntityListPage() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const canCreate = hasPermission('module_name', 'create');
  const canEdit = hasPermission('module_name', 'edit');
  
  useEffect(() => {
    loadData();
  }, []);
  
  async function loadData() {
    try {
      const { data, error } = await supabase
        .from('table_name')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setData(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="p-4 text-red-600">
        Error loading data: {error}
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {canCreate && (
        <Button href="/module/new">Create New</Button>
      )}
      <DataTable 
        data={data} 
        columns={columns}
        // ... other props
      />
    </div>
  );
}
File Storage Pattern
typescript// Always follow this pattern for file uploads
export async function uploadEmployeeAttachment(
  employeeId: string,
  file: File,
  category: string
) {
  const supabase = await createClient();
  
  // 1. Upload file - let Supabase generate the path
  const { data, error } = await supabase.storage
    .from('employee-attachments')
    .upload(`${employeeId}/${file.name}`, file);
    
  if (error) {
    return { error: 'Failed to upload file' };
  }
  
  // 2. ALWAYS use the returned path
  const storagePath = data.path;
  
  // 3. Save path to database
  const { error: dbError } = await supabase
    .from('employee_attachments')
    .insert({
      employee_id: employeeId,
      file_name: file.name,
      file_path: storagePath, // Use the returned path
      category,
      file_size: file.size,
      mime_type: file.type
    });
    
  if (dbError) {
    // Rollback file upload
    await supabase.storage
      .from('employee-attachments')
      .remove([storagePath]);
    return { error: 'Failed to save file record' };
  }
  
  return { success: true, path: storagePath };
}

// Generate signed URL for access
export async function getFileUrl(filePath: string) {
  const supabase = await createClient();
  
  const { data, error } = await supabase.storage
    .from('employee-attachments')
    .createSignedUrl(filePath, 3600); // 1 hour expiry
    
  return data?.signedUrl;
}
SMS Integration Pattern
typescript// Always standardize phone numbers
import { UK_PHONE_PATTERN } from '@/lib/constants';

export async function sendBookingConfirmation(bookingId: string) {
  // 1. Validate and standardize phone number
  let phoneNumber = customer.phone_number;
  if (!UK_PHONE_PATTERN.test(phoneNumber)) {
    return { error: 'Invalid phone number format' };
  }
  
  // 2. Convert to E.164 format
  if (phoneNumber.startsWith('0')) {
    phoneNumber = '+44' + phoneNumber.substring(1);
  }
  
  // 3. Check customer messaging health
  const { data: health } = await supabase
    .from('customer_messaging_health')
    .select('*')
    .eq('customer_id', customer.id)
    .single();
    
  if (health?.sms_suspended) {
    return { error: 'SMS messaging suspended for this customer' };
  }
  
  // 4. Queue message via jobs system
  const { error } = await supabase
    .from('jobs')
    .insert({
      type: 'send_sms',
      payload: {
        to: phoneNumber,
        template: 'booking_confirmation',
        variables: {
          customer_name: customer.name,
          event_name: event.title,
          // ... other variables
        }
      }
    });
    
  // 5. Process immediately in dev, cron handles in production
  if (process.env.NODE_ENV === 'development') {
    await fetch('/api/jobs/process-now');
  }
  
  return { success: true };
}
🔍 Feature-Specific Discovery
Before Adding New Features
bash# 1. Analyze existing patterns
echo "=== Feature Analysis ==="
# Find similar features
find src/app/\(authenticated\) -type f -name "*.tsx" | xargs grep -l "similar-feature"

# 2. Check permissions structure
echo "=== Permission Requirements ==="
grep -r "checkPermission" src/ | grep "module_name"

# 3. Review database schema
echo "=== Database Schema ==="
# Check for related tables
grep -r "CREATE TABLE" supabase/migrations/ | grep -E "(related|table)"

# 4. Check for existing components
echo "=== UI Components ==="
# Find reusable components
find src/components -name "*.tsx" | grep -E "(List|Form|Modal|Dialog)"
Migration Checklist
When creating database migrations:
sql-- supabase/migrations/[timestamp]_descriptive_name.sql

-- 1. Always start with a comment
-- Description: What this migration does

-- 2. Make migrations idempotent
CREATE TABLE IF NOT EXISTS table_name (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add RLS policies
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- 4. Create basic policies
CREATE POLICY "Users can view based on permissions" ON table_name
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'module_name', 'view')
  );

-- 5. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_table_name_created_at 
  ON table_name(created_at DESC);

-- 6. Add to audit_logs if needed
-- Handled automatically by audit triggers
🚀 Performance & Monitoring
Performance Checks
bash# 1. Bundle size analysis
npm run build > build-analysis.txt 2>&1
grep -E "(First Load JS|Route)" build-analysis.txt

# 2. Check for common issues
echo "=== Performance Issues ==="
# Find potential N+1 queries
grep -r "map.*await" src/ --include="*.tsx" --include="*.ts"

# Find missing loading states
grep -r "useState.*loading" src/ | wc -l

# Check for proper caching
grep -r "revalidatePath" src/app/actions/
Monitoring Integration Points

SMS Health: Monitor at /settings/sms-health
Webhook Logs: Check webhook_logs table
Audit Trail: Query audit_logs for activity
Job Queue: Monitor jobs table for processing
Error Tracking: Check Sentry dashboard (if configured)

🛡️ Security Checklist
Every Feature MUST:

 Use checkUserPermission() in server actions
 Validate all inputs with Zod schemas
 Log sensitive operations via logAuditEvent()
 Use RLS policies as final defense layer
 Generate time-limited signed URLs for files
 Sanitize phone numbers to E.164 format
 Never expose service role key to client
 Validate webhook signatures in production

Security Patterns
typescript// Pattern for sensitive operations
export async function deleteSensitiveData(id: string) {
  const supabase = await createClient();
  
  // 1. Enhanced permission check
  const hasPermission = await checkUserPermission('module_name', 'delete');
  
  if (!hasPermission) {
    // Log unauthorized attempt
    await logAuditEvent(supabase, {
      action: 'unauthorized_access_attempt',
      entity_type: 'sensitive_data',
      entity_id: id,
      details: { attempted_action: 'delete' }
    });
    
    return { error: 'Unauthorized' };
  }
  
  // 2. Perform operation
  const { error } = await supabase
    .from('sensitive_table')
    .delete()
    .eq('id', id);
    
  // 3. Always log deletions
  await logAuditEvent(supabase, {
    action: 'delete',
    entity_type: 'sensitive_data',
    entity_id: id,
    details: { deleted_at: new Date().toISOString() }
  });
  
  return { success: true };
}
🔧 Common Development Tasks
Adding a New Module
bash# 1. Create migration
echo "-- Description: Add new module tables" > supabase/migrations/$(date +%Y%m%d%H%M%S)_add_module_name.sql

# 2. Create types
touch src/types/module-name.ts

# 3. Create server actions
touch src/app/actions/module-name.ts

# 4. Create UI structure
mkdir -p src/app/\(authenticated\)/module-name
touch src/app/\(authenticated\)/module-name/page.tsx
touch src/app/\(authenticated\)/module-name/new/page.tsx
touch src/app/\(authenticated\)/module-name/\[id\]/page.tsx

# 5. Update permissions
# Add to rbac_permissions table via migration
Testing Webhooks Locally
bash# 1. Use webhook test tool
# Navigate to /settings/webhook-test

# 2. Or test via curl
curl -X POST http://localhost:3000/api/webhooks/twilio/route \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=%2B447700900000&To=%2B447700900001&Body=Test+message"

# 3. Check webhook logs
# Query webhook_logs table in Supabase
📝 Code Review Checklist
Before Requesting Review

 Run npm run lint - zero errors
 Run npm run build - builds successfully
 Test all user roles (super_admin, manager, staff)
 Verify audit logs created for sensitive actions
 Check mobile responsiveness
 Test error scenarios
 Verify loading states show
 Confirm success feedback displays
 Review discovery log for any issues

Common Issues to Check

 No hardcoded strings - use constants
 No console.log statements in production code
 All async operations have error handling
 Forms have proper validation and error display
 Server actions return consistent format
 RLS policies match permission checks
 File paths use returned values from Supabase
 Phone numbers converted to E.164 format

🚨 Critical Reminders

DO NOT COMMIT TO GITHUB unless explicitly asked
ALWAYS RUN BUILD before marking work complete
CHECK EXISTING PATTERNS before creating new ones
TEST WITH ALL ROLES to ensure permissions work
LOG AUDIT EVENTS for all sensitive operations
USE SUPABASE CONTEXT never create new clients
FOLLOW SMS PATTERNS for phone number handling
MIGRATIONS NEED USER ACTION - always notify

✅ Definition of Done
A feature is ONLY complete when:

Discovery protocol run and clean
Build passes with no errors
All user roles tested
Mobile responsive verified
Audit logging implemented
Error handling comprehensive
Loading states present
Success feedback shows
Documentation updated if needed
Performance impact acceptable

Remember: Quality over speed. A well-implemented feature following patterns is better than a quick fix that breaks conventions.

## Key Database Tables

- **events** - Event management with categories and capacity
- **customers** - Customer records with messaging health tracking
- **bookings** - Event bookings and registrations
- **employees** - Employee records with attachments
- **messages** - SMS message queue and history
- **private_bookings** - Private venue bookings
- **audit_logs** - Comprehensive audit trail
- **rbac_roles/rbac_permissions** - Role-based access control
- **jobs** - Background job queue for async processing
- **webhook_logs** - Incoming webhook request logging
- **customer_messaging_health** - SMS delivery health tracking
- **event_categories** - Event category management with features
- **employee_attachments** - File storage references for employees

## Important Configuration

### Environment Variables
Required variables are defined in `.env.example`. Key ones include:
- Supabase connection details
- Twilio API credentials  
- Google Calendar API settings
- Vercel deployment settings
- `NEXT_PUBLIC_CONTACT_PHONE_NUMBER` - Public contact phone number
- `SKIP_TWILIO_SIGNATURE_VALIDATION` - For testing webhooks locally (never use in production)

### Cron Jobs (vercel.json)
- Daily reminders: 9 AM UTC (`/api/cron/reminders`)
- Job processing: Every 5 minutes (`/api/jobs/process`)

### Middleware
- Authentication handling for protected routes
- Allows unauthenticated access to cron endpoints

## Common Pitfalls to Avoid

1. **Never create new Supabase clients** - Always use SupabaseProvider context
2. **Don't use API routes for mutations** - Use server actions
3. **Don't hardcode phone formats** - Convert to E.164 (+44...)
4. **Don't skip audit logging** - Required for sensitive operations
5. **Don't ignore RLS policies** - They're the final security layer
6. **Don't commit without lint/build** - Must pass before marking complete
7. **Don't forget to handle loading states** - Users need feedback
8. **Don't skip error handling** - All operations can fail
9. **Don't bypass permission checks** - Security first
10. **Don't use client-side mutations** - Always use server actions

## Testing Configuration

### Playwright Tests
- Tests run against **production URL**: https://management.orangejelly.co.uk
- Test files located in `/tests` directory
- Configuration: `playwright.config.ts`
- Default timeout: 60 seconds per test
- Retries: 1 on failure
- Screenshots and traces captured on failure

### Test Best Practices
- Tests require production login credentials
- Use unique test data to avoid conflicts
- Clean up test data when possible
- Tests run with limited parallelism to avoid rate limits
- See `tests/TEST_README.md` for comprehensive testing guide

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm run test:employees

# Debug tests with UI
npm run test:employees:ui

# Run tests in headed mode (see browser)
npm run test:headed

# Show test report after run
npm run test:report

# Run comprehensive test suite
npm run test:comprehensive

# Run all test suites
npm run test:suite
```

## Additional Resources

### Documentation Directory
Comprehensive documentation available in `/docs` including:
- API documentation
- Database schema documentation
- Feature-specific implementation guides
- Security and audit reports
- Deployment guides

### Utility Scripts
Extensive TypeScript scripts available in `/scripts` for:
- Database connectivity testing
- Schema analysis and validation
- Security scanning
- Performance analysis
- Migration management
- Business logic validation

Common scripts:
```bash
# Test database connectivity
tsx scripts/test-connectivity.ts

# Analyze schema consistency
tsx scripts/analyze-schema-consistency.ts

# Security scan
tsx scripts/security-scan.ts

# Performance analysis
tsx scripts/analyze-performance.ts

# Test critical flows
tsx scripts/test-critical-flows.ts

# Check for invalid phone numbers
tsx scripts/check-invalid-phone-numbers.ts

# Generate API key
tsx scripts/generate-api-key.ts

# Validate business logic
tsx scripts/validate-business-logic.ts

# Fix phone number formats
tsx scripts/cleanup-phone-numbers.ts

# Check webhook log entries
tsx scripts/check-messages.ts
```

Run any script with: `tsx scripts/[script-name].ts`

Note: There's also a JavaScript security scan script available:
```bash
node scripts/security-scan.js
```