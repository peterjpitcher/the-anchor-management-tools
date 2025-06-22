# Event Access Security

## Overview

All event-related endpoints and pages in The Anchor Management Tools require authentication. There is currently no public or anonymous access to event information.

## Current Implementation

### Authentication Requirement
- All event routes are under `/(authenticated)/` which requires a valid session
- Event API endpoints use Supabase Auth for authentication
- Row Level Security (RLS) policies enforce permission checks

### Permission Model
Events use the RBAC (Role-Based Access Control) system with the following permissions:
- `events.view` - View event listings and details
- `events.create` - Create new events
- `events.edit` - Edit existing events  
- `events.delete` - Delete events
- `events.manage` - Full administrative access

### Database Security
As of migration `20250621_fix_events_table_rls.sql`:
- RLS is enabled on the events table
- Access is revoked from the `anon` role
- Only authenticated users with appropriate permissions can access events

## Considerations for Public Access

If public/anonymous event access is needed in the future, consider:

### 1. Public Events Page
Create a new route outside `/(authenticated)/` for public event listings:
```typescript
// app/events/public/page.tsx
// Shows limited event information without authentication
```

### 2. Database Changes
Add a public visibility flag to events:
```sql
ALTER TABLE events ADD COLUMN is_public BOOLEAN DEFAULT false;
```

### 3. RLS Policy for Public Access
Create a policy allowing anonymous read access to public events:
```sql
CREATE POLICY "Public events are viewable by everyone"
    ON public.events FOR SELECT
    TO anon
    USING (is_public = true);
```

### 4. API Endpoint
Create a public API endpoint for event data:
```typescript
// app/api/events/public/route.ts
// Returns only public event information
```

## Security Best Practices

1. **Minimal Information**: If implementing public access, expose only necessary fields (name, date, time, capacity)
2. **No Personal Data**: Never expose customer or booking information publicly
3. **Rate Limiting**: Implement rate limiting on public endpoints
4. **Caching**: Use caching to reduce database load from public requests
5. **Monitoring**: Track public API usage for abuse detection

## Current Status

✅ **Secure by Default**: All event data requires authentication
✅ **RBAC Integration**: Fine-grained permission control
✅ **No Data Leakage**: No accidental public exposure of events

This is the intended behavior for a management system where all data should be protected.