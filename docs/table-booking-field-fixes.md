# Table Booking API - Required Field Fixes

## Immediate Fix Required

The website is currently sending `occasion` but the database expects `celebration_type`. This field name mismatch is causing the DATABASE_ERROR.

### Change Required in Website Code

In `/api/table-bookings/create/route.ts`, update the field mapping:

```javascript
// CURRENT (WRONG)
const transformedData = {
  // ...
  "occasion": body.occasion || "",
  // ...
};

// FIXED (CORRECT)
const transformedData = {
  // ...
  "celebration_type": body.occasion || null,  // Map occasion to celebration_type
  // Remove the "occasion" field entirely
};
```

## All Available Fields for Table Bookings

### Required Fields
- `booking_type`: "regular"
- `date`: "YYYY-MM-DD"
- `time`: "HH:mm"
- `party_size`: number (1-50)
- `customer`: object with:
  - `first_name`: string
  - `last_name`: string
  - `mobile_number`: string (UK format)
  - `sms_opt_in`: boolean (optional, default: false)

### Optional Enhancement Fields
These fields can greatly improve the booking experience:

1. **`duration_minutes`** (integer, default: 120)
   - How long the customer needs the table
   - Range: 60-240 minutes

2. **`special_requirements`** (string)
   - Free text for special requests
   - Examples: "Window table", "Wheelchair access", "High chair needed"

3. **`dietary_requirements`** (array of strings)
   - Must be an array, not a string
   - Examples: ["vegetarian", "gluten_free", "vegan"]

4. **`allergies`** (array of strings)
   - Must be an array, not a string
   - Examples: ["nuts", "shellfish", "dairy"]

5. **`celebration_type`** (string) - NOT "occasion"
   - Type of celebration
   - Examples: "birthday", "anniversary", "engagement"

6. **`source`** (string, default: "website")
   - Where the booking came from
   - Options: "website", "phone", "walk-in", "social_media"

## Example Implementation

### Basic Form Fields
```html
<!-- Current form might have -->
<input name="occasion" placeholder="Special occasion">

<!-- Should map to -->
celebration_type: formData.get('occasion')
```

### Enhanced Form Example
```javascript
const bookingData = {
  booking_type: "regular",
  date: "2024-03-15",
  time: "19:00",
  party_size: 4,
  duration_minutes: 120,
  customer: {
    first_name: "John",
    last_name: "Smith",
    mobile_number: "07700900000",
    sms_opt_in: true
  },
  special_requirements: "Window table, birthday cake",
  dietary_requirements: ["vegetarian", "gluten_free"],
  allergies: ["nuts"],
  celebration_type: "birthday",  // NOT "occasion"
  source: "website"
};
```

## Benefits of Using All Fields

1. **Better Service**: Staff can prepare for dietary needs and allergies
2. **Improved Experience**: Special requirements help provide personalized service
3. **Marketing Insights**: Celebration types help understand customer occasions
4. **Operational Efficiency**: Duration helps with table turnover planning
5. **Safety**: Allergy information ensures customer safety

## Testing After Fix

Once you change `occasion` to `celebration_type`, test with:

```bash
curl -X POST https://management.orangejelly.co.uk/api/table-bookings \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "booking_type": "regular",
    "date": "2024-03-15",
    "time": "19:00",
    "party_size": 2,
    "customer": {
      "first_name": "Test",
      "last_name": "User",
      "mobile_number": "07700900123"
    },
    "celebration_type": "birthday"
  }'
```

This should resolve the DATABASE_ERROR immediately.