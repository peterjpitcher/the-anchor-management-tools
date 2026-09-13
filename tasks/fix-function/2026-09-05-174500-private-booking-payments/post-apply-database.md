# Post-apply database verification

Verified read-only at 2026-09-05 19:31 UTC against production Supabase project `tfcasgxopxegwrabvwat`.

The owner-approved migrations are present in production history:

| Local file | Applied version | SHA-256 |
|---|---|---|
| `20260905180000_private_booking_invoice_settlement.sql` | `20260905192946` | `791277922fb5d15b22ed9067d190f81a2716d24babd676ca51720a0536409a79` |
| `20260905180100_reconcile_verified_private_booking_capture.sql` | `20260905192951` | `5e97ab0ac17bd19f9d2d43d81ae9b322211a5441c3b73090ea22cdd8f0d3cbb0` |

Both release-worktree files still have these approved checksums. Neither approved SQL file was edited during verification.

## Catalogue comparison

All 21 created or replaced function bodies match the exact approved SQL bodies. The comparison used MD5 of the source body solely as a byte-for-byte equality check, not as a security checksum. Every function's language, SECURITY DEFINER property, volatility, argument names/types/defaults, return shape and search path matches the approved definition. The cancellation function retains its approved `search_path=public`; the other 20 use `public, pg_catalog`.

All 21 deny EXECUTE to `anon` and PUBLIC. All permit `service_role`. Only the three explicitly intended functions permit `authenticated`: the two permission-checked booking read wrappers and the permission-checked manual invoice payment RPC. The internal row helper, trusted capture overloads, balance writer, refund/cancellation RPCs and trigger functions remain restricted.

| Function | Authenticated EXECUTE | Approved body |
|---|---|---|
| `after_invoice_payment_settlement()` | No | Matches |
| `after_private_booking_invoice_link()` | No | Matches |
| `apply_balance_payment_status(uuid)` | No | Matches |
| `calculate_private_booking_balance(uuid)` | Yes | Matches |
| `cancel_private_booking_invoice_atomic(uuid,text,uuid)` | No | Matches |
| `get_private_booking_settlement_total(uuid)` | Yes | Matches |
| `guard_invoice_payment_settlement()` | No | Matches |
| `guard_linked_booking_item_prices()` | No | Matches |
| `guard_linked_invoice_item_prices()` | No | Matches |
| `guard_linked_invoice_money()` | No | Matches |
| `guard_private_booking_invoice_money()` | No | Matches |
| `guard_private_booking_payment_settlement()` | No | Matches |
| `lock_invoice_settlement(uuid)` | No | Matches |
| `private_booking_settlement_rows(uuid)` | No | Matches |
| `recalculate_invoice_settlement(uuid)` | No | Matches |
| `record_balance_payment(uuid,numeric,text,uuid)` | No | Matches |
| `record_invoice_payment_transaction(jsonb)` | Yes | Matches |
| `record_invoice_paypal_payment_atomic(uuid,numeric,text,text)` | No | Matches |
| `record_invoice_paypal_payment_atomic(uuid,numeric,text,text,timestamp with time zone)` | No | Matches |
| `reserve_refund_balance(text,uuid,numeric,numeric,text,text,uuid,text,uuid)` | No | Matches |
| `sync_private_booking_payment_settlement()` | No | Matches |

The original four-argument PayPal RPC retains its optional order argument. The five-argument overload has no defaults, avoiding ambiguous overload resolution. Both return `jsonb`. The settlement row helper and refund reservation function retain their declared TABLE return types.

All nine installed triggers are enabled (`tgenabled=O`). Their table, timing, events, row level, target function and conditional expression match the approved SQL:

- `invoice_payment_settlement_changed` on `invoice_payments`.
- `invoice_payment_settlement_guard` on `invoice_payments`.
- `linked_booking_item_prices_guard` on `private_booking_items`.
- `linked_invoice_item_prices_guard` on `invoice_line_items`.
- `linked_invoice_money_guard` on `invoices`.
- `private_booking_invoice_link_changed` on `private_bookings`.
- `private_booking_invoice_money_guard` on `private_bookings`.
- `private_booking_payment_settlement_changed` on `private_booking_payments`.
- `private_booking_payment_settlement_guard` on `private_booking_payments`.

Both replacement invoice-payment CHECKs are validated. Their permitted values exactly match the approved method list (including `paypal`) and source-kind list (`booking_payment`, `booking_deposit`, `paypal`).

The detail view retains `security_invoker=on`, its existing columns/order and grants. Its total paid and payment status use `get_private_booking_settlement_total`; its remaining balance uses `calculate_private_booking_balance`. Anonymous SELECT is denied; authenticated and service-role SELECT remain permitted. The four existing unique indexes for invoice links, copied booking payments, applied deposits and PayPal capture identity are present with their original predicates.

No unexpected drift was found in the objects covered by these migrations.

## Production read-only smoke results

Executed inside `BEGIN READ ONLY` with `SET LOCAL ROLE service_role` and the service-role JWT claim. These were SELECT calls only:

| Check | Observed result |
|---|---|
| Effective database role | `service_role` |
| Booking balance calculation | 0 |
| Booking settlement total | 994.80 |
| Settlement rows | 250.00 applied deposit and 744.80 PayPal payment |
| Detail-view total paid | 994.80 |
| Detail-view remaining balance | 0 |
| Detail-view payment status | `Fully Paid` |
| Invoice total and paid amount | 994.80 and 994.80 |
| Invoice status | `paid` |
| Invoice pending PayPal order | NULL |
| Booking final payment method | `paypal` |
| Booking final payment date | 4 September 2026 in Europe/London |

The stored final payment timestamp is `2026-09-03T23:00:00Z`, which is midnight on 4 September in London. This is the invoice payment's business date, not the later reconciliation date.

Production role-denial checks also ran in read-only transactions:

- As `anon`, calling the booking balance read returned SQLSTATE `42501`: `permission denied for function calculate_private_booking_balance`.
- As `anon`, selecting the detail view returned SQLSTATE `42501`: `permission denied for view private_bookings_with_details`.
- As `authenticated` without a user identity, the settlement-total wrapper returned SQLSTATE `42501`: `permission_denied: private_bookings.view`.

These expected access-denied responses are passing negative checks. No grants were changed to bypass them.

## Scope and remaining verification

No production INSERT, UPDATE, DELETE, DDL, payment, refund, message or mutating function call was run during this verification. Mutating trigger/RPC behaviour was already exercised in the isolated PostgreSQL harness before approval; it was not replayed against customer records.

Database verification is complete for the applied migrations and repaired record. Deployment, generated TypeScript types and actual browser verification remain with the main agent. This report does not claim that the application deployment or browser path has been verified.

Status: applied in production, database verified. Migration versions `20260905192946` and `20260905192951`. No database migration remains pending in this approved pair.

