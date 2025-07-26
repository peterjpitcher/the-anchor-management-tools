# System Architecture

**Last Updated:** July 2025  
**Application:** The Anchor Management Tools  
**Production URL:** https://management.orangejelly.co.uk

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Application Architecture](#application-architecture)
4. [Database Architecture](#database-architecture)
5. [API Architecture](#api-architecture)
6. [Authentication & Authorization](#authentication--authorization)
7. [Data Flow & Integrations](#data-flow--integrations)
8. [Performance Architecture](#performance-architecture)
9. [Scalability & Infrastructure](#scalability--infrastructure)
10. [Security Architecture](#security-architecture)

## System Overview

The Anchor Management Tools is a comprehensive venue management system built as a modern, serverless web application. It provides event scheduling, customer management, employee records, private bookings, and automated SMS notifications.

### High-Level Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│   Frontend      │────▶│   Backend        │────▶│   Database      │
│   (Next.js)     │     │   (Server       │     │   (Supabase)   │
│                 │     │    Actions)      │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                         │
         │                       │                         │
         ▼                       ▼                         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│   CDN           │     │   SMS Service    │     │   File Storage  │
│   (Vercel Edge) │     │   (Twilio)       │     │   (Supabase)   │
│                 │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Core Components

- **Frontend**: React-based UI with server-side rendering
- **Backend**: Serverless functions handling business logic
- **Database**: PostgreSQL with Row Level Security
- **Authentication**: JWT-based auth with role management
- **File Storage**: Object storage for attachments
- **SMS Gateway**: Two-way messaging capabilities
- **Job Queue**: Scheduled tasks and async processing

## Technology Stack

### Frontend Technologies

- **Framework**: Next.js 15.3.3 (App Router)
- **UI Library**: React 19.1.0
- **Language**: TypeScript 5.4.5
- **Styling**: Tailwind CSS 3.4.0
- **Components**: Custom components with Headless UI
- **Icons**: Heroicons 2.1.3, Lucide React 0.551.0
- **Forms**: React Hook Form with Zod validation

### Backend Technologies

- **Runtime**: Node.js (via Vercel serverless)
- **API Pattern**: Server Actions (no traditional REST)
- **Database**: PostgreSQL 15 (via Supabase)
- **ORM**: Direct SQL queries with parameterization
- **Authentication**: Supabase Auth (JWT)
- **File Processing**: Puppeteer 24.12.1 (PDF generation)
- **Email**: Microsoft Graph API (Office 365)

### Infrastructure

- **Hosting**: Vercel (serverless functions)
- **Database**: Supabase (managed PostgreSQL)
- **CDN**: Vercel Edge Network
- **SMS Provider**: Twilio 5.7.0
- **Monitoring**: Ready for Sentry integration
- **CI/CD**: GitHub + Vercel automatic deployments

### Development Tools

- **Package Manager**: npm
- **Linting**: ESLint with custom config
- **Formatting**: Prettier
- **Testing**: Playwright for E2E tests
- **Type Checking**: TypeScript strict mode
- **Version Control**: Git/GitHub

## Application Architecture

### Architectural Patterns

#### 1. Server Actions Pattern
Primary pattern for all data mutations, eliminating traditional API routes:

```typescript
// Server action example
'use server';

export async function createBooking(formData: FormData) {
  // Direct database access
  const supabase = await createClient();
  
  // Permission check
  const hasPermission = await checkUserPermission('bookings', 'create');
  
  // Business logic
  const result = await supabase
    .from('bookings')
    .insert(data)
    .select()
    .single();
    
  // Automatic cache revalidation
  revalidatePath('/bookings');
  
  return result;
}
```

#### 2. Centralized Supabase Client
Single client instance pattern to prevent connection issues:

```typescript
// Singleton pattern for Supabase client
let cachedClient: SupabaseClient | null = null;

export async function createClient() {
  if (cachedClient) return cachedClient;
  
  cachedClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies }
  );
  
  return cachedClient;
}
```

#### 3. Context-Based State Management
React contexts for auth and permissions:

```typescript
// SupabaseProvider for auth state
// PermissionContext for role-based access
<SupabaseProvider>
  <PermissionContext.Provider>
    <App />
  </PermissionContext.Provider>
</SupabaseProvider>
```

### Directory Structure

```
src/
├── app/                        # Next.js App Router
│   ├── (authenticated)/        # Protected routes
│   ├── actions/               # Server actions
│   ├── api/                   # API routes (webhooks, cron)
│   └── auth/                  # Auth routes
├── components/                # React components
│   ├── providers/            # Context providers
│   └── ui/                   # UI components
├── contexts/                  # React contexts
├── lib/                       # Core utilities
│   ├── supabase/            # Database client
│   ├── sms/                 # SMS integration
│   └── validation/          # Zod schemas
└── types/                     # TypeScript definitions
```

### Request Lifecycle

1. **User Interaction** → Form submission or action trigger
2. **Server Action** → Validates input and checks permissions
3. **Database Operation** → Direct Supabase query with RLS
4. **Business Logic** → Additional processing (SMS, audit logs)
5. **Cache Revalidation** → Next.js revalidates affected paths
6. **UI Update** → React re-renders with new data

## Database Architecture

### Schema Design Principles

- **UUID Primary Keys**: All tables use UUID v4 for global uniqueness
- **Timestamptz Fields**: All timestamps include timezone information
- **Cascade Deletes**: Foreign key constraints with appropriate cascades
- **Row Level Security**: All tables protected by RLS policies
- **Audit Trail**: Comprehensive logging of all changes
- **Normalized Structure**: Proper normalization with junction tables

### Core Database Tables

#### Event Management
- **events**: Core event information (date, time, capacity)
- **event_categories**: Event categorization with features
- **bookings**: Customer registrations for events
- **customer_category_stats**: Analytics on customer preferences

#### Customer Management
- **customers**: Customer profiles with contact info
- **customer_messaging_health**: SMS delivery tracking
- **messages**: SMS message queue and history

#### Employee Management
- **employees**: Comprehensive employee records
- **employee_notes**: Time-stamped notes system
- **employee_attachments**: Document metadata
- **attachment_categories**: Document categorization

#### Private Bookings
- **private_bookings**: Venue hire bookings
- **private_booking_items**: Line items for bookings
- **catering_packages**: Catering options
- **venue_spaces**: Available spaces
- **vendors**: External vendor management

#### System Tables
- **audit_logs**: Comprehensive audit trail
- **rbac_roles**: Role definitions
- **rbac_permissions**: Permission definitions
- **rbac_role_permissions**: Role-permission mapping
- **profiles**: User profiles
- **jobs**: Background job queue
- **webhook_logs**: External webhook tracking
- **api_keys**: API authentication

### Database Views

```sql
-- Customer messaging health aggregation
CREATE VIEW customer_messaging_health AS
SELECT 
  customer_id,
  COUNT(*) FILTER (WHERE status = 'failed') as consecutive_failures,
  MAX(created_at) as last_message_date,
  CASE 
    WHEN COUNT(*) FILTER (WHERE status = 'failed') > 3 THEN 'suspended'
    ELSE 'active'
  END as messaging_status
FROM messages
GROUP BY customer_id;
```

### Performance Indexes

Critical indexes for query optimization:

```sql
-- Event queries
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_events_category_id ON events(category_id);

-- Customer queries  
CREATE INDEX idx_customers_mobile_number ON customers(mobile_number);
CREATE INDEX idx_customers_messaging_status ON customers(messaging_status);

-- Message queries
CREATE INDEX idx_messages_customer_created ON messages(customer_id, created_at);
CREATE INDEX idx_messages_status ON messages(status);

-- Private bookings
CREATE INDEX idx_private_bookings_event_date ON private_bookings(event_date);
CREATE INDEX idx_private_bookings_status ON private_bookings(status);
```

### Row Level Security (RLS)

All tables implement RLS with permission-based policies:

```sql
-- Example RLS policy
CREATE POLICY "Users can view with permission" ON bookings
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'bookings', 'view')
  );
```

## API Architecture

### API Route Usage

API routes are reserved for specific use cases:

1. **External Webhooks** (`/api/webhooks/*`)
   - Twilio SMS callbacks
   - Payment provider callbacks
   - Third-party integrations

2. **Scheduled Tasks** (`/api/cron/*`)
   - Daily reminder processing
   - Job queue processing
   - Cleanup tasks

3. **File Generation** (`/api/generate/*`)
   - PDF contracts
   - CSV exports
   - Reports

4. **Public API** (`/api/public/*`)
   - Table booking endpoint
   - Availability checking
   - Status endpoints

### Server Actions

All authenticated mutations use server actions:

```typescript
// Standardized server action pattern
export async function actionName(formData: FormData) {
  try {
    // 1. Get authenticated client
    const supabase = await createClient();
    
    // 2. Check permissions
    await requirePermission('module', 'action');
    
    // 3. Validate input
    const validated = Schema.parse(formData);
    
    // 4. Execute business logic
    const result = await businessLogic(validated);
    
    // 5. Log audit event
    await logAuditEvent({ ...details });
    
    // 6. Revalidate cache
    revalidatePath('/relevant-path');
    
    return { success: true, data: result };
  } catch (error) {
    return { error: error.message };
  }
}
```

### API Response Format

Standardized response structure:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}
```

## Authentication & Authorization

### Authentication Flow

1. **Login**: Supabase Auth handles credential verification
2. **Session**: JWT stored in httpOnly cookies
3. **Refresh**: Automatic token refresh on expiry
4. **Logout**: Session cleanup and redirect

### Authorization System (RBAC)

#### Role Hierarchy
- **super_admin**: Full system access
- **manager**: Department management
- **staff**: Basic operations

#### Permission Structure
```typescript
interface Permission {
  module: 'events' | 'customers' | 'employees' | 'private_bookings' | ...;
  action: 'view' | 'create' | 'edit' | 'delete' | 'manage';
}
```

#### Permission Checking
```typescript
// Server-side check
const hasPermission = await checkUserPermission('events', 'create');

// Client-side check
const { hasPermission } = usePermissions();
if (hasPermission('events', 'create')) {
  // Show create button
}
```

### API Key Authentication

For external integrations:

```typescript
// API key validation
const apiKey = await validateApiKey(request.headers.get('x-api-key'));
if (!apiKey || !apiKey.scopes.includes('required-scope')) {
  return unauthorized();
}
```

## Data Flow & Integrations

### SMS Integration Flow

```
User Action → Server Action → Queue Message → Twilio API → Delivery
                                   ↓
                              Webhook ← Status Update
                                   ↓
                              Update Status → Audit Log
```

### Email Integration (Microsoft Graph)

```typescript
// Email sending pattern
const graphClient = new GraphClient(accessToken);
await graphClient.sendMail({
  to: customer.email,
  subject: 'Invoice',
  attachments: [pdfBuffer],
  template: 'invoice'
});
```

### File Storage Pattern

```typescript
// Upload flow
const { data, error } = await supabase.storage
  .from('employee-attachments')
  .upload(`${employeeId}/${fileName}`, file);

// Always use returned path
const storagePath = data.path;

// Generate signed URL for access
const { data: { signedUrl } } = await supabase.storage
  .from('employee-attachments')
  .createSignedUrl(storagePath, 3600);
```

### Background Jobs

Job queue system for async processing:

```typescript
// Queue a job
await supabase.from('jobs').insert({
  type: 'send_sms',
  payload: { to, message, template },
  scheduled_for: new Date()
});

// Process jobs (cron)
const jobs = await supabase
  .from('jobs')
  .select('*')
  .eq('status', 'pending')
  .lte('scheduled_for', new Date());
```

## Performance Architecture

### Optimization Strategies

#### 1. Database Query Optimization
```typescript
// Avoid N+1 queries - use joins
const bookings = await supabase
  .from('private_bookings')
  .select(`
    *,
    customer:customers(*),
    items:private_booking_items(*),
    vendor:vendors(*)
  `)
  .eq('status', 'active');
```

#### 2. Caching Strategy
- **Static Pages**: Cached at edge via CDN
- **Dynamic Pages**: ISR with revalidation
- **API Responses**: Cache headers for GET requests
- **Database**: Query result caching via Supabase

#### 3. Code Splitting
```typescript
// Dynamic imports for heavy components
const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <Skeleton />,
  ssr: false
});
```

#### 4. Image Optimization
- Next.js Image component with automatic optimization
- WebP format with fallbacks
- Responsive sizing
- Lazy loading by default

### Performance Monitoring

Ready for integration with:
- **Application Performance**: Sentry
- **Infrastructure Metrics**: Vercel Analytics
- **Database Performance**: Supabase Dashboard
- **User Analytics**: Ready for Google Analytics

## Scalability & Infrastructure

### Horizontal Scaling

- **Stateless Architecture**: No server-side session storage
- **Serverless Functions**: Auto-scaling with Vercel
- **Database Pooling**: Connection pool management
- **CDN Distribution**: Global edge network

### Vertical Scaling Options

1. **Database Tier**: Supabase plan upgrades
2. **Function Limits**: Vercel Pro/Enterprise
3. **Storage Expansion**: Supabase storage limits
4. **SMS Volume**: Twilio pricing tiers

### Infrastructure as Code (Future)

Planned implementation:
```yaml
# vercel.json
{
  "functions": {
    "app/api/*": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/reminders",
      "schedule": "0 9 * * *"
    }
  ]
}
```

### Disaster Recovery

Current capabilities:
- **Database Backups**: Daily automatic backups
- **Point-in-Time Recovery**: 7-day retention
- **Code Versioning**: Git history
- **Environment Isolation**: Dev/staging/production

Planned improvements:
- Cross-region replication
- Automated failover
- Backup verification
- Recovery time objectives

## Security Architecture

### Security Layers

1. **Network Security**
   - HTTPS everywhere
   - WAF via Vercel
   - DDoS protection (platform-level)

2. **Application Security**
   - Input validation with Zod
   - SQL injection prevention
   - XSS protection via React
   - CSRF protection via SameSite cookies

3. **Data Security**
   - Encryption at rest (Supabase)
   - Encryption in transit (TLS)
   - Signed URLs for file access
   - Environment variable isolation

4. **Access Control**
   - Row Level Security (database)
   - RBAC (application)
   - API key scoping
   - Session management

### Security Patterns

#### Input Validation
```typescript
const schema = z.object({
  email: z.string().email(),
  phone: z.string().regex(/^\+44\d{10}$/),
  amount: z.number().positive().max(10000)
});

const validated = schema.parse(input);
```

#### Audit Logging
```typescript
await logAuditEvent({
  action: 'delete',
  entity_type: 'customer',
  entity_id: customerId,
  details: { reason: 'GDPR request' }
});
```

#### Sensitive Operations
```typescript
// Enhanced permission check for sensitive operations
const hasPermission = await checkUserPermission('sensitive', 'delete');
if (!hasPermission) {
  await logAuditEvent({
    action: 'unauthorized_attempt',
    details: { attempted_action: 'delete' }
  });
  throw new UnauthorizedError();
}
```

### Compliance Considerations

Current implementation:
- Comprehensive audit trail
- Data retention controls
- Access logging
- SMS opt-out mechanism

Required for full compliance:
- GDPR data export/deletion
- Privacy policy integration
- Cookie consent management
- Data processing agreements

## Architecture Decision Records

### Key Decisions

1. **Next.js App Router over Pages Router**
   - Better performance with RSC
   - Simplified data fetching
   - Future-proof architecture

2. **Server Actions over REST APIs**
   - Type safety across boundaries
   - Simplified architecture
   - Automatic cache invalidation

3. **Supabase over Custom Backend**
   - Integrated auth/database/storage
   - Managed infrastructure
   - Built-in RLS

4. **Vercel over Self-Hosting**
   - Seamless Next.js integration
   - Global CDN
   - Automatic scaling

5. **TypeScript Strict Mode**
   - Catch errors at compile time
   - Better IDE support
   - Self-documenting code

### Trade-offs Accepted

1. **Vendor Lock-in**: Accepted for reduced complexity
2. **Serverless Limitations**: Cold starts vs auto-scaling
3. **No GraphQL**: Simplicity over flexibility
4. **No State Management Library**: Server state preferred
5. **Limited Offline Support**: Online-first approach

## Future Architecture Roadmap

### Short-term (1-3 months)
- Implement Redis for rate limiting
- Add structured logging (Winston/Pino)
- Complete GDPR compliance features
- Add comprehensive monitoring

### Medium-term (3-6 months)
- Implement job queue (BullMQ)
- Add caching layer (Redis)
- Create API documentation (OpenAPI)
- Implement E2E test suite

### Long-term (6-12 months)
- Multi-region deployment
- GraphQL API option
- Microservices for heavy operations
- Advanced analytics pipeline

## Conclusion

The Anchor Management Tools demonstrates a modern, well-architected system built on solid foundations. The architecture prioritizes:

- **Developer Experience**: Type safety, clear patterns
- **Performance**: Edge computing, optimized queries
- **Security**: Defense in depth, comprehensive auditing
- **Scalability**: Serverless, managed services
- **Maintainability**: Clear structure, documentation

While there are areas for improvement (particularly around operational maturity and compliance), the core architecture provides a strong foundation for continued growth and enhancement.