# Critical Fixes Implementation Plan
## Immediate Actions Required

### 🚨 Priority 1: Fix Missing Jobs Table (Breaking Production)

**Issue:** Code references `jobs` table that doesn't exist, causing runtime errors

**Implementation Steps:**

1. **Create Migration File:**
```bash
touch supabase/migrations/20250119180000_create_missing_jobs_table.sql
```

2. **Migration Content:**
```sql
-- Create the missing jobs table that the code expects
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
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

-- Add essential indexes
CREATE INDEX idx_jobs_status_scheduled ON jobs(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);

-- Add RLS policies
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Only service role can access jobs
CREATE POLICY "Service role manages jobs" ON jobs
  FOR ALL USING (auth.role() = 'service_role');

-- Add update trigger
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Migrate existing job data from other tables
-- Insert from background_jobs if it has data
INSERT INTO jobs (type, payload, status, attempts, created_at)
SELECT 
  job_type as type,
  job_data as payload,
  CASE 
    WHEN status = 'pending' THEN 'pending'
    WHEN status = 'running' THEN 'processing'
    WHEN status = 'completed' THEN 'completed'
    ELSE 'failed'
  END as status,
  retry_count as attempts,
  created_at
FROM background_jobs
WHERE NOT EXISTS (
  SELECT 1 FROM jobs WHERE jobs.created_at = background_jobs.created_at
);
```

3. **Run Migration:**
```bash
supabase db push
```

4. **Update Code References:**
```typescript
// Update all imports to use consistent table
// FROM: background_jobs, job_queue
// TO: jobs
```

---

### 🚨 Priority 2: Fix Private Bookings Performance

**Issue:** Private bookings page loads slowly, fetching all data

**Quick Fix (30 minutes):**

1. **Add Database Indexes:**
```sql
-- migrations/20250119181000_add_private_bookings_indexes.sql
CREATE INDEX IF NOT EXISTS idx_private_bookings_event_date ON private_bookings(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_private_bookings_status ON private_bookings(status);
CREATE INDEX IF NOT EXISTS idx_private_bookings_customer_id ON private_bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_private_booking_items_booking_id ON private_booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_private_booking_payments_booking_id ON private_booking_payments(booking_id);
```

2. **Update the Page Component:**
```typescript
// src/app/(authenticated)/private-bookings/page.tsx

// Add pagination
const ITEMS_PER_PAGE = 20;

export default function PrivateBookingsPage() {
  const [page, setPage] = useState(1);
  const [bookings, setBookings] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  async function loadBookings() {
    setLoading(true);
    const from = (page - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE - 1;

    // Fetch only essential data for list view
    const { data, count, error } = await supabase
      .from('private_bookings')
      .select(`
        id,
        event_date,
        event_time,
        customer_name,
        status,
        total_amount,
        vendor:vendors(name)
      `, { count: 'exact' })
      .order('event_date', { ascending: false })
      .range(from, to);

    if (!error) {
      setBookings(data);
      setTotalCount(count);
    }
    setLoading(false);
  }

  // ... rest of component
}
```

3. **Update Server Action:**
```typescript
// src/app/actions/privateBookingActions.ts

export async function getPrivateBookingsList(
  page: number = 1,
  pageSize: number = 20,
  filters?: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }
) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('private_bookings')
    .select(`
      id,
      event_date,
      event_time,
      customer_name,
      status,
      total_amount,
      vendor:vendors(name)
    `, { count: 'exact' })
    .range(from, to)
    .order('event_date', { ascending: false });

  // Apply filters
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.dateFrom) {
    query = query.gte('event_date', filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte('event_date', filters.dateTo);
  }
  if (filters?.search) {
    query = query.ilike('customer_name', `%${filters.search}%`);
  }

  const { data, count, error } = await query;

  return {
    bookings: data || [],
    totalCount: count || 0,
    totalPages: Math.ceil((count || 0) / pageSize),
    currentPage: page,
    pageSize,
    error: error?.message,
  };
}

// Separate function for full details
export async function getPrivateBookingDetails(id: string) {
  const { data, error } = await supabase
    .from('private_bookings')
    .select(`
      *,
      vendor:vendors(*),
      items:private_booking_items(*),
      payments:private_booking_payments(*),
      customer:customers(*)
    `)
    .eq('id', id)
    .single();

  return { booking: data, error: error?.message };
}
```

