# Twilio Webhook Troubleshooting Guide

## Option A: Use the Unsecured Endpoint (Temporary)

1. In Twilio Console, change the webhook URL to:
   ```
   https://management.orangejelly.co.uk/api/webhooks/twilio-unsecured
   ```
2. This bypasses signature validation
3. Send a test SMS
4. If it works, the issue is signature validation
5. **Important**: Change back to secured endpoint after testing

## Option B: Use the Built-in Test Tool

1. Go to: https://management.orangejelly.co.uk/settings/webhook-test
2. This page lets you simulate incoming webhooks
3. Try sending a test message
4. Check if it appears in Messages

## Option C: Check Environment Variables

In Vercel Dashboard:
1. Go to your project settings
2. Check Environment Variables
3. Verify `TWILIO_AUTH_TOKEN` matches exactly what's in Twilio Console
4. After any changes, redeploy the application

## Common Issues & Solutions

### Issue 1: Signature Validation Failing
- **Symptom**: Webhook logs show "signature_failed"
- **Cause**: URL mismatch or wrong auth token
- **Fix**: Ensure Twilio webhook URL exactly matches your domain (including https://)

### Issue 2: No Webhook Attempts
- **Symptom**: No entries in webhook_logs table
- **Cause**: Twilio sending to wrong URL
- **Fix**: Update webhook URL in Twilio

### Issue 3: Customer Creation Failing
- **Symptom**: Webhook succeeds but no message appears
- **Cause**: Phone number format issues
- **Fix**: Check if customer exists with that phone number

## Debugging Commands

Test webhook manually with curl:
```bash
curl -X POST https://management.orangejelly.co.uk/api/webhooks/twilio-unsecured \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+447999999999&To=+447700106752&Body=Test message"
```

## What Should Happen

When working correctly:
1. SMS sent to Twilio number
2. Twilio POSTs to your webhook
3. Webhook creates/finds customer
4. Message saved to database
5. Message appears in /messages instantly
6. Webhook log shows "success" status