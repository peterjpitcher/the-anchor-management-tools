# Structural Mapper Report: Private Bookings Feature
**Date**: 2026-03-07  
**Scope**: Complete inventory of private-bookings section (Next.js 15 App Router)  
**Project**: Anchor Management Tools

---

## 1. FILE INVENTORY

### Critical Path Files (Server Actions & Database Layer)

| File Path | Role | Size Est. | Type | Key Dependencies |
|-----------|------|-----------|------|------------------|
| `src/app/actions/privateBookingActions.ts` | Server actions dispatcher | ~1200 LOC | Server Action | PrivateBookingService, SmsQueueService, checkUserPermission, logAuditEvent |
| `src/services/private-bookings.ts` | Business logic service | ~1000 LOC | Service | Supabase admin/server clients, date utilities, email service, SMS service |
| `src/app/api/private-bookings/contract/route.ts` | HTML contract generation API | ~106 LOC | API Route | generateContractHTML, user_has_permission RPC |
| `src/lib/contract-template.ts` | Contract HTML generator | ~850 LOC | Utility | PrivateBookingWithDetails type, dateUtils, formatting |
| `src/types/private-bookings.ts` | Type definitions | ~297 LOC | Types | Full booking domain model, enums, form types |

### API Routes

| File Path | HTTP Method | Purpose |
|-----------|-------------|---------|
| `src/app/api/private-bookings/contract/route.ts` | GET | Generates & returns HTML contract for booking; increments contract_version; logs audit event |

### UI Pages (Server-Side)

| File Path | Role | Data Fetching | Permissions Check |
|-----------|------|----------------|-------------------|
| `src/app/(authenticated)/private-bookings/page.tsx` | List all bookings (dashboard) | fetchPrivateBookings (server-side pagination) | getCurrentUserModuleActions('private_bookings') |
| `src/app/(authenticated)/private-bookings/[id]/page.tsx` | Booking detail server wrapper | getPrivateBooking(id) | getCurrentUserModuleActions + per-action checks |
| `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx` | Client-side redirect wrapper | None (redirects to /api/private-bookings/contract?bookingId=) | N/A (client-side) |
| `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx` | Edit booking form | getPrivateBooking(id, 'edit') + dependency lists | view, edit permissions |
| `src/app/(authenticated)/private-bookings/[id]/items/page.tsx` | Manage booking items (spaces, catering, vendors) | getPrivateBooking(id, 'items') + lists | view, edit permissions |
| `src/app/(authenticated)/private-bookings/[id]/messages/page.tsx` | SMS/message history | getPrivateBooking(id, 'messages') | view, send permissions |
| `src/app/(authenticated)/private-bookings/new/page.tsx` | Create new booking | None (form only) | create permission |
| `src/app/(authenticated)/private-bookings/settings/page.tsx` | Settings hub (spaces/catering/vendors) | None (links to sub-pages) | manage_spaces/manage_catering/manage_vendors |
| `src/app/(authenticated)/private-bookings/settings/spaces/page.tsx` | Manage venue spaces | getVenueSpacesForManagement() | manage_spaces |
| `src/app/(authenticated)/private-bookings/settings/catering/page.tsx` | Manage catering packages | getCateringPackagesForManagement() | manage_catering |
| `src/app/(authenticated)/private-bookings/settings/vendors/page.tsx` | Manage vendor directory | getVendorsForManagement() | manage_vendors |
| `src/app/(authenticated)/private-bookings/sms-queue/page.tsx` | SMS approval queue | SmsQueueService.getQueue(['pending', 'approved', 'cancelled']) | view_sms_queue, approve_sms, send |

### UI Client Components

| File Path | Type | Role | State Management |
|-----------|------|------|------------------|
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | Client Component | Main detail view; dispatch actions | React hooks; form state via server actions |
| `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx` | Client Component | SMS history & message sending UI | React hooks + server action dispatch |
| `src/app/(authenticated)/private-bookings/PrivateBookingsClient.tsx` | Client Component | Bookings list with filtering/pagination | React hooks + server action dispatch |
| `src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx` | Server Component | Wrapper only; passes data to client | N/A |

### Supporting Infrastructure

| File Path | Size | Purpose |
|-----------|------|---------|
| `src/app/actions/private-bookings-dashboard.ts` | ~150 LOC | Fetch bookings for dashboard with filtering, pagination, date logic |
| `src/services/sms-queue.ts` | ~600 LOC | SMS queue operations: send, approve, reject, auto-dispatch, idempotency management |
| `supabase/migrations/20250122000000_allow_overnight_private_bookings.sql` | ~20 LOC | Add end_time_next_day column for bookings spanning midnight |
| `supabase/migrations/20260401150000_create_private_booking_transaction.sql` | ~3 LOC | Placeholder (squashed; see 20260502000000) |
| `supabase/migrations/20260402020000_private_booking_lifecycle.sql` | ~25 LOC | Add hold_expiry, cancellation_reason, cancelled_at; indexes |
| `supabase/migrations/20260417000000_fix_private_booking_end_time_next_day.sql` | TBD | Fix end_time_next_day handling |
| `supabase/migrations/20260419000006_fix_private_booking_customer_last_name.sql` | TBD | Backfill/normalize customer_last_name |
| `supabase/migrations/20260420000001_add_contract_note_to_private_bookings.sql` | TBD | Add contract_note column |
| `supabase/migrations/20260420000015_private_booking_feedback_runtime.sql` | TBD | Feedback/runtime analysis |
| `supabase/migrations/20260420000020_table_areas_private_booking_blocks.sql` | TBD | Table area blocking for private bookings |
| `supabase/migrations/20260421000003_fix_private_booking_customer_phone_canonical.sql` | TBD | Phone normalization |
| `supabase/migrations/20260423000001_private_bookings_phone_international.sql` | TBD | International phone support |
| `supabase/migrations/20260502000000_private_booking_payments.sql` | ~68 LOC | Create private_booking_payments table; calculate_private_booking_balance() RPC; RLS policies |

