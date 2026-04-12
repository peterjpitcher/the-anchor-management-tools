**Ground Truth**

- `editDepositSchema` in [privateBookingActions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/privateBookingActions.ts:81) is:
  - `bookingId: z.string().uuid()`
  - `type: z.literal('deposit')`
  - `amount: z.string().refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, { message: 'Amount must be greater than £0' })`
  - `method: z.enum(['cash', 'card', 'invoice'])`
  - It does **not** include `paymentId`, `notes`, or `paypal`. The deposit branch of `editPrivateBookingPayment` only parses `bookingId`, `type`, `amount`, and `method` in [privateBookingActions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/privateBookingActions.ts:1792).

- `updateDeposit` in [payments.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/payments.ts:578) updates **both** fields on `private_bookings`:
  - `deposit_amount = data.amount`
  - `deposit_payment_method = data.method`
  - It does **not** touch `deposit_paid_date`.
  - It has no status guard, no `deposit_paid_date` guard, and no row-count check.

- `deposit_payment_method` for unpaid deposits is nullable in the DB type: [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:7559). New booking creation does **not** insert that column at all in the current RPC insert list: [mutations.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/mutations.ts:194), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:18545). `deleteDeposit` explicitly clears it back to `null` in [payments.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/payments.ts:591). So a normal unpaid deposit starts with `NULL`; calling `updateDeposit` would stamp it to `cash|card|invoice` before payment.

- `canManageDeposits` is derived in the page server component as `actions.has('manage_deposits') || actions.has('manage')` in [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/private-bookings/[id]/page.tsx:46), then passed through props to the client in [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/private-bookings/[id]/page.tsx:98). Separately, `canEditPayments` is `actions.has('manage')` only in [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/private-bookings/[id]/page.tsx:56).

- The current deposit card on the detail page has **no inline edit UI**. It shows the amount and, when unpaid, only the action buttons for `Record Payment`, `Pay via PayPal`, and `Send payment link` under this guard: `!booking.deposit_paid_date && (booking.status === 'draft' || booking.status === 'confirmed') && canManageDeposits` in [PrivateBookingDetailClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:2330).

- `PaymentHistoryTable`’s inline edit pattern in [PaymentHistoryTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx:33) uses:
  - State: `editingId`, `editValues { amount, method }`, `savingId`, `deletingId`, `confirmDeleteId`, `error`
  - Handlers: `startEdit`, `cancelEdit`, `handleSave`, `handleDeleteConfirm`
  - UI: number `Input`, method `Select`, save `Button` with `CheckIcon`, cancel `Button` with `XMarkIcon`, plus delete via `ConfirmDialog`
  - Save path: builds `FormData` with `paymentId`, `bookingId`, `type`, `amount`, `method`, calls `editPrivateBookingPayment`, then `toast` + `router.refresh()` in [PaymentHistoryTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx:71)

- Relevant types in [private-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/private-bookings.ts:1):
  - `PaymentMethod = 'cash' | 'card' | 'invoice' | 'paypal'`
  - Booking fields: `deposit_amount: number`, `deposit_paid_date?: string`, `deposit_payment_method?: PaymentMethod` in [private-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/private-bookings.ts:65)
  - `PaymentHistoryEntry` deposit row shape is `id: 'deposit'`, `type: 'deposit'`, `amount: number`, `method: 'cash' | 'card' | 'invoice' | 'paypal'`, `date: string` in [private-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/private-bookings.ts:305)

**Constraints / Guards**

- Unpaid deposits do not appear in payment history. `getBookingPaymentHistory` only pushes a deposit entry if `booking.deposit_paid_date` exists in [payments.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/payments.ts:478). So the existing inline-edit table pattern is only available after a deposit is marked paid.

- The shared edit action is gated by `checkUserPermission('private_bookings', 'manage', user.id)` in [privateBookingActions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/privateBookingActions.ts:1739), not `manage_deposits`. That means a user with `manage_deposits` but without full `manage` would satisfy `canManageDeposits` on the page but still get `Forbidden` from `editPrivateBookingPayment`.

- The spec’s note that the action expects `paymentId` for deposits is not how the current deposit branch works. `paymentId` is only part of the balance schema. In the table, deposit edits send `paymentId = 'deposit'` because the deposit history entry id is the literal `'deposit'`, and the deposit branch ignores it.

- PayPal is a mismatch today:
  - Types/history allow deposit method `'paypal'` in [private-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/private-bookings.ts:305)
  - `PaymentHistoryTable` treats PayPal deposits as read-only method UI in edit mode in [PaymentHistoryTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx:184)
  - But `editDepositSchema` rejects `'paypal'`, so saving an edited PayPal deposit through this action path will fail validation.