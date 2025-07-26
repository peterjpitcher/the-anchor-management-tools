# Sunday Lunch Deposit Implementation Discovery

## Current Implementation

### Payment Flow
1. **Booking Creation**: 
   - Customer selects Sunday lunch items (mains, sides, etc.)
   - Total is calculated: `sum(item.price_at_booking * item.quantity)`
   - Booking status set to `pending_payment`

2. **Payment Response**:
   ```json
   {
     "payment_required": true,
     "payment_details": {
       "amount": [TOTAL_AMOUNT],  // Currently full amount
       "currency": "GBP",
       "payment_url": "/api/table-bookings/payment/create?booking_id=xxx"
     }
   }
   ```

3. **Payment Processing**:
   - `/api/table-bookings/payment/create` creates PayPal order for full amount
   - Payment stored in `table_booking_payments` table
   - After successful payment, booking status changes to `confirmed`

## Required Changes for £5 Deposit System

### 1. API Changes (src/app/api/table-bookings/route.ts)
- Calculate deposit: `£5 * party_size`
- Calculate outstanding balance: `total_amount - deposit_amount`
- Return both amounts in response:
  ```json
  {
    "payment_required": true,
    "payment_details": {
      "deposit_amount": 25.00,      // £5 × 5 people
      "total_amount": 125.00,       // Full meal cost
      "outstanding_amount": 100.00,  // Due on arrival
      "currency": "GBP",
      "payment_url": "..."
    }
  }
  ```

### 2. Database Considerations
- `table_booking_payments` table can already handle partial payments
- May want to add fields to `table_bookings`:
  - `deposit_amount` - amount required as deposit
  - `total_amount` - full booking value
  - `outstanding_amount` - balance due

### 3. Payment Processing Changes
- Update `/api/table-bookings/payment/create` to:
  - Create PayPal order for deposit amount only
  - Store deposit amount in payment record
  - Track that this is a deposit payment

### 4. Status Management
- Booking becomes `confirmed` after deposit payment
- Need to track that balance is still due
- Consider adding a payment status field or using metadata

### 5. Customer Communication
- SMS templates need updating to mention:
  - Deposit paid amount
  - Outstanding balance
  - Payment due on arrival

## Implementation Steps

1. **Update Booking API**:
   - Add deposit calculation (£5 per person)
   - Return deposit and outstanding amounts
   - Keep meal selection requirement

2. **Update Payment Creation**:
   - Use deposit amount for PayPal order
   - Store payment type as 'deposit'

3. **Update Booking Confirmation**:
   - Show deposit paid
   - Show outstanding balance
   - Confirm payment due on arrival

4. **Update SMS Templates**:
   - Include deposit and balance information

## Benefits
- Lower barrier to booking (£5 vs full amount)
- Still captures commitment with deposit
- Reduces refund processing
- Maintains meal pre-selection for kitchen planning

## API Flexibility
Since it's API key protected and internal use only:
- No complex validation needed
- Can add override parameters if needed
- Simple, straightforward implementation