---

## 2. DATA MODEL

### Primary Tables

#### `private_bookings`
```sql
Fields (relevant subset):
  id: UUID (primary key)
  customer_id: UUID (nullable, FK → customers)
  customer_name: TEXT (deprecated, use customer_first_name + customer_last_name)
  customer_first_name: TEXT
  customer_last_name: TEXT
  customer_full_name: TEXT GENERATED (generated column)
  contact_phone: TEXT
  contact_email: TEXT
  event_date: DATE
  start_time: TIME
  setup_date: DATE (nullable)
  setup_time: TIME (nullable)
  end_time: TIME (nullable)
  end_time_next_day: BOOLEAN (default false; allows events spanning midnight)
  guest_count: INTEGER
  event_type: TEXT
  status: ENUM('draft', 'confirmed', 'completed', 'cancelled')
  hold_expiry: TIMESTAMPTZ (14-day default for draft bookings)
  cancellation_reason: TEXT
  cancelled_at: TIMESTAMPTZ
  deposit_amount: NUMERIC (default 250)
  deposit_paid_date: TIMESTAMPTZ (nullable)
  deposit_payment_method: ENUM('cash', 'card', 'invoice')
  total_amount: NUMERIC (computed from items)
  balance_due_date: DATE (7 days before event by default)
  final_payment_date: TIMESTAMPTZ (nullable; set when balance fully paid)
  final_payment_method: ENUM('cash', 'card', 'invoice')
  discount_type: ENUM('percent', 'fixed')
  discount_amount: NUMERIC
  discount_reason: TEXT
  calendar_event_id: TEXT (Google Calendar integration)
  contract_version: INTEGER (incremented on contract generation)
  internal_notes: TEXT
  contract_note: TEXT (specific note shown on contract only)
  customer_requests: TEXT
  special_requirements: TEXT
  accessibility_needs: TEXT
  source: TEXT (how booking was created)
  created_by: UUID (FK → auth.users)
  created_at: TIMESTAMPTZ
  updated_at: TIMESTAMPTZ
RLS: Enabled (view via user_has_permission RPC)
Indexes: hold_expiry, (status, hold_expiry)
```

#### `private_booking_items`
```sql
Fields:
  id: UUID (primary key)
  booking_id: UUID (FK → private_bookings, ON DELETE CASCADE)
  item_type: ENUM('space', 'catering', 'vendor', 'other')
  space_id: UUID (FK → venue_spaces, nullable)
  package_id: UUID (FK → catering_packages, nullable)
  vendor_id: UUID (FK → vendors, nullable)
  description: TEXT
  quantity: NUMERIC
  unit_price: NUMERIC
  discount_type: ENUM('percent', 'fixed')
  discount_value: NUMERIC (nullable)
  discount_reason: TEXT (nullable)
  line_total: NUMERIC (calculated: qty * price, minus item-level discount)
  notes: TEXT (nullable)
  created_at: TIMESTAMPTZ
  display_order: INTEGER (for reordering)
RLS: Enabled
Foreign Relations: venue_spaces, catering_packages, vendors
```

#### `private_booking_payments`
```sql
Fields:
  id: UUID (primary key)
  booking_id: UUID (FK → private_bookings, ON DELETE CASCADE)
  amount: NUMERIC (> 0)
  method: ENUM('cash', 'card', 'invoice')
  notes: TEXT (nullable)
  recorded_by: UUID (FK → auth.users, nullable)
  created_at: TIMESTAMPTZ
RLS: Enabled
Purpose: Track balance payments (not deposit); used by calculate_private_booking_balance()
```

#### `private_booking_sms_queue`
```sql
Fields (TypeScript model):
  id: UUID
  booking_id: UUID (FK → private_bookings)
  trigger_type: TEXT (enum: booking_created, deposit_received, payment_received, final_payment_received, reminder, status_change, date_changed, deposit_reminder_7day, balance_reminder_14day, event_reminder_1d, setup_reminder, booking_confirmed, booking_cancelled, booking_expired, booking_completed, balance_reminder, deposit_reminder_1day, manual, payment_due, urgent)
  recipient_phone: E.164 format
  message_body: TEXT
  status: ENUM('pending', 'approved', 'sent', 'cancelled', 'failed')
  approved_by: UUID (nullable, FK → auth.users)
  approved_at: TIMESTAMPTZ (nullable)
  sent_at: TIMESTAMPTZ (nullable)
  twilio_sid: TEXT (Twilio message SID)
  error_message: TEXT (nullable)
  created_at: TIMESTAMPTZ
  created_by: UUID (nullable, FK → auth.users)
  metadata: JSONB (custom context; e.g., cancelled_reason, old_date, new_date for date changes)
RLS: Enabled
Auto-send Rules: booking_created, deposit_received, final_payment_received, payment_received, booking_confirmed, booking_completed, date_changed, booking_cancelled, booking_expired, hold_extended, all reminder types, manual
Manual-approval Triggers: (none explicitly marked; all above auto-send)
```

#### `private_booking_audit`
```sql
Fields:
  id: UUID
  booking_id: UUID (FK → private_bookings)
  action: TEXT (e.g., 'contract_generated', 'status_changed', 'payment_recorded', etc.)
  field_name: TEXT (nullable; if audit is field-level)
  old_value: TEXT (nullable)
  new_value: TEXT (nullable)
  metadata: JSONB (custom context)
  performed_by: UUID (FK → auth.users, nullable)
  performed_at: TIMESTAMPTZ
RLS: Enabled
```

