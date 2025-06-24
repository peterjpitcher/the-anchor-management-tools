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

### Utility Scripts
The `/scripts/` directory contains various maintenance and analysis scripts:
- **Data Analysis**: `analyze-api-surface.ts`, `analyze-performance.ts`, `analyze-schema-consistency.ts`, `analyze-user-flows.ts`
- **Data Validation**: `check-booking-discount.ts`, `check-supabase-clients.ts`, `validate-business-logic.ts`
- **Migration Tools**: `fix-supabase-imports.sh` 
- **Testing**: `test-connectivity.ts`, `test-critical-flows.ts`, `load-test-critical-paths.ts`
- **Security**: `security-scan.ts`

Run TypeScript scripts with `tsx scripts/[script-name].ts` (tsx is included as a dev dependency).

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
- **Error Tracking**: Sentry integration (optional)
- **Rate Limiting**: Upstash Redis (optional)

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
   - Core entities: events, customers, bookings, employees, messages, private_bookings, event_categories
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
   - See `/docs/rbac.md` for detailed implementation guide

6. **Messaging Architecture**: Advanced SMS system with templates
   - Dynamic message templates with variable substitution
   - Configurable timing: immediate, 1hr, 12hr, 24hr, 7 days, custom
   - Event-specific template overrides
   - Two-way SMS support with reply handling
   - Automatic customer creation from unknown numbers
   - SMS health monitoring with automatic suspension rules
   - Webhook endpoints for status updates and inbound messages

7. **Audit Logging**: Comprehensive tracking for compliance
   - Immutable `audit_logs` table (no updates/deletes allowed)
   - Tracks: login/logout, CRUD operations, exports, document access
   - Automatic redaction of sensitive data
   - Client info tracking (IP, user agent)
   - Integration via `logAuditEvent()` in server actions

8. **Cron Jobs**: 
   - **SMS Reminders**: Daily at 9 AM via `/api/cron/reminders`
   - **Job Processor**: Every 5 minutes via `/api/jobs/process`
     - Processes background jobs for SMS sending
     - Required for booking confirmations and bulk SMS
   - Both secured with `CRON_SECRET_KEY` environment variable
   - Manual trigger available at `/api/jobs/process-now` for testing

9. **Form Data Pattern**: When passing data to server actions:
   - Use hidden input fields for additional data
   - Avoid `.bind()` pattern (deprecated in React 19)
   - Example: `<input type="hidden" name="customerId" value={customerId} />`

10. **Multi-Layer Authentication Pattern**:
    - Client-side: `SupabaseProvider` context provides single client instance
    - Server Actions: Use `createClient()` for authenticated operations
    - RBAC checks via `checkUserPermission()` in server actions
    - All auth events logged via `logAuditEvent()`

11. **Phone Number Standardization**:
    - UK phone numbers validated with `UK_PHONE_PATTERN`
    - Convert to E.164 format (+44...) in server actions
    - `generatePhoneVariants()` handles different formats when searching
    - Always store in standardized format in database

12. **Customer Loyalty Pattern**:
    - `getLoyalCustomers()` identifies frequent customers
    - Loyal customers marked with ★ in selection dropdowns
    - `sortCustomersByLoyalty()` puts loyal customers at top
    - Considers existing bookings when showing available customers

13. **Event-based Filtering Pattern**:
    - Bulk messaging supports event-based customer filtering
    - `getEventCustomers()` retrieves attendees for specific events
    - Enables targeted communications to event participants

### Recent Features

1. **Private Bookings Module**: Complete venue hire management
   - Draft/tentative/confirmed workflow
   - Comprehensive pricing and contract management
   - Integration with event calendar

2. **Event Categories**: Event categorization system
   - Visual identity with colors and icons
   - Smart customer suggestions based on category preferences
   - Category-based filtering throughout the app

3. **Enhanced Dashboard**: Role-based widgets
   - Configurable based on user permissions
   - Real-time statistics and activity monitoring
   - Quick action buttons for common tasks

### Project Structure
- `/src/app/(authenticated)/` - Protected routes requiring login
- `/src/app/actions/` - Server actions for data operations
- `/src/app/api/` - API routes (cron jobs, webhooks)
- `/src/components/` - Reusable UI components
- `/src/lib/` - Utilities, database client, SMS templates
- `/src/types/` - TypeScript type definitions
- `/supabase/migrations/` - Database schema migrations
- `/docs/` - Comprehensive documentation for all features
- `/scripts/` - Utility scripts for maintenance and analysis

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
- `SKIP_TWILIO_SIGNATURE_VALIDATION` - Optional, for testing only (NEVER set to true in production)

Optional for enhanced features:
- `NEXT_PUBLIC_SENTRY_DSN` - Error tracking
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` - Sentry configuration
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` - Rate limiting

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
- **Everything-on-one-page**: For complex forms, show all fields on one page
- **Progressive Disclosure**: Use for complex workflows (e.g., private bookings)
- **Status-driven UI**: UI changes based on entity status

