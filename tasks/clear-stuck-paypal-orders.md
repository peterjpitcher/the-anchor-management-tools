# Clear Stuck PayPal Deposit Orders

Use after deploying the PayPal reconciliation retry fix.

Dry-run inspection:

```bash
tsx scripts/clear-stuck-paypal-orders.ts
```

Clear unpaid bookings for PayPal orders that still fail lookup:

```bash
tsx scripts/clear-stuck-paypal-orders.ts --confirm
```

The script only clears `private_bookings.paypal_deposit_order_id` for rows where `deposit_paid_date IS NULL`. If PayPal returns order details successfully, the script prints the order and leaves the booking unchanged.
