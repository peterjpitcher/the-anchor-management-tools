# Private Bookings Field Mapping

This document provides a detailed mapping of all fields in the private bookings system, showing where each field is available across different interfaces.

## Field Availability Matrix

| Field Name | Database | TypeScript | View Page | Create Form | Edit Form | Notes |
|------------|----------|------------|-----------|-------------|-----------|-------|
| **Customer Information** ||||||| 
| customer_id | ✅ | ✅ | ✅ | ✅ | ❌ | Can select in create, but not change in edit |
| customer_name | ✅ | ✅ | ✅ | ❌ | ❌ | Deprecated field |
| customer_first_name | ✅ | ✅ | ✅ | ✅ | ✅ | |
| customer_last_name | ✅ | ✅ | ✅ | ✅ | ✅ | |
| customer_full_name | ✅ | ✅ | ✅ | Auto | Auto | Generated column |
| contact_phone | ✅ | ✅ | ✅ | ✅ | ✅ | |
| contact_email | ✅ | ✅ | ✅ | ✅ | ✅ | |
| **Event Details** ||||||| 
| event_date | ✅ | ✅ | ✅ | ✅ | ✅ | |
| start_time | ✅ | ✅ | ✅ | ✅ | ✅ | |
| setup_date | ✅ | ✅ | ✅ | ✅ | ❌ | Missing in edit form |
| setup_time | ✅ | ✅ | ✅ | ✅ | ✅ | |
| end_time | ✅ | ✅ | ✅ | ✅ | ✅ | |
| guest_count | ✅ | ✅ | ✅ | ✅ | ✅ | |
| event_type | ✅ | ✅ | ✅ | ✅ (text) | ✅ (select) | Inconsistent input types |
| **Status & Workflow** ||||||| 
| status | ✅ | ✅ | ✅ (modal) | Auto 'draft' | ❌ | Only changeable via modal |
| contract_version | ✅ | ✅ | ✅ | Auto 0 | ❌ | |
| calendar_event_id | ✅ | ✅ | ❌ | ❌ | ❌ | Not exposed in UI |
| **Financial Information** ||||||| 
| deposit_amount | ✅ | ✅ | ✅ | Auto 250 | ❌ | Cannot override default |
| deposit_paid_date | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via payment modal only |
| deposit_payment_method | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via payment modal only |
| total_amount | ✅ | ✅ | ✅ | Auto 0 | ❌ | Calculated from items |
| balance_due_date | ✅ | ✅ | ✅ | Auto calc | ❌ | Auto-calculated, not editable |
| final_payment_date | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via payment modal only |
| final_payment_method | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via payment modal only |
| **Discount Information** ||||||| 
| discount_type | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via discount modal only |
| discount_amount | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via discount modal only |
| discount_reason | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via discount modal only |
| **Notes & Requirements** ||||||| 
| internal_notes | ✅ | ✅ | ✅ | ✅ | ✅ | |
| customer_requests | ✅ | ✅ | ✅ | ✅ | ✅ | |
| special_requirements | ✅ | ✅ | ✅ | ❌ | ❌ | Field exists but not in forms |
| accessibility_needs | ✅ | ✅ | ✅ | ❌ | ❌ | Field exists but not in forms |
| **Tracking & Metadata** ||||||| 
| source | ✅ | ✅ | ✅ | ❌ | ❌ | Field exists but not in forms |
| created_by | ✅ | ✅ | ✅ | Auto | N/A | Set automatically |
| created_at | ✅ | ✅ | ✅ | Auto | N/A | Set automatically |
| updated_at | ✅ | ✅ | ✅ | N/A | Auto | Updated automatically |

## Field Access Patterns

### 1. **Full Access** (can create and edit via forms)
- customer_first_name
- customer_last_name
- contact_phone
- contact_email
- event_date
- start_time
- end_time
- guest_count
- setup_time
- internal_notes
- customer_requests

### 2. **Create Only** (can set on creation but not edit)
- customer_id (customer selection)
- setup_date

### 3. **Modal Only** (requires separate modal on view page)
- status
- All payment fields (deposit/final payment dates and methods)
- All discount fields (type, amount, reason)

### 4. **View Only** (displayed but not editable anywhere)
- customer_full_name (generated)
- created_at, created_by
- updated_at
- balance_due_date (auto-calculated)
- calculated_total (from items)

### 5. **Hidden** (in database but not exposed in UI)
- special_requirements
- accessibility_needs
- source
- calendar_event_id

### 6. **Inconsistent** (different behavior in different forms)
- event_type: Free text in create, dropdown in edit

## Impact Analysis

### High Impact Issues

1. **Accessibility Gap**: `special_requirements` and `accessibility_needs` fields exist but are completely inaccessible through the UI, potentially causing compliance issues.

2. **Customer Lock-in**: Once a booking is created with a customer, it cannot be reassigned to a different customer, requiring recreation of the entire booking if the wrong customer was selected.

3. **Financial Inflexibility**: Cannot set custom deposit amounts or override the auto-calculated balance due date during booking creation.

### Medium Impact Issues

4. **Two-Step Workflows**: Many common operations require navigating to the view page and opening modals rather than being available in the main forms.

5. **Missing Business Intelligence**: The `source` field could track how bookings originate (phone, email, walk-in, etc.) but is not exposed.

6. **Setup Date Asymmetry**: Can set setup_date when creating but not when editing, forcing users to remember to set it correctly on creation.

### Low Impact Issues

7. **Type Inconsistency**: The event_type field behavior differs between forms, potentially confusing users.

8. **Hidden Metadata**: Fields like calendar_event_id exist but have no UI, suggesting incomplete feature implementation.

## Recommendations Priority

### Critical (Do First)
1. Add `special_requirements` and `accessibility_needs` to both create and edit forms
2. Add `source` field with predefined options (Phone, Email, Walk-in, Website, Other)
3. Make `event_type` consistent across forms

### Important (Do Soon)
4. Add customer re-selection to edit form
5. Add `setup_date` to edit form
6. Allow deposit amount override in create form
7. Add ability to manually set balance_due_date

### Nice to Have (Future)
8. Expose calendar_event_id for integration purposes
9. Add bulk status change functionality
10. Create booking templates for common event types