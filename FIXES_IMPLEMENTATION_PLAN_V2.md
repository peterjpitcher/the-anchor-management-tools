# Implementation Plan V2 - Based on Actual Database Schema

**Date:** June 25, 2025  
**Prepared by:** Claude Code  
**Status:** REVISED after schema discovery

## Executive Summary

This revised plan is based on discovering the actual database schema. The good news: **the tables already exist!** The bad news: the code is using wrong field names everywhere. We need to update the code to match the existing database schema.

**Key Discovery:** 
- ✅ Tables exist: `catering_packages`, `venue_spaces`, `vendors`
- ❌ Code uses wrong field names (e.g., `per_head_cost` vs `cost_per_head`)
- ❌ TypeScript types don't match database schema

**Recommended Approach:** Update code to match database (Option A from feedback)

## Actual Database Schema

### Tables That Already Exist:

```sql
-- catering_packages table
id, name, description, package_type, cost_per_head, minimum_guests, 
maximum_guests, dietary_notes, active, display_order

-- venue_spaces table  
id, name, description, capacity_seated, capacity_standing, 
rate_per_hour, minimum_hours, setup_fee, active, display_order

-- vendors table
id, name, company_name, service_type, contact_phone, contact_email,
website, typical_rate, notes, preferred, active
```

## Field Mapping Issues Found

### Catering Settings Page

