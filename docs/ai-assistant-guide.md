# AI Assistant Guide

This file provides guidance to Claude Code (claude.ai/code) and other AI assistants when working with code in this repository.

## Project Context

This is "The Anchor - Management Tools" (EventPlanner 3.0), a Next.js 15 application for managing events, customers, and employees for a venue. The application includes automated SMS notifications, file attachments, and comprehensive CRUD operations for all entities.

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
- **Authentication**: Supabase Auth
- **Styling**: Tailwind CSS with custom theme colors
- **SMS**: Twilio integration for automated notifications
- **File Storage**: Supabase Storage for employee attachments
- **Deployment**: Vercel with cron jobs for scheduled tasks
- **Type Safety**: TypeScript with strict mode
- **Form Validation**: Zod schema validation

### Key Architectural Patterns

1. **Server Actions**: Used extensively for data mutations. Located in `/src/app/actions/`. This pattern co-locates mutations with components and eliminates need for separate API routes.

2. **Supabase Client**: Centralized through `SupabaseProvider` context. Always use the client from context to avoid multiple instances.

3. **File Storage Pattern**: When working with Supabase Storage:
   - Always use the returned `data.path` from upload responses as the canonical path
   - Store this path in the database for generating signed URLs
   - Never construct storage paths manually

4. **Database Schema**: 
   - Events, customers, bookings, employees with related tables
   - Employee system includes notes (with timestamps) and attachments (with categories)
   - All tables use UUID primary keys and cascade deletes

5. **Cron Jobs**: Automated SMS reminders run daily at 9 AM via Vercel cron, sending 7-day and 24-hour booking reminders through Twilio

### Project Structure
- `/src/app/(authenticated)/` - Protected routes requiring login
- `/src/app/actions/` - Server actions for data operations
- `/src/app/api/cron/` - Cron job endpoints for scheduled tasks
- `/src/components/` - Reusable UI components
- `/src/lib/` - Utilities, database client, SMS templates
- `/src/types/` - TypeScript type definitions
- `/supabase/migrations/` - Database schema migrations

### Environment Variables
Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` - For server-side operations
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET` - For securing cron job endpoints

### Recent Architectural Decisions
- Migrated from `useFormState` to `useActionState` (React 19)
- Fixed form data passing pattern - use hidden fields instead of `.bind()`
- Implemented proper bucket provisioning for file attachments
- Added comprehensive employee management system with notes and attachments

## Development Guidelines

### Code Style
- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Maintain consistent formatting with Prettier
- Ensure ESLint passes before committing

### Database Operations
- Always use parameterized queries
- Implement proper error handling
- Use transactions for multi-step operations
- Follow RLS policies for security

### File Handling
- Validate file types and sizes before upload
- Use signed URLs for secure file access
- Clean up storage when deleting records
- Organize files by employee ID

### SMS Operations
- Test with valid phone numbers
- Handle Twilio errors gracefully
- Log all SMS operations
- Respect rate limits

### Security Best Practices
- Never expose service role keys
- Validate all user inputs
- Use HTTPS for all requests
- Implement proper authentication checks

## Common Tasks

### Adding a New Feature
1. Plan the database schema changes
2. Create migration files
3. Update TypeScript types
4. Implement server actions
5. Build UI components
6. Add proper error handling
7. Test thoroughly

### Debugging Issues
1. Check browser console for errors
2. Review Vercel function logs
3. Inspect Supabase logs
4. Verify environment variables
5. Test in isolation

### Performance Optimization
1. Use proper database indexes
2. Implement pagination for large lists
3. Optimize images with Next.js Image
4. Minimize client-side JavaScript
5. Cache appropriate responses

## Troubleshooting

### Common Issues
- **Multiple Supabase clients**: Always use the provider
- **File upload errors**: Check bucket policies and size limits
- **SMS not sending**: Verify Twilio credentials and phone format
- **Build failures**: Run `npm run lint` and fix type errors
- **Auth issues**: Check middleware and session handling

### Error Patterns
- `406 Not Acceptable`: Use `.maybeSingle()` instead of `.single()`
- `Object not found`: Verify storage paths match database
- `Type errors`: Ensure proper null checks and type guards
- `RLS errors`: Check database policies and user permissions

## Best Practices

### Component Development
- Keep components focused and single-purpose
- Use proper TypeScript types
- Implement loading and error states
- Follow accessibility guidelines
- Make components responsive

### State Management
- Use server state when possible
- Minimize client state
- Implement optimistic updates
- Handle race conditions
- Cache appropriately

### Testing Approach
When tests are added:
- Test critical user paths
- Mock external services
- Use proper test data
- Clean up after tests
- Test error scenarios

## Migration Guide

When making breaking changes:
1. Document the changes clearly
2. Provide migration scripts
3. Update all affected code
4. Test upgrade path
5. Communicate with team

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)