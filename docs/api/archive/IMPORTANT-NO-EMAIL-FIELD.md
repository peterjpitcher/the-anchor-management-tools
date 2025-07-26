# IMPORTANT: No Email Field in Customers Table

## Critical Information for API Integration

The `customers` table in the database does **NOT** have an email column. This is a crucial detail that affects all API integrations.

### ❌ DO NOT Include Email
```json
// WRONG - This will cause DATABASE_ERROR
{
  "customer": {
    "first_name": "John",
    "last_name": "Smith", 
    "email": "john@example.com",  // ❌ NO EMAIL FIELD
    "mobile_number": "07700900000"
  }
}
```

### ✅ Correct Customer Object
```json
// CORRECT - No email field
{
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900000",
    "sms_opt_in": true  // Optional
  }
}
```

## Available Customer Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `first_name` | string | Yes | Customer's first name |
| `last_name` | string | Yes | Customer's last name |
| `mobile_number` | string | Yes | UK mobile number |
| `sms_opt_in` | boolean | No | SMS marketing consent (default: false) |

## Why No Email?

The system was designed to use mobile numbers as the primary customer identifier because:
1. SMS is the primary communication channel
2. Mobile numbers are unique and verifiable
3. Reduces duplicate customer records
4. Simplifies GDPR compliance

## Customer Identification

Customers are identified and deduplicated by their mobile number. The system will:
1. Check if a customer exists with the given mobile number
2. Reuse existing customer if found
3. Create new customer if not found

## Future Considerations

If email functionality is needed in the future:
1. A database migration would add the email column
2. The API would be updated to accept email
3. Existing integrations would continue to work (email would be optional)

## For Website Developers

When building booking forms:
- ✅ Collect email on your side if needed for your records
- ✅ Store email in your own database/system
- ❌ Don't send email to the Table Booking API
- ✅ Use mobile number for customer identification

## Error Prevention

If you see `DATABASE_ERROR` when creating bookings, first check:
1. Are you sending an email field? Remove it.
2. Are all required fields present? (first_name, last_name, mobile_number)
3. Is the mobile number in valid UK format?

## Updated: July 2025

This documentation reflects the current database schema. Always refer to the latest API documentation for updates.