#### `venue_spaces`
```sql
Fields:
  id: UUID
  name: TEXT
  description: TEXT (nullable)
  capacity_seated: INTEGER (nullable)
  capacity_standing: INTEGER (nullable)
  rate_per_hour: NUMERIC
  minimum_hours: INTEGER
  setup_fee: NUMERIC
  active: BOOLEAN
  display_order: INTEGER
  created_at, updated_at: TIMESTAMPTZ
```

#### `catering_packages`
```sql
Fields:
  id: UUID
  name: TEXT
  description: TEXT (nullable)
  serving_style: ENUM('buffet', 'sit-down', 'canapes', 'drinks', 'pizza', 'other') [PackageType]
  category: ENUM('food', 'drink', 'addon')
  pricing_model: ENUM('per_head', 'total_value', 'variable', 'per_jar', 'per_tray', 'menu_priced', 'free')
  cost_per_head: NUMERIC
  minimum_guests: INTEGER
  maximum_guests: INTEGER (nullable)
  dietary_notes: TEXT (nullable)
  active: BOOLEAN
  display_order: INTEGER
  created_at, updated_at: TIMESTAMPTZ
```

#### `vendors`
```sql
Fields:
  id: UUID
  name: TEXT
  company_name: TEXT (nullable)
  service_type: ENUM('dj', 'band', 'photographer', 'florist', 'decorator', 'cake', 'entertainment', 'transport', 'equipment', 'other')
  contact_phone: TEXT (nullable)
  contact_email: TEXT (nullable)
  website: TEXT (nullable)
  typical_rate: TEXT (nullable; free-form, e.g., "£500-800")
  typical_rate_normalized: TEXT (normalized monetary value)
  notes: TEXT (nullable)
  preferred: BOOLEAN
  active: BOOLEAN
  created_at, updated_at: TIMESTAMPTZ
```

### Related Tables (External FK)

- `customers` – customer profile linked by customer_id (optional)
- `auth.users` – created_by, performed_by, recorded_by, approved_by

### Type Definition Discrepancies

| TypeScript Type | DB Reality | Issue |
|-----------------|-----------|-------|
| `PrivateBooking.customer_name` | TEXT (exists, deprecated) | Type marked deprecated; migration to customer_first_name + customer_last_name in progress |
| `PrivateBooking.customer_full_name` | GENERATED column (exists) | TypeScript type has optional field; DB has generated column |
| `PrivateBooking.line_total` on items | NUMERIC (calculated) | Returned as NUMERIC or string depending on Supabase client conversion; contract-template.ts handles both |
| All NUMERIC fields in items | String or Number possible | Service layer must handle type coercion; contract-template uses `typeof === 'string' ? parseFloat : number` |

---

## 3. API SURFACE

### Server Actions (Private Bookings)

| Action | Signature | Permission Check | DB Writes | SMS Side-Effects |
|--------|-----------|------------------|-----------|------------------|
| `getPrivateBookings(filters?)` | filters: {status?, fromDate?, toDate?, customerId?} | private_bookings/view | SELECT | None |
| `getPrivateBooking(id, variant)` | variant: 'detail' \| 'edit' \| 'items' \| 'messages' | private_bookings/view | SELECT | None |
| `createPrivateBooking(formData)` | PrivateBookingFormData serialized | private_bookings/create | INSERT booking, items | SMS auto-sent (booking_created trigger) |
| `updatePrivateBooking(id, formData)` | PrivateBookingFormData serialized | private_bookings/edit | UPDATE booking | SMS auto-sent if date/status changed |
| `updateBookingStatus(id, status)` | status: BookingStatus | private_bookings/edit | UPDATE booking.status | SMS auto-sent (status_change trigger; specific: confirmed, cancelled, completed) |
| `addPrivateBookingNote(bookingId, note)` | note: string | private_bookings/edit | INSERT audit | None |
| `deletePrivateBooking(id)` | N/A | private_bookings/delete | DELETE cascade | None |
| `recordDepositPayment(id, formData)` | {payment_method, amount} | private_bookings/manage_deposits | INSERT into payments; UPDATE deposit_paid_date | SMS auto-sent (deposit_received trigger) |
| `recordFinalPayment(id, formData)` | {payment_method, amount} | private_bookings/manage_deposits | INSERT into payments; UPDATE final_payment_date if balance=0 | SMS auto-sent (final_payment_received trigger) |
| `cancelPrivateBooking(bookingId, reason?)` | reason: string (optional) | private_bookings/edit | UPDATE status, cancellation_reason, cancelled_at | SMS auto-sent (booking_cancelled trigger); old SMS messages cancelled |
| `extendBookingHold(bookingId, days)` | days: 7 \| 14 \| 30 | private_bookings/edit | UPDATE hold_expiry | SMS auto-sent (hold_extended trigger) |
| `applyBookingDiscount(bookingId, data)` | {discount_type, discount_amount, discount_reason} | private_bookings/edit | UPDATE booking discount fields | None |

### Booking Items Management

| Action | Permission | DB Operation |
|--------|-----------|--------------|
| `addBookingItem(data)` | private_bookings/edit | INSERT; calc line_total |
| `updateBookingItem(itemId, data)` | private_bookings/edit | UPDATE; recalc line_total |
| `deleteBookingItem(itemId)` | private_bookings/edit | DELETE |
| `reorderBookingItems(bookingId, orderedIds)` | private_bookings/edit | UPDATE display_order |

### SMS Queue Management

| Action | Permission | Operation | Idempotency |
|--------|-----------|-----------|-------------|
| `getPrivateBookingSmsQueue(statusFilter?)` | private_bookings/view_sms_queue | SELECT from queue | N/A |
| `approveSms(smsId)` | private_bookings/approve_sms | UPDATE status→'approved'; set approved_by, approved_at | Enforced via SmsQueueService |
| `rejectSms(smsId)` | private_bookings/approve_sms | UPDATE status→'cancelled'; store reason in metadata | Enforced |
| `sendApprovedSms(smsId)` | private_bookings/send | Call Twilio API; UPDATE status→'sent', sent_at, twilio_sid | Enforced via SmsQueueService (idempotency key) |

