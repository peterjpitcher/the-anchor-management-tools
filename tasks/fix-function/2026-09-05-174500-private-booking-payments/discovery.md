# Verified evidence

All production investigation was read-only. Target: the-anchor-management-tools, Supabase tfcasgxopxegwrabvwat. The production deployment observed was dpl_ExxtHAPe8Z6pM8fYBKDfP46wprUA. No deployment was performed.

Kim Renyard booking c28527fe-a373-460d-85a8-e509b78d6eba links to invoice 8a590bb4-487b-4522-929b-b5c6c3f81071 (INV-003WK). The gross invoice is £994.80. Its existing £250 booking deposit is explicitly applied by invoice_deposit_treatment=deducted.

PayPal live order 1NX08920NB808283W and capture 62921439S0526370F are COMPLETED, GBP744.80, captured 2026-09-04T13:38:30Z. Both order reference_id and custom_id match this invoice. This is received money, not a request to charge the customer again.

The database records only the £250 deposit on the invoice and no balance payment on the booking. Both invoice payment CHECK constraints reject paypal. Vercel reconciliation logs show the payment_method CHECK error repeatedly. The webhook claimed success despite failing to write the capture. Of the two linked private booking invoices, Kim was the only one with a pending invoice PayPal order reference; no invoice PayPal capture rows existed.

Actual authenticated local browser checks against current live records: booking shows Deposit applied to invoice, £250 of £994.80 paid, £744.80 outstanding, and no separate deposit refund button. Invoice shows £250 paid and £744.80 outstanding. Both pages report no browser warning/error logs. Their remaining balance is expected until the separately approved data repair runs. Zero outstanding was exercised in isolated PostgreSQL and component tests, not asserted from an unmodified production browser.
