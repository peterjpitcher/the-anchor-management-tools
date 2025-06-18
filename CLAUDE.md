# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is "The Anchor - Management Tools" (EventPlanner 3.0), a Next.js 15 application for managing events, customers, and employees for a venue. The application includes automated SMS notifications, file attachments, and comprehensive CRUD operations for all entities.

Production URL: https://management.orangejelly.co.uk

## Commands

### Development
- `npm run dev` - Start development server on http://localhost:3000
- `npm run build` - Build the project for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint for code quality checks

### Testing
No test runner is currently configured. When adding tests, check with the user for the preferred testing framework.

## Architecture Overview

### Technology Stack
- **Framework**: Next.js 15.3.3 with App Router and React 19.1.0
- **Database**: Supabase (PostgreSQL) with Row Level Security
- **Authentication**: Supabase Auth with JWT tokens
- **Styling**: Tailwind CSS with custom theme colors
- **SMS**: Twilio integration for automated notifications
- **File Storage**: Supabase Storage for employee attachments
- **Deployment**: Vercel with cron jobs for scheduled tasks
- **Type Safety**: TypeScript with strict mode
- **Form Validation**: Zod schema validation

### Key Architectural Patterns

1. **Server Actions**: Used exclusively for data mutations. Located in `/src/app/actions/`. This pattern co-locates mutations with components and eliminates need for separate API routes. Type-safe server-client communication is built-in.

2. **Supabase Client**: Centralized through `SupabaseProvider` context. Always use the client from context to avoid multiple instances and authentication issues.

3. **File Storage Pattern**: When working with Supabase Storage:
   - Always use the returned `data.path` from upload responses as the canonical path
   - Store this path in the database for generating signed URLs
   - Never construct storage paths manually
   - Employee attachments use format: `{employee_id}/{filename}`
   - Categories: legal_records, health_records, certifications, other

4. **Database Schema**: 
   - Core entities: events, customers, bookings, employees, messages
   - Employee system includes notes (timestamped) and attachments (categorized)
   - All tables use UUID primary keys and cascade deletes
   - Row Level Security enabled on all tables
   - Important views: `customer_messaging_health`, `message_templates_with_timing`
   - Key functions: `user_has_permission()`, `get_message_template()`, `log_audit_event()`

5. **RBAC System**: Comprehensive role-based access control
   - System roles: `super_admin`, `manager`, `staff`
   - Module-based permissions (view, create, edit, delete, manage)
   - Permission checks via `PermissionContext` (client) and `user_has_permission()` (server)
   - Middleware integration for route-level protection

6. **Messaging Architecture**: Advanced SMS system with templates
   - Dynamic message templates with variable substitution
   - Configurable timing: immediate, 1hr, 12hr, 24hr, 7 days, custom
   - Event-specific template overrides
   - Two-way SMS support with reply handling
   - Automatic customer creation from unknown numbers
   - SMS health monitoring with automatic suspension rules

7. **Audit Logging**: Comprehensive tracking for compliance
   - Immutable `audit_logs` table (no updates/deletes allowed)
   - Tracks: login/logout, CRUD operations, exports, document access
   - Automatic redaction of sensitive data
   - Client info tracking (IP, user agent)
   - Integration via `logAuditEvent()` in server actions

8. **Cron Jobs**: Automated SMS reminders run daily at 9 AM
   - Primary: Vercel cron at `/api/cron/send-reminders`
   - Backup: GitHub Actions workflow
   - Sends reminders based on template timing configuration
   - Secured with `CRON_SECRET_KEY` environment variable

9. **Form Data Pattern**: When passing data to server actions:
   - Use hidden input fields for additional data
   - Avoid `.bind()` pattern (deprecated in React 19)
   - Example: `<input type="hidden" name="customerId" value={customerId} />`

### Project Structure
- `/src/app/(authenticated)/` - Protected routes requiring login
- `/src/app/actions/` - Server actions for data operations
- `/src/app/api/` - API routes (cron jobs, webhooks)
- `/src/components/` - Reusable UI components
- `/src/lib/` - Utilities, database client, SMS templates
- `/src/types/` - TypeScript type definitions
- `/supabase/migrations/` - Database schema migrations
- `/docs/` - Comprehensive documentation for all features

### Environment Variables
Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` - For server-side operations
- `TWILIO_ACCOUNT_SID` - Optional for SMS features
- `TWILIO_AUTH_TOKEN` - Optional for SMS features
- `TWILIO_PHONE_NUMBER` - Optional for SMS features
- `NEXT_PUBLIC_APP_URL` - Application URL for links in SMS
- `NEXT_PUBLIC_CONTACT_PHONE_NUMBER` - Displayed contact number
- `CRON_SECRET_KEY` - For securing cron job endpoints

### UI/UX Conventions
- **Color Palette**: 
  - Primary Blue: `#2563eb`
  - Sidebar Green: `#005131`
  - Success Green: `#10b981`
  - Warning Yellow: `#f59e0b`
  - Error Red: `#ef4444`
- **Component Patterns**: Always check existing components before creating new ones
- **Loading States**: Use skeleton loaders for better UX
- **Error Handling**: Display user-friendly error messages with recovery actions
- **Responsive Design**: Mobile-first approach with Tailwind breakpoints

### Recent Architectural Decisions
- Migrated from `useFormState` to `useActionState` (React 19)
- Fixed form data passing pattern - use hidden fields instead of `.bind()`
- Implemented proper bucket provisioning for file attachments
- Added comprehensive employee management system with notes and attachments
- Webhook logging for Twilio SMS status tracking
- Domain updated to management.orangejelly.co.uk
- RBAC system with granular permissions
- Two-way SMS messaging with reply handling
- Audit logging system with immutable records
- SMS health monitoring dashboard

### Monitoring & Debugging Tools
- **SMS Health Dashboard**: `/settings/sms-health` - Monitor delivery rates and customer messaging status
- **Webhook Logs**: Database table for debugging webhook issues
- **Audit Logs**: Comprehensive activity tracking for compliance
- **Messages Interface**: View and reply to SMS conversations at `/messages`

### Important Reminders
1. **Database Migrations**: Always notify the user when creating new migrations in `/supabase/migrations/`. The user needs to run migrations manually in their Supabase dashboard or via CLI.

2. **Before Committing**: Always run `npm run build` locally to ensure the build passes before committing changes to GitHub.

3. **Git Workflow**: 
   - Do NOT commit code to GitHub unless explicitly asked by the user
   - The user will test locally first before requesting commits
   - Exception: Twilio-related changes may need to be committed for production testing

4. **Error Handling**: Server actions should always return consistent error formats:
   ```typescript
   { error: string } | { success: true, data?: any }
   ```

5. **TypeScript Path Aliases**: Use `@/` for imports (configured in tsconfig.json)

6. **Performance Considerations**:
   - Use React Suspense for async components
   - Implement proper caching strategies with `revalidatePath`
   - Optimize images with Next.js Image component
   - Minimize client-side JavaScript with server components

7. **Security Best Practices**:
   - All routes under `/(authenticated)` require authentication
   - Use Row Level Security for all database operations
   - Generate signed URLs for file access (24-hour expiry)
   - Never expose service role key to client
   - Validate all user inputs with Zod schemas

### Webhook Endpoints
- `/api/webhooks/twilio/status` - SMS delivery status updates
- `/api/webhooks/twilio/reply` - Incoming SMS messages
- `/api/webhooks/debug/*` - Debug endpoints for testing webhook functionality
- All webhook activity logged to `webhook_logs` table for debugging