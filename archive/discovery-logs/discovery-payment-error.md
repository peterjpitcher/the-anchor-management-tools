# Payment Error Discovery Report
**Date**: 2025-07-26  
**Issue**: Sunday lunch deposit payment redirects to API endpoint showing JSON error

## Problem Analysis

### Current Behavior
1. User clicks "Send payment link" on booking details page
2. Browser navigates directly to `/api/table-bookings/payment/create?booking_id=...`
3. If PayPal creation fails, user sees raw JSON: `{"error": "Failed to create payment"}`
4. Poor user experience - no way to recover or understand the issue

### Root Causes

1. **Direct Link Navigation**: Using `<a href=...>` for API endpoint instead of proper form/button
2. **API Error Handling**: API returns JSON on error instead of redirecting to error page
3. **No Error Context**: Generic "Failed to create payment" doesn't help diagnose issue

### Potential Failure Points
- Missing/invalid PayPal credentials (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`)
- Network issues connecting to PayPal
- Invalid booking data
- PayPal API changes or rate limits

## Proposed Solution

### Option 1: Quick Fix (Minimal Changes)
Improve error handling in the API to redirect to an error page:

```typescript
// In payment/create/route.ts
catch (error) {
  console.error('PayPal order creation error:', error);
  
  // Redirect to booking page with error
  const bookingUrl = `${baseUrl}/table-bookings/${bookingId}?error=payment_failed`;
  return NextResponse.redirect(bookingUrl);
}
```

### Option 2: Proper Implementation (Recommended)
1. Replace direct link with server action
2. Add loading state during payment creation
3. Show inline errors on failure
4. Log detailed errors for debugging

### Option 3: Customer-Facing Payment Page
Create a public payment page (`/booking/[reference]/payment`) that:
- Shows booking details
- Handles payment creation
- Shows proper error messages
- Allows retry on failure

## Implementation Plan

### 1. Immediate Fix (5 minutes)
Update the API endpoint to redirect on error instead of returning JSON

### 2. Add Logging (10 minutes)
Add detailed error logging to help diagnose PayPal issues

### 3. UI Improvement (30 minutes)
Replace direct link with button that shows loading state

### 4. Error Page (1 hour)
Create proper error handling flow with retry capability

## Testing Checklist
- [ ] Test with valid PayPal credentials
- [ ] Test with invalid credentials
- [ ] Test with network failure
- [ ] Test with invalid booking ID
- [ ] Verify error messages are user-friendly
- [ ] Check mobile responsiveness