# Architecture Overview

This section provides a comprehensive overview of The Anchor Management Tools' architecture, design patterns, and technical decisions.

## System Architecture

The application follows a modern, serverless architecture built on Next.js 15 with the following key components:

### Frontend Architecture
- **Framework**: Next.js 15 with App Router
- **UI Library**: React 19 with TypeScript
- **Styling**: Tailwind CSS with custom design system
- **State Management**: React hooks and server state via Server Actions
- **Component Library**: Custom components with shadcn/ui patterns

### Backend Architecture
- **API Layer**: Next.js Server Actions and Route Handlers
- **Database**: PostgreSQL via Supabase
- **Authentication**: Supabase Auth with JWT tokens
- **File Storage**: Supabase Storage with signed URLs
- **Background Jobs**: Vercel Cron for scheduled tasks

### Infrastructure
- **Hosting**: Vercel (serverless functions)
- **CDN**: Vercel Edge Network
- **Database**: Supabase (managed PostgreSQL)
- **SMS Service**: Twilio
- **Version Control**: GitHub

## Key Architectural Patterns

### 1. Server Actions Pattern
The application extensively uses Next.js Server Actions for data mutations:
- Co-locates data operations with components
- Eliminates need for separate API routes
- Provides type-safe server-client communication
- Enables progressive enhancement

Example:
```typescript
// src/app/actions/employeeActions.ts
export async function addEmployee(formData: FormData) {
  // Direct database operations
  // Automatic revalidation
  // Type-safe returns
}
```

### 2. Centralized Supabase Client
A single Supabase client instance is shared across the application:
- Prevents multiple client warnings
- Ensures consistent authentication state
- Optimizes connection pooling
- Simplifies configuration management

### 3. File Storage Architecture
Employee attachments follow a specific pattern:
- Files uploaded to Supabase Storage
- Path stored in database: `{employee_id}/{filename}`
- Signed URLs generated on-demand
- Automatic cleanup on deletion

### 4. Authentication Flow
- Middleware-based route protection
- JWT tokens with refresh rotation
- Session persistence across requests
- Automatic redirect for unauthenticated users

## Data Flow

### Request Lifecycle
1. User action triggers form submission
2. Server Action processes the request
3. Database operation via Supabase client
4. Automatic cache revalidation
5. UI updates with new data

### SMS Notification Flow
1. Cron job triggers at 9 AM daily
2. Queries upcoming events
3. Identifies customers needing reminders
4. Sends SMS via Twilio API
5. Logs results for monitoring

## Security Architecture

### Authentication & Authorization
- All routes protected by middleware
- Row Level Security (RLS) on all tables
- Service role key only on server
- Public key for client operations

### Data Protection
- HTTPS everywhere
- Encrypted database connections
- Signed URLs for file access
- Environment variable isolation

### Input Validation
- Zod schemas for form validation
- Server-side validation
- SQL injection prevention via parameterized queries
- XSS protection through React

## Performance Considerations

### Optimization Strategies
- Server-side rendering for initial load
- Streaming SSR for faster Time to First Byte
- Image optimization with Next.js Image
- Lazy loading for non-critical components

### Caching Strategy
- Static pages cached at edge
- Dynamic pages with revalidation
- Database query caching
- CDN for static assets

### Database Performance
- Indexed foreign keys
- Optimized query patterns
- Connection pooling
- Batch operations where possible

## Scalability Design

### Horizontal Scaling
- Stateless application design
- Serverless function architecture
- Database connection pooling
- CDN for global distribution

### Vertical Scaling
- Supabase tier upgrades
- Vercel Pro for higher limits
- Twilio volume pricing
- Storage expansion as needed

## Error Handling

### Client-Side Errors
- Error boundaries for React components
- User-friendly error messages
- Fallback UI components
- Retry mechanisms

### Server-Side Errors
- Comprehensive try-catch blocks
- Detailed error logging
- Graceful degradation
- User notification system

## Monitoring & Observability

### Application Monitoring
- Vercel Analytics for performance
- Error tracking (ready for Sentry)
- Custom logging for critical operations
- Health check endpoints

### Infrastructure Monitoring
- Supabase dashboard metrics
- Twilio delivery reports
- Vercel function logs
- GitHub Actions status

## Development Workflow

### Local Development
- Hot module replacement
- TypeScript for type safety
- ESLint for code quality
- Prettier for formatting

### CI/CD Pipeline
- GitHub for version control
- Automatic deployments via Vercel
- Environment-based configurations
- Rollback capabilities

## Future Architecture Considerations

### Potential Enhancements
- Redis for session caching
- Queue system for SMS delivery
- WebSocket for real-time updates
- Microservices for specific features

### Scaling Preparations
- Database sharding strategy
- Multi-region deployment
- Load balancing setup
- Backup automation

## Architecture Decision Records

Key decisions and their rationale:
1. **Next.js App Router**: Modern React patterns and better performance
2. **Supabase**: Integrated auth, database, and storage solution
3. **Server Actions**: Simplified architecture and type safety
4. **Vercel Hosting**: Seamless Next.js integration and global CDN
5. **Tailwind CSS**: Rapid development and consistent styling