| Code Uses | Database Has | Action Required |
|-----------|--------------|-----------------|
| `per_head_cost` | `cost_per_head` | Update field name |
| `minimum_order` | `minimum_guests` | Update field name |
| `is_active` | `active` | Update field name |
| `includes` | (doesn't exist) | Remove or use `description` |
| `package_type: 'sit_down'` | `package_type: 'sit-down'` | Fix hyphenation |

### Spaces Settings Page

| Code Uses | Database Has | Action Required |
|-----------|--------------|-----------------|
| `capacity` | `capacity_seated` + `capacity_standing` | Use two fields |
| `hire_cost` | `rate_per_hour` | Update field name |
| `is_active` | `active` | Update field name |
| (missing) | `minimum_hours` | Add to form |
| (missing) | `setup_fee` | Add to form |

### Vendors Settings Page

| Code Uses | Database Has | Action Required |
|-----------|--------------|-----------------|
| `vendor_type` | `service_type` | Update field name |
| `phone` | `contact_phone` | Update field name |
| `email` | `contact_email` | Update field name |
| `is_preferred` | `preferred` | Update field name |
| `is_active` | `active` | Update field name |

## Revised Implementation Plan

### Phase 1: Fix Server Actions (Day 1-2) 🔴 CRITICAL

**No database changes needed!** Just update the code to use correct field names.

#### 1.1 Fix Catering Page (`/private-bookings/settings/catering/page.tsx`)

```typescript
// BEFORE (line ~40):
const { data, error } = await supabase
  .from('private_bookings')  // ❌ WRONG TABLE
  .insert({
    name: formData.get('name'),
    package_type: formData.get('package_type'),  
    per_head_cost: formData.get('per_head_cost'),  // ❌ WRONG FIELD
    minimum_order: formData.get('minimum_order'),  // ❌ WRONG FIELD
    is_active: formData.get('is_active') === 'true'  // ❌ WRONG FIELD
  })

// AFTER:
const { data, error } = await supabase
  .from('catering_packages')  // ✅ CORRECT TABLE
  .insert({
    name: formData.get('name'),
    package_type: formData.get('package_type')?.toString().replace('_', '-'),  // ✅ Fix hyphenation
    cost_per_head: parseFloat(formData.get('cost_per_head') as string),  // ✅ CORRECT FIELD
    minimum_guests: parseInt(formData.get('minimum_guests') as string),  // ✅ CORRECT FIELD
    active: formData.get('active') === 'true',  // ✅ CORRECT FIELD
    description: formData.get('description'),
    dietary_notes: formData.get('dietary_notes')
  })
```

#### 1.2 Fix Form Field Names

Update all form inputs to use correct `name` attributes:

```tsx
// BEFORE:
<input name="per_head_cost" />
<input name="minimum_order" />
<input name="is_active" />

// AFTER:
<input name="cost_per_head" />
<input name="minimum_guests" />
<input name="active" />
```

### Phase 2: Create TypeScript Interfaces (Day 2-3) 🟠 HIGH

Create proper type definitions that match the database:

```typescript
// /src/types/catering.ts
export interface CateringPackage {
  id: string;  // UUID in future
  name: string;
  description?: string;
  package_type: 'buffet' | 'sit-down' | 'canapes' | 'drinks' | 'other';
  cost_per_head: number;
  minimum_guests: number;
  maximum_guests?: number;
  dietary_notes?: string;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// /src/types/venue.ts
export interface VenueSpace {
  id: string;
  name: string;
  description?: string;
  capacity_seated?: number;
  capacity_standing?: number;
  rate_per_hour: number;
  minimum_hours: number;
  setup_fee: number;
  active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// /src/types/vendor.ts
export interface Vendor {
  id: string;
  name: string;
  company_name?: string;
  service_type: 'dj' | 'band' | 'photographer' | 'florist' | 'decorator' | 'cake' | 'transport' | 'other';
  contact_phone?: string;
  contact_email?: string;
  website?: string;
  typical_rate?: string;
  notes?: string;
  preferred: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}
```

### Phase 3: Update Components (Day 3-4) 🟡 MEDIUM

Update all components to use the correct field names and types:

1. Update state variables
2. Update form field names
3. Update display logic
4. Add missing fields to forms

### Phase 4: Add Missing Server Actions (Day 4-5) 🟡 MEDIUM

Check if server actions exist in `/app/actions/`:
- `catering.ts` or `catering-packages.ts`
- `venue-spaces.ts` or `spaces.ts`
- `vendors.ts`

If not, create them with proper RBAC checks:

```typescript
// /src/app/actions/catering-packages.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/lib/permissions/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const CateringPackageSchema = z.object({
  name: z.string().min(1),
  package_type: z.enum(['buffet', 'sit-down', 'canapes', 'drinks', 'other']),
  cost_per_head: z.number().positive(),
  minimum_guests: z.number().int().positive(),
  // ... other fields
});

export async function createCateringPackage(formData: FormData) {
  const supabase = await createClient();
  
  // Check permissions
  const hasPermission = await checkUserPermission(supabase, 'private_bookings', 'manage');
  if (!hasPermission) {
    return { error: 'Unauthorized' };
  }
  
  // Validate and insert...
}
```

### Phase 5: Verify RBAC Permissions (Day 5) 🟠 HIGH

Check if RBAC permissions exist for these modules:

```sql
-- Check existing permissions
SELECT DISTINCT module_name, action_name 
FROM rbac_permissions 
WHERE module_name IN ('private_bookings', 'catering', 'venues', 'vendors')
ORDER BY module_name, action_name;
```

If missing, add them:

```sql
INSERT INTO rbac_permissions (module_name, action_name, description) VALUES
('catering', 'view', 'View catering packages'),
('catering', 'create', 'Create catering packages'),
('catering', 'edit', 'Edit catering packages'),
('catering', 'delete', 'Delete catering packages'),
('catering', 'manage', 'Full catering management');
-- Similar for venues and vendors
```

## Testing Plan

### Unit Testing Each Fix:

1. **Catering Package CRUD**
   - Create package with all fields
   - Verify `cost_per_head` saves correctly (not `per_head_cost`)
   - Verify `minimum_guests` saves correctly
   - Test package type hyphenation

2. **Venue Space CRUD**
   - Test both `capacity_seated` and `capacity_standing`
   - Verify `rate_per_hour` calculations
   - Test `setup_fee` addition

3. **Vendor CRUD**
   - Test `service_type` validation
   - Verify `preferred` flag works
   - Test contact fields validation

### Integration Testing:

1. Create a private booking
2. Add catering package to booking
3. Add venue space to booking
4. Add vendor to booking
5. Verify all items appear correctly

## Risk Mitigation

### Lower Risk Approach (Recommended):
- Update code to match database
- No database migrations needed
- Can be rolled back easily
- Won't affect other systems

### What We're NOT Doing:
- NOT changing database schema
- NOT creating new tables
- NOT renaming existing fields
- NOT breaking existing functionality

## Success Criteria

- [ ] All settings pages load without errors
- [ ] Can create/edit/delete catering packages
- [ ] Can create/edit/delete venue spaces
- [ ] Can create/edit/delete vendors
- [ ] All fields save correctly to database
- [ ] TypeScript compilation succeeds
- [ ] No console errors in browser

## Questions for Developer Review

1. **Permissions:** Should we use existing `private_bookings` permissions or create separate modules?
2. **Validation:** Should we add Zod schemas for runtime validation?
3. **Display Order:** Should we implement drag-and-drop reordering?
4. **Soft Delete:** Should deletes be soft (set active=false) or hard deletes?
5. **Audit Trail:** Should these changes be logged to audit_logs?

## Next Steps

1. Review this plan with the team
2. Confirm permission structure
3. Begin Phase 1 (field name fixes)
4. Test incrementally
5. Deploy in stages

---

This plan is based on actual database discovery, not assumptions. The path forward is clearer and less risky than the original plan.