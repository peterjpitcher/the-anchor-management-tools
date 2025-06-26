# Developer Guide and Architecture

**Generated on:** 2025-06-26T13:41:06.991Z
**Consolidated from:** 5 files

---


# Development Guide

*Source: development.md*

# Development Guide

This guide covers development practices, coding standards, and workflows for contributing to The Anchor Management Tools.

## Getting Started

### Development Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/your-org/EventPlanner3.0.git
   cd EventPlanner3.0
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Set Up Environment**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your development credentials
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

## Development Standards

### Code Style

#### TypeScript
- Use TypeScript for all new code
- Enable strict mode
- Define types for all functions
- Avoid `any` type
- Use interfaces over types when possible

```typescript
// Good
interface Employee {
  id: string;
  firstName: string;
  lastName: string;
}

function getEmployee(id: string): Promise<Employee> {
  // Implementation
}

// Avoid
function getEmployee(id: any): any {
  // Implementation
}
```

#### React Components
- Use functional components
- Implement proper TypeScript interfaces
- Handle loading and error states
- Make components reusable

```typescript
// Good component structure
interface EmployeeCardProps {
  employee: Employee;
  onEdit?: (id: string) => void;
}

export function EmployeeCard({ employee, onEdit }: EmployeeCardProps) {
  // Component implementation
}
```

#### Styling
- Use Tailwind CSS classes
- Follow mobile-first approach
- Maintain consistent spacing
- Use design system colors

```tsx
// Good
<div className="bg-white p-4 rounded-lg shadow sm:p-6">
  <h2 className="text-lg font-medium text-gray-900">Title</h2>
</div>

// Avoid inline styles
<div style={{ backgroundColor: 'white', padding: '16px' }}>
```

### File Organization

#### Directory Structure
```
src/
├── app/                    # Next.js app directory
│   ├── (authenticated)/    # Protected routes
│   ├── actions/           # Server actions
│   └── api/              # API routes
├── components/           # Reusable components
├── lib/                 # Utilities and helpers
└── types/              # TypeScript definitions
```

#### Naming Conventions
- Components: PascalCase (`EmployeeCard.tsx`)
- Utilities: camelCase (`formatDate.ts`)
- Types: PascalCase (`Database.ts`)
- Constants: UPPER_SNAKE_CASE
- Files: Match export name

### Database Development

#### Migrations
- Create numbered migration files
- Include up and down migrations
- Test before committing
- Document breaking changes

```sql
-- Good migration structure
-- 20240115_add_employee_status.sql

-- Up Migration
ALTER TABLE employees 
ADD COLUMN status TEXT NOT NULL DEFAULT 'Active';

-- Down Migration (in comments)
-- ALTER TABLE employees DROP COLUMN status;
```

#### Queries
- Use Supabase client properly
- Handle errors gracefully
- Use proper TypeScript types
- Optimize for performance

```typescript
// Good query pattern
export async function getEmployeeWithNotes(id: string) {
  const supabase = createClient();
  
  const { data, error } = await supabase
    .from('employees')
    .select(`
      *,
      employee_notes (
        *,
        created_by_user:auth.users!created_by (
          email
        )
      )
    `)
    .eq('employee_id', id)
    .single();

  if (error) throw error;
  return data;
}
```

### Server Actions

#### Best Practices
- Validate all inputs
- Use proper error handling
- Return meaningful responses
- Implement revalidation

```typescript
// Good server action
export async function updateEmployee(
  employeeId: string,
  formData: FormData
) {
  try {
    // Validate inputs
    const firstName = formData.get('first_name')?.toString();
    if (!firstName) {
      throw new Error('First name is required');
    }

    // Update database
    const { error } = await supabase
      .from('employees')
      .update({ first_name: firstName })
      .eq('employee_id', employeeId);

    if (error) throw error;

    // Revalidate cache
    revalidatePath(`/employees/${employeeId}`);
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error.message 
    };
  }
}
```

