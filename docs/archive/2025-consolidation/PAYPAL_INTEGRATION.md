# PayPal Integration for Table Bookings

## Required PayPal Information

To integrate PayPal for Sunday lunch pre-payments, you'll need:

### 1. PayPal Business Account
- Create a business account at https://www.paypal.com/uk/business
- Complete business verification

### 2. PayPal REST API Credentials
You'll need the following from your PayPal Developer Dashboard (https://developer.paypal.com):

- **Client ID**: Your app's public identifier
- **Client Secret**: Your app's private key (keep secure!)
- **Environment**: Start with "sandbox" for testing, then switch to "live"

### 3. Environment Variables to Add
Add these to your `.env.local` file:

```bash
# PayPal Configuration
PAYPAL_CLIENT_ID=your_client_id_here
PAYPAL_CLIENT_SECRET=your_client_secret_here
PAYPAL_ENVIRONMENT=sandbox  # or 'live' for production
PAYPAL_WEBHOOK_ID=your_webhook_id_here  # Optional, for payment notifications
```

### 4. Setting Up PayPal App
1. Log into PayPal Developer Dashboard
2. Navigate to "My Apps & Credentials"
3. Click "Create App"
4. Name your app (e.g., "Anchor Table Bookings")
5. Select "Merchant" as the app type
6. Copy the Client ID and Secret

### 5. Webhook Configuration (Optional but Recommended)
For real-time payment updates:

1. In your PayPal app settings, go to "Webhooks"
2. Add webhook URL: `https://your-domain.com/api/webhooks/paypal`
3. Subscribe to these events:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.REFUNDED`
   - `PAYMENT.CAPTURE.DENIED`

### 6. Testing in Sandbox
PayPal provides test accounts for sandbox:
- Create test buyer accounts in the sandbox
- Use test credit card numbers provided by PayPal
- All payments in sandbox are simulated

### 7. Going Live Checklist
Before switching to production:
- [ ] Replace sandbox credentials with live credentials
- [ ] Update PAYPAL_ENVIRONMENT to "live"
- [ ] Test a small real transaction
- [ ] Ensure refund process works correctly
- [ ] Set up proper error logging
- [ ] Configure webhook signature verification

## Current Implementation

The system is set up to:
1. Create PayPal payment requests for Sunday lunch bookings
2. Handle payment confirmations via webhooks
3. Process refunds for cancellations
4. Send payment confirmation SMS/emails

## Payment Flow

1. Customer books Sunday lunch → Status: `pending_payment`
2. SMS sent with payment link
3. Customer pays via PayPal
4. Webhook confirms payment → Status: `confirmed`
5. Confirmation SMS/email sent

## Refund Policy Integration

- Cancellations follow the booking policy rules
- Automatic refund calculation based on timing
- Partial refunds supported
- All refunds logged in audit trail