### Settings Management

| Action | Permission | Operation |
|--------|-----------|-----------|
| `createVenueSpace(data)` | private_bookings/manage_spaces | INSERT venue_spaces |
| `updateVenueSpace(id, data)` | private_bookings/manage_spaces | UPDATE venue_spaces |
| `deleteVenueSpace(id)` | private_bookings/manage_spaces | DELETE venue_spaces |
| `createCateringPackage(data)` | private_bookings/manage_catering | INSERT catering_packages |
| `updateCateringPackage(id, data)` | private_bookings/manage_catering | UPDATE catering_packages |
| `deleteCateringPackage(id)` | private_bookings/manage_catering | DELETE catering_packages |
| `createVendor(data)` | private_bookings/manage_vendors | INSERT vendors |
| `updateVendor(id, data)` | private_bookings/manage_vendors | UPDATE vendors |
| `deleteVendor(id)` | private_bookings/manage_vendors | DELETE vendors |

### API Routes

#### `GET /api/private-bookings/contract?bookingId={id}`

**Purpose**: Generate and return HTML contract for a booking

**Request**: Query param `bookingId` (required)

**Auth**: 
- User must be authenticated (401 if not)
- Must have permission: `user_has_permission(user.id, 'private_bookings', 'generate_contracts')` RPC

**Response** (200):
- Content-Type: text/html
- Content-Disposition: inline; filename="contract-{id-slice}.html"
- Body: Full HTML contract (printable, ~2000 lines including terms)

**Side Effects**:
1. Fetches booking with all relations (items, spaces, catering, vendors)
2. Calls `generateContractHTML()` from contract-template.ts
3. **Inserts audit log**: `private_booking_audit` row with action='contract_generated', contract_version in metadata
4. **Updates booking**: increments contract_version
5. **Returns 500** if audit fails (logged to console only)
6. **Returns 500** if version update fails (logged to console only)

**Known Issues**:
- No explicit error if booking not found after permission check (returns 404 quietly)
- Audit logging failure is logged but not surfaced to user
- Version increment happens after audit log (order could cause issues if both fail)

---

## 4. USER FLOWS (STEP-BY-STEP)

### Flow 1: CREATE BOOKING

**Entry Point**: `/private-bookings/new` (POST via server action)

**Steps**:
1. **User Authorization**: `checkUserPermission('private_bookings', 'create')` [action level]
2. **Form Parse**: Extract from FormData: customer_first_name, contact_phone, event_date, start_time, guest_count, etc.
3. **Validation**: privateBookingSchema.safeParse() – Zod validation on dates, times, emails
4. **Calculate Derived Fields**:
   - If `date_tbd=true`, append "Event date/time to be confirmed" to internal_notes
   - If no balance_due_date provided and not TBD, set to 7 days before event_date
   - If no hold_expiry provided, set to 14 days from creation
   - If no deposit_amount, default to 250
5. **Call Service**: `PrivateBookingService.createBooking(input)`
   - **In service**:
     - Inserts booking row → `private_bookings`
     - Create calendar event if isCalendarConfigured (Google Calendar sync)
     - Queue SMS: trigger='booking_created' → auto-send
     - Logs audit event
6. **Post-DB**: 
   - logAuditEvent() with operation_type='create', resource_type='private_booking'
   - revalidatePath('/private-bookings'), revalidateTag('dashboard')
7. **Return**: { success: true, data: booking } or { error: string }

**SMS Side Effect**: Booking created SMS auto-sent (trigger in PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS)

---

### Flow 2: EDIT BOOKING

**Entry Point**: `/private-bookings/[id]/edit` (POST via server action)

**Steps**:
1. **Authorization**: `checkUserPermission('private_bookings', 'edit')`
2. **Form Parse**: Similar to create; extract all editable fields
3. **Validation**: privateBookingSchema.safeParse()
4. **Call Service**: `PrivateBookingService.updateBooking(id, input, userId)`
   - **In service**:
     - Fetch current booking
     - If event_date changed:
       - **Cancel old SMS queue items** for this booking (mark as 'cancelled', metadata.cancelled_reason='event_date_changed')
       - **Create new SMS items** if date/status changes trigger reminders
       - Update Google Calendar event if synced
     - If status changed:
       - Trigger appropriate SMS (e.g., 'confirmed' → booking_confirmed, 'cancelled' → booking_cancelled)
     - UPDATE booking row
     - Logs audit for each changed field
5. **Post-DB**: revalidatePath, revalidateTag
6. **Return**: { success: true, data: booking } or { error: string }

**SMS Side Effects**:
- If event_date changed: old SMS cancelled, new ones created
- If status→'confirmed': booking_confirmed SMS auto-sent
- If status→'cancelled': booking_cancelled SMS auto-sent; stores reason + dates in metadata

---

### Flow 3: CONTRACT GENERATION (BROKEN)

**Entry Point**: `/private-bookings/[id]/contract` (page component)

**Current Implementation**:
1. **Page Component** (client-side):
   - Render loading state
   - useEffect → `window.location.href = /api/private-bookings/contract?bookingId={id}`
2. **API Route** (`GET /api/private-bookings/contract`):
   - Check auth (401 if not)
   - Check permission via RPC: `user_has_permission(user.id, 'private_bookings', 'generate_contracts')`
   - Fetch booking + relations (items, spaces, catering, vendors)
   - Call `generateContractHTML()` → returns HTML string
   - Insert audit log (action='contract_generated')
   - Update contract_version += 1
   - Return HTML with Content-Type: text/html
3. **Browser**: Renders HTML; user can Print to PDF