## Testing

### Manual Testing
- Test all user flows
- Verify mobile responsiveness
- Check error handling
- Test edge cases
- Verify SMS delivery

### Testing Checklist
- [ ] Feature works as expected
- [ ] Mobile layout correct
- [ ] Errors handled gracefully
- [ ] Loading states shown
- [ ] Form validation works
- [ ] Database updates correctly
- [ ] SMS sends properly

### Future: Automated Testing
When implementing tests:
- Unit tests for utilities
- Integration tests for server actions
- Component tests with React Testing Library
- E2E tests for critical paths

## Git Workflow

### Branch Strategy
```bash
main           # Production code
├── develop    # Development branch
└── feature/*  # Feature branches
```

### Commit Messages
Follow conventional commits:
```
feat: add employee document upload
fix: resolve SMS delivery issue
docs: update deployment guide
refactor: improve database queries
test: add employee service tests
```

### Pull Request Process
1. Create feature branch
2. Make changes
3. Run linting
4. Test thoroughly
5. Create PR with description
6. Request review
7. Address feedback
8. Merge when approved

## Common Development Tasks

### Adding a New Feature

1. **Plan the Feature**
   - Define requirements
   - Design database schema
   - Plan UI/UX
   - Consider edge cases

2. **Implementation Steps**
   ```bash
   # Create feature branch
   git checkout -b feature/new-feature
   
   # Create migrations if needed
   touch supabase/migrations/timestamp_description.sql
   
   # Update types
   npm run generate-types
   
   # Implement feature
   # Test thoroughly
   
   # Commit and push
   git add .
   git commit -m "feat: implement new feature"
   git push origin feature/new-feature
   ```

### Debugging

#### Client-Side Debugging
```typescript
// Use console.log strategically
console.log('Employee data:', employee);

// Use React Developer Tools
// Check component props and state

// Use Network tab for API calls
```

#### Server-Side Debugging
```typescript
// In server actions
console.log('Form data:', Object.fromEntries(formData));

// Check Vercel logs
// Review Supabase logs
```

### Performance Optimization

1. **Database Queries**
   - Use select to limit fields
   - Add appropriate indexes
   - Batch operations when possible
   - Use connection pooling

2. **React Performance**
   - Implement React.memo for expensive components
   - Use useMemo and useCallback appropriately
   - Lazy load components
   - Optimize images

3. **Bundle Size**
   - Use dynamic imports
   - Tree shake unused code
   - Analyze bundle size
   - Minimize dependencies

## Environment Management

### Local Development
```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-key
# Use local Supabase instance
```

### Staging Environment
- Create separate Supabase project
- Use staging environment variables
- Test migrations before production
- Verify all features

## Security Considerations

### Input Validation
- Validate all user inputs
- Sanitize data before storage
- Use parameterized queries
- Implement rate limiting

### Authentication
- Verify user sessions
- Check permissions
- Log security events
- Handle errors safely

### Data Protection
- Never log sensitive data
- Use environment variables
- Implement proper CORS
- Follow OWASP guidelines

## Resources

### Documentation
- [Next.js Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)

### Tools
- React Developer Tools
- Supabase Studio
- Vercel CLI
- TypeScript Playground

### Learning Resources
- Next.js tutorials
- Supabase guides
- React patterns
- TypeScript tips

## Getting Help

### Internal Resources
- Review existing code
- Check documentation
- Ask team members
- Review PRs

### External Resources
- Stack Overflow
- GitHub Discussions
- Discord communities
- Official forums

---


# Architecture Overview

*Source: architecture.md*

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

---


# AI Assistant Guide

*Source: ai-assistant-guide.md*

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

---


# Comprehensive Testing Strategy

*Source: testing-strategy.md*

# Comprehensive Testing Strategy

This document outlines the testing strategy for The Anchor Management Tools based on audit findings and critical issues.

## 🎯 Testing Priorities

