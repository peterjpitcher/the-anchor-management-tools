# Performance Optimization Guide
## The Anchor Management Tools

### Quick Reference: Performance Bottlenecks & Solutions

---

## 🚨 Critical Performance Issues

### 1. Private Bookings Section (User-Reported Slow Loading)

**Root Causes Identified:**
- Loading ALL bookings without pagination
- Multiple sequential database queries
- No caching mechanism
- Heavy vendor/catering data loaded for list view
- Missing database indexes

**Immediate Fix (Can implement today):**

```sql
-- Add these indexes to improve query performance
CREATE INDEX idx_private_bookings_event_date ON private_bookings(event_date DESC);
CREATE INDEX idx_private_bookings_status ON private_bookings(status);
CREATE INDEX idx_private_bookings_customer ON private_bookings(customer_id);
CREATE INDEX idx_private_booking_items_booking ON private_booking_items(booking_id);
```

**Code Optimization:**

Replace this pattern:
```typescript
// ❌ Current slow implementation
const bookings = await supabase
  .from('private_bookings')
  .select('*, vendor:vendors(*), items:private_booking_items(*)')
  .order('event_date', { ascending: false });
```

With this:
```typescript
// ✅ Optimized implementation
// 1. List view - minimal data
const bookings = await supabase
  .from('private_bookings')
  .select(`
    id,
    event_date,
    event_time,
    customer_name,
    status,
    total_amount,
    vendor:vendors(name)
  `)
  .order('event_date', { ascending: false })
  .limit(20);

// 2. Detail view - full data only when needed
const bookingDetails = await supabase
  .from('private_bookings')
  .select(`
    *,
    vendor:vendors(*),
    items:private_booking_items(*),
    payments:private_booking_payments(*)
  `)
  .eq('id', bookingId)
  .single();
```

### 2. Missing Jobs Table (Critical Bug)

**Issue:** Code references `jobs` table that doesn't exist

**Fix:** Create this migration immediately:
```sql
-- migrations/20250119_create_missing_jobs_table.sql
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_status_scheduled ON jobs(status, scheduled_for);
CREATE INDEX idx_jobs_type ON jobs(type);
```

---

## 📊 Database Performance Optimizations

### Missing Indexes (Add These Now)

```sql
-- Customer lookups (frequent operations)
CREATE INDEX idx_customers_mobile_number ON customers(mobile_number);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_messaging_status ON customers(messaging_status);

-- Message queries (heavy table)
CREATE INDEX idx_messages_customer_created ON messages(customer_id, created_at DESC);
CREATE INDEX idx_messages_twilio_sid ON messages(twilio_message_sid);
CREATE INDEX idx_messages_status ON messages(status);

-- Event queries
CREATE INDEX idx_events_date_status ON events(event_date, status);
CREATE INDEX idx_events_category ON events(category_id);

-- Booking queries
CREATE INDEX idx_bookings_event_customer ON bookings(event_id, customer_id);
CREATE INDEX idx_bookings_created ON bookings(created_at DESC);
```

### Query Optimization Patterns

**Bad Pattern (N+1 Queries):**
```typescript
// ❌ Makes multiple queries
const events = await getEvents();
for (const event of events) {
  const bookings = await getBookingsForEvent(event.id);
  event.bookings = bookings;
}
```

**Good Pattern (Single Query):**
```typescript
// ✅ Single query with relations
const events = await supabase
  .from('events')
  .select(`
    *,
    bookings(count),
    category:event_categories(name, color)
  `);
```

---

## 🚀 Frontend Performance Optimizations

### 1. Implement React Query

```typescript
// Install: npm install @tanstack/react-query

// _app.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

// In components
function PrivateBookings() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['private-bookings', page, filters],
    queryFn: () => fetchPrivateBookings(page, filters),
    keepPreviousData: true, // Smooth pagination
  });
}
```

### 2. Virtual Scrolling for Long Lists

```typescript
// Install: npm install react-window

import { FixedSizeList } from 'react-window';

function BookingsList({ bookings }) {
  const Row = ({ index, style }) => (
    <div style={style}>
      <BookingRow booking={bookings[index]} />
    </div>
  );

  return (
    <FixedSizeList
      height={600}
      itemCount={bookings.length}
      itemSize={80}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}
```

### 3. Code Splitting

```typescript
// Lazy load heavy components
const PrivateBookingsModule = lazy(() => 
  import('./modules/PrivateBookings')
);

const InvoicesModule = lazy(() => 
  import('./modules/Invoices')
);

// Use with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <PrivateBookingsModule />
</Suspense>
```