**Issues** (BROKEN FLOW MARKERS):
- ⚠️ **No permission check in action layer**: Only checked in API route; if someone crafts `/api/private-bookings/contract?bookingId=X` directly, they bypass next.js server action checks
- ⚠️ **Audit logging failure silently fails**: If audit insert fails, returns 500; user doesn't know why
- ⚠️ **Version increment after audit log**: Both are separate queries; if first succeeds but second fails, audit is logged but version is not incremented (inconsistency)
- ⚠️ **No retry mechanism**: If contract generation fails partway, user gets 500 with no clear message
- ⚠️ **Contract note field not integrated**: `contract_note` column exists but no UI to edit it before contract generation

**Expected Flow** (What should happen):
1. User navigates to `/private-bookings/[id]/contract`
2. Page fetches booking (server-side)
3. Displays summary + "Generate & Print" button
4. User clicks button → calls server action that:
   - Re-checks permission
   - Calls `generateContractHTML()`
   - Inserts audit log (transactional)
   - Returns HTML/PDF
   - Stores PDF in storage (optional)
5. Browser downloads/opens PDF or shows in modal

---

### Flow 4: RECORD DEPOSIT PAYMENT

**Entry Point**: Deposit payment form on booking detail

**Steps**:
1. **Authorization**: `checkUserPermission('private_bookings', 'manage_deposits')`
2. **Form Parse**: { payment_method: 'cash'|'card'|'invoice', amount: number }
3. **Validation**: amount > 0, method in enum
4. **Call Service**: `PrivateBookingService.recordDeposit(bookingId, amount, method, userId)`
   - **In service**:
     - Validates amount matches booking.deposit_amount (or allows overpayment?)
     - INSERT into private_booking_payments? **NO** – deposits have separate column
     - UPDATE booking: deposit_paid_date = now(), deposit_payment_method = method
     - Actually **stores as booking.deposit_paid_date + method**, not in payments table (payments table is for balance only)
     - Logs audit event
     - Queue SMS: trigger='deposit_received' → auto-send
5. **Post-DB**: revalidatePath, revalidateTag
6. **Return**: { success: true } or { error: string }

**SMS Side Effect**: SMS auto-sent (deposit_received trigger)

**DB Quirk**: Deposit payment recorded on **booking row itself**, not in `private_booking_payments` table (which is balance-only)

---

### Flow 5: RECORD BALANCE/FINAL PAYMENT

**Entry Point**: Balance payment form on booking detail

**Steps**:
1. **Authorization**: `checkUserPermission('private_bookings', 'manage_deposits')`
2. **Form Parse**: { payment_method, amount }
3. **Validation**: amount > 0
4. **Call Service**: `PrivateBookingService.recordBalancePayment(bookingId, amount, method, userId)`
   - **In service**:
     - INSERT into private_booking_payments row (booking_id, amount, method, recorded_by)
     - Call RPC: `calculate_private_booking_balance(bookingId)` → returns remaining balance
     - If remaining_balance <= 0:
       - UPDATE booking: final_payment_date = now(), final_payment_method = method
       - Queue SMS: trigger='final_payment_received' → auto-send
     - Else:
       - Queue SMS: trigger='payment_received' → auto-send (partial payment)
     - Logs audit event
5. **Post-DB**: revalidatePath, revalidateTag
6. **Return**: { success: true } or { error: string }

**SMS Side Effects**:
- If balance remaining: 'payment_received' SMS auto-sent
- If balance=0: 'final_payment_received' SMS auto-sent

**DB Logic**: RPC `calculate_private_booking_balance()`:
```sql
v_total = SUM(line_total) FROM private_booking_items
v_payments_sum = SUM(amount) FROM private_booking_payments
RETURN GREATEST(0, v_total - v_payments_sum)
```
**Note**: Deposit is NOT deducted from balance; it's a separate security bond.

---

### Flow 6: CANCEL BOOKING

**Entry Point**: Cancel button on booking detail

**Steps**:
1. **Authorization**: `checkUserPermission('private_bookings', 'edit')`
2. **Form Input**: Optional cancellation_reason
3. **Call Service**: `PrivateBookingService.cancelBooking(bookingId, reason, userId)`
   - **In service**:
     - Fetch booking
     - UPDATE booking: status='cancelled', cancellation_reason=reason, cancelled_at=now()
     - **Cancel all pending SMS for this booking**: UPDATE status='cancelled' WHERE booking_id=id AND status='pending'
       - Store metadata.cancelled_reason = 'booking_cancelled'
     - Logs audit event
     - Queue SMS: trigger='booking_cancelled' → auto-send
4. **Post-DB**: revalidatePath, revalidateTag
5. **Return**: { success: true } or { error: string }

**SMS Side Effects**:
- Pending SMS auto-cancelled (metadata updated)
- Booking_cancelled SMS auto-sent

---

### Flow 7: ADD/EDIT/DELETE BOOKING ITEMS

**Add Item Entry**: Items page or quick-add modal

**Steps**:
1. **Authorization**: `checkUserPermission('private_bookings', 'edit')`
2. **Form Parse**: {item_type, space_id?, package_id?, vendor_id?, description, quantity, unit_price, discount_value?, discount_type?, notes?}
3. **Validation**: All required fields, type validation
4. **Call Service**: `PrivateBookingService.addBookingItem(data)`
   - **In service**:
     - INSERT into private_booking_items
     - **DB calculates line_total**: qty * unit_price, minus item-level discount
     - Logs audit event
5. **Post-DB**: revalidatePath for booking detail and items page, revalidateTag dashboard
6. **Return**: { success: true } or { error: string }

**Edit Item**:
1. Call `PrivateBookingService.updateBookingItem(itemId, {quantity?, unit_price?, discount_value?, discount_type?, notes?})`
   - UPDATE item, recalc line_total
   - Returns bookingId for revalidation

**Delete Item**:
1. Call `PrivateBookingService.deleteBookingItem(itemId)`
   - DELETE item
   - Returns bookingId