### Critical (Week 1)
1. **Data Validation** - Prevent invalid data entry
2. **Rate Limiting** - Verify DDoS protection
3. **GDPR Compliance** - Ensure data rights work
4. **Authentication** - Confirm security boundaries

### High (Month 1)
1. **Performance** - Load testing and optimization
2. **SMS Delivery** - End-to-end messaging tests
3. **Booking Flows** - Complete user journeys
4. **Error Handling** - Graceful failure scenarios

### Medium (Quarter 1)
1. **Accessibility** - WCAG compliance
2. **Cross-browser** - Compatibility testing
3. **Mobile Experience** - Responsive design
4. **Integration** - Third-party services

## Testing Pyramid

```
         /\
        /  \       E2E Tests (10%)
       /────\      - Critical user journeys
      /      \     - Happy path scenarios
     /────────\    
    /          \   Integration Tests (30%)
   /────────────\  - API endpoints
  /              \ - Database operations
 /────────────────\- External services
/                  \
────────────────────── Unit Tests (60%)
                       - Business logic
                       - Validation rules
                       - Utility functions
```

## Test Implementation Plan

### Phase 1: Unit Tests (Week 1)

#### 1.1 Validation Tests

Create `src/lib/__tests__/validation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  phoneSchema,
  emailSchema,
  futureDateSchema,
  customerSchema,
  formatPhoneForStorage,
  formatPhoneForDisplay,
} from '../validation';

describe('Phone Number Validation', () => {
  describe('phoneSchema', () => {
    const validNumbers = [
      { input: '+447700900123', description: 'E.164 format' },
      { input: '+447911123456', description: 'Different UK mobile' },
    ];

    const invalidNumbers = [
      { input: '123', description: 'Too short' },
      { input: '07700900123', description: 'Missing country code' },
      { input: 'notaphone', description: 'Not a number' },
      { input: '+44', description: 'Incomplete' },
      { input: '+1234567890', description: 'Non-UK number' },
    ];

    validNumbers.forEach(({ input, description }) => {
      it(`accepts valid number: ${description}`, () => {
        expect(() => phoneSchema.parse(input)).not.toThrow();
      });
    });

    invalidNumbers.forEach(({ input, description }) => {
      it(`rejects invalid number: ${description}`, () => {
        expect(() => phoneSchema.parse(input)).toThrow();
      });
    });

    it('allows empty values', () => {
      expect(() => phoneSchema.parse('')).not.toThrow();
      expect(() => phoneSchema.parse(null)).not.toThrow();
      expect(() => phoneSchema.parse(undefined)).not.toThrow();
    });
  });

  describe('Phone Number Formatting', () => {
    it('formats for storage correctly', () => {
      expect(formatPhoneForStorage('07700900123')).toBe('+447700900123');
      expect(formatPhoneForStorage('07700 900123')).toBe('+447700900123');
      expect(formatPhoneForStorage('+447700900123')).toBe('+447700900123');
    });

    it('formats for display correctly', () => {
      expect(formatPhoneForDisplay('+447700900123')).toBe('07700 900123');
      expect(formatPhoneForDisplay(null)).toBe('');
    });

    it('throws on invalid format', () => {
      expect(() => formatPhoneForStorage('123')).toThrow();
      expect(() => formatPhoneForStorage('invalid')).toThrow();
    });
  });
});

describe('Date Validation', () => {
  it('accepts future dates', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(() => futureDateSchema.parse(tomorrow.toISOString())).not.toThrow();
  });

  it('accepts today', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(() => futureDateSchema.parse(today)).not.toThrow();
  });

  it('rejects past dates', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(() => futureDateSchema.parse(yesterday.toISOString())).toThrow();
  });
});

describe('Email Validation', () => {
  const validEmails = [
    'user@example.com',
    'user.name@example.co.uk',
    'user+tag@example.com',
  ];

  const invalidEmails = [
    'notanemail',
    '@example.com',
    'user@',
    'user@example',
  ];

  validEmails.forEach((email) => {
    it(`accepts valid email: ${email}`, () => {
      expect(() => emailSchema.parse(email)).not.toThrow();
    });
  });

  invalidEmails.forEach((email) => {
    it(`rejects invalid email: ${email}`, () => {
      expect(() => emailSchema.parse(email)).toThrow();
    });
  });
});
```

