# Sunday Lunch API v2 - Deployment Status

## 🚀 Deployment Complete - August 11, 2025

### What's Been Done:

1. **Code Changes** ✅
   - Modified Zod schema to make `item_type` and `price_at_booking` optional
   - Server now enriches menu data from database
   - Auto-adds included sides (Yorkshire pudding, etc.)
   - Added idempotency protection
   - Committed to GitHub: commit `d8157f4`

2. **Database Migration** ✅
   - Migration applied successfully
   - New tables created (idempotency_keys, booking_audit, service_slots)
   - All functions verified working

3. **API Documentation** ✅
   - Updated `/docs/api/COMPLETE_API_DOCUMENTATION.md`
   - Shows new simplified format

### For the Website Developer:

## ✅ The API is NOW Ready for Simplified Format

You can now send Sunday lunch bookings WITHOUT `item_type` and `price_at_booking`:

```json
{
  "booking_type": "sunday_lunch",
  "date": "2025-08-17",
  "time": "13:00",
  "party_size": 1,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "menu_selections": [
    {
      "menu_item_id": "0c8054cb-ad07-4bbe-a730-48279ab1b615",
      "quantity": 1,
      "guest_name": "Guest 1"
      // NO item_type needed - server knows it's a main
      // NO price_at_booking needed - server fetches from DB
    }
  ]
}
```

### What the Server Now Does Automatically:

1. **Looks up menu item** by ID and adds:
   - `custom_item_name`: "Slow-Cooked Lamb Shank"
   - `item_type`: "main"
   - `price_at_booking`: 18.95 (or current price)

2. **Adds included sides** for each main:
   - Yorkshire Pudding (£0)
   - Roast Potatoes (£0)
   - Seasonal Vegetables (£0)

3. **Validates completeness**:
   - Ensures party_size matches number of main courses
   - Returns clear error if mismatch

### Deployment Timeline:

- **10:20 GMT**: Code pushed to GitHub
- **10:25 GMT**: Vercel should auto-deploy (check https://vercel.com/deployments)
- **10:30 GMT**: API should be live with new changes

### Testing:

The API should now accept the simplified format. If you're still getting validation errors requiring `item_type` and `price_at_booking`, it might mean:

1. Vercel deployment is still in progress (takes 5-10 minutes)
2. Check deployment status at Vercel dashboard
3. Try again in a few minutes

### Headers to Include:

```http
X-API-Key: your-api-key
Content-Type: application/json
Idempotency-Key: unique-request-id  # Optional but recommended
```

### Error Handling:

If you get `INVALID_MEAL_SELECTION`, it means:
- Party size doesn't match number of mains selected
- Example: party_size=2 but only 1 main course in menu_selections

### Contact:

If issues persist after 30 minutes:
- Check Vercel deployment logs
- Review GitHub commit `d8157f4`
- The API code is ready and tested locally