**Total Recalculation**: Not explicit; line_total is DB-calculated on insert/update. Booking total_amount computed from SUM(items).

---

### Flow 8: SMS QUEUE (APPROVAL & SENDING)

**Queue Population**:
- Auto-triggered by booking actions (see Flow 1-7)
- Trigger types with auto-send: booking_created, deposit_received, final_payment_received, payment_received, booking_confirmed, booking_completed, date_changed, booking_cancelled, booking_expired, hold_extended, all reminders, manual
- **Manual reminders** and certain **status_change** messages require approval (not auto-send)

**Manual Approval Flow** (entry: `/private-bookings/sms-queue`):

1. **Page Load**: 
   - Fetch SMS queue: `SmsQueueService.getQueue(['pending', 'approved', 'cancelled'])`
   - Filter by status (pending, approved, cancelled)
   - Permissions check: view_sms_queue, approve_sms, send

2. **Approve SMS**:
   - User clicks "Approve" button on pending message
   - Call `approveSms(smsId)` → SmsQueueService.approveSms()
   - **In service**: UPDATE sms: status='approved', approved_by=userId, approved_at=now()
   - revalidatePath('/private-bookings/sms-queue')
   - Return success/error

3. **Reject SMS**:
   - User clicks "Reject" button
   - Call `rejectSms(smsId)` → SmsQueueService.rejectSms()
   - **In service**: UPDATE sms: status='cancelled', metadata.cancelled_reason='rejected_by_user'
   - revalidatePath

4. **Send Approved SMS**:
   - User clicks "Send Now" on approved message
   - Call `sendApprovedSms(smsId)` → SmsQueueService.sendApprovedSms()
   - **In service**:
     - Idempotency check: Has this message been sent recently? (via claim/lock mechanism)
     - Call Twilio API: sendSMS(recipient_phone, message_body)
     - If success: UPDATE sms: status='sent', sent_at=now(), twilio_sid={sid}
     - If failure: UPDATE sms: status='failed', error_message={error}
     - Return { success: true, sent: true } or { success: false, error: ... }
   - revalidatePath
   - **Note**: If Twilio API fails, SMS stays in 'approved' state and user sees error; can retry

**Auto-Send Flow** (internal, no user action):
- When booking action triggers auto-send trigger type (e.g., booking_created):
  - Service calls `SmsQueueService.sendPrivateBookingSms()`
  - **In service**:
    - Resolve recipient phone: direct phone → booking phone → customer phone (fallback chain)
    - Safety check: ensure customer exists (idempotency key for customer resolution)
    - Call Twilio API directly (not queued; sent immediately)
    - If success: return { sent: true }
    - If failure: return { error, code, logFailure } (logged)
  - **No queue row created** for auto-send (unless explicitly queued for manual approval)
  - If customer lookup fails: error is logged, SMS not sent

**SMS Idempotency**: Enforced via SmsQueueService:
- Dedup lock TTL: 15 minutes (PRIVATE_BOOKING_SMS_QUEUE_DEDUPE_LOCK_TTL_HOURS = 0.25)
- Prevents duplicate sends if request retried

---

### Flow 9: SETTINGS (SPACES, CATERING, VENDORS)

**Manage Venue Spaces** (`/private-bookings/settings/spaces`)

1. **Authorization**: manage_spaces
2. **Fetch Spaces**: `getVenueSpacesForManagement()` → returns all spaces (active + inactive)
3. **Create Space**:
   - Form: {name, capacity_seated, capacity_standing, rate_per_hour, minimum_hours, setup_fee, description?, is_active}
   - Call `createVenueSpace(data)` → PrivateBookingService.createVenueSpace()
   - INSERT into venue_spaces
   - Audit log: user_id, action='create_space'
   - revalidatePath
4. **Update Space**:
   - Call `updateVenueSpace(id, data)` → UPDATE
   - Audit log
5. **Delete Space**:
   - Call `deleteVenueSpace(id)` → DELETE (cascade? check RLS)
   - Audit log

**Manage Catering** (`/private-bookings/settings/catering`)
- Same pattern: create/update/delete CateringPackage
- Fields: name, serving_style, category (food|drink|addon), per_head_cost, pricing_model, minimum_order, description, is_active

**Manage Vendors** (`/private-bookings/settings/vendors`)
- Same pattern: create/update/delete Vendor
- Fields: name, company_name, service_type (dj|band|photographer|...), contact_phone, contact_email, website, typical_rate, notes, preferred, is_active
- **Vendor rate normalization**: sanitizeMoneyString() applied on fetch/display

---

## 5. EXTERNAL DEPENDENCIES

### Supabase RPCs

| RPC Name | Used By | Purpose | Failure Behavior |
|----------|---------|---------|------------------|
| `user_has_permission(p_user_id, p_module_name, p_action)` | API route /api/private-bookings/contract | Permission check (returns BOOLEAN) | Returns false; 403 response |
| `calculate_private_booking_balance(p_booking_id)` | PrivateBookingService.recordBalancePayment() | Returns remaining balance after payments | Returns 0 if error; affects final_payment_date logic |

### Google Calendar

**Function**: `syncCalendarEvent()`, `deleteCalendarEvent()`, `isCalendarConfigured()`

**Used In**:
- PrivateBookingService.createBooking() – creates event on event_date
- PrivateBookingService.updateBooking() – updates event if date changes
- PrivateBookingService.cancelBooking() – deletes event

**Failure**: Logged as warning; booking still created; event sync failure not surfaced to user

**Config**: `isCalendarConfigured()` returns boolean; if false, calendar calls skipped

### Twilio SMS

**Function**: `sendSMS(recipient, message, customerId?)`

**Used In**:
- SmsQueueService.sendPrivateBookingSms() – auto-send SMS
- SmsQueueService.sendApprovedSms() – manual send from queue

**Failure**:
- Auto-send: error logged, SMS not queued (silent failure)
- Manual send: error stored in sms.error_message, status='failed', user sees error on UI