#### 1.2 Business Logic Tests

Create `src/app/actions/__tests__/bookings.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBooking } from '../bookings';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server');

describe('Booking Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prevents overbooking', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'event-1',
          capacity: 10,
          bookings: [
            { seats: 5 },
            { seats: 3 },
          ],
        },
      }),
    };

    vi.mocked(createClient).mockReturnValue(mockSupabase as any);

    const formData = new FormData();
    formData.set('event_id', 'event-1');
    formData.set('customer_id', 'customer-1');
    formData.set('seats', '5'); // Requesting 5, but only 2 available

    const result = await createBooking(formData);
    
    expect(result.error).toBe('Only 2 seats available for this event');
  });

  it('prevents booking past events', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'event-1',
          date: yesterday.toISOString(),
          capacity: 100,
          bookings: [],
        },
      }),
    };

    vi.mocked(createClient).mockReturnValue(mockSupabase as any);

    const formData = new FormData();
    formData.set('event_id', 'event-1');
    formData.set('customer_id', 'customer-1');
    formData.set('seats', '2');

    const result = await createBooking(formData);
    
    expect(result.error).toBe('Cannot book past events');
  });
});
```

#### 1.3 Rate Limiting Tests

Create `src/lib/__tests__/rate-limit.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkRateLimit } from '../rate-limit';
import { redis } from '../redis';

describe('Rate Limiting', () => {
  const testId = `test-${Date.now()}`;

  beforeAll(async () => {
    // Ensure Redis connection
    await redis.ping();
  });

  afterAll(async () => {
    // Clean up test data
    await redis.del(`rl:api:${testId}`);
  });

  it('allows requests within limit', async () => {
    const results = [];
    
    // Make 5 requests (well under 100/min limit)
    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit('api', testId);
      results.push(result);
    }

    results.forEach((result) => {
      expect(result.success).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });
  });

  it('enforces SMS rate limit', async () => {
    const smsTestId = `sms-test-${Date.now()}`;
    
    // SMS limit is 10/minute
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('sms', smsTestId);
    }

    // 11th request should fail
    const result = await checkRateLimit('sms', smsTestId);
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
```

### Phase 2: Integration Tests (Week 2)

#### 2.1 API Endpoint Tests

Create `src/app/api/__tests__/health.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { GET } from '../health/route';

describe('Health Check Endpoint', () => {
  it('returns healthy status when all services are up', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks).toHaveProperty('database');
    expect(data.checks).toHaveProperty('auth');
    expect(data.checks).toHaveProperty('storage');
  });

  it('returns unhealthy status when a service is down', async () => {
    // Mock a database failure
    // ... mock implementation

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
  });
});
```

#### 2.2 Database Operations