---

## 🔄 API Performance Optimizations

### 1. Response Caching

```typescript
// Add to API routes
export async function GET(request: NextRequest) {
  const data = await fetchData();
  
  const response = NextResponse.json(data);
  
  // Cache for 5 minutes
  response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate');
  
  return response;
}
```

### 2. Implement Pagination

```typescript
// Server action with pagination
export async function getPrivateBookings(
  page: number = 1,
  pageSize: number = 20,
  filters?: BookingFilters
) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const query = supabase
    .from('private_bookings')
    .select('*', { count: 'exact' })
    .range(from, to)
    .order('event_date', { ascending: false });

  // Apply filters
  if (filters?.status) query.eq('status', filters.status);
  if (filters?.dateFrom) query.gte('event_date', filters.dateFrom);
  if (filters?.dateTo) query.lte('event_date', filters.dateTo);

  const { data, count, error } = await query;

  return {
    data,
    pagination: {
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize),
    },
  };
}
```

### 3. Background Job Processing

```typescript
// Move heavy operations to background jobs
export async function generateMonthlyReport(month: string) {
  // Don't process immediately
  await queueJob({
    type: 'generate_report',
    payload: { month },
    priority: 'low',
  });
  
  return { message: 'Report generation queued' };
}
```

---

## 📦 Bundle Size Optimization

### 1. Analyze Bundle

```bash
# Install bundle analyzer
npm install --save-dev @next/bundle-analyzer

# Add to next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer({
  // your config
});

# Run analysis
ANALYZE=true npm run build
```

### 2. Tree Shaking

```typescript
// ❌ Bad - imports entire library
import _ from 'lodash';
const result = _.debounce(fn, 300);

// ✅ Good - imports only what's needed
import debounce from 'lodash/debounce';
const result = debounce(fn, 300);
```

### 3. Dynamic Imports

```typescript
// Heavy libraries loaded on demand
const PDFGenerator = dynamic(() => import('./PDFGenerator'), {
  loading: () => <p>Loading PDF generator...</p>,
  ssr: false,
});
```

---

## 🎯 Quick Wins Checklist

### This Week:
- [ ] Add missing database indexes
- [ ] Fix private bookings query to use pagination
- [ ] Create missing `jobs` table
- [ ] Implement basic caching headers

### Next Week:
- [ ] Install and configure React Query
- [ ] Add virtual scrolling to long lists
- [ ] Implement code splitting for large modules
- [ ] Add bundle size monitoring

### This Month:
- [ ] Consolidate duplicate job queue tables
- [ ] Implement comprehensive caching strategy
- [ ] Add performance monitoring (Web Vitals)
- [ ] Optimize image loading

---

## 📈 Monitoring Performance

### 1. Add Performance Tracking

```typescript
// lib/performance.ts
export function measurePerformance(metricName: string) {
  const start = performance.now();
  
  return {
    end: () => {
      const duration = performance.now() - start;
      console.log(`${metricName}: ${duration}ms`);
      
      // Send to analytics
      if (window.gtag) {
        window.gtag('event', 'timing_complete', {
          name: metricName,
          value: Math.round(duration),
        });
      }
    },
  };
}

// Usage
const perf = measurePerformance('private-bookings-load');
await loadBookings();
perf.end();
```

### 2. Track Core Web Vitals

```typescript
// Install: npm install web-vitals

import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

function sendToAnalytics(metric) {
  // Send to your analytics service
  console.log(metric);
}

getCLS(sendToAnalytics);
getFID(sendToAnalytics);
getFCP(sendToAnalytics);
getLCP(sendToAnalytics);
getTTFB(sendToAnalytics);
```

---

## 🔥 Emergency Performance Fixes

If the site is critically slow, do these immediately:

1. **Enable Vercel Edge Caching:**
   ```typescript
   export const config = {
     runtime: 'edge',
   };
   ```

2. **Add Database Connection Pooling:**
   ```typescript
   // In Supabase client
   const supabase = createClient(url, key, {
     db: { pooling: true },
   });
   ```

3. **Emergency Query Limits:**
   ```typescript
   // Temporarily limit all queries
   .limit(10)
   ```

4. **Disable Heavy Features:**
   ```typescript
   // Feature flag for heavy operations
   const ENABLE_HEAVY_FEATURES = process.env.NODE_ENV === 'production' 
     ? false 
     : true;
   ```

Remember: Monitor after each change to ensure improvements are working!