**Rate Limiting**: Built-in via Twilio account (not explicit guards in code)

**Idempotency**: Managed via idempotency key hashing (computeIdempotencyRequestHash) + claim/lock mechanism

### Email Service

**Function**: `sendEmail(to, subject, html, cc?, attachments?)`

**Used In**: Not found in private-bookings flows (only SMS used for notifications)

### Analytics

**Function**: `recordAnalyticsEvent()`

**Used In**: PrivateBookingService.createBooking()

**Failure**: Logged as warning; booking still created

### Audit Logging

**Function**: `logAuditEvent({user_id, operation_type, resource_type, resource_id, operation_status})`

**Used In**: All major actions (create, update, delete, payment record, note add)

**Failure**: Logged as error; action still completes (audit is supplementary, not blocking)

---

## 6. STATE MACHINE

### Booking Status Transitions

```
Draft → Confirmed → Completed → (end)
  ↓          ↓
  └─→ Cancelled → (end)
```

**Transitions & Triggers**:

| From | To | Trigger | Guard Conditions | Side Effects |
|------|----|---------|--------------------|--------------|
| draft | draft | Hold expiry extended | canEdit | hold_expiry updated; no SMS (handled separately as hold_extended) |
| draft | confirmed | User clicks "Confirm" | canEdit | booking_confirmed SMS auto-sent; hold_expiry cleared? |
| draft | cancelled | cancelBooking() | canEdit | cancellation_reason set, cancelled_at set; booking_cancelled SMS auto-sent; pending SMS cancelled |
| confirmed | confirmed | Edit (no status change) | canEdit | No SMS (status unchanged) |
| confirmed | completed | (automatic or manual?) | manage_deposits? | booking_completed SMS auto-sent |
| confirmed | cancelled | cancelBooking() | canEdit | booking_cancelled SMS auto-sent |
| completed | (no further transitions) | – | – | – |
| cancelled | (no reversals) | – | – | – |

**SMS Triggers by Status Transition**:
- draft → confirmed: 'booking_confirmed' (auto-send)
- any → cancelled: 'booking_cancelled' (auto-send)
- confirmed → completed: 'booking_completed' (auto-send; currently no explicit trigger in code)
- hold expiry extended: 'hold_extended' (auto-send)

**Hold Expiry Logic** (draft bookings):
- Default: 14 days from creation
- Can be extended: 7, 14, 30 days via `extendBookingHold()`
- **No automatic status transition** when hold expires (no cron job visible to cancel expired drafts)

**Payment State** (independent of booking status):
- Deposit required before confirmation (implicit; not enforced in code)
- Balance due 7 days before event_date
- Final payment marks balance_due as 0
- Once final_payment_date set, no more balance due (balance=0 in contract)

---

## 7. MISSING/AMBIGUOUS AREAS

### Structural Gaps

1. **Contract Generation Flow Broken**:
   - Page component redirects to API route (unusual pattern)
   - No server action wrapper; permission check only in API route, not action layer
   - Audit log + version increment are separate queries (not transactional)
   - No error message if audit fails (returns 500, logged to console only)

2. **Contract Note Field Underutilized**:
   - Column exists: `contract_note` TEXT
   - Displayed on contract HTML (contract-template.ts line 452-457)
   - **No UI to edit it** before contract generation
   - Users cannot see/edit it on booking detail page

3. **Booking Completion Not Defined**:
   - Status='completed' exists in type
   - No code path explicitly sets it (only draft→confirmed→cancelled)
   - When should a booking auto-complete? After event_date passes? Manual action?
   - `booking_completed` SMS trigger defined but when fires unclear

4. **Hold Expiry Not Enforced**:
   - Expiry date stored, index exists
   - No cron job or scheduled action to cancel expired draft bookings
   - Draft bookings may linger indefinitely if not confirmed or manually cancelled

5. **Deposit Not Mandatory**:
   - Deposit_amount stored, but no validation to prevent confirmation without deposit_paid_date
   - Contract assumes £250 default if not set (line 111 of contract-template)
   - No business logic enforcing deposit must be paid before confirmation

6. **Total Amount Calculation Ambiguous**:
   - Type: PrivateBooking.total_amount exists in TypeScript
   - SQL: No explicit column; appears to be computed (SUM of items)
   - But when queried, does it return computed value or NULL?
   - Contract-template calculates subtotal from items directly (not from booking.total_amount)

7. **Discount Logic Complexity**:
   - Item-level discounts: discount_value + discount_type on each item → line_total calculated with discount
   - Booking-level discounts: discount_amount + discount_type on booking
   - Contract shows both separately; final total = subtotal - booking_discount
   - **No RLS policy** prevents user from directly editing line_total or bypassing discount logic via direct SQL

8. **Customer Phone Normalization Unclear**:
   - Migration: 20260421000003_fix_private_booking_customer_phone_canonical.sql (no details)
   - Migration: 20260423000001_private_bookings_phone_international.sql (no details)
   - Code uses libphonenumber-js to normalize to E.164 (seen in booking form)
   - **When does normalization happen?** On insert? On update? If not stored normalized, SMS sends to non-normalized number?

9. **SMS Auto-Send Not Queued**:
   - Auto-send triggers (booking_created, deposit_received, etc.) are sent immediately, not queued
   - If Twilio fails during auto-send, error logged but **no queue row created** for retry
   - User has no visibility into failed auto-sends; must be caught via monitoring/logs

10. **Idempotency Key Mechanism Opaque**:
    - SmsQueueService uses `claimIdempotencyKey()` and `releaseIdempotencyClaim()`
    - Mechanism appears to be lock-based (15-min TTL)
    - **How is concurrency handled?** What if two requests with same key arrive simultaneously?
    - **How are stale claims cleaned up?** After TTL expires, is claim auto-released?