Create `src/lib/__tests__/database.integration.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@/lib/supabase/server';

describe('Database Operations', () => {
  const supabase = createClient();
  let testCustomerId: string;

  beforeEach(async () => {
    // Create test customer
    const { data } = await supabase
      .from('customers')
      .insert({
        first_name: 'Test',
        last_name: 'User',
        mobile_number: '+447700900999',
      })
      .select()
      .single();
    
    testCustomerId = data.id;
  });

  afterEach(async () => {
    // Clean up
    await supabase
      .from('customers')
      .delete()
      .eq('id', testCustomerId);
  });

  it('enforces phone number constraint', async () => {
    const { error } = await supabase
      .from('customers')
      .insert({
        first_name: 'Invalid',
        last_name: 'Phone',
        mobile_number: '123', // Invalid format
      });

    expect(error).toBeTruthy();
    expect(error.code).toBe('23514'); // Check constraint violation
  });

  it('cascades booking deletion with event', async () => {
    // Create event
    const { data: event } = await supabase
      .from('events')
      .insert({
        name: 'Test Event',
        date: new Date().toISOString(),
        time: '19:00',
        capacity: 100,
      })
      .select()
      .single();

    // Create booking
    const { data: booking } = await supabase
      .from('bookings')
      .insert({
        event_id: event.id,
        customer_id: testCustomerId,
        seats: 2,
      })
      .select()
      .single();

    // Delete event
    await supabase
      .from('events')
      .delete()
      .eq('id', event.id);

    // Verify booking was deleted
    const { data: deletedBooking } = await supabase
      .from('bookings')
      .select()
      .eq('id', booking.id)
      .single();

    expect(deletedBooking).toBeNull();
  });
});
```

### Phase 3: End-to-End Tests (Week 3)

#### 3.1 Critical User Journeys

Create `e2e/booking-flow.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Booking Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'testpassword');
    await page.click('[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('complete booking journey', async ({ page }) => {
    // Navigate to events
    await page.goto('/events');
    
    // Create new event
    await page.click('text=Create Event');
    await page.fill('[name="name"]', 'Test Quiz Night');
    await page.fill('[name="date"]', '2024-12-31');
    await page.fill('[name="time"]', '19:00');
    await page.fill('[name="capacity"]', '50');
    await page.click('text=Create Event');

    // Verify event created
    await expect(page.locator('text=Test Quiz Night')).toBeVisible();

    // Navigate to customers
    await page.goto('/customers');
    
    // Create customer
    await page.click('text=Add Customer');
    await page.fill('[name="first_name"]', 'John');
    await page.fill('[name="last_name"]', 'Doe');
    await page.fill('[name="mobile_number"]', '07700900123');
    await page.click('text=Create Customer');

    // Create booking
    await page.goto('/bookings/new');
    await page.selectOption('[name="event_id"]', 'Test Quiz Night');
    await page.selectOption('[name="customer_id"]', 'John Doe');
    await page.fill('[name="seats"]', '2');
    await page.click('text=Create Booking');

    // Verify booking created
    await expect(page.locator('text=Booking confirmed')).toBeVisible();
  });

  test('prevents overbooking', async ({ page }) => {
    // Assume event with capacity 10, 8 seats booked
    await page.goto('/bookings/new');
    await page.selectOption('[name="event_id"]', 'Nearly Full Event');
    await page.selectOption('[name="customer_id"]', 'John Doe');
    await page.fill('[name="seats"]', '5'); // Try to book 5 when only 2 available
    await page.click('text=Create Booking');

    // Verify error message
    await expect(page.locator('text=Only 2 seats available')).toBeVisible();
  });
});
```

#### 3.2 GDPR Compliance Tests

Create `e2e/gdpr-compliance.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test.describe('GDPR Compliance', () => {
  test('privacy policy accessible', async ({ page }) => {
    await page.goto('/');
    
    // Check footer link
    await page.click('text=Privacy Policy');
    await expect(page).toHaveURL('/privacy');
    await expect(page.locator('h1')).toContainText('Privacy Policy');
    
    // Verify key sections
    await expect(page.locator('text=Information We Collect')).toBeVisible();
    await expect(page.locator('text=Your Rights')).toBeVisible();
    await expect(page.locator('text=Contact Us')).toBeVisible();
  });

  test('data export functionality', async ({ page }) => {
    // Login and navigate to customer
    await page.goto('/login');
    // ... login steps
    
    await page.goto('/customers/123/gdpr');
    
    // Request data export
    await page.click('text=Export Data');
    
    // Wait for download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('text=Download JSON'),
    ]);

    // Verify download
    expect(download.suggestedFilename()).toContain('customer-data');
    expect(download.suggestedFilename()).toContain('.json');
  });

  test('consent management', async ({ page }) => {
    await page.goto('/customers/new');
    
    // Check consent checkbox
    const consentCheckbox = page.locator('[name="sms_opt_in"]');
    await expect(consentCheckbox).not.toBeChecked();
    
    // Check consent
    await consentCheckbox.check();
    
    // Verify consent text
    await expect(page.locator('text=Reply STOP to opt-out')).toBeVisible();
    
    // Submit form
    await page.fill('[name="first_name"]', 'Jane');
    await page.fill('[name="mobile_number"]', '07700900123');
    await page.click('text=Create Customer');
    
    // Verify consent recorded
    await page.goto('/customers/jane-doe');
    await expect(page.locator('text=SMS Marketing: ✓')).toBeVisible();
  });
});
```