### Build Configuration
- **TypeScript**: Strict mode enabled with ES2017 target
- **Path Aliases**: `@/` maps to `./src/` directory
- **ESLint**: Configured but errors ignored during builds
- **Server Actions**: Body size limit set to 10MB for file uploads
- **No Prettier**: Project doesn't use Prettier for code formatting
- **Next.js Configuration**: Uses experimental features for enhanced performance
- **Sentry Integration**: Configured with source map upload and tree shaking

### Important Reminders

1. **Database Migrations**: Always notify the user when creating new migrations in `/supabase/migrations/`. The user needs to run migrations manually in their Supabase dashboard or via CLI. Check `supabase/migrations/README_MIGRATIONS.md` for any pending migrations.

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
   - Always enable webhook signature validation in production

8. **Rate Limiting**: Server-side rate limiting implemented
   - Login attempts: 5/minute
   - Signups: 2/minute
   - Use `checkRateLimit()` in server actions

### Monitoring & Debugging Tools
- **SMS Health Dashboard**: `/settings/sms-health` - Monitor delivery rates and customer messaging status
- **Webhook Logs**: Database table for debugging webhook issues
- **Audit Logs**: Comprehensive activity tracking for compliance
- **Messages Interface**: View and reply to SMS conversations at `/messages`
- **Webhook Test Tool**: `/settings/webhook-test` - Test webhook connectivity
- **Import Messages Tool**: `/settings/import-messages` - Bulk import messaging data

### Webhook Endpoints
- `/api/webhooks/twilio/route` - Main webhook endpoint for SMS
- `/api/cron/reminders` - Daily reminder cron job
- All webhook activity logged to `webhook_logs` table for debugging

### Common Development Tasks

1. **Adding a New Entity**: 
   - Create migration in `/supabase/migrations/`
   - Add types in `/src/types/`
   - Create server actions in `/src/app/actions/`
   - Build UI components and pages
   - Add RBAC permissions if needed

2. **Working with SMS Templates**:
   - Templates stored in `message_templates` table
   - Use `{{variable}}` syntax for dynamic content
   - Test with different timing configurations
   - Monitor delivery via SMS health dashboard

3. **File Uploads**:
   - Use the employee attachments pattern as reference
   - Always store the returned path from Supabase
   - Generate signed URLs for access
   - Implement proper error handling

4. **Permission Checks**:
   - Client-side: Use `PermissionContext`
   - Server-side: Use `checkUserPermission()` in actions
   - Always check permissions before sensitive operations

### Documentation Structure
Comprehensive documentation available in `/docs/`:
- **Setup**: installation.md, configuration.md, deployment.md
- **Features**: feature-*.md files for each major module
- **Technical**: architecture.md, database-schema.md, api-reference.md
- **Security**: security.md, rbac.md
- **Monitoring**: monitoring.md, troubleshooting.md
- **Standards**: development.md, style-guide.md, ui-standards.md

### Debugging & Development Tips

1. **When the build fails**: 
   - Check for TypeScript errors: `npm run build` shows detailed error messages
   - Common issues: missing imports, type mismatches, unused variables
   - ESLint errors are ignored during build but shown for awareness

2. **Supabase Connection Issues**:
   - Verify environment variables are set correctly
   - Check if RLS policies are blocking queries
   - Use Supabase dashboard SQL editor to test queries directly
   - Server actions need service role key, client needs anon key

3. **SMS/Twilio Issues**:
   - Check webhook logs in database for debugging
   - Use `/settings/webhook-test` to verify connectivity
   - Ensure phone numbers are in E.164 format
   - Check SMS health dashboard for delivery rates

4. **File Upload Problems**:
   - Verify Supabase Storage bucket exists and has proper policies
   - Check file size limits (10MB for server actions)
   - Always use the returned path from upload response
   - Generate signed URLs for secure access

### Code Patterns to Follow

1. **Component Naming**: Use PascalCase for components (e.g., `CustomerList.tsx`)
2. **Server Action Naming**: Use camelCase with action verbs (e.g., `createCustomer`, `updateEvent`)
3. **Type Definitions**: Always define types in `/src/types/` and import them
4. **Loading States**: Use `loading` prop or Suspense boundaries, not custom states
5. **Error Messages**: User-facing errors should be clear and actionable
6. **Date Handling**: Use `format` from date-fns for consistent date formatting
7. **Modal/Dialog Pattern**: Use the existing Dialog component from `/src/components/ui/`
8. **Table Pattern**: Use the DataTable component for consistent table UI
9. **Form Pattern**: Use react-hook-form with Zod validation
10. **Icons**: Use lucide-react icons consistently throughout the app