11. **No Explicit Booking Expiry Automation**:
    - Type: `booking_expired` SMS trigger exists
    - When should this fire? After event_date passes? After cancellation deadline?
    - No cron job visible in codebase to generate this trigger

12. **Private Booking Feedback/Runtime Analysis**:
    - Migration: 20260420000015_private_booking_feedback_runtime.sql (no details in code)
    - Purpose unclear; not referenced in types or actions

13. **Table Areas Blocking**:
    - Migration: 20260420000020_table_areas_private_booking_blocks.sql
    - Suggests private bookings can block table availability
    - **No code path visible** to fetch table availability or block tables when booking created
    - Likely incomplete feature

14. **Contract Version Not Explained**:
    - contract_version incremented on each generation
    - No use of version number in UI (no "view version X" links)
    - Presumably for audit trail, but old versions not stored/retrievable

15. **SMS Queue Metadata Structure Unspecified**:
    - metadata: JSONB allows arbitrary data
    - Known keys: cancelled_reason, old_date, new_date (for date change)
    - **No schema validation** for metadata on insert
    - Code does `typeof metadata.key === 'string' ? metadata.key : ''` (no type safety)

16. **Source Field Underutilized**:
    - Booking.source: TEXT (how booking was created)
    - **No validation** on value; free-form string
    - No filtering/reporting by source visible in code

17. **Audit Trail Foreign Keys**:
    - PrivateBookingAudit.performed_by can be NULL
    - When is it NULL? System actions? API calls without user context?
    - No distinction in audit between user action and system action

18. **Vendor Rate Normalization Strategy Unclear**:
    - typical_rate: TEXT (free-form, e.g., "£500-800")
    - typical_rate_normalized: TEXT (output from sanitizeMoneyString)
    - sanitizeMoneyString() does what exactly? Strips currency? Extracts number?
    - **Applied on fetch only**, not stored; can become stale

19. **No Calendar Sync Rollback**:
    - If booking.cancelBooking() calls deleteCalendarEvent() and it fails, booking is still cancelled (no rollback)
    - Calendar and DB become out of sync

20. **Settings Delete Cascades Unchecked**:
    - deleteVenueSpace(), deleteCateringPackage(), deleteVendor() all DELETE
    - **No check if item is used** in active bookings
    - If space/package is deleted, booking items reference deleted IDs (FK constraint may prevent, or may allow orphaned rows depending on RLS)

21. **No Booking Cloning**:
    - Common feature for recurring private events
    - No action to duplicate a booking
    - User must manually recreate from scratch

22. **Items Display Order**:
    - display_order column added (migration 20251021120000)
    - `reorderBookingItems()` action exists
    - But no guarantee items are fetched in display_order sequence; ORDER BY not explicit in queries shown

23. **Contract Template Hardcoded Branding**:
    - Company details hardcoded in API route (Orange Jelly Limited, address, phone, VAT)
    - No way to customize per-booking or per-company setting
    - If company info changes, contracts already generated are stale

24. **No Contract PDF Storage**:
    - Contract generated on-demand, returned as HTML
    - No PDF stored in storage (Supabase Storage, S3, etc.)
    - If user loses HTML/PDF printout, must regenerate (no historical record)
    - No way to view contract as it was at time of generation (with old item prices, discounts)

25. **Setup Date/Time Isolated**:
    - setup_date, setup_time columns exist
    - Used in contract template (shown if setup_time set)
    - **No business logic** for setup validation (e.g., setup must be before event_date)
    - No reminders for setup time

26. **End Time Next Day Not Validated**:
    - end_time_next_day: BOOLEAN
    - If true, end_time is on next calendar day
    - **No validation** that end_time > start_time (could be 20:00 start, 10:00 end next day = valid, but could also be 20:00 start, 19:00 end next day = invalid)

---

## Summary Table: Permissioning Matrix

| Module | Actions Defined | Checked In Actions? | Checked In API? | Checked In RPC? |
|--------|-----------------|-------------------|-----------------|-----------------|
| private_bookings | view, create, edit, delete, manage_deposits, view_sms_queue, approve_sms, send, manage_spaces, manage_catering, manage_vendors | YES (checkUserPermission) | YES (RPC for generate_contracts) | YES (user_has_permission RPC) |

**Permission Checks**:
- Create: checked in action
- Edit: checked in action
- Delete: checked in action
- View: checked in action + at page level
- Manage Deposits: checked in action
- View SMS Queue: checked in action
- Approve SMS: checked in action
- Send SMS: checked in action
- Manage Spaces/Catering/Vendors: checked in action (requirePrivateBookingsPermission)
- Generate Contracts: checked in API route ONLY (not in action)

---

## Dependency Graph

```
User Browser
  ↓
/private-bookings/* (pages, server components)
  ↓
PrivateBookingDetailClient, PrivateBookingsClient (client components)
  ↓
privateBookingActions.ts (server actions)
  ↓
├─→ PrivateBookingService (business logic)
│   ├─→ Supabase Server Client (auth + RLS)
│   ├─→ Supabase Admin Client (service role, bypasses RLS)
│   ├─→ SmsQueueService (SMS operations)
│   ├─→ Google Calendar API (if configured)
│   ├─→ Email Service (sendEmail)
│   └─→ Analytics (recordAnalyticsEvent)
│
├─→ SmsQueueService (SMS queue)
│   ├─→ Supabase Admin Client
│   ├─→ Twilio (sendSMS)
│   └─→ Customer Resolution (idempotency)
│
├─→ checkUserPermission (RBAC)
│   └─→ user_has_permission RPC
│
└─→ logAuditEvent (audit logging)
    └─→ Supabase (private_booking_audit table)

/api/private-bookings/contract
  ↓
  ├─→ Supabase Server Client
  ├─→ user_has_permission RPC
  └─→ generateContractHTML (contract-template.ts)
```

---

**End of Report**