### Phase 4: Performance Tests (Week 4)

#### 4.1 Load Testing

Create `performance/load-test.js`:
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 10 },  // Ramp up
    { duration: '5m', target: 50 },  // Stay at 50 users
    { duration: '2m', target: 100 }, // Peak load
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests under 3s
    http_req_failed: ['rate<0.1'],    // Error rate under 10%
  },
};

export default function () {
  const BASE_URL = 'https://management.orangejelly.co.uk';

  // Test health endpoint
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
    'health check responds quickly': (r) => r.timings.duration < 500,
  });

  sleep(1);

  // Test customer list (authenticated)
  const headers = {
    'Authorization': `Bearer ${__ENV.TEST_TOKEN}`,
  };
  
  const customersRes = http.get(`${BASE_URL}/api/customers`, { headers });
  check(customersRes, {
    'customers status is 200': (r) => r.status === 200,
    'customers response time OK': (r) => r.timings.duration < 2000,
  });

  sleep(2);
}
```

#### 4.2 Database Query Performance

Create `performance/database-performance.sql`:
```sql
-- Test query performance
EXPLAIN ANALYZE
SELECT 
  c.id,
  c.first_name,
  c.last_name,
  COUNT(b.id) as total_bookings,
  MAX(e.date) as last_event_date
FROM customers c
LEFT JOIN bookings b ON b.customer_id = c.id
LEFT JOIN events e ON e.id = b.event_id
WHERE c.created_at > NOW() - INTERVAL '30 days'
GROUP BY c.id
ORDER BY total_bookings DESC
LIMIT 100;

-- Check for missing indexes
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  most_common_vals
FROM pg_stats
WHERE tablename IN ('customers', 'bookings', 'events', 'messages')
  AND n_distinct > 100
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = pg_stats.tablename
    AND indexdef LIKE '%' || attname || '%'
  );