---

### 🚨 Priority 3: Consolidate Job Queue Tables

**Issue:** Three different job queue implementations causing confusion

**Implementation Plan:**

1. **Data Migration Script:**
```typescript
// scripts/migrate-job-queues.ts
import { createAdminClient } from '@/lib/supabase/server';

async function migrateJobQueues() {
  const supabase = await createAdminClient();
  
  console.log('Starting job queue migration...');
  
  // 1. Migrate from job_queue
  const { data: jobQueueData } = await supabase
    .from('job_queue')
    .select('*')
    .eq('status', 'pending');
    
  if (jobQueueData?.length) {
    const jobsToInsert = jobQueueData.map(job => ({
      type: job.type,
      payload: job.data || {},
      status: 'pending',
      scheduled_for: job.scheduled_at,
      created_at: job.created_at,
    }));
    
    await supabase.from('jobs').insert(jobsToInsert);
    console.log(`Migrated ${jobsToInsert.length} jobs from job_queue`);
  }
  
  // 2. Update all code references
  console.log('Update these files to use "jobs" table:');
  console.log('- src/lib/background-jobs.ts');
  console.log('- src/lib/job-processor.ts');
  console.log('- src/app/api/jobs/process/route.ts');
  
  console.log('Migration complete!');
}

migrateJobQueues();
```

2. **Update Job Processing Code:**
```typescript
// src/lib/job-processor.ts
export async function processJobs() {
  const supabase = await createAdminClient();
  
  // Get pending jobs
  const { data: jobs } = await supabase
    .from('jobs') // Use single table
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(10);
    
  for (const job of jobs || []) {
    await processJob(job);
  }
}
```

---

### 📋 Implementation Checklist

#### Day 1 (Today):
- [ ] Create and run jobs table migration
- [ ] Add private bookings indexes
- [ ] Implement pagination for private bookings list
- [ ] Test private bookings performance improvement
- [ ] Deploy fixes to production

#### Day 2:
- [ ] Migrate data from old job tables
- [ ] Update all job processing code
- [ ] Test job processing with new table
- [ ] Add monitoring for job queue

#### Day 3:
- [ ] Clean up old job tables (after verification)
- [ ] Update documentation
- [ ] Add performance monitoring
- [ ] Create alerts for job failures

---

### 🔍 Verification Steps

After implementing each fix:

1. **Verify Jobs Table:**
```sql
-- Check table exists and has data
SELECT COUNT(*) FROM jobs;
SELECT * FROM jobs ORDER BY created_at DESC LIMIT 10;
```

2. **Test Private Bookings Performance:**
```typescript
// Add timing to page load
console.time('private-bookings-load');
await loadBookings();
console.timeEnd('private-bookings-load');
// Should be < 1 second
```

3. **Monitor Error Logs:**
```bash
# Check for any job-related errors
tail -f logs/error.log | grep -i "jobs"
```

---

### 🚑 If Something Goes Wrong

**Rollback Plan:**

1. **Jobs Table Issue:**
```sql
-- Keep old tables temporarily
-- Just update code to use old table names
UPDATE config SET job_table = 'background_jobs' WHERE key = 'job_processor';
```

2. **Performance Gets Worse:**
```typescript
// Revert to old query temporarily
const ENABLE_PAGINATION = false; // Quick toggle
```

3. **Critical Errors:**
```typescript
// Add circuit breaker
const MAX_RETRIES = 3;
let retries = 0;

async function safeLoadBookings() {
  try {
    return await loadBookings();
  } catch (error) {
    if (++retries > MAX_RETRIES) {
      // Fallback to basic query
      return await loadBasicBookings();
    }
    throw error;
  }
}
```

---

### 📞 Communication Plan

1. **Before Deployment:**
   - Notify team about planned fixes
   - Schedule during low-traffic period
   - Have rollback plan ready

2. **During Deployment:**
   - Monitor error rates
   - Check performance metrics
   - Be ready to rollback

3. **After Deployment:**
   - Verify all features working
   - Monitor for 24 hours
   - Document any issues

Remember: These fixes address critical production issues. Test thoroughly but move quickly to restore stability.