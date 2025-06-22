# Validation Constraints Documentation

## Overview
This document outlines all validation constraints implemented in the application to ensure data integrity and consistency.

## Phone Number Validation

### Format
- **Pattern**: E.164 format (`+[country][number]`)
- **UK Example**: `+447700900123`
- **Regex**: `^\+[1-9]\d{1,14}$`

### Implementation
- **Frontend**: Zod validation in `/src/lib/validation.ts`
- **Backend**: PostgreSQL CHECK constraints
- **Tables**: `customers.mobile_number`, `employees.mobile_number`, `employees.emergency_contact_phone`

### User Experience
- Input placeholders show example format
- Error messages guide users to correct format
- Automatic formatting applied where possible

## Email Validation

### Format
- Standard email format with basic validation
- **Regex**: `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`

### Implementation
- **Frontend**: HTML5 email input type + Zod validation
- **Backend**: PostgreSQL CHECK constraints
- **Tables**: `customers.email_address`, `employees.email_address`

## Name Validation

### Format
- Letters, spaces, hyphens, and apostrophes only
- **Regex**: `^[a-zA-Z\s\-']+$`
- Examples: "John", "Mary-Jane", "O'Connor"

### Implementation
- **Frontend**: Zod validation
- **Backend**: PostgreSQL CHECK constraints
- **Tables**: `customers.first_name/last_name`, `employees.first_name/last_name`

## Date Validation

### Event Dates
- **New Events**: Cannot be created with past dates
- **Existing Events**: Past events preserved for historical records
- **Maximum**: 1 year in the future
- **Frontend**: HTML5 date input with min/max attributes

### Private Bookings
- **New Bookings**: Must be today or future
- **Maximum**: 1 year in the future
- **Frontend**: Date picker with constraints

### Date of Birth
- Must be in the past
- Must be after 1900-01-01
- **Tables**: `customers.date_of_birth`, `employees.date_of_birth`

### Implementation
- **Frontend**: Date pickers with min/max constraints
- **Backend**: PostgreSQL triggers for complex validation

## Booking Capacity

### Rules
- Bookings cannot exceed event capacity
- Real-time availability checking
- Prevents overbooking

### Implementation
- **Backend**: PostgreSQL trigger `check_booking_capacity()`
- **Frontend**: Shows available seats before booking

## Migration Strategy

### Invalid Data Handling
1. **Phone Numbers**: Invalid numbers set to NULL
2. **Emails**: Invalid emails set to NULL
3. **Audit Trail**: All changes logged to `audit_logs`
4. **User Notification**: Clear error messages for fixes

### Running Migrations
```sql
-- Use the flexible version that allows historical data
\i 20241221_add_validation_constraints_flexible.sql
```

## Error Messages

### User-Friendly Messages
- **Phone**: "Please enter a valid UK phone number (e.g., +447700900123)"
- **Email**: "Please enter a valid email address"
- **Name**: "Names can only contain letters, spaces, hyphens, and apostrophes"
- **Date**: "Cannot create events with dates in the past"
- **Capacity**: "Only X seats available for this event"

## Testing Validation

### Test Cases
1. **Phone Numbers**:
   - Valid: `+447700900123`
   - Invalid: `07700900123`, `+44`, `123456`

2. **Emails**:
   - Valid: `user@example.com`
   - Invalid: `user@`, `@example.com`, `user`

3. **Names**:
   - Valid: `John`, `Mary-Jane`, `O'Connor`
   - Invalid: `John123`, `Mary@Jane`

4. **Dates**:
   - Valid: Today or future for new events
   - Invalid: Yesterday for new events

## Monitoring

### Validation Failures
- Logged to application logs
- Sentry captures validation errors
- Audit logs track data cleanup

### Success Metrics
- Reduced invalid data entries
- Improved SMS delivery rates
- Better data quality for reporting