```

### Phase 5: Security Tests (Month 2)

#### 5.1 Authentication Tests

Create `security/auth.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('Authentication Security', () => {
  it('prevents access to protected routes without auth', async () => {
    const protectedRoutes = [
      '/dashboard',
      '/customers',
      '/events',
      '/employees',
      '/settings',
    ];

    for (const route of protectedRoutes) {
      const response = await fetch(`${BASE_URL}${route}`, {
        redirect: 'manual',
      });
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/login');
    }
  });

  it('enforces rate limiting on login attempts', async () => {
    const attempts = [];
    
    // Make 6 login attempts (limit is 5/15min)
    for (let i = 0; i < 6; i++) {
      attempts.push(
        fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'wrongpassword',
          }),
        })
      );
    }

    const responses = await Promise.all(attempts);
    const lastResponse = responses[5];
    
    expect(lastResponse.status).toBe(429);
    expect(lastResponse.headers.get('retry-after')).toBeTruthy();
  });
});
```

#### 5.2 Input Sanitization

Create `security/input-sanitization.test.ts`:
```typescript
describe('Input Sanitization', () => {
  const maliciousInputs = [
    '<script>alert("XSS")</script>',
    '"; DROP TABLE customers; --',
    '../../../etc/passwd',
    'javascript:alert(1)',
    '<img src=x onerror=alert(1)>',
  ];

  it('sanitizes customer names', async () => {
    for (const input of maliciousInputs) {
      const response = await createCustomer({
        first_name: input,
        last_name: 'Test',
        mobile_number: '+447700900123',
      });

      // Should either reject or sanitize
      if (response.data) {
        expect(response.data.first_name).not.toContain('<script>');
        expect(response.data.first_name).not.toContain('DROP TABLE');
      }
    }
  });
});
```

## Test Automation

### Continuous Integration

Create `.github/workflows/test.yml`:
```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: supabase/postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Setup test database
        run: |
          npm run db:test:setup
      
      - name: Run integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        run: npm run test:e2e
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
```

### Test Scripts

Update `package.json`:
```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run src/**/*.test.ts",
    "test:integration": "vitest run src/**/*.integration.test.ts",
    "test:e2e": "playwright test",
    "test:load": "k6 run performance/load-test.js",
    "test:security": "npm run test:security:auth && npm run test:security:input",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest watch"
  }
}
```

## Test Data Management

### Test Data Factory

Create `tests/factories/customer.factory.ts`:
```typescript
import { faker } from '@faker-js/faker';

export function createTestCustomer(overrides = {}) {
  return {
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    email_address: faker.internet.email(),
    mobile_number: `+447${faker.string.numeric(9)}`,
    date_of_birth: faker.date.past({ years: 50 }).toISOString(),
    sms_opt_in: faker.datatype.boolean(),
    notes: faker.lorem.sentence(),
    ...overrides,
  };
}

export function createTestEvent(overrides = {}) {
  const futureDate = faker.date.future();
  return {
    name: faker.lorem.words(3),
    date: futureDate.toISOString().split('T')[0],
    time: faker.date.future().toTimeString().slice(0, 5),
    capacity: faker.number.int({ min: 10, max: 200 }),
    ...overrides,
  };
}
```

### Database Seeding

Create `tests/seed.ts`:
```typescript
import { createClient } from '@/lib/supabase/server';
import { createTestCustomer, createTestEvent } from './factories';

export async function seedTestData() {
  const supabase = createClient();
  
  // Create test customers
  const customers = Array(50).fill(null).map(() => createTestCustomer());
  await supabase.from('customers').insert(customers);
  
  // Create test events
  const events = Array(20).fill(null).map(() => createTestEvent());
  await supabase.from('events').insert(events);
  
  console.log('✅ Test data seeded');
}

export async function cleanupTestData() {
  const supabase = createClient();
  
  // Delete test data (be careful in production!)
  await supabase.from('bookings').delete().match({ test_data: true });
  await supabase.from('events').delete().match({ test_data: true });
  await supabase.from('customers').delete().match({ test_data: true });
  
  console.log('✅ Test data cleaned up');
}
```

## Testing Checklist

### Before Each Release

- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] E2E tests for critical paths passing
- [ ] No console errors in browser
- [ ] Performance benchmarks met
- [ ] Security scan completed
- [ ] Accessibility audit passed
- [ ] Mobile testing completed
- [ ] Cross-browser testing done

### Weekly

- [ ] Review test coverage reports
- [ ] Update test data
- [ ] Check for flaky tests
- [ ] Review error logs from production
- [ ] Update test documentation

### Monthly

- [ ] Full regression test
- [ ] Load testing
- [ ] Security penetration test
- [ ] Accessibility audit
- [ ] Performance profiling

## Success Metrics

- **Test Coverage**: > 80% for critical paths
- **Test Execution Time**: < 10 minutes for CI
- **Test Reliability**: < 1% flaky tests
- **Bug Detection**: > 90% caught before production
- **Performance**: All endpoints < 3s response time

---


# Troubleshooting Guide

*Source: troubleshooting.md*

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

---

