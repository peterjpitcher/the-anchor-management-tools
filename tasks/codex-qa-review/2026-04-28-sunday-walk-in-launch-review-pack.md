# Review Pack: sunday-walk-in-launch

**Generated:** 2026-04-28
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`
**Base ref:** `main`
**HEAD:** `663d479e`
**Diff range:** `main...HEAD`
**Stats:**  26 files changed, 2078 insertions(+), 113 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
scripts/one-off/2026-04-28-sunday-hours-13-18.sql
src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx
src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx
src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts
src/app/api/boh/table-bookings/[id]/party-size/route.ts
src/app/api/business/hours/route.ts
src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts
src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts
src/app/api/foh/bookings/route.ts
src/app/api/stripe/webhook/route.ts
src/app/api/table-bookings/route.ts
src/app/g/[token]/table-payment/page.tsx
src/lib/table-bookings/bookings.ts
src/lib/table-bookings/deposit.ts
src/lib/table-bookings/sunday-preorder.ts
src/tests/api/foh/deposit-waiver.test.ts
supabase/migrations/20260509000014_add_deposit_amount_locked.sql
supabase/migrations/20260509000015_patch_v05_threshold_and_cutoff.sql
supabase/migrations/20260509000016_patch_v05_core_threshold.sql
tests/api/legacy-payment-link.test.ts
tests/api/paypalCaptureOrderTableBooking.test.ts
tests/api/paypalCreateOrderTableBooking.test.ts
tests/api/stripeWebhookMutationGuards.test.ts
tests/api/tableBookingStructuredPersistence.test.ts
tests/lib/table-bookings/deposit.test.ts
tests/lib/tableCheckoutSessionExpiry.test.ts
```

## User Concerns

RPC patches verbatim-copy from existing migrations; Migration A backfill correctness; deposit_amount_locked written at every capture surface (PayPal capture, Stripe checkout.session.completed, cash record_table_cash_deposit_v05, token-payment); PayPal capture-order fail-closed when amount missing; canonical deposit precedence (locked > stored > computed); legacy admin paths preserved

## Diff (`main...HEAD`)

```diff
diff --git a/scripts/one-off/2026-04-28-sunday-hours-13-18.sql b/scripts/one-off/2026-04-28-sunday-hours-13-18.sql
new file mode 100644
index 00000000..801f4cab
--- /dev/null
+++ b/scripts/one-off/2026-04-28-sunday-hours-13-18.sql
@@ -0,0 +1,64 @@
+-- 2026-04-28 — Sunday service window: 12:00–17:00 → 13:00–18:00
+--
+-- Spec: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md §6, §8.3
+-- Plan: docs/superpowers/plans/2026-04-28-sunday-walk-in-launch.md Task 4.4
+--
+-- Context: the Sunday-walk-in launch moves the kitchen window from 12:00–17:00
+-- to 13:00–18:00 to align with new service patterns. Last bookable arrival is
+-- 17:30 so the kitchen has 30 min to plate (slot logic enforces this — separate
+-- from the kitchen window stored here).
+--
+-- Why this lives in scripts/one-off/ (not supabase/migrations/):
+-- Wave 2 of the rollout is local-only. Peter applies this update during the
+-- staged deploy window. Once executed, capture the UPDATE inside a tracked
+-- migration so a fresh `npx supabase db push` reproduces the change.
+--
+-- POST-DEPLOY VERIFICATION (Spec §8.3 Task 4.5):
+-- SELECT day_of_week, kitchen_opens, kitchen_closes, schedule_config
+-- FROM public.business_hours WHERE day_of_week = 0;
+-- Expected: kitchen_opens=13:00:00, kitchen_closes=18:00:00, schedule_config
+--           contains a single Sunday entry with starts_at=13:00:00 and
+--           ends_at=18:00:00.
+--
+-- If this needs to be rolled back: re-run with the legacy values
+-- (kitchen_opens=12:00:00, kitchen_closes=17:00:00, schedule_config window
+-- 12:00:00–17:00:00).
+
+BEGIN;
+
+UPDATE public.business_hours
+SET
+  -- Generic kitchen window. New public bookings use booking_type='regular' for
+  -- both food and drinks; the legacy 'sunday_lunch' booking_type is reserved
+  -- for back-fill of historical records only.
+  schedule_config = '[
+    {
+      "starts_at": "13:00:00",
+      "ends_at": "18:00:00",
+      "capacity": 50,
+      "booking_type": "food",
+      "slot_type": "sunday_food"
+    }
+  ]'::jsonb,
+  kitchen_opens = '13:00:00',
+  kitchen_closes = '18:00:00'
+WHERE
+  day_of_week = 0;
+
+-- Sanity: confirm exactly one row was updated. If 0, the table layout has
+-- diverged from spec assumptions and the deployer should investigate before
+-- committing.
+DO $$
+DECLARE
+  v_count integer;
+BEGIN
+  SELECT COUNT(*) INTO v_count
+  FROM public.business_hours
+  WHERE day_of_week = 0;
+  IF v_count <> 1 THEN
+    RAISE EXCEPTION 'Expected exactly 1 Sunday business_hours row, found %', v_count;
+  END IF;
+END;
+$$;
+
+COMMIT;
diff --git a/src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx b/src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx
index 06595968..59a9b3a0 100644
--- a/src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx
+++ b/src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx
@@ -51,6 +51,19 @@ function formatLondonDateTime(iso: string): string {
   }).format(new Date(iso))
 }
 
+/**
+ * Extract legacy pre-order text from a `special_requirements` string. Public-
+ * API legacy Sunday-lunch bookings ship the pre-order as free text such as
+ * 'Sunday lunch pre-order: Guest 1: Roasted Chicken x1'. Returns null if no
+ * marker is present. Spec §8.3.
+ */
+function extractLegacyPreorderText(specialRequirements: string | null | undefined): string | null {
+  if (!specialRequirements) return null
+  const marker = /sunday lunch pre-?order/i
+  if (!marker.test(specialRequirements)) return null
+  return specialRequirements.trim()
+}
+
 export default function PreorderTab({ booking, canEdit }: Props) {
   const [data, setData] = useState<PreorderData | null>(null)
   const [loading, setLoading] = useState(true)
@@ -77,6 +90,29 @@ export default function PreorderTab({ booking, canEdit }: Props) {
   if (loading) return <p className="text-sm text-gray-500">Loading pre-order&hellip;</p>
 
   if (!data || data.state === 'blocked') {
+    // Public-API legacy bookings can ship pre-order text in
+    // `special_requirements` rather than as structured `table_booking_items`
+    // rows (e.g. 'Sunday lunch pre-order: Guest 1: Roasted Chicken x1'). If
+    // the structured API returns blocked but the booking has that legacy
+    // text, surface it so kitchen can still see the pre-order. Spec §8.3.
+    const legacyPreorderText = extractLegacyPreorderText(booking.special_requirements)
+    if (legacyPreorderText) {
+      return (
+        <div className="space-y-2 max-w-2xl">
+          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
+            Legacy pre-order (from special requirements)
+          </p>
+          <pre className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-gray-800">
+            {legacyPreorderText}
+          </pre>
+          {data?.reason ? (
+            <p className="text-xs text-gray-500 italic">
+              Structured pre-order data unavailable ({data.reason}); showing free-text from booking notes.
+            </p>
+          ) : null}
+        </div>
+      )
+    }
     return (
       <p className="text-sm text-gray-500">
         Pre-order not available{data?.reason ? `: ${data.reason}` : ''}
diff --git a/src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx b/src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx
index 6012fc1f..738fa5b8 100644
--- a/src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx
+++ b/src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx
@@ -395,6 +395,14 @@ export const FohCreateBookingModal = React.memo(function FohCreateBookingModal(p
 
           {createMode !== 'walk_in' && createMode !== 'management' && createForm.purpose !== 'event' && (
             <div className="space-y-2 md:col-span-2">
+              {/*
+                Legacy Sunday-lunch toggle (Spec §8.3): kept for staff-explicit
+                legacy data entry only. New public bookings never set this. The
+                deposit-required decision is now driven by the centralised 10+
+                rule and is independent of this toggle. Disabled by default;
+                staff who genuinely need to back-fill a legacy Sunday-lunch
+                booking can enable it via the input itself if required.
+              */}
               <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                 <input
                   type="checkbox"
@@ -407,9 +415,10 @@ export const FohCreateBookingModal = React.memo(function FohCreateBookingModal(p
                       sunday_preorder_mode: event.target.checked ? current.sunday_preorder_mode : 'send_link'
                     }))
                   }
-                  disabled={!sundaySelected}
+                  disabled
+                  title="Legacy admin-only — new public bookings never use this. Deposit decision is independent of this toggle."
                 />
-                <span>Sunday lunch</span>
+                <span>Legacy Sunday lunch (admin)</span>
               </label>
 
               <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
@@ -644,7 +653,7 @@ export const FohCreateBookingModal = React.memo(function FohCreateBookingModal(p
             {createMode === 'walk_in'
               ? 'Walk-ins require covers. Guest name and phone are optional.'
               : createForm.purpose !== 'event'
-              ? 'Sunday lunch and bookings of 7+ people require a GBP 10 per person deposit.'
+              ? 'Bookings of 10 or more people require a GBP 10 per person deposit.'
               : 'Event booking status depends on event payment mode and capacity.'}
           </p>
           <div className="flex items-center gap-2">
diff --git a/src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts b/src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts
index ecb40a1c..0a2e025b 100644
--- a/src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts
+++ b/src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts
@@ -23,6 +23,7 @@ import {
   suggestWalkInTime,
 } from '../utils'
 import type { FohCreateBookingResponse, FohCreateEventBookingResponse } from '../types'
+import { requiresDeposit as requiresDepositForParty } from '@/lib/table-bookings/deposit'
 
 export type UseFohCreateBookingReturn = {
   isCreateModalOpen: boolean
@@ -226,10 +227,13 @@ export function useFohCreateBooking(input: {
   }, [date, isCreateModalOpen])
 
   // --- Overlapping event prompt acknowledgement guard ---
-  const sundaySelected = isSundayDate(createForm.booking_date)
+  // Deposit-required decision uses the centralised 10+ rule. Legacy
+  // sunday_lunch toggle no longer drives this. Spec §8.3.
   const formRequiresDeposit =
-    createMode !== 'management' && !createForm.is_venue_event &&
-    ((createForm.sunday_lunch && sundaySelected) || (createMode !== 'walk_in' && Number(createForm.party_size) >= 7))
+    createMode !== 'management' && !createForm.is_venue_event && createMode !== 'walk_in' &&
+    requiresDepositForParty(Number(createForm.party_size) || 0, {
+      depositWaived: createForm.waive_deposit === true,
+    })
 
   const sundayMenuByCategory = useMemo(() => {
     return sundayMenuItems.reduce<Record<string, SundayMenuItem[]>>((acc, item) => {
@@ -425,8 +429,10 @@ export function useFohCreateBooking(input: {
       setErrorMessage('Please confirm whether this booking is for the overlapping event.'); return
     }
     const requiresDepositValidation =
-      (!isWalkIn && !isManagement && !createForm.waive_deposit && !createForm.is_venue_event) &&
-      ((createForm.sunday_lunch && sundaySelected) || partySize >= 7)
+      (!isWalkIn && !isManagement && !createForm.is_venue_event) &&
+      requiresDepositForParty(partySize, {
+        depositWaived: createForm.waive_deposit === true,
+      })
     if (requiresDepositValidation && !createForm.sunday_deposit_method) {
       setErrorMessage('Choose whether the deposit was taken in cash or should be sent by payment link.'); return
     }
@@ -453,7 +459,7 @@ export function useFohCreateBooking(input: {
           date: bookingDate, time: effectiveBookingTime, party_size: partySize,
           purpose: createForm.purpose === 'drinks' ? 'drinks' : 'food', notes: createForm.notes || undefined,
           sunday_lunch: isManagement ? undefined : createForm.sunday_lunch,
-          sunday_deposit_method: (!isWalkIn && !isManagement && !createForm.waive_deposit && !createForm.is_venue_event && (createForm.sunday_lunch || partySize >= 7)) ? createForm.sunday_deposit_method : undefined,
+          sunday_deposit_method: (!isWalkIn && !isManagement && !createForm.is_venue_event && requiresDepositForParty(partySize, { depositWaived: createForm.waive_deposit === true })) ? createForm.sunday_deposit_method : undefined,
           sunday_preorder_mode: (!isManagement && createForm.sunday_lunch) ? createForm.sunday_preorder_mode : undefined,
           sunday_preorder_items: (!isManagement && sundayPreorderItems.length > 0) ? sundayPreorderItems : undefined,
           waive_deposit: createForm.waive_deposit || undefined, is_venue_event: createForm.is_venue_event || undefined
diff --git a/src/app/api/boh/table-bookings/[id]/party-size/route.ts b/src/app/api/boh/table-bookings/[id]/party-size/route.ts
index c23357a3..874f5261 100644
--- a/src/app/api/boh/table-bookings/[id]/party-size/route.ts
+++ b/src/app/api/boh/table-bookings/[id]/party-size/route.ts
@@ -11,11 +11,17 @@ import { createGuestToken } from '@/lib/guest/tokens'
 import { sendSMS } from '@/lib/twilio'
 import { getSmartFirstName } from '@/lib/sms/bulk'
 import { ensureReplyInstruction } from '@/lib/sms/support'
+import {
+  getCanonicalDeposit,
+  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
+  requiresDeposit,
+} from '@/lib/table-bookings/deposit'
 
 const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
 
-const DEPOSIT_THRESHOLD = 7
-const DEPOSIT_PER_PERSON_GBP = 10
+// Threshold + per-person rate now live in the centralised deposit helper —
+// see src/lib/table-bookings/deposit.ts. Spec §7.3, §8.3.
+const DEPOSIT_PER_PERSON_GBP = LARGE_GROUP_DEPOSIT_PER_PERSON_GBP
 
 const UpdatePartySizeSchema = z.object({
   party_size: z.preprocess(
@@ -62,7 +68,7 @@ export async function POST(
 
   // Read current booking state before the update so we can detect threshold crossings
   const { data: currentBooking, error: fetchError } = await auth.supabase.from('table_bookings')
-    .select('id, party_size, status, payment_status, customer_id, booking_date, booking_reference, booking_type, start_datetime')
+    .select('id, party_size, status, payment_status, customer_id, booking_date, booking_reference, booking_type, start_datetime, deposit_amount, deposit_amount_locked, deposit_waived')
     .eq('id', id)
     .maybeSingle()
 
@@ -95,13 +101,28 @@ export async function POST(
 
     // ── Threshold crossing detection ──────────────────────────────────────────
 
-    const wasDepositRequired = previousPartySize >= DEPOSIT_THRESHOLD
-    const isNowDepositRequired = newPartySize >= DEPOSIT_THRESHOLD
+    const depositWaived = currentBooking.deposit_waived === true
+    const wasDepositRequired = requiresDeposit(previousPartySize, { depositWaived })
+    const isNowDepositRequired = requiresDeposit(newPartySize, { depositWaived })
     const depositAlreadyHandled = ['completed', 'refunded'].includes(currentPaymentStatus ?? '')
 
     // Case 1: Party increased past the deposit threshold — request deposit
     if (!wasDepositRequired && isNowDepositRequired && !depositAlreadyHandled) {
-      const depositAmount = newPartySize * DEPOSIT_PER_PERSON_GBP
+      // Read the canonical amount: locked > stored > computed. If a lock
+      // already exists (paid bookings), it stays — the SMS link will quote
+      // the locked amount. Otherwise compute from the new party size.
+      // Spec §3 step 9, §7.3, §7.4, §8.3.
+      const depositAmount = getCanonicalDeposit(
+        {
+          party_size: newPartySize,
+          deposit_amount: currentBooking.deposit_amount ?? null,
+          deposit_amount_locked: currentBooking.deposit_amount_locked ?? null,
+          status: currentBooking.status ?? null,
+          payment_status: currentBooking.payment_status ?? null,
+          deposit_waived: currentBooking.deposit_waived ?? null,
+        },
+        newPartySize,
+      )
       const depositLabel = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(depositAmount)
       const isSundayLunch = currentBooking.booking_type === 'sunday_lunch'
 
@@ -146,7 +167,14 @@ export async function POST(
             const seatWord = newPartySize === 1 ? 'person' : 'people'
             const depositKindLabel = isSundayLunch ? 'Sunday lunch deposit' : 'table deposit'
             const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
-            const smsBody = `The Anchor: Hi ${firstName}, your party size has been updated to ${newPartySize} ${seatWord}. A ${depositKindLabel} of ${depositLabel} (${newPartySize} x £${DEPOSIT_PER_PERSON_GBP}) is now required to secure your booking. Pay now: ${depositUrl}`
+            // Only include the (party_size × per-person) breakdown when the
+            // canonical amount actually matches that simple multiplication —
+            // for paid/locked bookings the breakdown could be misleading.
+            const expectedSimpleTotal = newPartySize * DEPOSIT_PER_PERSON_GBP
+            const breakdownNote = depositAmount === expectedSimpleTotal
+              ? ` (${newPartySize} x £${DEPOSIT_PER_PERSON_GBP})`
+              : ''
+            const smsBody = `The Anchor: Hi ${firstName}, your party size has been updated to ${newPartySize} ${seatWord}. A ${depositKindLabel} of ${depositLabel}${breakdownNote} is now required to secure your booking. Pay now: ${depositUrl}`
             await sendSMS(
               customer.mobile_number,
               ensureReplyInstruction(smsBody, supportPhone),
diff --git a/src/app/api/business/hours/route.ts b/src/app/api/business/hours/route.ts
index 46fa95dd..e2b02858 100644
--- a/src/app/api/business/hours/route.ts
+++ b/src/app/api/business/hours/route.ts
@@ -281,7 +281,16 @@ export async function GET(_request: NextRequest) {
   }
 
   const todayConfig = todayHoursData?.schedule_config || [];
-  const sundayLunchConfig = todayConfig.find((c: any) => c.booking_type === 'sunday_lunch');
+  // Sunday food window: post-launch (Spec §6, §8.3 Task 4.4) the
+  // schedule_config entry uses booking_type='food' (slot_type 'sunday_food').
+  // Legacy data still uses booking_type='sunday_lunch'. Accept either so the
+  // API keeps returning a usable Sunday window during the migration.
+  const sundayLunchConfig = todayConfig.find(
+    (c: any) =>
+      c.booking_type === 'sunday_lunch' ||
+      c.slot_type === 'sunday_food' ||
+      (currentDay === 0 && c.booking_type === 'food'),
+  );
 
   // Calculate service information
   const services = {
@@ -344,9 +353,12 @@ export async function GET(_request: NextRequest) {
     },
   };
 
-  // Sunday lunch info
-  let sundaySlots = ['12:00', '12:30', '13:00', '13:30', '14:00'];
-  let lastOrderTime = '14:00';
+  // Sunday food info — fallbacks reflect the new 13:00–18:00 service window
+  // (Spec §6, §8.3 Task 4.4). The DB-driven config above will overwrite these
+  // when present. Last seating is 1 hour before service ends, i.e. 17:00 for
+  // an 18:00 close.
+  let sundaySlots = ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'];
+  let lastOrderTime = '17:00';
 
   if (sundayLunchConfig && sundayLunchConfig.starts_at && sundayLunchConfig.ends_at) {
     const start = sundayLunchConfig.starts_at.substring(0, 5);
diff --git a/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts b/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts
index 94077648..e816aeb7 100644
--- a/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts
+++ b/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts
@@ -17,6 +17,24 @@ const CaptureOrderSchema = z.object({
   orderId: z.string().min(1),
 });
 
+/**
+ * Parse the captured GBP amount from a PayPal v2 capture response.
+ * Returns the GBP value as a finite number, or null when missing/unparseable.
+ *
+ * Caller MUST fail closed on null — silently falling back to
+ * `booking.deposit_amount` would let stale amounts get locked. Spec §6, §7.4, §8.3.
+ */
+function parseCapturedAmountGbp(
+  captureResult: { amount?: string | number | null } | null | undefined,
+): number | null {
+  if (!captureResult || captureResult.amount === undefined || captureResult.amount === null) {
+    return null;
+  }
+  const raw = captureResult.amount;
+  const n = typeof raw === 'number' ? raw : Number(raw);
+  return Number.isFinite(n) && n > 0 ? n : null;
+}
+
 export async function POST(
   request: NextRequest,
   { params }: { params: Promise<{ id: string }> },
@@ -87,7 +105,49 @@ export async function POST(
 
       const transactionId = captureResult.transactionId;
 
-      // Update the booking atomically
+      // Lock the actually-captured GBP amount on the booking — authoritative
+      // source for what the customer was charged. Fail closed if the capture
+      // response is missing/malformed: do NOT update payment_status, log a
+      // high-severity error, and return 502 so the customer sees an explicit
+      // "we couldn't confirm your payment" state. We deliberately do NOT
+      // fall back to booking.deposit_amount — that's how stale amounts get
+      // locked. Spec §6, §7.4, §8.3.
+      const lockedAmountGbp = parseCapturedAmountGbp(captureResult);
+      if (lockedAmountGbp === null) {
+        logger.error('paypal-capture: capture succeeded but no parseable GBP amount in response', {
+          metadata: {
+            bookingId,
+            orderId,
+            transactionId,
+            // Capture the raw amount value so on-call can investigate.
+            rawAmount: captureResult?.amount ?? null,
+            captureStatus: captureResult?.status ?? null,
+          },
+        });
+        void logAuditEvent({
+          operation_type: 'payment.capture_amount_unparseable',
+          resource_type: 'table_booking',
+          resource_id: bookingId,
+          operation_status: 'failure',
+          additional_info: {
+            orderId,
+            transactionId,
+            rawAmount: String(captureResult?.amount ?? 'null'),
+            action_needed:
+              'PayPal capture succeeded but the captured amount was missing or unparseable — manual reconciliation required before unlocking the booking',
+          },
+        });
+        return NextResponse.json(
+          {
+            error: 'Payment captured but amount could not be verified. Please contact support; do not retry.',
+          },
+          { status: 502 },
+        );
+      }
+
+      // Update the booking atomically — including deposit_amount_locked so
+      // any future recompute (party-size change, blind compute, etc.) honours
+      // the actually-captured amount.
       const { error: updateError } = await supabase
         .from('table_bookings')
         .update({
@@ -95,6 +155,7 @@ export async function POST(
           status: 'confirmed',
           payment_method: 'paypal',
           paypal_deposit_capture_id: transactionId,
+          deposit_amount_locked: lockedAmountGbp,
         })
         .eq('id', bookingId);
 
@@ -128,6 +189,7 @@ export async function POST(
           orderId,
           transactionId,
           bookingId,
+          lockedAmountGbp,
         },
       });
 
diff --git a/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts b/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts
index 61ebeea1..f43c4bc0 100644
--- a/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts
+++ b/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts
@@ -5,6 +5,7 @@ import { createAdminClient } from '@/lib/supabase/admin';
 import { createInlinePayPalOrder } from '@/lib/paypal';
 import { logAuditEvent } from '@/app/actions/audit';
 import { logger } from '@/lib/logger';
+import { getCanonicalDeposit } from '@/lib/table-bookings/deposit';
 
 export const dynamic = 'force-dynamic';
 
@@ -18,10 +19,12 @@ export async function POST(
     async () => {
       const supabase = createAdminClient();
 
-      // Fetch the booking
+      // Fetch the booking. We pull `deposit_amount_locked`, `deposit_waived`,
+      // and `booking_type` so the canonical-deposit reader can honour locked
+      // amounts and waivers. Spec §7.3, §8.3.
       const { data: booking, error: fetchError } = await supabase
         .from('table_bookings')
-        .select('id, party_size, status, payment_status, paypal_deposit_order_id, deposit_amount')
+        .select('id, party_size, status, payment_status, paypal_deposit_order_id, deposit_amount, deposit_amount_locked, deposit_waived, booking_type')
         .eq('id', bookingId)
         .single();
 
@@ -59,8 +62,27 @@ export async function POST(
         return NextResponse.json({ orderId: booking.paypal_deposit_order_id });
       }
 
-      // Calculate amount server-side — never trust client
-      const depositAmount = booking.party_size * 10;
+      // Read canonical deposit (locked > stored > computed). This stops
+      // blind party_size * 10 recompute and honours
+      // `deposit_amount_locked` for paid/refunded bookings. Spec §3 step 9,
+      // §7.3, §7.4, §8.3.
+      const depositAmount = getCanonicalDeposit(
+        {
+          party_size: booking.party_size,
+          deposit_amount: booking.deposit_amount ?? null,
+          deposit_amount_locked: booking.deposit_amount_locked ?? null,
+          status: booking.status ?? null,
+          payment_status: booking.payment_status ?? null,
+          deposit_waived: booking.deposit_waived ?? null,
+        },
+        booking.party_size,
+      );
+      if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
+        return NextResponse.json(
+          { error: 'No deposit required for this booking.' },
+          { status: 400 },
+        );
+      }
 
       let paypalOrder: { orderId: string };
       try {
@@ -79,12 +101,13 @@ export async function POST(
         );
       }
 
-      // Persist the order ID and deposit amount on the booking
+      // Persist the order ID. Deliberately NOT writing deposit_amount here —
+      // the canonical reader is the source of truth and `deposit_amount_locked`
+      // is set by the capture path on successful payment. Spec §7.3, §7.4, §8.3.
       const { error: persistError } = await supabase
         .from('table_bookings')
         .update({
           paypal_deposit_order_id: paypalOrder.orderId,
-          deposit_amount: depositAmount,
         })
         .eq('id', bookingId);
 
diff --git a/src/app/api/foh/bookings/route.ts b/src/app/api/foh/bookings/route.ts
index 1b97aa62..972326c5 100644
--- a/src/app/api/foh/bookings/route.ts
+++ b/src/app/api/foh/bookings/route.ts
@@ -19,6 +19,10 @@ import {
   type TableBookingRpcResult
 } from '@/lib/table-bookings/bookings'
 import { saveSundayPreorderByBookingId } from '@/lib/table-bookings/sunday-preorder'
+import {
+  computeDepositAmount,
+  requiresDeposit as requiresDepositForParty,
+} from '@/lib/table-bookings/deposit'
 
 const STRICT_SUNDAY_LUNCH_OPERATOR_EMAIL = 'manager@the-anchor.pub'
 
@@ -85,12 +89,15 @@ const CreateFohTableBookingSchema = z.object({
     }
   }
 
-  // Deposit not required for management overrides, deposit waivers, or venue events — they bypass deposit restrictions
+  // Deposit not required for management overrides, deposit waivers, or venue events — they bypass deposit restrictions.
+  // The deposit threshold is the centralised 10+ rule; legacy `sunday_lunch` flag is kept for admin-only legacy
+  // creation but no longer drives the deposit-required decision. Spec §8.3.
   if (
     value.management_override !== true &&
     value.waive_deposit !== true &&
     value.is_venue_event !== true &&
-    (value.sunday_lunch === true || (value.party_size != null && value.party_size >= 7)) &&
+    value.party_size != null &&
+    requiresDepositForParty(value.party_size) &&
     value.sunday_deposit_method == null
   ) {
     context.addIssue({
@@ -1049,7 +1056,13 @@ export async function POST(request: NextRequest) {
     )
   }
 
-  const requiresDeposit = (effectiveSundayLunch || payload.party_size >= 7) && payload.waive_deposit !== true && payload.is_venue_event !== true
+  // Deposit-required decision uses the centralised 10+ rule with explicit
+  // waiver support. `effectiveSundayLunch` is retained ONLY for the legacy
+  // admin-creation path (RPC payload + post-create persistence); the deposit
+  // decision is now generic and unaware of booking_type. Spec §8.3.
+  const requiresDeposit = requiresDepositForParty(payload.party_size, {
+    depositWaived: payload.waive_deposit === true,
+  }) && payload.is_venue_event !== true
   const depositMethod = requiresDeposit
     ? payload.sunday_deposit_method || null
     : null
@@ -1180,9 +1193,17 @@ export async function POST(request: NextRequest) {
       bookingResult.table_booking_id &&
       depositMethod === 'cash'
     ) {
+      // Staff-confirmed cash deposit. Amount derived from the centralised
+      // helper so the per-person rate + threshold stay in one place. The RPC
+      // records the cash payment; we then lock the staff-confirmed amount on
+      // the booking row so any subsequent recompute (party-size change, blind
+      // compute) honours what was actually taken. Spec §6, §7.4, §8.3.
+      const cashDepositAmount = Number(
+        computeDepositAmount(Math.max(1, Number(payload.party_size || 1))).toFixed(2),
+      )
       const { data: cashConfirmRaw, error: cashConfirmError } = await auth.supabase.rpc('record_table_cash_deposit_v05', {
         p_table_booking_id: bookingResult.table_booking_id,
-        p_amount: Number((Math.max(1, Number(payload.party_size || 1)) * 10).toFixed(2)),
+        p_amount: cashDepositAmount,
         p_currency: 'GBP',
       })
 
@@ -1221,6 +1242,25 @@ export async function POST(request: NextRequest) {
         )
       }
 
+      // Lock the staff-confirmed cash amount on the booking row. The RPC
+      // updates payments + sets payment_status='completed' but does NOT touch
+      // deposit_amount_locked, so we write it here. Failure to lock is logged
+      // but does not block — the booking is already confirmed by the RPC.
+      // Spec §6, §7.4, §8.3.
+      const { error: cashLockError } = await auth.supabase
+        .from('table_bookings')
+        .update({ deposit_amount_locked: cashDepositAmount })
+        .eq('id', bookingResult.table_booking_id)
+      if (cashLockError) {
+        logger.error('Failed to lock cash deposit amount on booking', {
+          error: new Error(cashLockError.message),
+          metadata: {
+            tableBookingId: bookingResult.table_booking_id,
+            cashDepositAmount,
+          },
+        })
+      }
+
       bookingResult = {
         ...bookingResult,
         state: 'confirmed',
diff --git a/src/app/api/stripe/webhook/route.ts b/src/app/api/stripe/webhook/route.ts
index 2de1f5e2..92862066 100644
--- a/src/app/api/stripe/webhook/route.ts
+++ b/src/app/api/stripe/webhook/route.ts
@@ -492,6 +492,36 @@ async function handleCheckoutSessionCompleted(
     const rpcResult = (rpcResultRaw ?? {}) as TableDepositCompletedResult
 
     if (rpcResult.state === 'confirmed' && rpcResult.table_booking_id && rpcResult.customer_id) {
+      // Lock the actually-captured GBP amount from the Stripe session. Authoritative.
+      // Fail-closed: if `amount_total` is null/unparseable, log + skip the lock
+      // write rather than guess. We deliberately do NOT fall back to
+      // booking.deposit_amount — that's how stale amounts get locked.
+      // Spec §6, §7.4, §8.3.
+      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
+        const { error: lockError } = await supabase
+          .from('table_bookings')
+          .update({ deposit_amount_locked: amount })
+          .eq('id', rpcResult.table_booking_id)
+        if (lockError) {
+          logger.error('stripe-webhook: failed to lock deposit amount on table booking', {
+            error: new Error(lockError.message),
+            metadata: {
+              tableBookingId: rpcResult.table_booking_id,
+              checkoutSessionId,
+              amount,
+            },
+          })
+        }
+      } else {
+        logger.error('stripe-webhook: missing/invalid amount_total — skipping deposit_amount_locked write', {
+          metadata: {
+            tableBookingId: rpcResult.table_booking_id,
+            checkoutSessionId,
+            rawAmount: amount,
+          },
+        })
+      }
+
       const [analyticsOutcome, smsOutcome] = await Promise.allSettled([
         recordAnalyticsEventSafe(supabase, {
           customerId: rpcResult.customer_id,
diff --git a/src/app/api/table-bookings/route.ts b/src/app/api/table-bookings/route.ts
index f10c8467..5ca3848d 100644
--- a/src/app/api/table-bookings/route.ts
+++ b/src/app/api/table-bookings/route.ts
@@ -24,7 +24,7 @@ import {
   sendTableBookingCreatedSmsIfAllowed,
   type TableBookingRpcResult
 } from '@/lib/table-bookings/bookings'
-import { saveSundayPreorderByBookingId } from '@/lib/table-bookings/sunday-preorder'
+import { computeDepositAmount } from '@/lib/table-bookings/deposit'
 import { logAuditEvent } from '@/app/actions/audit'
 import { logger } from '@/lib/logger'
 import { verifyTurnstileToken, getClientIp } from '@/lib/turnstile'
@@ -87,6 +87,7 @@ type TableBookingResponseData = {
   table_name: string | null
   booking_id: string | null
   deposit_amount: number | null
+  fallback_payment_url: string | null
 }
 
 function isAssignmentConflictRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
@@ -244,7 +245,9 @@ export async function POST(request: NextRequest) {
         p_party_size: payload.party_size,
         p_booking_purpose: payload.purpose,
         p_notes: payload.notes || null,
-        p_sunday_lunch: payload.sunday_lunch === true,
+        // Sunday-lunch flag is legacy — new public bookings never set this. The
+        // FOH admin path retains it for legacy data entry only. Spec §8.3.
+        p_sunday_lunch: false,
         p_source: 'brand_site'
       })
 
@@ -300,34 +303,11 @@ export async function POST(request: NextRequest) {
         }
       }
 
-      // Persist Sunday lunch pre-order line items in the dedicated table so the
-      // admin pre-order tab, kitchen prep sheet, and analytics see structured
-      // data instead of parsing a free-text notes blob. Best-effort: items still
-      // survive in the notes field if this fails, so the kitchen isn't blind.
-      if (
-        bookingResult.table_booking_id &&
-        payload.sunday_lunch === true &&
-        (payload.sunday_preorder_items?.length ?? 0) > 0
-      ) {
-        try {
-          await saveSundayPreorderByBookingId(supabase, {
-            bookingId: bookingResult.table_booking_id,
-            items: payload.sunday_preorder_items!,
-            staffOverride: true,
-          })
-        } catch (preorderError) {
-          logger.warn('Failed to persist Sunday preorder items for website booking', {
-            metadata: {
-              tableBookingId: bookingResult.table_booking_id,
-              itemCount: payload.sunday_preorder_items?.length ?? 0,
-              error:
-                preorderError instanceof Error
-                  ? preorderError.message
-                  : String(preorderError),
-            },
-          })
-        }
-      }
+      // Sunday lunch pre-order persistence has been removed from the public
+      // booking path. New public bookings never use the legacy `sunday_lunch`
+      // booking_type, so persisting pre-order line items here is no longer
+      // valid. The legacy admin FOH path retains `saveSundayPreorderByBookingId`
+      // for staff-explicit legacy Sunday-lunch creation. Spec §8.3.
 
       const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
 
@@ -468,6 +448,11 @@ export async function POST(request: NextRequest) {
         ]
 
         if (bookingResult.state === 'pending_payment') {
+          // Compute deposit via the centralised helper instead of inline
+          // `party_size * 10` arithmetic — keeps the threshold and rate in one
+          // place. The booking is fresh from the RPC so there is no prior
+          // locked/stored amount to honour here. Spec §3 step 9, §8.3.
+          const analyticsDeposit = computeDepositAmount(payload.party_size)
           analyticsPromises.push(recordTableBookingAnalyticsSafe(supabase, {
             customerId: customerResolution.customerId,
             tableBookingId: bookingResult.table_booking_id,
@@ -475,7 +460,7 @@ export async function POST(request: NextRequest) {
             metadata: {
               hold_expires_at: holdExpiresAt,
               next_step_url_provided: Boolean(nextStepUrl),
-              deposit_amount: Number((Math.max(1, Number(payload.party_size || 1)) * 10).toFixed(2)),
+              deposit_amount: Number(analyticsDeposit.toFixed(2)),
               deposit_per_person: 10,
             },
           }, {
@@ -520,6 +505,24 @@ export async function POST(request: NextRequest) {
 
       const responseStatus = responseState === 'blocked' ? 200 : 201
 
+      // Canonical deposit amount for the response payload. Booking is fresh
+      // from the RPC so there is no prior locked/stored amount to honour, but
+      // we still route through the helper to keep the threshold + rate in one
+      // place. Spec §3 step 9, §8.3.
+      const canonicalDeposit =
+        responseState === 'pending_payment' ? computeDepositAmount(payload.party_size) : null
+
+      // Failed-PayPal recovery surface (Spec §6): always expose the token-based
+      // payment URL on `pending_payment` responses as `fallback_payment_url` so
+      // the website can fall back to the management's hosted payment page when
+      // its inline PayPal button fails to render. The field is intentionally
+      // not overloaded onto `next_step_url` — `next_step_url` retains its
+      // happy-path semantics; `fallback_payment_url` is the explicit recovery
+      // surface. Both currently resolve to the same `/g/{token}/table-payment`
+      // URL but the contract is independent.
+      const fallbackPaymentUrl =
+        responseState === 'pending_payment' ? nextStepUrl : null
+
       const responsePayload = {
         success: true,
         data: {
@@ -533,7 +536,8 @@ export async function POST(request: NextRequest) {
           hold_expires_at: responseState === 'pending_payment' ? holdExpiresAt : null,
           table_name: bookingResult.table_name || null,
           booking_id: responseState === 'pending_payment' ? (bookingResult.table_booking_id || null) : null,
-          deposit_amount: responseState === 'pending_payment' ? payload.party_size * 10 : null
+          deposit_amount: canonicalDeposit,
+          fallback_payment_url: fallbackPaymentUrl,
         } satisfies TableBookingResponseData,
         meta: {
           status_code: responseStatus,
diff --git a/src/app/g/[token]/table-payment/page.tsx b/src/app/g/[token]/table-payment/page.tsx
index 5ac090c0..0dac73ef 100644
--- a/src/app/g/[token]/table-payment/page.tsx
+++ b/src/app/g/[token]/table-payment/page.tsx
@@ -175,11 +175,15 @@ export default async function TablePaymentPage({ params, searchParams }: TablePa
 
     paypalOrderId = paypalOrder.orderId
 
+    // Persist the order ID only. Deliberately not writing deposit_amount —
+    // the canonical reader (preview.totalAmount derives from
+    // getCanonicalDeposit) is the source of truth, and capture-time is when
+    // we lock the actually-charged amount via deposit_amount_locked.
+    // Spec §7.3, §7.4, §8.3.
     await supabase
       .from('table_bookings')
       .update({
         paypal_deposit_order_id: paypalOrderId,
-        deposit_amount: preview.totalAmount,
       })
       .eq('id', preview.tableBookingId)
 
@@ -223,6 +227,37 @@ export default async function TablePaymentPage({ params, searchParams }: TablePa
         return { success: false, error: 'Payment verification failed — please contact us.' }
       }
 
+      // Parse the actually-captured GBP amount from PayPal's response. This
+      // is the authoritative figure. Fail closed if missing/unparseable —
+      // do NOT silently fall back to preview.totalAmount or
+      // booking.deposit_amount; that would let stale amounts get locked.
+      // Spec §6, §7.4, §8.3.
+      const rawAmount = capture.amount
+      const lockedAmountGbp =
+        rawAmount === undefined || rawAmount === null
+          ? null
+          : (() => {
+              const n = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount)
+              return Number.isFinite(n) && n > 0 ? n : null
+            })()
+
+      if (lockedAmountGbp === null) {
+        void logAuditEvent({
+          operation_type: 'payment.capture_amount_unparseable',
+          resource_type: 'table_booking',
+          resource_id: bookingIdForCapture,
+          operation_status: 'failure',
+          additional_info: {
+            orderId: captureOrderId,
+            transactionId: capture.transactionId,
+            rawAmount: String(rawAmount ?? 'null'),
+            action_needed:
+              'PayPal capture succeeded but the captured amount was missing or unparseable — manual reconciliation required',
+          },
+        })
+        return { success: false, error: 'Payment captured but amount could not be verified. Please contact us; do not retry.' }
+      }
+
       const { error: updateError } = await db
         .from('table_bookings')
         .update({
@@ -230,6 +265,7 @@ export default async function TablePaymentPage({ params, searchParams }: TablePa
           status: 'confirmed',
           payment_method: 'paypal',
           paypal_deposit_capture_id: capture.transactionId,
+          deposit_amount_locked: lockedAmountGbp,
         })
         .eq('id', bookingIdForCapture)
 
@@ -257,6 +293,7 @@ export default async function TablePaymentPage({ params, searchParams }: TablePa
         additional_info: {
           transactionId: capture.transactionId,
           amount: capture.amount,
+          lockedAmountGbp,
           bookingId: bookingIdForCapture,
         },
       })
diff --git a/src/lib/table-bookings/bookings.ts b/src/lib/table-bookings/bookings.ts
index f44eeb20..623638fd 100644
--- a/src/lib/table-bookings/bookings.ts
+++ b/src/lib/table-bookings/bookings.ts
@@ -15,8 +15,15 @@ import {
 import { logger } from '@/lib/logger'
 import { AuditService } from '@/services/audit'
 import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'
+import {
+  computeDepositAmount,
+  getCanonicalDeposit,
+  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
+} from './deposit'
 
-const DEPOSIT_PER_PERSON_GBP = 10
+// Re-exported for backwards-compat in this file. The single source of truth is
+// `LARGE_GROUP_DEPOSIT_PER_PERSON_GBP` in `./deposit.ts`. Spec §7.3, §8.3.
+const DEPOSIT_PER_PERSON_GBP = LARGE_GROUP_DEPOSIT_PER_PERSON_GBP
 
 export type TableBookingState = 'confirmed' | 'pending_payment' | 'blocked'
 
@@ -454,7 +461,10 @@ export async function getTablePaymentPreviewByRawToken(
       booking_date,
       booking_time,
       start_datetime,
-      booking_type
+      booking_type,
+      deposit_amount,
+      deposit_amount_locked,
+      deposit_waived
     `)
     .eq('id', token.table_booking_id)
     .maybeSingle()
@@ -488,7 +498,21 @@ export async function getTablePaymentPreviewByRawToken(
   }
 
   const partySize = Math.max(1, Number(booking.committed_party_size ?? booking.party_size ?? 1))
-  const totalAmount = Number((partySize * DEPOSIT_PER_PERSON_GBP).toFixed(2))
+  // Read canonical deposit (locked > stored > computed). Honours
+  // `deposit_amount_locked` for already-paid bookings and any stored
+  // `deposit_amount` for `pending_payment` rows. Spec §3 step 9, §7.3, §8.3.
+  const canonical = getCanonicalDeposit(
+    {
+      party_size: partySize,
+      deposit_amount: booking.deposit_amount ?? null,
+      deposit_amount_locked: booking.deposit_amount_locked ?? null,
+      status: booking.status ?? null,
+      payment_status: booking.payment_status ?? null,
+      deposit_waived: booking.deposit_waived ?? null,
+    },
+    partySize,
+  )
+  const totalAmount = Number(canonical.toFixed(2))
   if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
     return { state: 'blocked', reason: 'invalid_amount' }
   }
@@ -705,7 +729,9 @@ export async function sendTableBookingCreatedSmsIfAllowed(
   const bookingMoment = formatLondonDateTime(input.bookingResult.start_datetime)
   const partySize = Math.max(1, Number(input.bookingResult.party_size ?? 1))
   const seatWord = partySize === 1 ? 'person' : 'people'
-  const depositAmount = Number((partySize * DEPOSIT_PER_PERSON_GBP).toFixed(2))
+  // Centralised compute. Booking is fresh from the RPC so no prior locked
+  // amount can exist here. Spec §3 step 9, §8.3.
+  const depositAmount = Number(computeDepositAmount(partySize).toFixed(2))
   const depositLabel = new Intl.NumberFormat('en-GB', {
     style: 'currency',
     currency: 'GBP',
diff --git a/src/lib/table-bookings/deposit.ts b/src/lib/table-bookings/deposit.ts
new file mode 100644
index 00000000..685ac9b5
--- /dev/null
+++ b/src/lib/table-bookings/deposit.ts
@@ -0,0 +1,96 @@
+/**
+ * Centralised deposit helper for table bookings.
+ *
+ * Single source of truth for the 10+ deposit threshold and £10/person rate. Any
+ * code path that decides "does this booking require a deposit" or "what amount"
+ * MUST go through these helpers — duplicating the rule elsewhere is a footgun
+ * (the threshold has changed twice already and we don't want a third drift).
+ *
+ * Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
+ *           §7.3 (deposit helper design), §7.4 (lock-amount design).
+ */
+
+export const LARGE_GROUP_DEPOSIT_PER_PERSON_GBP = 10;
+export const LARGE_GROUP_DEPOSIT_THRESHOLD = 10;
+
+export type DepositOptions = {
+  depositWaived?: boolean;
+};
+
+/**
+ * Returns true when a deposit must be charged for a booking of the given party size.
+ * Preserves the existing `p_deposit_waived` semantics — a manager-level waiver
+ * always wins regardless of party size.
+ */
+export function requiresDeposit(partySize: number, opts: DepositOptions = {}): boolean {
+  if (opts.depositWaived === true) return false;
+  return partySize >= LARGE_GROUP_DEPOSIT_THRESHOLD;
+}
+
+/**
+ * Computes a fresh deposit amount from party size only. Returns 0 when no deposit is required.
+ * Use this only when there is no prior amount (locked or stored) on the booking.
+ */
+export function computeDepositAmount(partySize: number, opts: DepositOptions = {}): number {
+  if (!requiresDeposit(partySize, opts)) return 0;
+  return partySize * LARGE_GROUP_DEPOSIT_PER_PERSON_GBP;
+}
+
+/**
+ * Booking shape for the canonical-deposit reader. Intentionally narrow — accepts any object
+ * with the relevant fields so it works for partial selects.
+ */
+export type BookingForDeposit = {
+  party_size: number;
+  deposit_amount?: number | string | null;
+  deposit_amount_locked?: number | string | null;
+  status?: string | null;
+  payment_status?: string | null;
+  deposit_waived?: boolean | null;
+};
+
+const PAYMENT_REQUIRED_STATES = new Set(['pending_payment']);
+const PAYMENT_REQUIRED_PAYMENT_STATUSES = new Set(['pending', 'completed']);
+
+function toNumberOrNull(v: number | string | null | undefined): number | null {
+  if (v === null || v === undefined) return null;
+  const n = typeof v === 'number' ? v : Number(v);
+  return Number.isFinite(n) ? n : null;
+}
+
+/**
+ * Returns the canonical deposit amount for a booking. Read priority:
+ *   1. deposit_amount_locked (always wins — paid bookings are immutable)
+ *   2. stored deposit_amount when the booking is in a payment-required state
+ *   3. fresh compute via requiresDeposit + party size, or 0 if not required
+ */
+export function getCanonicalDeposit(
+  booking: BookingForDeposit,
+  partySizeOverride?: number,
+): number {
+  const locked = toNumberOrNull(booking.deposit_amount_locked);
+  if (locked !== null) return locked;
+
+  const stored = toNumberOrNull(booking.deposit_amount);
+  const status = booking.status ?? '';
+  const paymentStatus = booking.payment_status ?? '';
+  const isPaymentRequiredState =
+    PAYMENT_REQUIRED_STATES.has(status) ||
+    PAYMENT_REQUIRED_PAYMENT_STATUSES.has(paymentStatus);
+
+  if (stored !== null && isPaymentRequiredState) {
+    return stored;
+  }
+
+  const partySize = partySizeOverride ?? booking.party_size;
+  return computeDepositAmount(partySize, { depositWaived: booking.deposit_waived === true });
+}
+
+/**
+ * Convenience helper used by capture surfaces that need to write the lock.
+ * Callers pass the actually-captured amount from the payment provider.
+ */
+export type LockDepositArgs = {
+  bookingId: string;
+  amount: number;
+};
diff --git a/src/lib/table-bookings/sunday-preorder.ts b/src/lib/table-bookings/sunday-preorder.ts
index ee11cb98..b1c84dec 100644
--- a/src/lib/table-bookings/sunday-preorder.ts
+++ b/src/lib/table-bookings/sunday-preorder.ts
@@ -689,6 +689,23 @@ export async function saveSundayPreorderByBookingId(
     staffOverride?: boolean
   }
 ): Promise<SundayPreorderSaveResult> {
+  // Defence-in-depth: refuse to persist pre-orders for non-legacy bookings.
+  // The new public flow never creates `booking_type='sunday_lunch'` rows so
+  // this code path should never receive one. If it does (mis-wired caller,
+  // legacy data import, etc.), log loudly and bail rather than persist.
+  // `getSundayPreorderPageDataByBookingId` also returns `not_sunday_lunch` —
+  // this is a second guard. Spec §8.3.
+  const { data: bookingRow } = await supabase.from('table_bookings')
+    .select('id, booking_type')
+    .eq('id', input.bookingId)
+    .maybeSingle()
+  if (bookingRow && bookingRow.booking_type !== 'sunday_lunch') {
+    console.warn(
+      `[sunday-preorder] Refusing to persist pre-order for non-legacy booking ${input.bookingId} (booking_type=${bookingRow.booking_type}). New flow does not use pre-orders.`
+    )
+    return { state: 'blocked', reason: 'not_sunday_lunch' }
+  }
+
   const pageData = await getSundayPreorderPageDataByBookingId(supabase, input.bookingId)
   return saveSundayPreorderFromPageData(supabase, {
     pageData,
diff --git a/src/tests/api/foh/deposit-waiver.test.ts b/src/tests/api/foh/deposit-waiver.test.ts
index 054c71e6..67bfb36a 100644
--- a/src/tests/api/foh/deposit-waiver.test.ts
+++ b/src/tests/api/foh/deposit-waiver.test.ts
@@ -30,11 +30,13 @@ function makeRequest(body: object) {
   }) as unknown as import('next/server').NextRequest
 }
 
+// Walk-in launch (spec §6, §7.3): the deposit threshold is now 10+ (not 7+).
+// Party_size: 10 puts the booking on the deposit-required side of the boundary.
 const baseBookingPayload = {
   customer_id: '00000000-0000-0000-0000-000000000001',
   date: '2026-04-05',
   time: '13:00',
-  party_size: 8,
+  party_size: 10,
   purpose: 'food'
 }
 
@@ -142,11 +144,57 @@ describe('POST /api/foh/bookings — deposit waiver', () => {
     expect(res.status).toBe(201)
   })
 
-  it('should require sunday_deposit_method when waive_deposit is false and party_size >= 7', async () => {
+  it('requires a deposit decision when party_size >= 10 and waive_deposit is false', async () => {
+    // Use the same comprehensive mock as the manager-waive case so the route's
+    // customer-lookup step succeeds and we exercise the actual deposit gate.
+    const mockSupabase = {
+      from: vi.fn().mockImplementation((table: string) => {
+        if (table === 'user_roles') {
+          return {
+            select: vi.fn().mockReturnValue({
+              eq: vi.fn().mockResolvedValue({
+                data: [{ roles: { name: 'manager' } }]
+              })
+            })
+          }
+        }
+        if (table === 'customers') {
+          const eqChain = {
+            eq: vi.fn(),
+            maybeSingle: vi.fn().mockResolvedValue({
+              data: { id: '00000000-0000-0000-0000-000000000001', mobile_e164: '+441234567890', mobile_number: '01234567890' },
+              error: null
+            }),
+            single: vi.fn().mockResolvedValue({ data: null, error: null })
+          }
+          eqChain.eq.mockReturnValue(eqChain)
+          return { select: vi.fn().mockReturnValue(eqChain) }
+        }
+        const eqChain = {
+          eq: vi.fn(),
+          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
+          single: vi.fn().mockResolvedValue({ data: null, error: null }),
+          limit: vi.fn().mockReturnValue({
+            eq: vi.fn().mockResolvedValue({ data: [], error: null })
+          })
+        }
+        eqChain.eq.mockReturnValue(eqChain)
+        return {
+          select: vi.fn().mockReturnValue(eqChain),
+          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
+          update: vi.fn().mockReturnValue({
+            eq: vi.fn().mockResolvedValue({ data: null, error: null })
+          }),
+          upsert: vi.fn().mockResolvedValue({ data: null, error: null })
+        }
+      }),
+      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
+    }
+
     const mockResult: MockOkResult = {
       ok: true,
       userId: 'user-3',
-      supabase: {}
+      supabase: mockSupabase
     }
     vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
 
diff --git a/supabase/migrations/20260509000014_add_deposit_amount_locked.sql b/supabase/migrations/20260509000014_add_deposit_amount_locked.sql
new file mode 100644
index 00000000..d5611db5
--- /dev/null
+++ b/supabase/migrations/20260509000014_add_deposit_amount_locked.sql
@@ -0,0 +1,114 @@
+-- ============================================================================
+-- Migration A: deposit lock column + legacy unpaid pending conversion + paid backfill.
+-- Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
+--           §7.4 (lock-amount design), §8.4 Migration A (full SQL spec).
+-- D6 verified (28 April 2026): the only paid value of payments.status for
+--   charge_type='table_deposit' is 'succeeded'. This SQL uses status='succeeded'.
+-- D11 verified (28 April 2026): 0 future unpaid pending Sunday-lunch bookings,
+--   1 future paid (TB-8229A1B4 / Sun 31 May 2026, party 1, £10 deposit). Step 1
+--   is a defensive no-op on day 1; Step 2 will lock the 1 paid row + any history.
+-- ============================================================================
+
+-- Add the lock column. Additive, no defaults — existing rows are NULL.
+ALTER TABLE public.table_bookings
+  ADD COLUMN IF NOT EXISTS deposit_amount_locked numeric NULL;
+
+COMMENT ON COLUMN public.table_bookings.deposit_amount_locked IS
+  'Locked deposit amount in GBP. Set by every successful payment-capture surface (PayPal capture-order, Stripe webhook, cash/manual deposit confirmation) and by the Migration A backfill. Once set it is immutable — paid bookings always read the canonical amount from this column. NULL means no payment has been captured for this booking yet.';
+
+-- ============================================================================
+-- STEP 1 (legacy unpaid pending conversion, per OQ14a resolution):
+-- For legacy sunday_lunch bookings that have not captured a payment AND whose
+-- service date is in the future, convert them to regular bookings under the new
+-- rules. Pre-order data on the row is preserved (in table_booking_items /
+-- special_requirements) but is no longer kitchen-enforced.
+--
+-- IMPORTANT — only touch FUTURE bookings. Historical abandoned/past
+-- pending_payment rows must not be rewritten (would pollute reporting and
+-- historical state).
+--
+-- IMPORTANT — staff review list MUST be generated and signed off before this
+-- UPDATE runs (see §8.4 Pre-conversion review).
+--
+-- Below 10: drop pending_payment status (becomes confirmed); deposit no longer
+--           required.
+-- 10+:      keep pending_payment (deposit still required under new rules);
+--           deposit_amount stays.
+-- ============================================================================
+UPDATE public.table_bookings tb
+SET
+  booking_type = 'regular',
+  status = CASE WHEN tb.party_size >= 10 THEN tb.status ELSE 'confirmed' END,
+  deposit_amount = CASE WHEN tb.party_size >= 10 THEN tb.deposit_amount ELSE NULL END
+WHERE tb.booking_type = 'sunday_lunch'
+  AND tb.status = 'pending_payment'
+  AND tb.start_datetime >= NOW()  -- ONLY future-dated bookings
+  AND NOT EXISTS (
+    SELECT 1 FROM public.payments p
+    WHERE p.table_booking_id = tb.id
+      AND p.charge_type = 'table_deposit'
+      AND p.status = 'succeeded'
+  )
+  AND tb.paypal_deposit_capture_id IS NULL
+  AND COALESCE(tb.payment_status::text, '') <> 'completed';  -- NULL-safe
+
+-- ============================================================================
+-- STEP 2 (paid-deposit backfill):
+-- Lock the captured deposit amount for any booking with paid evidence.
+-- Sources, in priority order:
+--   1. payments.amount where charge_type='table_deposit' AND status='succeeded'
+--      (latest by created_at via DISTINCT ON)
+--   2. table_bookings.deposit_amount fallback (legacy rows where the payments
+--      record may be missing but deposit_amount was set on the booking row)
+--
+-- The outer WHERE clause guards against locking a NULL value when neither
+-- source has a usable amount.
+-- ============================================================================
+WITH paid_payments AS (
+  SELECT DISTINCT ON (p.table_booking_id)
+    p.table_booking_id,
+    p.amount
+  FROM public.payments p
+  WHERE p.charge_type = 'table_deposit'
+    AND p.status = 'succeeded'
+  ORDER BY p.table_booking_id, p.created_at DESC
+)
+UPDATE public.table_bookings tb
+SET deposit_amount_locked = COALESCE(
+  (SELECT amount FROM paid_payments pp WHERE pp.table_booking_id = tb.id),
+  tb.deposit_amount
+)
+WHERE tb.deposit_amount_locked IS NULL
+  AND (
+    COALESCE(tb.payment_status::text, '') = 'completed'
+    OR tb.paypal_deposit_capture_id IS NOT NULL
+    OR EXISTS (SELECT 1 FROM paid_payments pp WHERE pp.table_booking_id = tb.id)
+  )
+  AND COALESCE(
+    (SELECT amount FROM paid_payments pp WHERE pp.table_booking_id = tb.id),
+    tb.deposit_amount
+  ) IS NOT NULL;
+
+-- ============================================================================
+-- STEP 3 — Verification report (zero rows on success). Run as a sanity check.
+-- Any row returned indicates a paid booking that backfill couldn't lock — flag
+-- for staff review BEFORE the launch banner activates.
+-- Acceptance criterion (§8.10): zero rows here, OR a written sign-off from the
+-- owner explicitly listing the rows and the reason they remain unlocked.
+-- ============================================================================
+-- This SELECT does not run as part of the migration; it's the script you run
+-- post-migration to verify integrity. Copy into the SQL editor:
+/*
+SELECT tb.id, tb.booking_reference, tb.start_datetime, tb.party_size,
+       tb.payment_status, tb.paypal_deposit_capture_id, tb.deposit_amount, tb.deposit_amount_locked
+FROM public.table_bookings tb
+WHERE tb.deposit_amount_locked IS NULL
+  AND (
+    tb.payment_status::text = 'completed'
+    OR tb.paypal_deposit_capture_id IS NOT NULL
+    OR EXISTS (SELECT 1 FROM public.payments p
+               WHERE p.table_booking_id = tb.id
+                 AND p.charge_type = 'table_deposit'
+                 AND p.status = 'succeeded')
+  );
+*/
diff --git a/supabase/migrations/20260509000015_patch_v05_threshold_and_cutoff.sql b/supabase/migrations/20260509000015_patch_v05_threshold_and_cutoff.sql
new file mode 100644
index 00000000..3643b10b
--- /dev/null
+++ b/supabase/migrations/20260509000015_patch_v05_threshold_and_cutoff.sql
@@ -0,0 +1,581 @@
+-- ============================================================================
+-- Migration B: patch create_table_booking_v05 to apply the new 10+ deposit
+-- threshold (replacing the legacy "Sunday OR 7-20" rule) and skip the Sunday
+-- pre-order cutoff calc for non-legacy bookings.
+--
+-- Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
+--           §7.10 (migration discipline — full body copied verbatim from latest
+--           migration), §8.4 Migration B.
+--
+-- Source body: 20260509000005_create_table_booking_v05_deposit_waived.sql
+--              (the canonical 10-param version; later migrations 006/007 only
+--               adjust grants / drop stale overloads — they do not redefine
+--               the body).
+--
+-- Three minimal edits applied IN PLACE (everything else is verbatim):
+--   Edit 1: v_sunday_preorder_cutoff_at — already wrapped with
+--           "IF p_sunday_lunch THEN ... ELSE NULL END IF" in the source body
+--           (lines 399-404 of migration 005). No change required for this edit.
+--           Recorded here for spec traceability.
+--   Edit 2: v_deposit_required — replace "(Sunday lunch OR 7-20 group)" with
+--           "p_party_size >= 10 AND NOT COALESCE(p_deposit_waived, false)".
+--           This preserves p_deposit_waived semantics: the existing waiver
+--           check that follows still runs but is now redundant for the new
+--           rule (kept anyway to avoid touching unrelated logic).
+--   Edit 3: deposit_amount calc — UNCHANGED (party_size * 10).
+--
+-- pending_payment now triggers on "p_party_size >= 10 AND NOT p_deposit_waived"
+-- — preserves waiver semantics. Capacity, table assignment, hold expiry, audit
+-- logging, error returns, return shape — all unchanged.
+-- ============================================================================
+
+CREATE OR REPLACE FUNCTION public.create_table_booking_v05(
+  p_customer_id       uuid,
+  p_booking_date      date,
+  p_booking_time      time without time zone,
+  p_party_size        integer,
+  p_booking_purpose   text    DEFAULT 'food',
+  p_notes             text    DEFAULT NULL,
+  p_sunday_lunch      boolean DEFAULT false,
+  p_source            text    DEFAULT 'brand_site',
+  p_bypass_cutoff     boolean DEFAULT false,  -- FOH only: skip 30-min pre-close buffer
+  p_deposit_waived    boolean DEFAULT false   -- manager/super_admin waiver
+)
+RETURNS jsonb
+LANGUAGE plpgsql
+SECURITY DEFINER
+SET search_path = public
+AS $$
+DECLARE
+  v_purpose text;
+  v_booking_type public.table_booking_type;
+  v_booking_status public.table_booking_status;
+  v_is_sunday boolean;
+
+  v_booking_start_local timestamp without time zone;
+  v_booking_start timestamptz;
+  v_booking_end timestamptz;
+
+  v_hours_row RECORD;
+
+  v_pub_open_minutes integer;
+  v_pub_close_minutes integer;
+  v_pub_close_service_minutes integer;
+  v_pub_booking_minutes integer;
+
+  v_kitchen_open_minutes integer;
+  v_kitchen_close_minutes integer;
+  v_kitchen_close_service_minutes integer;
+  v_kitchen_booking_minutes integer;
+
+  v_food_duration_minutes integer := 120;
+  v_drinks_duration_minutes integer := 90;
+  v_sunday_duration_minutes integer := 120;
+  v_duration_minutes integer;
+
+  v_drinks_near_close_allowed boolean := false;
+
+  v_selected_table_id uuid;
+  v_selected_table_ids uuid[];
+  v_selected_table_names text[];
+  v_selected_table_display_name text;
+
+  v_table_booking_id uuid;
+  v_booking_reference text;
+
+  v_deposit_required boolean := false;
+  v_hold_expires_at timestamptz;
+  v_now timestamptz := NOW();
+  v_party_size_eff integer;
+  v_deposit_amount numeric(10, 2);
+  v_payment_id uuid;
+
+  v_sunday_preorder_cutoff_at timestamptz;
+BEGIN
+  IF p_customer_id IS NULL THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'missing_customer');
+  END IF;
+
+  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'missing_datetime');
+  END IF;
+
+  IF p_party_size IS NULL OR p_party_size < 1 THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_party_size');
+  END IF;
+
+  IF p_party_size >= 21 THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
+  END IF;
+
+  v_purpose := LOWER(TRIM(COALESCE(p_booking_purpose, 'food')));
+  IF v_purpose NOT IN ('food', 'drinks') THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_purpose');
+  END IF;
+
+  v_is_sunday := EXTRACT(DOW FROM p_booking_date)::integer = 0;
+  IF COALESCE(p_sunday_lunch, false) AND NOT v_is_sunday THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'sunday_lunch_requires_sunday');
+  END IF;
+
+  v_booking_type := CASE
+    WHEN COALESCE(p_sunday_lunch, false) THEN 'sunday_lunch'::public.table_booking_type
+    ELSE 'regular'::public.table_booking_type
+  END;
+
+  v_booking_start_local := (p_booking_date::text || ' ' || p_booking_time::text)::timestamp;
+  v_booking_start := v_booking_start_local AT TIME ZONE 'Europe/London';
+
+  IF v_booking_start <= v_now THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'in_past');
+  END IF;
+
+  SELECT
+    bh.day_of_week,
+    COALESCE(sh.is_closed, bh.is_closed, false) AS is_closed,
+    COALESCE(sh.is_kitchen_closed, bh.is_kitchen_closed, false) AS is_kitchen_closed,
+    COALESCE(sh.opens, bh.opens) AS opens,
+    COALESCE(sh.closes, bh.closes) AS closes,
+    COALESCE(sh.kitchen_opens, bh.kitchen_opens) AS kitchen_opens,
+    COALESCE(sh.kitchen_closes, bh.kitchen_closes) AS kitchen_closes
+  INTO v_hours_row
+  FROM public.business_hours bh
+  LEFT JOIN public.special_hours sh ON sh.date = p_booking_date
+  WHERE bh.day_of_week = EXTRACT(DOW FROM p_booking_date)::integer
+  LIMIT 1;
+
+  IF NOT FOUND THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
+  END IF;
+
+  IF COALESCE(v_hours_row.is_closed, false) THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
+  END IF;
+
+  IF v_hours_row.opens IS NULL OR v_hours_row.closes IS NULL THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
+  END IF;
+
+  v_pub_open_minutes := (EXTRACT(HOUR FROM v_hours_row.opens)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.opens)::integer;
+  v_pub_close_minutes := (EXTRACT(HOUR FROM v_hours_row.closes)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.closes)::integer;
+  v_pub_booking_minutes := (EXTRACT(HOUR FROM p_booking_time)::integer * 60) + EXTRACT(MINUTE FROM p_booking_time)::integer;
+
+  v_pub_close_service_minutes := CASE
+    WHEN v_pub_close_minutes <= v_pub_open_minutes THEN v_pub_close_minutes + 1440
+    ELSE v_pub_close_minutes
+  END;
+
+  IF v_pub_close_minutes <= v_pub_open_minutes AND v_pub_booking_minutes < v_pub_open_minutes THEN
+    v_pub_booking_minutes := v_pub_booking_minutes + 1440;
+  END IF;
+
+  IF NOT (v_pub_booking_minutes >= v_pub_open_minutes AND v_pub_booking_minutes < v_pub_close_service_minutes) THEN
+    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
+  END IF;
+
+  SELECT
+    COALESCE(
+      CASE
+        WHEN jsonb_typeof(value) = 'boolean' THEN (value::text)::boolean
+        WHEN jsonb_typeof(value) = 'number' THEN (value::text)::numeric <> 0
+        WHEN jsonb_typeof(value) = 'string' THEN LOWER(TRIM(BOTH '"' FROM value::text)) IN ('1','true','yes','y','on')
+        WHEN jsonb_typeof(value) = 'object' THEN COALESCE(
+          LOWER(value->>'enabled') IN ('1','true','yes','y','on'),
+          LOWER(value->>'allow') IN ('1','true','yes','y','on')
+        )
+        ELSE NULL
+      END,
+      false
+    )
+  INTO v_drinks_near_close_allowed
+  FROM public.system_settings
+  WHERE key IN (
+    'table_booking_drinks_near_close_allowed',
+    'table_bookings_drinks_near_close_allowed',
+    'drinks_near_close_allowed'
+  )
+  ORDER BY updated_at DESC NULLS LAST
+  LIMIT 1;
+
+  IF v_purpose = 'food' OR COALESCE(p_sunday_lunch, false) THEN
+    IF COALESCE(v_hours_row.is_kitchen_closed, false)
+       OR v_hours_row.kitchen_opens IS NULL
+       OR v_hours_row.kitchen_closes IS NULL THEN
+      RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
+    END IF;
+
+    v_kitchen_open_minutes := (EXTRACT(HOUR FROM v_hours_row.kitchen_opens)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.kitchen_opens)::integer;
+    v_kitchen_close_minutes := (EXTRACT(HOUR FROM v_hours_row.kitchen_closes)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.kitchen_closes)::integer;
+    v_kitchen_booking_minutes := (EXTRACT(HOUR FROM p_booking_time)::integer * 60) + EXTRACT(MINUTE FROM p_booking_time)::integer;
+
+    v_kitchen_close_service_minutes := CASE
+      WHEN v_kitchen_close_minutes <= v_kitchen_open_minutes THEN v_kitchen_close_minutes + 1440
+      ELSE v_kitchen_close_minutes
+    END;
+
+    IF v_kitchen_close_minutes <= v_kitchen_open_minutes AND v_kitchen_booking_minutes < v_kitchen_open_minutes THEN
+      v_kitchen_booking_minutes := v_kitchen_booking_minutes + 1440;
+    END IF;
+
+    IF NOT (v_kitchen_booking_minutes >= v_kitchen_open_minutes AND v_kitchen_booking_minutes < v_kitchen_close_service_minutes) THEN
+      RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
+    END IF;
+
+    -- 30-minute pre-close buffer: skipped for FOH (p_bypass_cutoff = true)
+    IF v_kitchen_booking_minutes > (v_kitchen_close_service_minutes - 30)
+       AND NOT COALESCE(p_bypass_cutoff, false) THEN
+      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
+    END IF;
+  END IF;
+
+  -- Drinks near-close buffer: also skipped for FOH
+  IF v_purpose = 'drinks' AND NOT COALESCE(v_drinks_near_close_allowed, false)
+     AND NOT COALESCE(p_bypass_cutoff, false) THEN
+    IF v_pub_booking_minutes > (v_pub_close_service_minutes - 30) THEN
+      RETURN jsonb_build_object('state', 'blocked', 'reason', 'cut_off');
+    END IF;
+  END IF;
+
+  SELECT
+    COALESCE(
+      CASE
+        WHEN jsonb_typeof(value) = 'number' THEN (value::text)::integer
+        WHEN jsonb_typeof(value) = 'string' THEN NULLIF(regexp_replace(TRIM(BOTH '"' FROM value::text), '[^0-9]', '', 'g'), '')::integer
+        WHEN jsonb_typeof(value) = 'object' THEN COALESCE(
+          NULLIF(regexp_replace(COALESCE(value->>'minutes', ''), '[^0-9]', '', 'g'), '')::integer,
+          NULLIF(regexp_replace(COALESCE(value->>'value', ''), '[^0-9]', '', 'g'), '')::integer
+        )
+        ELSE NULL
+      END,
+      120
+    )
+  INTO v_food_duration_minutes
+  FROM public.system_settings
+  WHERE key IN ('table_booking_duration_food_minutes', 'table_bookings_food_duration_minutes')
+  ORDER BY updated_at DESC NULLS LAST
+  LIMIT 1;
+

[diff truncated at line 1500 — total was 2771 lines. Consider scoping the review to fewer files.]
```

## Changed File Contents

### `scripts/one-off/2026-04-28-sunday-hours-13-18.sql`

```
-- 2026-04-28 — Sunday service window: 12:00–17:00 → 13:00–18:00
--
-- Spec: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md §6, §8.3
-- Plan: docs/superpowers/plans/2026-04-28-sunday-walk-in-launch.md Task 4.4
--
-- Context: the Sunday-walk-in launch moves the kitchen window from 12:00–17:00
-- to 13:00–18:00 to align with new service patterns. Last bookable arrival is
-- 17:30 so the kitchen has 30 min to plate (slot logic enforces this — separate
-- from the kitchen window stored here).
--
-- Why this lives in scripts/one-off/ (not supabase/migrations/):
-- Wave 2 of the rollout is local-only. Peter applies this update during the
-- staged deploy window. Once executed, capture the UPDATE inside a tracked
-- migration so a fresh `npx supabase db push` reproduces the change.
--
-- POST-DEPLOY VERIFICATION (Spec §8.3 Task 4.5):
-- SELECT day_of_week, kitchen_opens, kitchen_closes, schedule_config
-- FROM public.business_hours WHERE day_of_week = 0;
-- Expected: kitchen_opens=13:00:00, kitchen_closes=18:00:00, schedule_config
--           contains a single Sunday entry with starts_at=13:00:00 and
--           ends_at=18:00:00.
--
-- If this needs to be rolled back: re-run with the legacy values
-- (kitchen_opens=12:00:00, kitchen_closes=17:00:00, schedule_config window
-- 12:00:00–17:00:00).

BEGIN;

UPDATE public.business_hours
SET
  -- Generic kitchen window. New public bookings use booking_type='regular' for
  -- both food and drinks; the legacy 'sunday_lunch' booking_type is reserved
  -- for back-fill of historical records only.
  schedule_config = '[
    {
      "starts_at": "13:00:00",
      "ends_at": "18:00:00",
      "capacity": 50,
      "booking_type": "food",
      "slot_type": "sunday_food"
    }
  ]'::jsonb,
  kitchen_opens = '13:00:00',
  kitchen_closes = '18:00:00'
WHERE
  day_of_week = 0;

-- Sanity: confirm exactly one row was updated. If 0, the table layout has
-- diverged from spec assumptions and the deployer should investigate before
-- committing.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.business_hours
  WHERE day_of_week = 0;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 Sunday business_hours row, found %', v_count;
  END IF;
END;
$$;

COMMIT;
```

### `src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx`

```
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import toast from 'react-hot-toast'
import type { Booking } from './BookingDetailClient'

interface PreorderItem {
  menu_dish_id: string
  name_snapshot: string
  item_type: 'main' | 'side' | 'extra'
  quantity: number
  price_snapshot: number
}

interface MenuItem {
  menu_dish_id: string
  name: string
  price: number
  category_code: string | null
  item_type: 'main' | 'side' | 'extra'
  sort_order: number
}

interface PreorderData {
  state: 'ready' | 'blocked'
  reason?: string
  can_submit?: boolean
  submit_deadline_at?: string | null
  sunday_preorder_cutoff_at?: string | null
  sunday_preorder_completed_at?: string | null
  cutoff_overridden?: boolean
  existing_items?: PreorderItem[]
  menu_items?: MenuItem[]
}

interface Props {
  booking: Booking
  canEdit: boolean
}

function formatLondonDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }).format(new Date(iso))
}

/**
 * Extract legacy pre-order text from a `special_requirements` string. Public-
 * API legacy Sunday-lunch bookings ship the pre-order as free text such as
 * 'Sunday lunch pre-order: Guest 1: Roasted Chicken x1'. Returns null if no
 * marker is present. Spec §8.3.
 */
function extractLegacyPreorderText(specialRequirements: string | null | undefined): string | null {
  if (!specialRequirements) return null
  const marker = /sunday lunch pre-?order/i
  if (!marker.test(specialRequirements)) return null
  return specialRequirements.trim()
}

export default function PreorderTab({ booking, canEdit }: Props) {
  const [data, setData] = useState<PreorderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/boh/table-bookings/${booking.id}/preorder`)
      if (!res.ok) throw new Error('Failed to load pre-order')
      const json = (await res.json()) as PreorderData
      setData(json)
    } catch {
      toast.error('Could not load pre-order data')
    } finally {
      setLoading(false)
    }
  }, [booking.id])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <p className="text-sm text-gray-500">Loading pre-order&hellip;</p>

  if (!data || data.state === 'blocked') {
    // Public-API legacy bookings can ship pre-order text in
    // `special_requirements` rather than as structured `table_booking_items`
    // rows (e.g. 'Sunday lunch pre-order: Guest 1: Roasted Chicken x1'). If
    // the structured API returns blocked but the booking has that legacy
    // text, surface it so kitchen can still see the pre-order. Spec §8.3.
    const legacyPreorderText = extractLegacyPreorderText(booking.special_requirements)
    if (legacyPreorderText) {
      return (
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Legacy pre-order (from special requirements)
          </p>
          <pre className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-gray-800">
            {legacyPreorderText}
          </pre>
          {data?.reason ? (
            <p className="text-xs text-gray-500 italic">
              Structured pre-order data unavailable ({data.reason}); showing free-text from booking notes.
            </p>
          ) : null}
        </div>
      )
    }
    return (
      <p className="text-sm text-gray-500">
        Pre-order not available{data?.reason ? `: ${data.reason}` : ''}
      </p>
    )
  }

  const itemsByType = {
    main: data.existing_items?.filter((i) => i.item_type === 'main') ?? [],
    side: data.existing_items?.filter((i) => i.item_type === 'side') ?? [],
    extra: data.existing_items?.filter((i) => i.item_type === 'extra') ?? [],
  }

  const hasItems = (data.existing_items?.length ?? 0) > 0

  if (editing) {
    return (
      <PreorderEditForm
        data={data}
        bookingId={booking.id}
        onSave={() => {
          setEditing(false)
          void load()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {data.sunday_preorder_completed_at ? '✓ Submitted by guest' : 'Not yet submitted'}
          </p>
          {data.sunday_preorder_cutoff_at && (
            <p className="text-xs text-gray-500 mt-0.5">
              Cutoff: {formatLondonDateTime(data.sunday_preorder_cutoff_at)}
              {data.cutoff_overridden && (
                <span className="ml-1 text-amber-600">(custom cutoff set)</span>
              )}
            </p>
          )}
        </div>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {hasItems ? 'Edit pre-order' : 'Create pre-order'}
          </Button>
        )}
      </div>

      {!hasItems && (
        <p className="text-sm text-gray-500 italic">No items on this pre-order yet.</p>
      )}

      {/* Mains */}
      {itemsByType.main.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Mains</p>
          {itemsByType.main.map((item) => (
            <div
              key={item.menu_dish_id}
              className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"
            >
              <span className="text-sm text-gray-900">
                {item.name_snapshot}
              </span>
              <span className="text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-0.5">
                &times; {item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Sides */}
      {itemsByType.side.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Sides</p>
          {itemsByType.side.map((item) => (
            <div
              key={item.menu_dish_id}
              className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"

[truncated at line 200 — original has 340 lines]
```

### `src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx`

```
'use client'

import React, { FormEvent } from 'react'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { cn } from '@/lib/utils'
import type {
  FohCreateMode,
  FohCustomerSearchResult,
  FohEventOption,
  SundayMenuItem,
  WalkInTargetTable,
} from '../types'
import {
  formatEventBookingMode,
  formatEventOptionDateTime,
  formatEventPaymentMode,
  formatGbp,
  isSundayDate,
} from '../utils'

export type CreateForm = {
  booking_date: string
  event_id: string
  phone: string
  customer_name: string
  first_name: string
  last_name: string
  time: string
  party_size: string
  purpose: 'food' | 'drinks' | 'event'
  sunday_lunch: boolean
  sunday_deposit_method: 'payment_link' | 'cash'
  sunday_preorder_mode: 'send_link' | 'capture_now'
  notes: string
  waive_deposit: boolean
  is_venue_event: boolean
}

type FohCreateBookingModalProps = {
  open: boolean
  createMode: FohCreateMode
  createForm: CreateForm
  canWaiveDeposit: boolean
  walkInTargetTable: WalkInTargetTable | null
  submittingBooking: boolean
  // Customer search
  customerQuery: string
  customerResults: FohCustomerSearchResult[]
  selectedCustomer: FohCustomerSearchResult | null
  searchingCustomers: boolean
  // Events
  eventOptions: FohEventOption[]
  loadingEventOptions: boolean
  eventOptionsError: string | null
  selectedEventOption: FohEventOption | null
  overlappingEventForTable: FohEventOption | null
  tableEventPromptAcknowledgedEventId: string | null
  walkInPurposeAutoSelectionEnabled: boolean
  // Sunday
  sundayMenuItems: SundayMenuItem[]
  loadingSundayMenu: boolean
  sundayMenuError: string | null
  sundayPreorderQuantities: Record<string, string>
  sundayMenuByCategory: Record<string, SundayMenuItem[]>
  sundaySelectedItemCount: number
  // Deposit
  formRequiresDeposit: boolean
  // Messages
  errorMessage: string | null
  // Callbacks
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSetCreateForm: (updater: (current: CreateForm) => CreateForm) => void
  onSetCustomerQuery: (query: string) => void
  onSelectCustomer: (customer: FohCustomerSearchResult) => void
  onClearCustomer: () => void
  onSetSundayPreorderQuantities: (updater: (current: Record<string, string>) => Record<string, string>) => void
  onSetTableEventPromptAcknowledgedEventId: (id: string | null) => void
  onSetWalkInPurposeAutoSelectionEnabled: (enabled: boolean) => void
  onRetrySundayMenu: () => void
  onSetErrorMessage: (msg: string | null) => void
}

export const FohCreateBookingModal = React.memo(function FohCreateBookingModal(props: FohCreateBookingModalProps) {
  const {
    open,
    createMode,
    createForm,
    canWaiveDeposit,
    walkInTargetTable,
    submittingBooking,
    customerQuery,
    customerResults,
    selectedCustomer,
    searchingCustomers,
    eventOptions,
    loadingEventOptions,
    eventOptionsError,
    selectedEventOption,
    overlappingEventForTable,
    tableEventPromptAcknowledgedEventId,
    walkInPurposeAutoSelectionEnabled,
    sundayMenuItems,
    loadingSundayMenu,
    sundayMenuError,
    sundayPreorderQuantities,
    sundayMenuByCategory,
    sundaySelectedItemCount,
    formRequiresDeposit,
    errorMessage,
    onClose,
    onSubmit,
    onSetCreateForm,
    onSetCustomerQuery,
    onSelectCustomer,
    onClearCustomer,
    onSetSundayPreorderQuantities,
    onSetTableEventPromptAcknowledgedEventId,
    onSetWalkInPurposeAutoSelectionEnabled,
    onRetrySundayMenu,
    onSetErrorMessage,
  } = props

  const sundaySelected = isSundayDate(createForm.booking_date)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={createMode === 'walk_in' ? 'Add walk-in' : 'Add booking'}
      description="Search existing customer by name or phone first. If not found, enter phone details to create a new customer."
      size="lg"
    >
      <form onSubmit={onSubmit} className="space-y-4">

        {/* Customer search section */}
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <label className="block text-xs font-medium text-gray-700">
            Find existing customer
            <input
              type="text"
              value={customerQuery}
              onChange={(event) => {
                onSetCustomerQuery(event.target.value)
                if (selectedCustomer) {
                  onClearCustomer()
                }
              }}
              placeholder="Search by name or phone"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <p className="mt-2 text-xs text-gray-500">
            Accepts international +... numbers; local numbers default to +44.
          </p>

          {searchingCustomers && <p className="mt-2 text-xs text-gray-500">Searching customers...</p>}

          {!selectedCustomer && !searchingCustomers && customerQuery.trim().length >= 2 && customerResults.length === 0 && (
            <div className="mt-2 px-4 py-2 text-sm text-gray-500">No customers found</div>
          )}

          {!selectedCustomer && customerResults.length > 0 && (
            <div className="mt-2 max-h-56 overflow-auto rounded-md border border-gray-200 bg-white">
              {customerResults.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => onSelectCustomer(customer)}
                  className="flex w-full items-start justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 last:border-b-0"
                >
                  <span className="font-medium text-gray-900">{customer.full_name}</span>
                  <span className="text-xs text-gray-500">{customer.display_phone || 'No phone'}</span>
                </button>
              ))}
            </div>
          )}

          {selectedCustomer && (
            <div className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">Using customer: {selectedCustomer.full_name}</p>
                  <p className="text-xs text-green-700">{selectedCustomer.display_phone || 'No stored phone'}</p>
                </div>
                <button
                  type="button"
                  onClick={onClearCustomer}
                  className="rounded border border-green-300 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-100"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        {createMode === 'walk_in' && walkInTargetTable && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">

[truncated at line 200 — original has 679 lines]
```

### `src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts`

```
'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  FohCreateMode,
  FohCustomerSearchResult,
  FohEventOption,
  FohScheduleResponse,
  SundayMenuItem,
  TimelineRange,
  WalkInTargetTable,
} from '../types'
import type { CreateForm } from '../components/FohCreateBookingModal'
import {
  DEFAULT_COUNTRY_CODE,
  getTableWindowMs,
  isSundayDate,
  mapFohBlockedReason,
  mapFohEventBlockedReason,
  postBookingAction,
  resolveWalkInDefaults,
  splitName,
  suggestWalkInTime,
} from '../utils'
import type { FohCreateBookingResponse, FohCreateEventBookingResponse } from '../types'
import { requiresDeposit as requiresDepositForParty } from '@/lib/table-bookings/deposit'

export type UseFohCreateBookingReturn = {
  isCreateModalOpen: boolean
  createMode: FohCreateMode
  createForm: CreateForm
  walkInTargetTable: WalkInTargetTable | null
  submittingBooking: boolean
  searchingCustomers: boolean
  customerQuery: string
  customerResults: FohCustomerSearchResult[]
  selectedCustomer: FohCustomerSearchResult | null
  sundayMenuItems: SundayMenuItem[]
  loadingSundayMenu: boolean
  sundayMenuError: string | null
  sundayPreorderQuantities: Record<string, string>
  eventOptions: FohEventOption[]
  loadingEventOptions: boolean
  eventOptionsError: string | null
  walkInPurposeAutoSelectionEnabled: boolean
  tableEventPromptAcknowledgedEventId: string | null
  hasLoadedSundayMenu: boolean
  // Computed
  sundayMenuByCategory: Record<string, SundayMenuItem[]>
  sundaySelectedItemCount: number
  selectedEventOption: FohEventOption | null
  overlappingEventForTable: FohEventOption | null
  formRequiresDeposit: boolean
  // Actions
  setCreateForm: (updater: (current: CreateForm) => CreateForm) => void
  setCustomerQuery: (query: string) => void
  setSelectedCustomer: (customer: FohCustomerSearchResult | null) => void
  setCustomerResults: (results: FohCustomerSearchResult[]) => void
  setSundayPreorderQuantities: (updater: (current: Record<string, string>) => Record<string, string>) => void
  setTableEventPromptAcknowledgedEventId: (id: string | null) => void
  setWalkInPurposeAutoSelectionEnabled: (enabled: boolean) => void
  openCreateModal: (options?: {
    mode?: FohCreateMode; laneTableId?: string; laneTableName?: string; suggestedTime?: string
    prefill?: Partial<Pick<CreateForm, 'booking_date' | 'purpose' | 'event_id'>>
  }) => void
  closeCreateModal: () => void
  handleCreateBooking: (event: FormEvent<HTMLFormElement>) => void
  retrySundayMenu: () => void
}

export function useFohCreateBooking(input: {
  date: string
  clockNow: Date
  canEdit: boolean
  schedule: FohScheduleResponse['data'] | null
  timeline: TimelineRange
  setErrorMessage: (msg: string | null) => void
  setStatusMessage: (msg: string | null) => void
  reloadSchedule: (opts?: { requestedDate?: string; surfaceError?: boolean }) => Promise<void>
}): UseFohCreateBookingReturn {
  const { date, clockNow, canEdit, schedule, timeline, setErrorMessage, setStatusMessage, reloadSchedule } = input

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [createMode, setCreateMode] = useState<FohCreateMode>('booking')
  const [walkInTargetTable, setWalkInTargetTable] = useState<WalkInTargetTable | null>(null)
  const [submittingBooking, setSubmittingBooking] = useState(false)
  const [searchingCustomers, setSearchingCustomers] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<FohCustomerSearchResult[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<FohCustomerSearchResult | null>(null)
  const [sundayMenuItems, setSundayMenuItems] = useState<SundayMenuItem[]>([])
  const [loadingSundayMenu, setLoadingSundayMenu] = useState(false)
  const [hasLoadedSundayMenu, setHasLoadedSundayMenu] = useState(false)
  const [sundayMenuError, setSundayMenuError] = useState<string | null>(null)
  const [sundayPreorderQuantities, setSundayPreorderQuantities] = useState<Record<string, string>>({})
  const [eventOptions, setEventOptions] = useState<FohEventOption[]>([])
  const [loadingEventOptions, setLoadingEventOptions] = useState(false)
  const [eventOptionsError, setEventOptionsError] = useState<string | null>(null)
  const [walkInPurposeAutoSelectionEnabled, setWalkInPurposeAutoSelectionEnabled] = useState(false)
  const [tableEventPromptAcknowledgedEventId, setTableEventPromptAcknowledgedEventId] = useState<string | null>(null)

  const [createForm, setCreateForm] = useState<CreateForm>({
    booking_date: date,
    event_id: '',
    phone: '',
    customer_name: '',
    first_name: '',
    last_name: '',
    time: '19:00',
    party_size: '2',
    purpose: 'food' as 'food' | 'drinks' | 'event',
    sunday_lunch: false,
    sunday_deposit_method: 'payment_link' as 'payment_link' | 'cash',
    sunday_preorder_mode: 'send_link' as 'send_link' | 'capture_now',
    notes: '',
    waive_deposit: false,
    is_venue_event: false
  })

  // --- Customer search ---
  useEffect(() => {
    if (selectedCustomer) { setCustomerResults([]); return }
    const query = customerQuery.trim()
    if (query.length < 2) { setCustomerResults([]); return }
    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setSearchingCustomers(true)
      try {
        const params = new URLSearchParams({ q: query, default_country_code: DEFAULT_COUNTRY_CODE })
        const response = await fetch(`/api/foh/customers/search?${params.toString()}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error((payload && payload.error) || 'Customer search failed')
        if (!cancelled) {
          setCustomerResults(Array.isArray(payload?.data) ? payload.data as FohCustomerSearchResult[] : [])
        }
      } catch {
        if (!cancelled) setCustomerResults([])
      } finally {
        if (!cancelled) setSearchingCustomers(false)
      }
    }, 280)
    return () => { cancelled = true; window.clearTimeout(timeoutId) }
  }, [customerQuery, selectedCustomer])

  // --- Sunday date guard ---
  useEffect(() => {
    if (isSundayDate(createForm.booking_date)) return
    setCreateForm((current) => ({
      ...current, sunday_lunch: false, sunday_deposit_method: 'payment_link', sunday_preorder_mode: 'send_link'
    }))
    setSundayPreorderQuantities({})
  }, [createForm.booking_date])

  // --- Sunday menu loader ---
  useEffect(() => {
    if (!isCreateModalOpen || !createForm.sunday_lunch || !isSundayDate(createForm.booking_date)) return
    if (hasLoadedSundayMenu || loadingSundayMenu) return
    let cancelled = false
    const controller = new AbortController()
    let timeoutId: number | null = null
    const loadSundayMenu = async () => {
      setLoadingSundayMenu(true)
      setSundayMenuError(null)
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => { controller.abort(); reject(new Error('Loading Sunday lunch menu timed out. Please retry.')) }, 12_000)
        })
        const response = (await Promise.race([
          fetch('/api/foh/sunday-preorder/menu', { cache: 'no-store', signal: controller.signal }),
          timeoutPromise
        ])) as Response
        if (timeoutId != null) { window.clearTimeout(timeoutId); timeoutId = null }
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load Sunday lunch menu')
        if (!cancelled) setSundayMenuItems(Array.isArray(payload?.data) ? payload.data as SundayMenuItem[] : [])
      } catch (error) {
        if (!cancelled) setSundayMenuError(error instanceof Error ? error.message : 'Failed to load Sunday lunch menu')
      } finally {
        if (timeoutId != null) { window.clearTimeout(timeoutId); timeoutId = null }
        if (!cancelled) { setLoadingSundayMenu(false); setHasLoadedSundayMenu(true) }
      }
    }
    void loadSundayMenu()
    return () => { cancelled = true; if (timeoutId != null) window.clearTimeout(timeoutId); controller.abort() }
  }, [createForm.booking_date, createForm.sunday_lunch, hasLoadedSundayMenu, isCreateModalOpen])

  // --- Event options loader ---
  useEffect(() => {
    if (!isCreateModalOpen) return
    const bookingDate = createForm.booking_date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) { setEventOptions([]); setEventOptionsError('Please choose a valid event date'); return }
    let cancelled = false
    const controller = new AbortController()
    const loadEvents = async () => {
      setLoadingEventOptions(true)
      setEventOptionsError(null)
      try {
        const params = new URLSearchParams({ date: bookingDate })
        const response = await fetch(`/api/foh/events?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
        const payload = await response.json().catch(() => null)

[truncated at line 200 — original has 516 lines]
```

### `src/app/api/boh/table-bookings/[id]/party-size/route.ts`

```
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import {
  mapSeatUpdateBlockedReason,
  updateTableBookingPartySizeWithLinkedEventSeats
} from '@/lib/events/staff-seat-updates'
import { createAdminClient } from '@/lib/supabase/admin'
import { createGuestToken } from '@/lib/guest/tokens'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { ensureReplyInstruction } from '@/lib/sms/support'
import {
  getCanonicalDeposit,
  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
  requiresDeposit,
} from '@/lib/table-bookings/deposit'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Threshold + per-person rate now live in the centralised deposit helper —
// see src/lib/table-bookings/deposit.ts. Spec §7.3, §8.3.
const DEPOSIT_PER_PERSON_GBP = LARGE_GROUP_DEPOSIT_PER_PERSON_GBP

const UpdatePartySizeSchema = z.object({
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  send_sms: z.boolean().optional().default(true)
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdatePartySizeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid party size',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const newPartySize = parsed.data.party_size
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/+$/, '')

  // Read current booking state before the update so we can detect threshold crossings
  const { data: currentBooking, error: fetchError } = await auth.supabase.from('table_bookings')
    .select('id, party_size, status, payment_status, customer_id, booking_date, booking_reference, booking_type, start_datetime, deposit_amount, deposit_amount_locked, deposit_waived')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !currentBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const previousPartySize = Math.max(1, Number(currentBooking.party_size || 1))
  const currentStatus: string = currentBooking.status || ''
  const currentPaymentStatus: string | null = currentBooking.payment_status || null

  try {
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(auth.supabase, {
      tableBookingId: id,
      partySize: newPartySize,
      actor: 'boh',
      sendSms: parsed.data.send_sms,
      appBaseUrl
    })

    if (result.state === 'blocked') {
      return NextResponse.json(
        {
          error: mapSeatUpdateBlockedReason(result.reason),
          reason: result.reason || null
        },
        { status: 409 }
      )
    }

    // ── Threshold crossing detection ──────────────────────────────────────────

    const depositWaived = currentBooking.deposit_waived === true
    const wasDepositRequired = requiresDeposit(previousPartySize, { depositWaived })
    const isNowDepositRequired = requiresDeposit(newPartySize, { depositWaived })
    const depositAlreadyHandled = ['completed', 'refunded'].includes(currentPaymentStatus ?? '')

    // Case 1: Party increased past the deposit threshold — request deposit
    if (!wasDepositRequired && isNowDepositRequired && !depositAlreadyHandled) {
      // Read the canonical amount: locked > stored > computed. If a lock
      // already exists (paid bookings), it stays — the SMS link will quote
      // the locked amount. Otherwise compute from the new party size.
      // Spec §3 step 9, §7.3, §7.4, §8.3.
      const depositAmount = getCanonicalDeposit(
        {
          party_size: newPartySize,
          deposit_amount: currentBooking.deposit_amount ?? null,
          deposit_amount_locked: currentBooking.deposit_amount_locked ?? null,
          status: currentBooking.status ?? null,
          payment_status: currentBooking.payment_status ?? null,
          deposit_waived: currentBooking.deposit_waived ?? null,
        },
        newPartySize,
      )
      const depositLabel = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(depositAmount)
      const isSundayLunch = currentBooking.booking_type === 'sunday_lunch'

      // 1. Move booking to pending_payment
      await auth.supabase.from('table_bookings')
        .update({ status: 'pending_payment', payment_status: 'pending' })
        .eq('id', id)

      // 2. Generate deposit payment link (admin client to bypass RLS for guest token creation)
      let depositUrl: string | null = null
      try {
        if (currentBooking.customer_id) {
          const holdExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
          const admin = createAdminClient()
          const { rawToken } = await createGuestToken(admin, {
            customerId: currentBooking.customer_id,
            actionType: 'payment',
            tableBookingId: id,
            expiresAt: holdExpiry.toISOString(),
          })
          depositUrl = `${appBaseUrl}/g/${rawToken}/table-payment`
        }
      } catch (tokenError) {
        logger.error('Failed to generate deposit payment token after party-size threshold crossing', {
          error: tokenError instanceof Error ? tokenError : new Error(String(tokenError)),
          metadata: { tableBookingId: id },
        })
      }

      // 3. Send SMS to customer with the deposit link
      let smsSent = false
      if (parsed.data.send_sms && currentBooking.customer_id && depositUrl) {
        try {
          const { data: customer } = await auth.supabase
            .from('customers')
            .select('id, first_name, mobile_number, sms_status')
            .eq('id', currentBooking.customer_id)
            .maybeSingle()

          if (customer && customer.sms_status === 'active' && customer.mobile_number) {
            const firstName = getSmartFirstName(customer.first_name)
            const seatWord = newPartySize === 1 ? 'person' : 'people'
            const depositKindLabel = isSundayLunch ? 'Sunday lunch deposit' : 'table deposit'
            const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
            // Only include the (party_size × per-person) breakdown when the
            // canonical amount actually matches that simple multiplication —
            // for paid/locked bookings the breakdown could be misleading.
            const expectedSimpleTotal = newPartySize * DEPOSIT_PER_PERSON_GBP
            const breakdownNote = depositAmount === expectedSimpleTotal
              ? ` (${newPartySize} x £${DEPOSIT_PER_PERSON_GBP})`
              : ''
            const smsBody = `The Anchor: Hi ${firstName}, your party size has been updated to ${newPartySize} ${seatWord}. A ${depositKindLabel} of ${depositLabel}${breakdownNote} is now required to secure your booking. Pay now: ${depositUrl}`
            await sendSMS(
              customer.mobile_number,
              ensureReplyInstruction(smsBody, supportPhone),
              {
                customerId: currentBooking.customer_id,
                metadata: {
                  table_booking_id: id,
                  template_key: 'table_booking_pending_payment',
                  trigger: 'party_size_threshold_crossed',
                }
              }
            )
            smsSent = true
          }
        } catch (smsError) {
          logger.warn('Failed to send deposit SMS after party-size threshold crossing', {
            metadata: {
              tableBookingId: id,
              customerId: currentBooking.customer_id,
              error: smsError instanceof Error ? smsError.message : String(smsError),
            },
          })
        }

[truncated at line 200 — original has 236 lines]
```

### `src/app/api/business/hours/route.ts`

```
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getTodayIsoDate, getLocalIsoDateDaysAhead } from '@/lib/dateUtils';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export async function GET(_request: NextRequest) {
  try {
    // This endpoint can be public for SEO purposes
    const supabase = createAdminClient();
    
    // Get regular hours
    const { data: regularHours, error: hoursError } = await supabase
      .from('business_hours')
      .select('*')
      .order('day_of_week', { ascending: true });

    if (hoursError) {
      console.error('Failed to fetch business hours:', hoursError);
      return createErrorResponse('Failed to fetch business hours', 'DATABASE_ERROR', 500);
    }

    // Get special hours for the next 90 days
    const today = new Date();

    let specialHours = [];
    try {
      const { data, error } = await supabase
        .from('special_hours')
        .select('*')
        .gte('date', getTodayIsoDate())
        .lte('date', getLocalIsoDateDaysAhead(90))
        .order('date', { ascending: true });
      
      if (error) {
        console.error('Special hours query failed:', error);
        // Continue with empty special hours instead of failing
      } else {
        specialHours = data || [];
      }
    } catch (specialError) {
      console.error('Special hours error:', specialError);
      // Continue with empty special hours
    }

    let serviceStatuses: any[] = [];
    try {
      const { data, error } = await supabase
        .from('service_statuses')
        .select('service_code, display_name, is_enabled, message, updated_at')
        .order('updated_at', { ascending: true });

      if (error) {
        console.error('Service status query failed:', error);
      } else {
        serviceStatuses = data || [];
      }
    } catch (serviceStatusError) {
      console.error('Service status error:', serviceStatusError);
    }

    let serviceStatusOverrides: any[] = [];
    try {
      const { data, error } = await supabase
        .from('service_status_overrides')
        .select('service_code, start_date, end_date, is_enabled, message, updated_at, created_by')
        .gte('end_date', format(today, 'yyyy-MM-dd'))
        .order('start_date', { ascending: true });

      if (error) {
        console.error('Service status overrides query failed:', error);
      } else {
        serviceStatusOverrides = data || [];
      }
    } catch (serviceOverridesError) {
      console.error('Service status overrides error:', serviceOverridesError);
    }

    // Get today's events for capacity information
    const todayStr = format(today, 'yyyy-MM-dd');
    const { data: todayEvents } = await supabase
      .from('events')
      .select('id, title, start_date, start_time, capacity')
      .eq('start_date', todayStr)
      .order('start_time', { ascending: true });

    // Table booking functionality removed; omit reservation capacity + slot calculations.

  // Format regular hours
  const formattedRegularHours = regularHours?.reduce((acc: any, hour) => {
    const dayName = DAY_NAMES[hour.day_of_week];
    acc[dayName] = {
      opens: hour.opens,
      closes: hour.closes,
      kitchen: hour.is_kitchen_closed ? null : (hour.kitchen_opens && hour.kitchen_closes ? {
        opens: hour.kitchen_opens,
        closes: hour.kitchen_closes,
      } : null),
      is_closed: hour.is_closed,
      is_kitchen_closed: hour.is_kitchen_closed,
      schedule_config: hour.schedule_config || [] // Expose new config
    };
    return acc;
  }, {}) || {};

  // Format special hours - handle kitchen closure based on null values or venue closure
  const formattedSpecialHours = specialHours?.map(special => ({
    date: special.date,
    opens: special.opens,
    closes: special.closes,
    kitchen: (special.is_closed || special.is_kitchen_closed) ? null : (special.kitchen_opens && special.kitchen_closes ? {
      opens: special.kitchen_opens,
      closes: special.kitchen_closes,
    } : null),
    is_kitchen_closed: special.is_kitchen_closed ?? false,
    status: special.is_closed ? 'closed' : 'modified',
    note: special.note,
    schedule_config: special.schedule_config || [] // Expose new config
  })) || [];

  const serviceStatus = serviceStatuses.reduce(
    (acc: Record<string, { displayName: string; isEnabled: boolean; message: string | null; updatedAt: string }>, status: any) => {
      acc[status.service_code] = {
        displayName: status.display_name,
        isEnabled: status.is_enabled !== false,
        message: status.message,
        updatedAt: status.updated_at,
      };
      return acc;
    },
    {}
  );

  const serviceOverrides = serviceStatusOverrides.reduce(
    (acc: Record<string, Array<{ startDate: string; endDate: string; isEnabled: boolean; message: string | null; updatedAt: string; createdBy?: string }>>, override: any) => {
      if (!acc[override.service_code]) {
        acc[override.service_code] = [];
      }
      acc[override.service_code].push({
        startDate: override.start_date,
        endDate: override.end_date,
        isEnabled: override.is_enabled,
        message: override.message,
        updatedAt: override.updated_at,
        createdBy: override.created_by,
      });
      return acc;
    },
    {}
  );

  const sundayLunchStatus = serviceStatus['sunday_lunch'];
  const sundayOverrides = serviceOverrides['sunday_lunch'] || [];
  const sundayLunchEnabled = sundayLunchStatus ? sundayLunchStatus.isEnabled : true;

  console.warn('[BusinessHours API] Sunday Lunch Status:', {
    status: sundayLunchStatus,
    enabled: sundayLunchEnabled,
    overridesCount: sundayOverrides.length
  });

  // Calculate current status in London timezone
  const timeZone = 'Europe/London';
  const now = new Date();
  const nowInLondon = toZonedTime(now, timeZone);
  const currentDay = nowInLondon.getDay();
  const currentTime = format(nowInLondon, 'HH:mm:ss');
  const todayDate = format(nowInLondon, 'yyyy-MM-dd');
  const currentDayName = DAY_NAMES[currentDay];
  

  // Check if today has special hours
  const todaySpecial = specialHours?.find(s => s.date === todayDate);
  let currentStatus: any = {
    isOpen: false,
    kitchenOpen: false,
    closesIn: null,
    opensIn: null,
  };

  if (todaySpecial) {
    if (!todaySpecial.is_closed && todaySpecial.opens && todaySpecial.closes) {
      // Handle venues that close at or after midnight
      const isCurrentlyOpen = todaySpecial.closes <= todaySpecial.opens
        ? (currentTime >= todaySpecial.opens || currentTime < todaySpecial.closes)
        : (currentTime >= todaySpecial.opens && currentTime < todaySpecial.closes);
      
      const isKitchenOpen = todaySpecial.is_kitchen_closed ? false : 
        !!(todaySpecial.kitchen_opens && todaySpecial.kitchen_closes &&
        (todaySpecial.kitchen_closes <= todaySpecial.kitchen_opens
          ? (currentTime >= todaySpecial.kitchen_opens || currentTime < todaySpecial.kitchen_closes)
          : (currentTime >= todaySpecial.kitchen_opens && currentTime < todaySpecial.kitchen_closes)));

      currentStatus = {
        isOpen: isCurrentlyOpen,
        kitchenOpen: isKitchenOpen,
        closesIn: isCurrentlyOpen ? calculateTimeUntil(currentTime, todaySpecial.closes) : null,

[truncated at line 200 — original has 511 lines]
```

### `src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts`

```
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { withApiAuth } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { capturePayPalPayment } from '@/lib/paypal';
import { logAuditEvent } from '@/app/actions/audit';
import { logger } from '@/lib/logger';
import {
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
} from '@/lib/table-bookings/bookings';

export const dynamic = 'force-dynamic';

const CaptureOrderSchema = z.object({
  orderId: z.string().min(1),
});

/**
 * Parse the captured GBP amount from a PayPal v2 capture response.
 * Returns the GBP value as a finite number, or null when missing/unparseable.
 *
 * Caller MUST fail closed on null — silently falling back to
 * `booking.deposit_amount` would let stale amounts get locked. Spec §6, §7.4, §8.3.
 */
function parseCapturedAmountGbp(
  captureResult: { amount?: string | number | null } | null | undefined,
): number | null {
  if (!captureResult || captureResult.amount === undefined || captureResult.amount === null) {
    return null;
  }
  const raw = captureResult.amount;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: bookingId } = await params;

  return withApiAuth(
    async () => {
      // Parse and validate request body
      let orderId: string;
      try {
        const body = await request.json();
        const parsed = CaptureOrderSchema.parse(body);
        orderId = parsed.orderId;
      } catch {
        return NextResponse.json({ error: 'Invalid request body. orderId is required.' }, { status: 400 });
      }

      const supabase = createAdminClient();

      // Fetch the booking
      const { data: booking, error: fetchError } = await supabase
        .from('table_bookings')
        .select('id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id, party_size, start_datetime, booking_reference, booking_type, source')
        .eq('id', bookingId)
        .single();

      if (fetchError || !booking) {
        if (fetchError) {
          logger.error('capture-order: booking fetch failed', {
            error: new Error(fetchError.message),
            metadata: { bookingId, code: fetchError.code, details: fetchError.details },
          });
        }
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      // Idempotent: if already captured, return success without reprocessing
      if (booking.payment_status === 'completed' && booking.paypal_deposit_capture_id !== null) {
        return NextResponse.json({ success: true });
      }

      // Validate orderId matches what we stored
      if (booking.paypal_deposit_order_id !== orderId) {
        return NextResponse.json({ error: 'Order ID mismatch' }, { status: 400 });
      }

      // Capture the PayPal payment
      let captureResult: { transactionId: string; status: string; payerId?: string; amount?: string };
      try {
        captureResult = await capturePayPalPayment(orderId);
      } catch (err) {
        void logAuditEvent({
          operation_type: 'payment.capture_failed',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId,
            error: err instanceof Error ? err.message : 'Unknown error',
          },
        });
        return NextResponse.json(
          { error: 'Failed to capture PayPal payment. Please try again.' },
          { status: 502 },
        );
      }

      const transactionId = captureResult.transactionId;

      // Lock the actually-captured GBP amount on the booking — authoritative
      // source for what the customer was charged. Fail closed if the capture
      // response is missing/malformed: do NOT update payment_status, log a
      // high-severity error, and return 502 so the customer sees an explicit
      // "we couldn't confirm your payment" state. We deliberately do NOT
      // fall back to booking.deposit_amount — that's how stale amounts get
      // locked. Spec §6, §7.4, §8.3.
      const lockedAmountGbp = parseCapturedAmountGbp(captureResult);
      if (lockedAmountGbp === null) {
        logger.error('paypal-capture: capture succeeded but no parseable GBP amount in response', {
          metadata: {
            bookingId,
            orderId,
            transactionId,
            // Capture the raw amount value so on-call can investigate.
            rawAmount: captureResult?.amount ?? null,
            captureStatus: captureResult?.status ?? null,
          },
        });
        void logAuditEvent({
          operation_type: 'payment.capture_amount_unparseable',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId,
            transactionId,
            rawAmount: String(captureResult?.amount ?? 'null'),
            action_needed:
              'PayPal capture succeeded but the captured amount was missing or unparseable — manual reconciliation required before unlocking the booking',
          },
        });
        return NextResponse.json(
          {
            error: 'Payment captured but amount could not be verified. Please contact support; do not retry.',
          },
          { status: 502 },
        );
      }

      // Update the booking atomically — including deposit_amount_locked so
      // any future recompute (party-size change, blind compute, etc.) honours
      // the actually-captured amount.
      const { error: updateError } = await supabase
        .from('table_bookings')
        .update({
          payment_status: 'completed',
          status: 'confirmed',
          payment_method: 'paypal',
          paypal_deposit_capture_id: transactionId,
          deposit_amount_locked: lockedAmountGbp,
        })
        .eq('id', bookingId);

      if (updateError) {
        // PayPal captured but DB update failed — log for manual reconciliation
        void logAuditEvent({
          operation_type: 'payment.capture_local_update_failed',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId,
            transactionId,
            dbError: updateError.message,
            action_needed: 'Manual reconciliation required — PayPal capture succeeded but DB update failed',
          },
        });
        return NextResponse.json(
          { error: 'Payment captured but booking update failed. Our team has been notified.' },
          { status: 502 },
        );
      }

      // Audit log success
      void logAuditEvent({
        operation_type: 'payment.captured',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          orderId,
          transactionId,
          bookingId,
          lockedAmountGbp,
        },
      });

      // Send confirmation notifications now that payment is confirmed.
      // Both were deferred at booking-creation time for website bookings awaiting deposit.
      if (booking.customer_id) {
        const bookingResultForNotifications = {
          state: 'confirmed' as const,

[truncated at line 200 — original has 235 lines]
```

### `src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts`

```
import { NextRequest, NextResponse } from 'next/server';

import { withApiAuth } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createInlinePayPalOrder } from '@/lib/paypal';
import { logAuditEvent } from '@/app/actions/audit';
import { logger } from '@/lib/logger';
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: bookingId } = await params;

  return withApiAuth(
    async () => {
      const supabase = createAdminClient();

      // Fetch the booking. We pull `deposit_amount_locked`, `deposit_waived`,
      // and `booking_type` so the canonical-deposit reader can honour locked
      // amounts and waivers. Spec §7.3, §8.3.
      const { data: booking, error: fetchError } = await supabase
        .from('table_bookings')
        .select('id, party_size, status, payment_status, paypal_deposit_order_id, deposit_amount, deposit_amount_locked, deposit_waived, booking_type')
        .eq('id', bookingId)
        .single();

      if (fetchError || !booking) {
        if (fetchError) {
          logger.error('create-order: booking fetch failed', {
            error: new Error(fetchError.message),
            metadata: { bookingId, code: fetchError.code, details: fetchError.details },
          });
        }
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      // If already paid (payment completed), return 409
      if (booking.payment_status === 'completed') {
        return NextResponse.json(
          { error: 'Deposit has already been paid for this booking' },
          { status: 409 },
        );
      }

      // Only proceed if the booking is awaiting payment
      const awaitingDeposit =
        booking.status === 'pending_payment' || booking.payment_status === 'pending';

      if (!awaitingDeposit) {
        return NextResponse.json(
          { error: 'This booking does not require a deposit payment' },
          { status: 400 },
        );
      }

      // Idempotent: return existing order ID without calling PayPal again
      if (booking.paypal_deposit_order_id) {
        return NextResponse.json({ orderId: booking.paypal_deposit_order_id });
      }

      // Read canonical deposit (locked > stored > computed). This stops
      // blind party_size * 10 recompute and honours
      // `deposit_amount_locked` for paid/refunded bookings. Spec §3 step 9,
      // §7.3, §7.4, §8.3.
      const depositAmount = getCanonicalDeposit(
        {
          party_size: booking.party_size,
          deposit_amount: booking.deposit_amount ?? null,
          deposit_amount_locked: booking.deposit_amount_locked ?? null,
          status: booking.status ?? null,
          payment_status: booking.payment_status ?? null,
          deposit_waived: booking.deposit_waived ?? null,
        },
        booking.party_size,
      );
      if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
        return NextResponse.json(
          { error: 'No deposit required for this booking.' },
          { status: 400 },
        );
      }

      let paypalOrder: { orderId: string };
      try {
        paypalOrder = await createInlinePayPalOrder({
          customId: bookingId,
          reference: `tb-deposit-${bookingId}`,
          description: `Table booking deposit – ${booking.party_size} guests`,
          amount: depositAmount,
          currency: 'GBP',
          requestId: `tb-deposit-${bookingId}`,
        });
      } catch (err) {
        return NextResponse.json(
          { error: 'Failed to create PayPal order. Please try again.' },
          { status: 502 },
        );
      }

      // Persist the order ID. Deliberately NOT writing deposit_amount here —
      // the canonical reader is the source of truth and `deposit_amount_locked`
      // is set by the capture path on successful payment. Spec §7.3, §7.4, §8.3.
      const { error: persistError } = await supabase
        .from('table_bookings')
        .update({
          paypal_deposit_order_id: paypalOrder.orderId,
        })
        .eq('id', bookingId);

      if (persistError) {
        void logAuditEvent({
          operation_type: 'payment.order_persist_failed',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId: paypalOrder.orderId,
            amount: depositAmount,
            dbError: persistError.message,
            action_needed: 'PayPal order created but order ID not persisted — manual reconciliation may be needed',
          },
        });
        return NextResponse.json(
          { error: 'Order created but could not be saved. Please try again.' },
          { status: 502 },
        );
      }

      // Audit log
      void logAuditEvent({
        operation_type: 'payment.order_created',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          orderId: paypalOrder.orderId,
          amount: depositAmount,
          currency: 'GBP',
          bookingId,
          partySize: booking.party_size,
        },
      });

      return NextResponse.json({ orderId: paypalOrder.orderId });
    },
    ['read:events'],
    request,
  );
}
```

### `src/app/api/foh/bookings/route.ts`

```
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { fromZonedTime } from 'date-fns-tz'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createClient } from '@/lib/supabase/server'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logAuditEvent } from '@/app/actions/audit'
import {
  alignTablePaymentHoldToScheduledSend,
  createTablePaymentToken,
  mapTableBookingBlockedReason,
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendSundayPreorderLinkSmsIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
  type TableBookingRpcResult
} from '@/lib/table-bookings/bookings'
import { saveSundayPreorderByBookingId } from '@/lib/table-bookings/sunday-preorder'
import {
  computeDepositAmount,
  requiresDeposit as requiresDepositForParty,
} from '@/lib/table-bookings/deposit'

const STRICT_SUNDAY_LUNCH_OPERATOR_EMAIL = 'manager@the-anchor.pub'

const SundayPreorderItemSchema = z.object({
  menu_dish_id: z.string().uuid(),
  quantity: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(25)
  )
})

const CreateFohTableBookingSchema = z.object({
  customer_id: z.string().uuid().optional(),
  phone: z.string().trim().min(7).max(32).optional(),
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
  walk_in: z.boolean().optional(),
  walk_in_guest_name: z.string().trim().max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  purpose: z.enum(['food', 'drinks']),
  notes: z.string().trim().max(500).optional(),
  sunday_lunch: z.boolean().optional(),
  sunday_deposit_method: z.enum(['cash', 'payment_link']).optional(),
  sunday_preorder_mode: z.enum(['send_link', 'capture_now']).optional(),
  sunday_preorder_items: z.array(SundayPreorderItemSchema).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  management_override: z.boolean().optional(),
  waive_deposit: z.boolean().optional(),
  is_venue_event: z.boolean().optional().default(false)
}).superRefine((value, context) => {
  if (!value.customer_id && !value.phone && value.walk_in !== true && value.management_override !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide a customer or phone number'
    })
  }

  if (value.management_override === true && !value.customer_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Management override requires a selected customer'
    })
  }

  if (value.sunday_preorder_mode === 'capture_now') {
    if (value.sunday_lunch !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Capture now can only be used for Sunday lunch bookings'
      })
      return
    }

    if ((value.sunday_preorder_items || []).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add at least one Sunday lunch item or choose send link'
      })
    }
  }

  // Deposit not required for management overrides, deposit waivers, or venue events — they bypass deposit restrictions.
  // The deposit threshold is the centralised 10+ rule; legacy `sunday_lunch` flag is kept for admin-only legacy
  // creation but no longer drives the deposit-required decision. Spec §8.3.
  if (
    value.management_override !== true &&
    value.waive_deposit !== true &&
    value.is_venue_event !== true &&
    value.party_size != null &&
    requiresDepositForParty(value.party_size) &&
    value.sunday_deposit_method == null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose cash or payment link for the table deposit'
    })
  }
})

function splitWalkInGuestName(fullName: string | null | undefined): {
  firstName?: string
  lastName?: string
} {
  if (!fullName) {
    return {}
  }

  const cleaned = fullName.trim()
  if (!cleaned) {
    return {}
  }

  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return {}
  }

  if (parts.length === 1) {
    return { firstName: parts[0] }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  }
}

function isSundayIsoDate(dateIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false
  const parsed = new Date(`${dateIso}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.getUTCDay() === 0
}

function hasManagerSundayLunchCutoffPassed(bookingDateIso: string, now = new Date()): boolean {
  if (!isSundayIsoDate(bookingDateIso)) return false

  const sundayMiddayUtc = new Date(`${bookingDateIso}T12:00:00Z`)
  if (!Number.isFinite(sundayMiddayUtc.getTime())) return false

  const saturdayMiddayUtc = new Date(sundayMiddayUtc)
  saturdayMiddayUtc.setUTCDate(saturdayMiddayUtc.getUTCDate() - 1)
  const saturdayDateIso = saturdayMiddayUtc.toISOString().slice(0, 10)
  const cutoffDateTime = fromZonedTime(`${saturdayDateIso}T13:00:00`, 'Europe/London')

  if (!Number.isFinite(cutoffDateTime.getTime())) return false
  return now.getTime() >= cutoffDateTime.getTime()
}

function isStrictSundayLunchOperator(email: string | null | undefined): boolean {
  return (email || '').trim().toLowerCase() === STRICT_SUNDAY_LUNCH_OPERATOR_EMAIL
}

async function shouldAutoPromoteSundayLunchForFoh(input: {
  supabase: any
  bookingDate: string
  bookingTime: string
  purpose: 'food' | 'drinks'
  sundayLunchExplicit: boolean
  userId: string
}): Promise<boolean> {
  if (input.sundayLunchExplicit || input.purpose !== 'food' || !isSundayIsoDate(input.bookingDate)) {
    return false
  }

  const [regularWindowResult, sundayWindowResult] = await Promise.all([
    input.supabase.rpc('table_booking_matches_service_window_v05', {
      p_booking_date: input.bookingDate,
      p_booking_time: input.bookingTime,
      p_booking_purpose: input.purpose,
      p_sunday_lunch: false
    }),
    input.supabase.rpc('table_booking_matches_service_window_v05', {
      p_booking_date: input.bookingDate,
      p_booking_time: input.bookingTime,
      p_booking_purpose: input.purpose,
      p_sunday_lunch: true
    })
  ])

  if (regularWindowResult.error || sundayWindowResult.error) {
    logger.warn('Failed to evaluate FOH Sunday lunch auto-promotion window checks', {
      metadata: {
        userId: input.userId,
        bookingDate: input.bookingDate,
        bookingTime: input.bookingTime,
        regularError: regularWindowResult.error?.message || null,
        sundayError: sundayWindowResult.error?.message || null
      }
    })
    return false

[truncated at line 200 — original has 1560 lines]
```

### `src/app/api/stripe/webhook/route.ts`

```
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import {
  createStripeRefund,
  verifyStripeWebhookSignature
} from '@/lib/payments/stripe'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  sendEventBookingSeatUpdateSms,
  sendEventPaymentConfirmationSms,
  sendEventPaymentRetrySms
} from '@/lib/events/event-payments'
import {
  sendTableBookingConfirmedAfterDepositSmsIfAllowed,
} from '@/lib/table-bookings/bookings'

export const runtime = 'nodejs'

type StripeWebhookEvent = {
  id: string
  type: string
  data?: {
    object?: any
  }
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeStripeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id'
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  sanitized['stripe-signature-present'] = headers['stripe-signature'] ? 'true' : 'false'
  return sanitized
}

async function logStripeWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
  }
): Promise<void> {
  try {
    await supabase.from('webhook_logs').insert({
      webhook_type: 'stripe',
      status: input.status,
      headers: sanitizeStripeHeadersForLog(input.headers),
      body: truncate(input.body, 10000),
      params: {
        event_id: input.eventId ?? null,
        event_type: input.eventType ?? null
      },
      error_message: truncate(input.errorMessage, 500)
    })
  } catch (error) {
    logger.warn('Failed to store Stripe webhook log', {
      metadata: {
        status: input.status,
        eventId: input.eventId,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }
}

type CheckoutCompletedResult = {
  state: 'confirmed' | 'already_confirmed' | 'blocked'
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  seats?: number
}

type SeatIncreaseCompletedResult = {
  state: 'updated' | 'blocked'
  reason?: string
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  old_seats?: number
  new_seats?: number
  delta?: number
}

type TableDepositCompletedResult = {
  state: 'confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  customer_id?: string
  booking_reference?: string
  party_size?: number
}

function mapRefundStatus(status: string | null): 'refunded' | 'pending' | 'failed' {
  switch (status) {
    case 'succeeded':
      return 'refunded'
    case 'pending':
    case 'requires_action':
      return 'pending'
    default:
      return 'failed'
  }
}

function getSessionMetadata(stripeSession: any): Record<string, string> {
  if (typeof stripeSession?.metadata === 'object' && stripeSession.metadata !== null) {
    return stripeSession.metadata as Record<string, string>
  }
  return {}
}

type EventPaymentRetrySmsResult = {
  success?: boolean
  code?: string | null
  logFailure?: boolean
  error?: string | null
} | null | undefined

function logEventPaymentRetrySmsOutcome(input: {
  bookingId: string
  checkoutSessionId: string
  context: 'blocked_checkout' | 'checkout_failure'
}, smsResult: EventPaymentRetrySmsResult): void {
  if (!smsResult || smsResult.success === true) {
    return
  }

  const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
  const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
  const smsError = typeof smsResult.error === 'string' ? smsResult.error : null

  if (smsLogFailure) {
    logger.error('Stripe webhook event payment retry SMS reported logging failure', {
      metadata: {
        bookingId: input.bookingId,
        checkoutSessionId: input.checkoutSessionId,
        context: input.context,
        code: smsCode,
        logFailure: smsLogFailure,
        error: smsError
      }
    })
    return
  }

  logger.warn('Stripe webhook event payment retry SMS send returned non-success', {
    metadata: {
      bookingId: input.bookingId,
      checkoutSessionId: input.checkoutSessionId,
      context: input.context,
      code: smsCode,
      logFailure: smsLogFailure,
      error: smsError
    }
  })
}

async function recordAnalyticsEventSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: string
) {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record Stripe webhook analytics event', {
      metadata: {
        context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)

[truncated at line 200 — original has 1376 lines]
```

### `src/app/api/table-bookings/route.ts`

```
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  withApiAuth,
  createApiResponse,
  createErrorResponse
} from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  claimIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  alignTablePaymentHoldToScheduledSend,
  createTablePaymentToken,
  mapTableBookingBlockedReason,
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
  type TableBookingRpcResult
} from '@/lib/table-bookings/bookings'
import { computeDepositAmount } from '@/lib/table-bookings/deposit'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { verifyTurnstileToken, getClientIp } from '@/lib/turnstile'
import { createRateLimiter } from '@/lib/rate-limit'

const tableBookingIpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many booking requests from this address. Please try again later.'
})

type SmsSafetyMeta = Awaited<ReturnType<typeof sendTableBookingCreatedSmsIfAllowed>>['sms']

const SundayPreorderItemSchema = z.object({
  menu_dish_id: z.string().uuid(),
  quantity: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(25)
  )
})

const CreateTableBookingSchema = z.object({
  phone: z.string().trim().min(7).max(32),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(320).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  purpose: z.enum(['food', 'drinks']),
  notes: z.string().trim().max(500).optional(),
  sunday_lunch: z.boolean().optional(),
  dietary_requirements: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  allergies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  sunday_preorder_items: z.array(SundayPreorderItemSchema).max(40).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  skip_customer_sms: z.boolean().optional()
})

type TableBookingResponseData = {
  state: 'confirmed' | 'pending_payment' | 'blocked'
  table_booking_id: string | null
  booking_reference: string | null
  reason: string | null
  blocked_reason:
    | 'outside_hours'
    | 'cut_off'
    | 'no_table'
    | 'private_booking_blocked'
    | 'too_large_party'
    | 'customer_conflict'
    | 'in_past'
    | 'blocked'
    | null
  next_step_url: string | null
  hold_expires_at: string | null
  table_name: string | null
  booking_id: string | null
  deposit_amount: number | null
  fallback_payment_url: string | null
}

function isAssignmentConflictRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return (
    code === '23P01'
    || message.includes('table_assignment_overlap')
    || message.includes('table_assignment_private_blocked')
  )
}

async function recordTableBookingAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
) {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record table booking analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

export async function OPTIONS(_request: NextRequest) {
  return createApiResponse({}, 200)
}

export async function POST(request: NextRequest) {
  // IP-based rate limiting — first line of defence before any DB work
  const ipRateLimitResponse = await tableBookingIpLimiter(request)
  if (ipRateLimitResponse) {
    return ipRateLimitResponse
  }

  // Turnstile CAPTCHA verification — only for direct browser requests.
  // API-key-authenticated requests (e.g. from the website proxy) skip Turnstile
  // because the website has its own Turnstile widget with a different secret key
  // and handles verification before proxying.
  const hasApiKey = Boolean(request.headers.get('x-api-key') || request.headers.get('authorization'))
  if (!hasApiKey) {
    const turnstileToken = request.headers.get('x-turnstile-token')
    const clientIp = getClientIp(request)
    const turnstile = await verifyTurnstileToken(turnstileToken, clientIp)
    if (!turnstile.success) {
      return createErrorResponse(
        turnstile.error || 'Bot verification failed',
        'TURNSTILE_FAILED',
        403
      )
    }
  }

  return withApiAuth(async (req) => {
    const idempotencyKey = getIdempotencyKey(req)
    if (!idempotencyKey) {
      return createErrorResponse('Missing Idempotency-Key header', 'IDEMPOTENCY_KEY_REQUIRED', 400)
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
    }

    const parsed = CreateTableBookingSchema.safeParse(body)
    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.issues[0]?.message || 'Invalid table booking payload',
        'VALIDATION_ERROR',
        400,
        { issues: parsed.error.issues }
      )
    }

    const payload = parsed.data

    let normalizedPhone: string
    try {
      normalizedPhone = formatPhoneForStorage(payload.phone, {
        defaultCountryCode: payload.default_country_code
      })
    } catch {
      return createErrorResponse('Please enter a valid phone number', 'VALIDATION_ERROR', 400)
    }

    const bookingTime = payload.time.length === 5 ? `${payload.time}:00` : payload.time

    const requestHash = computeIdempotencyRequestHash({
      phone: normalizedPhone,
      first_name: payload.first_name || null,
      last_name: payload.last_name || null,
      email: payload.email || null,
      date: payload.date,
      time: bookingTime,
      party_size: payload.party_size,
      purpose: payload.purpose,
      notes: payload.notes || null,
      sunday_lunch: payload.sunday_lunch === true,
      dietary_requirements: payload.dietary_requirements ?? null,
      allergies: payload.allergies ?? null,
      sunday_preorder_items: payload.sunday_preorder_items ?? null
    })


[truncated at line 200 — original has 581 lines]
```

### `src/app/g/[token]/table-payment/page.tsx`

```
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import { getTablePaymentPreviewByRawToken } from '@/lib/table-bookings/bookings'
import { tablePaymentBlockedReasonMessage } from '@/lib/table-bookings/table-payment-blocked-reason'
import { GuestPageShell } from '@/components/features/shared/GuestPageShell'
import { createSimplePayPalOrder, capturePayPalPayment, getPayPalOrder } from '@/lib/paypal'
import { logAuditEvent } from '@/app/actions/audit'
import { TablePaymentClient } from './TablePaymentClient'

type TablePaymentPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export const dynamic = 'force-dynamic'

function getSingleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

export default async function TablePaymentPage({ params, searchParams }: TablePaymentPageProps) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const state = getSingleValue(resolvedSearchParams.state)
  const reason = getSingleValue(resolvedSearchParams.reason)
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'

  if (state === 'paid') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Deposit received</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'your deposit payment has been received.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Thanks. We are confirming your booking now. You will receive a text confirmation shortly.
          </p>
          <p className="mt-3 text-sm text-slate-700">
            If you do not receive confirmation, call {contactPhone}.
          </p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/book-table">
              Back to The Anchor
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  if (state === 'blocked') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{tablePaymentBlockedReasonMessage(reason)}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/book-table">
              Back to book a table
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_table_payment_view',
    maxAttempts: 60,
  })

  if (!throttle.allowed) {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{tablePaymentBlockedReasonMessage('rate_limited')}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
        </div>
      </GuestPageShell>
    )
  }

  const supabase = createAdminClient()
  const preview = await getTablePaymentPreviewByRawToken(supabase, token)

  if (preview.state !== 'ready') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{tablePaymentBlockedReasonMessage(preview.reason)}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
        </div>
      </GuestPageShell>
    )
  }

  // preview.state === 'ready' from here — all fields are available
  const { data: booking } = await supabase
    .from('table_bookings')
    .select('payment_status, paypal_deposit_order_id')
    .eq('id', preview.tableBookingId)
    .single()

  // Already paid — redirect to confirmed page
  if (booking?.payment_status === 'completed') {
    redirect(`/g/${token}/table-payment?state=paid`)
  }

  // Create or reuse PayPal order (only reuse if still valid on PayPal's side)
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.the-anchor.pub'
  let paypalOrderId = ''
  let needsNewOrder = true

  if (booking?.paypal_deposit_order_id) {
    try {
      const existingOrder = await getPayPalOrder(booking.paypal_deposit_order_id as string)
      if (existingOrder.status === 'CREATED' || existingOrder.status === 'APPROVED') {
        paypalOrderId = booking.paypal_deposit_order_id as string
        needsNewOrder = false
      }
    } catch {
      // Order expired or invalid on PayPal's side — create a fresh one
    }
  }

  if (needsNewOrder) {
    let paypalOrder: { orderId: string }
    try {
      paypalOrder = await createSimplePayPalOrder({
        customId: preview.tableBookingId,
        reference: `tb-deposit-${preview.tableBookingId}`,
        description: `Table booking deposit – ${preview.partySize} guests`,
        amount: preview.totalAmount,
        currency: preview.currency,
        returnUrl: `${appBaseUrl}/g/${token}/table-payment`,
        cancelUrl: `${appBaseUrl}/g/${token}/table-payment?state=cancelled`,
        requestId: `tb-deposit-${preview.tableBookingId}`,
      })
    } catch {
      return (
        <GuestPageShell>
          <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
            <h1 className="text-2xl font-semibold text-slate-900">Payment unavailable</h1>
            <p className="mt-2 text-sm text-slate-700">
              {formatGuestGreeting(null, 'we could not set up your payment right now.')}
            </p>
            <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
          </div>
        </GuestPageShell>
      )
    }

    paypalOrderId = paypalOrder.orderId

    // Persist the order ID only. Deliberately not writing deposit_amount —
    // the canonical reader (preview.totalAmount derives from
    // getCanonicalDeposit) is the source of truth, and capture-time is when
    // we lock the actually-charged amount via deposit_amount_locked.
    // Spec §7.3, §7.4, §8.3.
    await supabase
      .from('table_bookings')
      .update({
        paypal_deposit_order_id: paypalOrderId,
      })
      .eq('id', preview.tableBookingId)

    void logAuditEvent({
      operation_type: 'payment.order_created',
      resource_type: 'table_booking',
      resource_id: preview.tableBookingId,
      operation_status: 'success',
      additional_info: {
        orderId: paypalOrderId,
        amount: preview.totalAmount,
        currency: preview.currency,
        bookingId: preview.tableBookingId,
        partySize: preview.partySize,

[truncated at line 200 — original has 349 lines]
```

### `src/lib/table-bookings/bookings.ts`

```
import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { createTableManageToken } from '@/lib/table-bookings/manage-booking'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'
import {
  computeStripeCheckoutExpiresAtUnix,
  createStripeTableDepositCheckoutSession,
  expireStripeCheckoutSession,
  type StripeCheckoutSession,
} from '@/lib/payments/stripe'
import { logger } from '@/lib/logger'
import { AuditService } from '@/services/audit'
import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'
import {
  computeDepositAmount,
  getCanonicalDeposit,
  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
} from './deposit'

// Re-exported for backwards-compat in this file. The single source of truth is
// `LARGE_GROUP_DEPOSIT_PER_PERSON_GBP` in `./deposit.ts`. Spec §7.3, §8.3.
const DEPOSIT_PER_PERSON_GBP = LARGE_GROUP_DEPOSIT_PER_PERSON_GBP

export type TableBookingState = 'confirmed' | 'pending_payment' | 'blocked'

export type TableBookingRpcResult = {
  state: TableBookingState
  table_booking_id?: string
  booking_reference?: string
  status?: string
  reason?: string
  table_id?: string
  table_ids?: string[]
  table_name?: string
  table_names?: string[]
  tables_joined?: boolean
  party_size?: number
  booking_purpose?: 'food' | 'drinks'
  booking_type?: string
  start_datetime?: string
  end_datetime?: string
  hold_expires_at?: string
  sunday_lunch?: boolean
  sunday_preorder_cutoff_at?: string | null
}

export type TablePaymentTokenResult = {
  rawToken: string
  url: string
  expiresAt: string
}

export type TablePaymentPreviewResult =
  | {
    state: 'ready'
    tableBookingId: string
    customerId: string
    bookingReference: string
    partySize: number
    totalAmount: number
    currency: string
    holdExpiresAt: string
    bookingDate: string | null
    bookingTime: string | null
    startDateTime: string | null
    bookingType: string | null
    tokenHash: string
  }
  | {
    state: 'blocked'
    reason:
      | 'invalid_token'
      | 'token_expired'
      | 'token_used'
      | 'booking_not_found'
      | 'booking_not_pending_payment'
      | 'hold_expired'
      | 'invalid_amount'
      | 'token_customer_mismatch'
  }

type SmsSafetyMeta =
  | {
    success: boolean
    code: string | null
    logFailure: boolean
  }
  | null

type TableBookingNotificationRow = {
  id: string
  customer_id: string | null
  booking_reference: string | null
  booking_date: string | null
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string | null
  source: string | null
  special_requirements: string | null
}

type CustomerNotificationRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_e164: string | null
  mobile_number: string | null
  email: string | null
}

export const MANAGER_TABLE_BOOKING_EMAIL = 'manager@the-anchor.pub'

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const { code: thrownCode, logFailure: thrownLogFailure } = extractSmsSafetyInfo(error)

  if (thrownLogFailure) {
    return {
      code: 'logging_failed',
      logFailure: true
    }
  }

  if (thrownCode) {
    return {
      code: thrownCode,
      logFailure: false
    }
  }

  return {
    code: 'safety_unavailable',
    logFailure: false
  }
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function resolveBaseUrl(appBaseUrl?: string | null): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL
  const chosen = (appBaseUrl || fromEnv || 'http://localhost:3000').replace(/\/+$/, '')
  return chosen
}

function formatPence(amount: number): number {
  return Math.round(amount * 100)
}

export function mapTableBookingBlockedReason(reason?: string | null):
  | 'outside_hours'
  | 'cut_off'
  | 'no_table'
  | 'private_booking_blocked'
  | 'too_large_party'
  | 'customer_conflict'
  | 'in_past'
  | 'blocked' {
  switch (reason) {
    case 'too_large_party':
      return 'too_large_party'
    case 'no_table':
      return 'no_table'
    case 'private_booking_blocked':
      return 'private_booking_blocked'
    case 'cut_off':
      return 'cut_off'
    case 'customer_conflict':
      return 'customer_conflict'
    case 'in_past':
      return 'in_past'
    case 'outside_hours':
    case 'hours_not_configured':
    case 'outside_service_window':
    case 'sunday_lunch_requires_sunday':
      return 'outside_hours'
    default:
      return 'blocked'
  }
}

function formatLondonDateTime(isoDateTime?: string | null): string {
  if (!isoDateTime) return 'your booking time'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',

[truncated at line 200 — original has 1372 lines]
```

### `src/lib/table-bookings/deposit.ts`

```
/**
 * Centralised deposit helper for table bookings.
 *
 * Single source of truth for the 10+ deposit threshold and £10/person rate. Any
 * code path that decides "does this booking require a deposit" or "what amount"
 * MUST go through these helpers — duplicating the rule elsewhere is a footgun
 * (the threshold has changed twice already and we don't want a third drift).
 *
 * Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
 *           §7.3 (deposit helper design), §7.4 (lock-amount design).
 */

export const LARGE_GROUP_DEPOSIT_PER_PERSON_GBP = 10;
export const LARGE_GROUP_DEPOSIT_THRESHOLD = 10;

export type DepositOptions = {
  depositWaived?: boolean;
};

/**
 * Returns true when a deposit must be charged for a booking of the given party size.
 * Preserves the existing `p_deposit_waived` semantics — a manager-level waiver
 * always wins regardless of party size.
 */
export function requiresDeposit(partySize: number, opts: DepositOptions = {}): boolean {
  if (opts.depositWaived === true) return false;
  return partySize >= LARGE_GROUP_DEPOSIT_THRESHOLD;
}

/**
 * Computes a fresh deposit amount from party size only. Returns 0 when no deposit is required.
 * Use this only when there is no prior amount (locked or stored) on the booking.
 */
export function computeDepositAmount(partySize: number, opts: DepositOptions = {}): number {
  if (!requiresDeposit(partySize, opts)) return 0;
  return partySize * LARGE_GROUP_DEPOSIT_PER_PERSON_GBP;
}

/**
 * Booking shape for the canonical-deposit reader. Intentionally narrow — accepts any object
 * with the relevant fields so it works for partial selects.
 */
export type BookingForDeposit = {
  party_size: number;
  deposit_amount?: number | string | null;
  deposit_amount_locked?: number | string | null;
  status?: string | null;
  payment_status?: string | null;
  deposit_waived?: boolean | null;
};

const PAYMENT_REQUIRED_STATES = new Set(['pending_payment']);
const PAYMENT_REQUIRED_PAYMENT_STATUSES = new Set(['pending', 'completed']);

function toNumberOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns the canonical deposit amount for a booking. Read priority:
 *   1. deposit_amount_locked (always wins — paid bookings are immutable)
 *   2. stored deposit_amount when the booking is in a payment-required state
 *   3. fresh compute via requiresDeposit + party size, or 0 if not required
 */
export function getCanonicalDeposit(
  booking: BookingForDeposit,
  partySizeOverride?: number,
): number {
  const locked = toNumberOrNull(booking.deposit_amount_locked);
  if (locked !== null) return locked;

  const stored = toNumberOrNull(booking.deposit_amount);
  const status = booking.status ?? '';
  const paymentStatus = booking.payment_status ?? '';
  const isPaymentRequiredState =
    PAYMENT_REQUIRED_STATES.has(status) ||
    PAYMENT_REQUIRED_PAYMENT_STATUSES.has(paymentStatus);

  if (stored !== null && isPaymentRequiredState) {
    return stored;
  }

  const partySize = partySizeOverride ?? booking.party_size;
  return computeDepositAmount(partySize, { depositWaived: booking.deposit_waived === true });
}

/**
 * Convenience helper used by capture surfaces that need to write the lock.
 * Callers pass the actually-captured amount from the payment provider.
 */
export type LockDepositArgs = {
  bookingId: string;
  amount: number;
};
```

### `src/lib/table-bookings/sunday-preorder.ts`

```
import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'

type BookingItemType = 'main' | 'side' | 'extra'

// Typed shapes for DB rows returned by loadSundayLunchMenuItems — prevents silent
// any[] casts masking missing or malformed fields from the menu tables.
interface MenuMenuRow {
  id: string
}

interface MenuDishMenuAssignmentRow {
  dish_id: string
  category_id: string | null
  sort_order: number | null
}

interface MenuDishRow {
  id: string
  name: string
  selling_price: number | null
  is_active: boolean
}

interface MenuCategoryRow {
  id: string
  code: string | null
  name: string | null
}

interface FallbackDishRow {
  id: string
  name: string
  selling_price: number | null
}

interface LegacyMenuItemRow {
  name: string
  category: string | null
  display_order: number | null
}

export type SundayMenuItem = {
  menu_dish_id: string
  name: string
  price: number
  category_code: string | null
  category_name: string | null
  item_type: BookingItemType
  sort_order: number
}

export type SundayPreorderExistingItem = {
  menu_dish_id: string
  name_snapshot: string
  price_snapshot: number
  quantity: number
  item_type: BookingItemType
}

export type SundayPreorderPageData = {
  state: 'ready' | 'blocked'
  reason?: string
  booking_id?: string
  customer_id?: string
  booking_reference?: string | null
  start_datetime?: string | null
  party_size?: number | null
  status?: string | null
  can_submit?: boolean
  submit_deadline_at?: string | null
  cancellation_deadline_at?: string | null
  sunday_preorder_cutoff_at?: string | null
  sunday_preorder_completed_at?: string | null
  cutoff_overridden?: boolean
  existing_items?: SundayPreorderExistingItem[]
  menu_items?: SundayMenuItem[]
}

export type SundayPreorderSaveResult = {
  state: 'saved' | 'blocked'
  reason?: string
  booking_id?: string
  item_count?: number
}

export type SundayPreorderSaveInputItem = {
  menu_dish_id: string
  quantity: number
}

function resolveAppBaseUrl(appBaseUrl?: string): string {
  return (appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

function computeTokenExpiry(bookingStartIso?: string | null): string {
  const now = Date.now()
  const capMs = now + 30 * 24 * 60 * 60 * 1000
  const bookingPlus48Ms = bookingStartIso ? Date.parse(bookingStartIso) + 48 * 60 * 60 * 1000 : Number.NaN
  const fallbackMs = now + 14 * 24 * 60 * 60 * 1000

  const resolvedMs = Number.isFinite(bookingPlus48Ms)
    ? Math.min(Math.max(bookingPlus48Ms, now + 60 * 60 * 1000), capMs)
    : Math.min(fallbackMs, capMs)

  return new Date(resolvedMs).toISOString()
}

function resolveItemType(categoryCode?: string | null): BookingItemType {
  const normalized = (categoryCode || '').toLowerCase()
  if (normalized.includes('extra')) {
    return 'extra'
  }
  if (normalized.includes('side')) {
    return 'side'
  }
  return 'main'
}

function formatCategoryName(categoryCode?: string | null): string | null {
  const normalized = (categoryCode || '').trim()
  if (!normalized) return null
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function sortSundayMenuItems(items: SundayMenuItem[]): SundayMenuItem[] {
  return [...items].sort((a, b) => {
    const categoryCompare = (a.category_name || '').localeCompare(b.category_name || '')
    if (categoryCompare !== 0) return categoryCompare
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.name.localeCompare(b.name)
  })
}

function minDefinedDate(a?: Date | null, b?: Date | null): Date | null {
  if (a && b) {
    return a.getTime() <= b.getTime() ? a : b
  }
  return a || b || null
}

function toIsoOrNull(date?: Date | null): string | null {
  if (!date) return null
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function parseIso(value?: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

// Returns null when no menu items could be loaded (triggers menu_unavailable block in callers).
async function loadSundayLunchMenuItems(
  supabase: SupabaseClient<any, 'public', any>
): Promise<SundayMenuItem[] | null> {
  const { data: sundayMenuRaw, error: sundayMenuError } = await supabase.from('menu_menus')
    .select('id')
    .eq('code', 'sunday_lunch')
    .eq('is_active', true)
    .maybeSingle()

  if (!sundayMenuError && sundayMenuRaw?.id) {
    const sundayMenu = sundayMenuRaw as MenuMenuRow

    const { data: assignmentsRaw, error: assignmentsError } = await supabase.from('menu_dish_menu_assignments')
      .select('dish_id, category_id, sort_order')
      .eq('menu_id', sundayMenu.id)

    const assignmentRows: MenuDishMenuAssignmentRow[] = assignmentsError
      ? []
      : (assignmentsRaw || []) as MenuDishMenuAssignmentRow[]

    if (assignmentRows.length > 0) {
      const dishIds = Array.from(new Set(assignmentRows.map((row) => row.dish_id).filter(Boolean)))
      const categoryIds = Array.from(new Set(assignmentRows.map((row) => row.category_id).filter(Boolean)))

      const [{ data: dishesRaw }, { data: categoriesRaw }] = await Promise.all([
        supabase.from('menu_dishes')
          .select('id, name, selling_price, is_active')
          .in('id', dishIds)
          .eq('is_active', true),
        categoryIds.length > 0
          ? supabase.from('menu_categories')
              .select('id, code, name')
              .in('id', categoryIds)
          : Promise.resolve({ data: [] as MenuCategoryRow[] })
      ])

      const dishMap = new Map(
        ((dishesRaw || []) as MenuDishRow[]).map((dish) => [dish.id, dish])

[truncated at line 200 — original has 721 lines]
```

### `src/tests/api/foh/deposit-waiver.test.ts`

```
// src/tests/api/foh/deposit-waiver.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth and Supabase before importing the route
vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn()
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) }
  })
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { POST } from '@/app/api/foh/bookings/route'

// The real PermissionCheckResult ok:true branch has no `response` field.
// We use `as unknown as` casts to avoid coupling the test to internal types.
type MockOkResult = {
  ok: true
  userId: string
  supabase: any // typed as any to avoid brittle coupling to the internal Supabase admin client type
}

function makeRequest(body: object) {
  return new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }) as unknown as import('next/server').NextRequest
}

// Walk-in launch (spec §6, §7.3): the deposit threshold is now 10+ (not 7+).
// Party_size: 10 puts the booking on the deposit-required side of the boundary.
const baseBookingPayload = {
  customer_id: '00000000-0000-0000-0000-000000000001',
  date: '2026-04-05',
  time: '13:00',
  party_size: 10,
  purpose: 'food'
}

describe('POST /api/foh/bookings — deposit waiver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  })

  it('should return 403 when a non-manager tries to waive the deposit', async () => {
    const mockResult: MockOkResult = {
      ok: true,
      userId: 'user-1',
      supabase: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ roles: { name: 'staff' } }]
            })
          })
        })
      }
    }
    vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: true })
    const res = await POST(req)
    // NOTE: This test will continue to fail (returning 400 from Zod) until BOTH:
    // 1. waive_deposit is added to the schema (Task 4 Step 1), AND
    // 2. the role check block is added (Task 4 Step 3)
    // After both steps, it should return 403 for a staff user.
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/permission/i)
  })

  it('should allow a manager to waive the deposit', async () => {
    const mockRpcResult = {
      data: {
        state: 'confirmed',
        table_booking_id: 'booking-1',
        booking_reference: 'REF001',
        reason: null,
        table_name: 'Table 1'
      },
      error: null
    }

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ roles: { name: 'manager' } }]
              })
            })
          }
        }
        if (table === 'customers') {
          const eqChain = {
            eq: vi.fn(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: '00000000-0000-0000-0000-000000000001', mobile_e164: '+441234567890', mobile_number: '01234567890' },
              error: null
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
          eqChain.eq.mockReturnValue(eqChain)
          return { select: vi.fn().mockReturnValue(eqChain) }
        }
        // All other tables: return empty/success stubs
        const eqChain = {
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
        // eq returns itself so further chaining works
        eqChain.eq.mockReturnValue(eqChain)
        return {
          select: vi.fn().mockReturnValue(eqChain),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      }),
      rpc: vi.fn().mockResolvedValue(mockRpcResult)
    }

    const mockResult: MockOkResult = {
      ok: true,
      userId: 'user-2',
      supabase: mockSupabase
    }
    vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: true })
    const res = await POST(req)
    // Should succeed (201) — not blocked on deposit method missing
    expect(res.status).toBe(201)
  })

  it('requires a deposit decision when party_size >= 10 and waive_deposit is false', async () => {
    // Use the same comprehensive mock as the manager-waive case so the route's
    // customer-lookup step succeeds and we exercise the actual deposit gate.
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ roles: { name: 'manager' } }]
              })
            })
          }
        }
        if (table === 'customers') {
          const eqChain = {
            eq: vi.fn(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: '00000000-0000-0000-0000-000000000001', mobile_e164: '+441234567890', mobile_number: '01234567890' },
              error: null
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
          eqChain.eq.mockReturnValue(eqChain)
          return { select: vi.fn().mockReturnValue(eqChain) }
        }
        const eqChain = {
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
        eqChain.eq.mockReturnValue(eqChain)
        return {
          select: vi.fn().mockReturnValue(eqChain),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
    }

    const mockResult: MockOkResult = {
      ok: true,
      userId: 'user-3',
      supabase: mockSupabase
    }
    vi.mocked(requireFohPermission).mockResolvedValue(mockResult as unknown as Awaited<ReturnType<typeof requireFohPermission>>)


[truncated at line 200 — original has 207 lines]
```

### `supabase/migrations/20260509000014_add_deposit_amount_locked.sql`

```
-- ============================================================================
-- Migration A: deposit lock column + legacy unpaid pending conversion + paid backfill.
-- Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
--           §7.4 (lock-amount design), §8.4 Migration A (full SQL spec).
-- D6 verified (28 April 2026): the only paid value of payments.status for
--   charge_type='table_deposit' is 'succeeded'. This SQL uses status='succeeded'.
-- D11 verified (28 April 2026): 0 future unpaid pending Sunday-lunch bookings,
--   1 future paid (TB-8229A1B4 / Sun 31 May 2026, party 1, £10 deposit). Step 1
--   is a defensive no-op on day 1; Step 2 will lock the 1 paid row + any history.
-- ============================================================================

-- Add the lock column. Additive, no defaults — existing rows are NULL.
ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS deposit_amount_locked numeric NULL;

COMMENT ON COLUMN public.table_bookings.deposit_amount_locked IS
  'Locked deposit amount in GBP. Set by every successful payment-capture surface (PayPal capture-order, Stripe webhook, cash/manual deposit confirmation) and by the Migration A backfill. Once set it is immutable — paid bookings always read the canonical amount from this column. NULL means no payment has been captured for this booking yet.';

-- ============================================================================
-- STEP 1 (legacy unpaid pending conversion, per OQ14a resolution):
-- For legacy sunday_lunch bookings that have not captured a payment AND whose
-- service date is in the future, convert them to regular bookings under the new
-- rules. Pre-order data on the row is preserved (in table_booking_items /
-- special_requirements) but is no longer kitchen-enforced.
--
-- IMPORTANT — only touch FUTURE bookings. Historical abandoned/past
-- pending_payment rows must not be rewritten (would pollute reporting and
-- historical state).
--
-- IMPORTANT — staff review list MUST be generated and signed off before this
-- UPDATE runs (see §8.4 Pre-conversion review).
--
-- Below 10: drop pending_payment status (becomes confirmed); deposit no longer
--           required.
-- 10+:      keep pending_payment (deposit still required under new rules);
--           deposit_amount stays.
-- ============================================================================
UPDATE public.table_bookings tb
SET
  booking_type = 'regular',
  status = CASE WHEN tb.party_size >= 10 THEN tb.status ELSE 'confirmed' END,
  deposit_amount = CASE WHEN tb.party_size >= 10 THEN tb.deposit_amount ELSE NULL END
WHERE tb.booking_type = 'sunday_lunch'
  AND tb.status = 'pending_payment'
  AND tb.start_datetime >= NOW()  -- ONLY future-dated bookings
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.table_booking_id = tb.id
      AND p.charge_type = 'table_deposit'
      AND p.status = 'succeeded'
  )
  AND tb.paypal_deposit_capture_id IS NULL
  AND COALESCE(tb.payment_status::text, '') <> 'completed';  -- NULL-safe

-- ============================================================================
-- STEP 2 (paid-deposit backfill):
-- Lock the captured deposit amount for any booking with paid evidence.
-- Sources, in priority order:
--   1. payments.amount where charge_type='table_deposit' AND status='succeeded'
--      (latest by created_at via DISTINCT ON)
--   2. table_bookings.deposit_amount fallback (legacy rows where the payments
--      record may be missing but deposit_amount was set on the booking row)
--
-- The outer WHERE clause guards against locking a NULL value when neither
-- source has a usable amount.
-- ============================================================================
WITH paid_payments AS (
  SELECT DISTINCT ON (p.table_booking_id)
    p.table_booking_id,
    p.amount
  FROM public.payments p
  WHERE p.charge_type = 'table_deposit'
    AND p.status = 'succeeded'
  ORDER BY p.table_booking_id, p.created_at DESC
)
UPDATE public.table_bookings tb
SET deposit_amount_locked = COALESCE(
  (SELECT amount FROM paid_payments pp WHERE pp.table_booking_id = tb.id),
  tb.deposit_amount
)
WHERE tb.deposit_amount_locked IS NULL
  AND (
    COALESCE(tb.payment_status::text, '') = 'completed'
    OR tb.paypal_deposit_capture_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM paid_payments pp WHERE pp.table_booking_id = tb.id)
  )
  AND COALESCE(
    (SELECT amount FROM paid_payments pp WHERE pp.table_booking_id = tb.id),
    tb.deposit_amount
  ) IS NOT NULL;

-- ============================================================================
-- STEP 3 — Verification report (zero rows on success). Run as a sanity check.
-- Any row returned indicates a paid booking that backfill couldn't lock — flag
-- for staff review BEFORE the launch banner activates.
-- Acceptance criterion (§8.10): zero rows here, OR a written sign-off from the
-- owner explicitly listing the rows and the reason they remain unlocked.
-- ============================================================================
-- This SELECT does not run as part of the migration; it's the script you run
-- post-migration to verify integrity. Copy into the SQL editor:
/*
SELECT tb.id, tb.booking_reference, tb.start_datetime, tb.party_size,
       tb.payment_status, tb.paypal_deposit_capture_id, tb.deposit_amount, tb.deposit_amount_locked
FROM public.table_bookings tb
WHERE tb.deposit_amount_locked IS NULL
  AND (
    tb.payment_status::text = 'completed'
    OR tb.paypal_deposit_capture_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.payments p
               WHERE p.table_booking_id = tb.id
                 AND p.charge_type = 'table_deposit'
                 AND p.status = 'succeeded')
  );
*/
```

### `supabase/migrations/20260509000015_patch_v05_threshold_and_cutoff.sql`

```
-- ============================================================================
-- Migration B: patch create_table_booking_v05 to apply the new 10+ deposit
-- threshold (replacing the legacy "Sunday OR 7-20" rule) and skip the Sunday
-- pre-order cutoff calc for non-legacy bookings.
--
-- Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
--           §7.10 (migration discipline — full body copied verbatim from latest
--           migration), §8.4 Migration B.
--
-- Source body: 20260509000005_create_table_booking_v05_deposit_waived.sql
--              (the canonical 10-param version; later migrations 006/007 only
--               adjust grants / drop stale overloads — they do not redefine
--               the body).
--
-- Three minimal edits applied IN PLACE (everything else is verbatim):
--   Edit 1: v_sunday_preorder_cutoff_at — already wrapped with
--           "IF p_sunday_lunch THEN ... ELSE NULL END IF" in the source body
--           (lines 399-404 of migration 005). No change required for this edit.
--           Recorded here for spec traceability.
--   Edit 2: v_deposit_required — replace "(Sunday lunch OR 7-20 group)" with
--           "p_party_size >= 10 AND NOT COALESCE(p_deposit_waived, false)".
--           This preserves p_deposit_waived semantics: the existing waiver
--           check that follows still runs but is now redundant for the new
--           rule (kept anyway to avoid touching unrelated logic).
--   Edit 3: deposit_amount calc — UNCHANGED (party_size * 10).
--
-- pending_payment now triggers on "p_party_size >= 10 AND NOT p_deposit_waived"
-- — preserves waiver semantics. Capacity, table assignment, hold expiry, audit
-- logging, error returns, return shape — all unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_table_booking_v05(
  p_customer_id       uuid,
  p_booking_date      date,
  p_booking_time      time without time zone,
  p_party_size        integer,
  p_booking_purpose   text    DEFAULT 'food',
  p_notes             text    DEFAULT NULL,
  p_sunday_lunch      boolean DEFAULT false,
  p_source            text    DEFAULT 'brand_site',
  p_bypass_cutoff     boolean DEFAULT false,  -- FOH only: skip 30-min pre-close buffer
  p_deposit_waived    boolean DEFAULT false   -- manager/super_admin waiver
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purpose text;
  v_booking_type public.table_booking_type;
  v_booking_status public.table_booking_status;
  v_is_sunday boolean;

  v_booking_start_local timestamp without time zone;
  v_booking_start timestamptz;
  v_booking_end timestamptz;

  v_hours_row RECORD;

  v_pub_open_minutes integer;
  v_pub_close_minutes integer;
  v_pub_close_service_minutes integer;
  v_pub_booking_minutes integer;

  v_kitchen_open_minutes integer;
  v_kitchen_close_minutes integer;
  v_kitchen_close_service_minutes integer;
  v_kitchen_booking_minutes integer;

  v_food_duration_minutes integer := 120;
  v_drinks_duration_minutes integer := 90;
  v_sunday_duration_minutes integer := 120;
  v_duration_minutes integer;

  v_drinks_near_close_allowed boolean := false;

  v_selected_table_id uuid;
  v_selected_table_ids uuid[];
  v_selected_table_names text[];
  v_selected_table_display_name text;

  v_table_booking_id uuid;
  v_booking_reference text;

  v_deposit_required boolean := false;
  v_hold_expires_at timestamptz;
  v_now timestamptz := NOW();
  v_party_size_eff integer;
  v_deposit_amount numeric(10, 2);
  v_payment_id uuid;

  v_sunday_preorder_cutoff_at timestamptz;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'missing_customer');
  END IF;

  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'missing_datetime');
  END IF;

  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_party_size');
  END IF;

  IF p_party_size >= 21 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
  END IF;

  v_purpose := LOWER(TRIM(COALESCE(p_booking_purpose, 'food')));
  IF v_purpose NOT IN ('food', 'drinks') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_purpose');
  END IF;

  v_is_sunday := EXTRACT(DOW FROM p_booking_date)::integer = 0;
  IF COALESCE(p_sunday_lunch, false) AND NOT v_is_sunday THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'sunday_lunch_requires_sunday');
  END IF;

  v_booking_type := CASE
    WHEN COALESCE(p_sunday_lunch, false) THEN 'sunday_lunch'::public.table_booking_type
    ELSE 'regular'::public.table_booking_type
  END;

  v_booking_start_local := (p_booking_date::text || ' ' || p_booking_time::text)::timestamp;
  v_booking_start := v_booking_start_local AT TIME ZONE 'Europe/London';

  IF v_booking_start <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'in_past');
  END IF;

  SELECT
    bh.day_of_week,
    COALESCE(sh.is_closed, bh.is_closed, false) AS is_closed,
    COALESCE(sh.is_kitchen_closed, bh.is_kitchen_closed, false) AS is_kitchen_closed,
    COALESCE(sh.opens, bh.opens) AS opens,
    COALESCE(sh.closes, bh.closes) AS closes,
    COALESCE(sh.kitchen_opens, bh.kitchen_opens) AS kitchen_opens,
    COALESCE(sh.kitchen_closes, bh.kitchen_closes) AS kitchen_closes
  INTO v_hours_row
  FROM public.business_hours bh
  LEFT JOIN public.special_hours sh ON sh.date = p_booking_date
  WHERE bh.day_of_week = EXTRACT(DOW FROM p_booking_date)::integer
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  IF COALESCE(v_hours_row.is_closed, false) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
  END IF;

  IF v_hours_row.opens IS NULL OR v_hours_row.closes IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
  END IF;

  v_pub_open_minutes := (EXTRACT(HOUR FROM v_hours_row.opens)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.opens)::integer;
  v_pub_close_minutes := (EXTRACT(HOUR FROM v_hours_row.closes)::integer * 60) + EXTRACT(MINUTE FROM v_hours_row.closes)::integer;
  v_pub_booking_minutes := (EXTRACT(HOUR FROM p_booking_time)::integer * 60) + EXTRACT(MINUTE FROM p_booking_time)::integer;

  v_pub_close_service_minutes := CASE
    WHEN v_pub_close_minutes <= v_pub_open_minutes THEN v_pub_close_minutes + 1440
    ELSE v_pub_close_minutes
  END;

  IF v_pub_close_minutes <= v_pub_open_minutes AND v_pub_booking_minutes < v_pub_open_minutes THEN
    v_pub_booking_minutes := v_pub_booking_minutes + 1440;
  END IF;

  IF NOT (v_pub_booking_minutes >= v_pub_open_minutes AND v_pub_booking_minutes < v_pub_close_service_minutes) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'outside_hours');
  END IF;

  SELECT
    COALESCE(
      CASE
        WHEN jsonb_typeof(value) = 'boolean' THEN (value::text)::boolean
        WHEN jsonb_typeof(value) = 'number' THEN (value::text)::numeric <> 0
        WHEN jsonb_typeof(value) = 'string' THEN LOWER(TRIM(BOTH '"' FROM value::text)) IN ('1','true','yes','y','on')
        WHEN jsonb_typeof(value) = 'object' THEN COALESCE(
          LOWER(value->>'enabled') IN ('1','true','yes','y','on'),
          LOWER(value->>'allow') IN ('1','true','yes','y','on')
        )
        ELSE NULL
      END,
      false
    )
  INTO v_drinks_near_close_allowed
  FROM public.system_settings
  WHERE key IN (
    'table_booking_drinks_near_close_allowed',
    'table_bookings_drinks_near_close_allowed',
    'drinks_near_close_allowed'
  )
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_purpose = 'food' OR COALESCE(p_sunday_lunch, false) THEN

[truncated at line 200 — original has 581 lines]
```

### `supabase/migrations/20260509000016_patch_v05_core_threshold.sql`

```
-- ============================================================================
-- Migration C: patch create_table_booking_v05_core to apply the new 10+ deposit
-- threshold. Affects event/table reservation flows that go through _core.
--
-- Spec ref: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md
--           §8.4 Migration C.
--
-- Source body: 20260509000013_fix_core_remove_card_capture_refs.sql
--              (the latest migration that defines _core).
--
-- One minimal edit applied IN PLACE (everything else is verbatim):
--   Replace the legacy "Sunday lunch OR 7+ party" rule:
--       IF COALESCE(p_sunday_lunch, false) = false AND COALESCE(p_party_size, 0) < 7 THEN
--   with the new 10+ threshold honouring deposit-waiver semantics. This RPC
--   does not currently accept p_deposit_waived as a parameter, so we keep the
--   COALESCE(p_deposit_waived, false) wrapper textually consistent with
--   Migration B but evaluate to "no waiver" by default until/unless the
--   parameter is added downstream.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_table_booking_v05_core(
  p_customer_id uuid,
  p_booking_date date,
  p_booking_time time without time zone,
  p_party_size integer,
  p_booking_purpose text DEFAULT 'food',
  p_notes text DEFAULT NULL,
  p_sunday_lunch boolean DEFAULT false,
  p_source text DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_state text := 'blocked';
  v_table_booking_id uuid;
  v_booking RECORD;
  v_now timestamptz := NOW();
  v_party_size integer := GREATEST(1, COALESCE(p_party_size, 1));
  v_booking_start timestamptz;
  v_hold_expires_at timestamptz;
  v_deposit_amount numeric(10, 2);
  v_payment_id uuid;
BEGIN
  IF to_regprocedure('public.create_table_booking_v05_core_sunday_deposit_legacy(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  v_result := public.create_table_booking_v05_core_sunday_deposit_legacy(
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    p_booking_purpose,
    p_notes,
    p_sunday_lunch,
    p_source
  );

  -- Migration C edit: deposit required ONLY for parties of 10+. Sunday-lunch
  -- and the legacy 7+ rule no longer trigger a deposit. Skip when the booking
  -- is below threshold — return the underlying result unchanged.
  IF NOT (COALESCE(p_party_size, 0) >= 10) THEN
    RETURN v_result;
  END IF;

  v_state := COALESCE(v_result->>'state', 'blocked');
  IF v_state = 'blocked' THEN
    RETURN v_result;
  END IF;

  v_table_booking_id := NULLIF(v_result->>'table_booking_id', '')::uuid;
  IF v_table_booking_id IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT
    tb.id,
    tb.status,
    tb.party_size,
    tb.committed_party_size,
    tb.booking_date,
    tb.booking_time,
    tb.start_datetime,
    tb.payment_method,
    tb.payment_status
  INTO v_booking
  FROM public.table_bookings tb
  WHERE tb.id = v_table_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN v_result;
  END IF;

  v_party_size := GREATEST(1, COALESCE(v_booking.committed_party_size, v_booking.party_size, p_party_size, 1));
  v_deposit_amount := ROUND((v_party_size::numeric) * 10.0, 2);
  v_booking_start := COALESCE(
    v_booking.start_datetime,
    ((v_booking.booking_date::text || ' ' || v_booking.booking_time::text)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_booking_start IS NULL OR v_booking_start <= v_now THEN
    v_hold_expires_at := v_now + INTERVAL '15 minutes';
  ELSE
    v_hold_expires_at := LEAST(v_booking_start, v_now + INTERVAL '24 hours');
  END IF;

  -- FIX: card_capture_hold rows no longer exist (dropped in 20260508000007);
  -- this UPDATE is a safe no-op but kept for defensive cleanup of any legacy rows.
  UPDATE public.booking_holds
  SET
    status = 'released',
    released_at = v_now,
    updated_at = v_now
  WHERE table_booking_id = v_table_booking_id
    AND hold_type = 'card_capture_hold'
    AND status = 'active';

  -- FIX: UPDATE public.card_captures removed — table dropped in 20260508000007

  UPDATE public.booking_holds
  SET
    seats_or_covers_held = v_party_size,
    expires_at = v_hold_expires_at,
    updated_at = v_now,
    scheduled_sms_send_time = NULL,
    status = 'active',
    released_at = NULL,
    consumed_at = NULL
  WHERE table_booking_id = v_table_booking_id
    AND hold_type = 'payment_hold'
    AND status = 'active';

  IF NOT FOUND THEN
    INSERT INTO public.booking_holds (
      hold_type,
      table_booking_id,
      seats_or_covers_held,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_table_booking_id,
      v_party_size,
      'active',
      v_hold_expires_at,
      v_now,
      v_now
    );
  END IF;

  SELECT p.id
  INTO v_payment_id
  FROM public.payments p
  WHERE p.table_booking_id = v_table_booking_id
    AND p.charge_type = 'table_deposit'
    AND p.status IN ('pending', 'succeeded')
  ORDER BY p.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_payment_id IS NULL THEN
    INSERT INTO public.payments (
      table_booking_id,
      charge_type,
      amount,
      currency,
      status,
      metadata,
      created_at
    ) VALUES (
      v_table_booking_id,
      'table_deposit',
      v_deposit_amount,
      'GBP',
      'pending',
      jsonb_build_object(
        'source', 'table_booking_runtime',
        'deposit_per_person', 10,
        'party_size', v_party_size,
        'created_at', v_now
      ),
      v_now
    )
    RETURNING id INTO v_payment_id;
  ELSE
    UPDATE public.payments
    SET
      amount = v_deposit_amount,
      currency = 'GBP',
      status = CASE WHEN status = 'succeeded' THEN status ELSE 'pending' END,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'source', 'table_booking_runtime',
        'deposit_per_person', 10,

[truncated at line 200 — original has 231 lines]
```

### `tests/api/legacy-payment-link.test.ts`

```
/**
 * Walk-in launch (spec §6, §7.3, §7.4, §8.3): the legacy SMS payment link
 * (path: /g/<token>/table-payment) always charges the canonical deposit:
 *   1. If deposit_amount_locked is set, charge that.
 *   2. Else if deposit_amount is set, charge that.
 *   3. Else compute fresh.
 *
 * If none resolves to a positive amount, the link must fail with a
 * `state: 'blocked'` reason that staff can recognise (`invalid_amount`),
 * NOT silently fall back to the legacy 7+ rule. This is the
 * staff-recovery-friendly contract the spec requires.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createStripeTableDepositCheckoutSessionMock } = vi.hoisted(() => ({
  createStripeTableDepositCheckoutSessionMock: vi.fn(),
}))

vi.mock('@/lib/payments/stripe', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments/stripe')>('@/lib/payments/stripe')
  return {
    ...actual,
    createStripeTableDepositCheckoutSession: createStripeTableDepositCheckoutSessionMock,
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((body: string) => body),
}))
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(),
}))
vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  createSundayPreorderToken: vi.fn(),
}))

import { createTableCheckoutSessionByRawToken } from '@/lib/table-bookings/bookings'

function buildSupabase(bookingOverrides: Record<string, unknown> = {}) {
  const guestTokenMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'token-legacy',
      customer_id: 'customer-1',
      table_booking_id: 'tb-legacy',
      expires_at: '2026-06-30T09:00:00.000Z',
      consumed_at: null,
    },
    error: null,
  })
  const guestTokenSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: guestTokenMaybeSingle,
      }),
    }),
  })

  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'tb-legacy',
      customer_id: 'customer-1',
      status: 'pending_payment',
      payment_status: 'pending',
      hold_expires_at: '2026-06-30T09:00:00.000Z',
      party_size: 12,
      committed_party_size: 12,
      booking_reference: 'TB-LEGACY',
      booking_date: '2026-06-28',
      booking_time: '13:00:00',
      start_datetime: '2026-06-28T13:00:00.000Z',
      booking_type: 'regular',
      deposit_amount: null,
      deposit_amount_locked: null,
      deposit_waived: false,
      ...bookingOverrides,
    },
    error: null,
  })
  const bookingSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle }),
  })

  const paymentsSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'payment-row' }, error: null }),
      }),
    }),
  })

  return {
    from: vi.fn((table: string) => {
      if (table === 'guest_tokens') return { select: guestTokenSelect }
      if (table === 'table_bookings') return { select: bookingSelect }
      if (table === 'payments') return { select: paymentsSelect }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('Legacy payment link — canonical deposit charging (walk-in launch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T07:14:00.000Z'))
    createStripeTableDepositCheckoutSessionMock.mockResolvedValue({
      id: 'cs_legacy_1',
      url: 'https://stripe.test/checkout/cs_legacy_1',
      payment_intent: 'pi_legacy_1',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('charges the locked amount when deposit_amount_locked is set (legacy paid booking)', async () => {
    const result = await createTableCheckoutSessionByRawToken(
      buildSupabase({
        deposit_amount_locked: 60,
        deposit_amount: 100,
      }) as any,
      { rawToken: 'raw-legacy-token', appBaseUrl: 'https://example.invalid' }
    )

    expect(result).toMatchObject({ state: 'created' })

    const stripeArgs = createStripeTableDepositCheckoutSessionMock.mock.calls[0]?.[0]
    // formatPence converts £60 → 6000p
    expect(stripeArgs.unitAmountMinor).toBe(6000)
  })

  it('charges deposit_amount when locked is null (existing pending booking)', async () => {
    const result = await createTableCheckoutSessionByRawToken(
      buildSupabase({
        deposit_amount_locked: null,
        deposit_amount: 80,
      }) as any,
      { rawToken: 'raw-legacy-token', appBaseUrl: 'https://example.invalid' }
    )

    expect(result).toMatchObject({ state: 'created' })

    const stripeArgs = createStripeTableDepositCheckoutSessionMock.mock.calls[0]?.[0]
    expect(stripeArgs.unitAmountMinor).toBe(8000)
  })

  it('fails with state: blocked + reason: invalid_amount when no canonical deposit resolves', async () => {
    // party_size below threshold and no stored/locked deposit → 0
    const result = await createTableCheckoutSessionByRawToken(
      buildSupabase({
        party_size: 4,
        committed_party_size: 4,
        deposit_amount_locked: null,
        deposit_amount: null,
      }) as any,
      { rawToken: 'raw-legacy-token', appBaseUrl: 'https://example.invalid' }
    )

    expect(result).toMatchObject({ state: 'blocked', reason: 'invalid_amount' })

    // Must NOT call Stripe with a zero/invalid amount.
    expect(createStripeTableDepositCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('fails with state: blocked + reason: hold_expired when the hold window has lapsed', async () => {
    const result = await createTableCheckoutSessionByRawToken(
      buildSupabase({
        hold_expires_at: '2026-06-26T09:00:00.000Z', // already past per fake clock
        deposit_amount_locked: 60,
      }) as any,
      { rawToken: 'raw-legacy-token', appBaseUrl: 'https://example.invalid' }
    )

    expect(result).toMatchObject({ state: 'blocked', reason: 'hold_expired' })
    expect(createStripeTableDepositCheckoutSessionMock).not.toHaveBeenCalled()
  })
})
```

### `tests/api/paypalCaptureOrderTableBooking.test.ts`

```
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  supabaseFrom,
  capturePayPalPayment,
  loggerError,
  sendTableBookingCreatedSmsIfAllowed,
  sendManagerTableBookingCreatedEmailIfAllowed,
} = vi.hoisted(() => ({
  supabaseFrom: vi.fn(),
  capturePayPalPayment: vi.fn(),
  loggerError: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: () => Promise<Response>) => handler()),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: supabaseFrom }),
}))

vi.mock('@/lib/paypal', () => ({
  capturePayPalPayment: (...args: unknown[]) => capturePayPalPayment(...args),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCreatedSmsIfAllowed: (...args: unknown[]) =>
    sendTableBookingCreatedSmsIfAllowed(...args),
  sendManagerTableBookingCreatedEmailIfAllowed: (...args: unknown[]) =>
    sendManagerTableBookingCreatedEmailIfAllowed(...args),
}))

import { POST } from '@/app/api/external/table-bookings/[id]/paypal/capture-order/route'

const BOOKING_ID = '6ac0fc03-6030-44f2-9767-89a4e542620a'

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/external/table-bookings/xxx/paypal/capture-order', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Request
}

function buildBookingFetch(bookingRow: unknown, fetchError: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data: bookingRow, error: fetchError })
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
  return { select, update }
}

describe('POST /api/external/table-bookings/[id]/paypal/capture-order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseFrom.mockReset()
  })

  it('captures a Sunday lunch booking and sets sunday_lunch=true in notification payload', async () => {
    const bookingRow = {
      id: BOOKING_ID,
      status: 'pending_payment',
      payment_status: 'pending',
      paypal_deposit_order_id: 'ORDER-123',
      paypal_deposit_capture_id: null,
      customer_id: 'cust-1',
      party_size: 2,
      start_datetime: '2026-04-26T12:00:00Z',
      booking_reference: 'TB-TEST1234',
      booking_type: 'sunday_lunch',
      source: 'brand_site',
    }

    // First call: table_bookings select; second call: table_bookings update; third: customers select
    const tableBookingsSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: bookingRow, error: null })
    const tableBookingsEq1 = vi.fn(() => ({ single: tableBookingsSingle }))
    const tableBookingsSelect = vi.fn(() => ({ eq: tableBookingsEq1 }))
    const tableBookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const tableBookingsUpdate = vi.fn(() => ({ eq: tableBookingsUpdateEq }))

    const customersMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { mobile_e164: '+447000000000', mobile_number: '+447000000000' }, error: null })
    const customersEq = vi.fn(() => ({ maybeSingle: customersMaybeSingle }))
    const customersSelect = vi.fn(() => ({ eq: customersEq }))

    supabaseFrom.mockImplementation((table: string) => {
      if (table === 'table_bookings') {
        return { select: tableBookingsSelect, update: tableBookingsUpdate }
      }
      if (table === 'customers') {
        return { select: customersSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    capturePayPalPayment.mockResolvedValue({
      transactionId: 'TXN-999',
      status: 'COMPLETED',
      amount: 40,
    })

    const response = await POST(
      buildRequest({ orderId: 'ORDER-123' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ success: true })

    // Regression: SELECT must use the real column booking_type, NOT sunday_lunch.
    const selectArg = tableBookingsSelect.mock.calls[0]?.[0]
    expect(selectArg).toContain('booking_type')
    expect(selectArg).not.toMatch(/\bsunday_lunch\b/)

    // Walk-in launch (spec §6, §7.4, §8.3): the capture must persist
    // deposit_amount_locked = the actually-captured GBP amount.
    expect(tableBookingsUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = tableBookingsUpdate.mock.calls[0]?.[0]
    expect(updatePayload).toMatchObject({
      payment_status: 'completed',
      status: 'confirmed',
      payment_method: 'paypal',
      paypal_deposit_capture_id: 'TXN-999',
      deposit_amount_locked: 40,
    })

    // The notification payload must derive sunday_lunch from booking_type.
    expect(sendTableBookingCreatedSmsIfAllowed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingResult: expect.objectContaining({ sunday_lunch: true }),
      }),
    )
  })

  it('derives sunday_lunch=false for a regular booking_type', async () => {
    const bookingRow = {
      id: BOOKING_ID,
      status: 'pending_payment',
      payment_status: 'pending',
      paypal_deposit_order_id: 'ORDER-123',
      paypal_deposit_capture_id: null,
      customer_id: 'cust-1',
      party_size: 8,
      start_datetime: '2026-04-24T19:00:00Z',
      booking_reference: 'TB-TEST2345',
      booking_type: 'regular',
      source: 'brand_site',
    }

    const tableBookingsSingle = vi.fn().mockResolvedValue({ data: bookingRow, error: null })
    const tableBookingsSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: tableBookingsSingle })) }))
    const tableBookingsUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
    const customersSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }))

    supabaseFrom.mockImplementation((table: string) =>
      table === 'table_bookings'
        ? { select: tableBookingsSelect, update: tableBookingsUpdate }
        : { select: customersSelect },
    )

    capturePayPalPayment.mockResolvedValue({
      transactionId: 'TXN-42',
      status: 'COMPLETED',
      amount: 80,
    })

    await POST(
      buildRequest({ orderId: 'ORDER-123' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(sendTableBookingCreatedSmsIfAllowed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingResult: expect.objectContaining({ sunday_lunch: false }),
      }),
    )
  })

  it('fails closed (502, no DB update) when PayPal capture response has no parseable GBP amount', async () => {

[truncated at line 200 — original has 275 lines]
```

### `tests/api/paypalCreateOrderTableBooking.test.ts`

```
/**
 * Walk-in launch (spec §6, §7.3, §7.4, §8.3): canonical deposit precedence
 * for the PayPal create-order endpoint.
 *
 * Precedence (locked > stored > computed):
 *   1. If deposit_amount_locked is set, use it (authoritative).
 *   2. Else if deposit_amount is set on the row, use it (e.g. an unpaid
 *      pending booking holding a stored amount).
 *   3. Else compute the standard 10+ rule * £10 per person.
 *   4. Waivers always result in 0 (covered by getCanonicalDeposit).
 *
 * Critically, the create-order path must NEVER overwrite a locked amount —
 * once a booking has been paid (or the cash deposit confirmed), the
 * deposit_amount_locked column is sealed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    (handler: any, _permissions: string[], request: Request) =>
      handler(request, { id: 'k', name: 'k', permissions: ['read:events'], rate_limit: 100, is_active: true })
  ),
}))

const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateEq = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
    })),
  })),
}))

const mockCreatePayPalOrder = vi.fn()
vi.mock('@/lib/paypal', () => ({
  createInlinePayPalOrder: mockCreatePayPalOrder,
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

function buildBookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-canonical',
    party_size: 12,
    status: 'pending_payment',
    payment_status: 'pending',
    paypal_deposit_order_id: null,
    deposit_amount: null,
    deposit_amount_locked: null,
    deposit_waived: false,
    booking_type: 'regular',
    ...overrides,
  }
}

function mockFetchAndUpdate(booking: ReturnType<typeof buildBookingRow>) {
  mockSingle.mockResolvedValueOnce({ data: booking, error: null })
  mockEq.mockReturnValue({ single: mockSingle })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockUpdateEq.mockResolvedValueOnce({ error: null })
  mockUpdate.mockReturnValue({ eq: mockUpdateEq })
}

async function callRoute(id: string) {
  const { POST } = await import('@/app/api/external/table-bookings/[id]/paypal/create-order/route')
  const req = new NextRequest(
    `http://localhost/api/external/table-bookings/${id}/paypal/create-order`,
    { method: 'POST' }
  )
  return POST(req, { params: Promise.resolve({ id }) })
}

describe('paypal create-order canonical deposit precedence (walk-in launch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('locked amount wins: uses deposit_amount_locked even when deposit_amount differs', async () => {
    // Edge case: an admin set deposit_amount=120 but the previous capture
    // locked £80. The next order recreate (e.g. customer reopens the link)
    // must not silently bump the charge to £120.
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 12,
        deposit_amount: 120,
        deposit_amount_locked: 80,
      })
    )
    mockCreatePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-LOCKED' })

    const res = await callRoute('booking-canonical')
    expect(res.status).toBe(200)

    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 80 })
    )
  })

  it('stored amount used when locked is null: deposit_amount=50 wins over the £10*party_size compute', async () => {
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 12,
        deposit_amount: 50,
        deposit_amount_locked: null,
      })
    )
    mockCreatePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-STORED' })

    const res = await callRoute('booking-canonical')
    expect(res.status).toBe(200)

    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50 })
    )
  })

  it('falls back to fresh compute when neither locked nor stored is set', async () => {
    // 12 guests * £10 = £120
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 12,
        deposit_amount: null,
        deposit_amount_locked: null,
      })
    )
    mockCreatePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-FRESH' })

    const res = await callRoute('booking-canonical')
    expect(res.status).toBe(200)

    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 120 })
    )
  })

  it('NEVER persists deposit_amount on the create-order path, even when canonical resolves from stored', async () => {
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 12,
        deposit_amount: 50,
        deposit_amount_locked: null,
      })
    )
    mockCreatePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-NO-OVERWRITE' })

    await callRoute('booking-canonical')

    // Spec §7.3, §7.4: the create-order path may only persist
    // paypal_deposit_order_id. It must never write deposit_amount or
    // deposit_amount_locked — those are owned by the capture/confirm path.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = mockUpdate.mock.calls[0]?.[0]
    expect(updatePayload).toEqual({ paypal_deposit_order_id: 'ORDER-NO-OVERWRITE' })
    expect(updatePayload).not.toHaveProperty('deposit_amount')
    expect(updatePayload).not.toHaveProperty('deposit_amount_locked')
  })

  it('rejects with 400 when canonical resolves to 0 (no deposit required)', async () => {
    // party_size=4 is below 10+ threshold; locked/stored both null;
    // canonical compute = 0 → no order should be created.
    mockFetchAndUpdate(
      buildBookingRow({
        party_size: 4,
        deposit_amount: null,
        deposit_amount_locked: null,
      })
    )

    const res = await callRoute('booking-canonical')
    expect(res.status).toBe(400)
    expect(mockCreatePayPalOrder).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
```

### `tests/api/stripeWebhookMutationGuards.test.ts`

```
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/payments/stripe', () => ({
  createStripeRefund: vi.fn(),
  retrieveStripeSetupIntent: vi.fn(),
  verifyStripeWebhookSignature: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/events/event-payments', () => ({
  sendEventBookingSeatUpdateSms: vi.fn(),
  sendEventPaymentConfirmationSms: vi.fn(),
  sendEventPaymentRetrySms: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingConfirmedAfterDepositSmsIfAllowed: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { retrieveStripeSetupIntent, verifyStripeWebhookSignature } from '@/lib/payments/stripe'
import { sendEventBookingSeatUpdateSms, sendEventPaymentConfirmationSms, sendEventPaymentRetrySms } from '@/lib/events/event-payments'
import { sendTableBookingConfirmedAfterDepositSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { POST } from '@/app/api/stripe/webhook/route'

describe('stripe webhook mutation guards', () => {
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  })

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret
    }
  })

  it('fails closed when approved-charge status update affects no charge-request rows', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

    const chargeRequestLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'charge-request-1',
        table_booking_id: 'table-booking-1',
        metadata: {},
        charge_status: 'pending',
      },
      error: null,
    })
    const chargeRequestLookupEq = vi.fn().mockReturnValue({ maybeSingle: chargeRequestLookupMaybeSingle })
    const chargeRequestLookupSelect = vi.fn().mockReturnValue({ eq: chargeRequestLookupEq })

    const chargeRequestUpdateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const chargeRequestUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: chargeRequestUpdateMaybeSingle })
    const chargeRequestUpdateEq = vi.fn().mockReturnValue({ select: chargeRequestUpdateSelect })
    const chargeRequestUpdate = vi.fn().mockReturnValue({ eq: chargeRequestUpdateEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'charge_requests') {
          return {
            select: chargeRequestLookupSelect,
            update: chargeRequestUpdate,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const eventPayload = {
      id: 'evt_approved_charge_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_approved_1',
          amount: 1250,
          currency: 'gbp',
          metadata: {
            payment_kind: 'approved_charge',
            charge_request_id: 'charge-request-1',
          },
        },
      },
    }

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify(eventPayload),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
  })

  it('fails closed when blocked seat-increase payment update affects no rows and no terminal payment exists', async () => {
    ;(verifyStripeWebhookSignature as unknown as vi.Mock).mockReturnValue(true)
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-seat-increase')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })

    const paymentUpdateSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const paymentUpdateEqStatus = vi.fn().mockReturnValue({ select: paymentUpdateSelect })
    const paymentUpdateEqCheckout = vi.fn().mockReturnValue({ eq: paymentUpdateEqStatus })
    const paymentUpdate = vi.fn().mockReturnValue({ eq: paymentUpdateEqCheckout })

    const paymentLookupMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const paymentLookupLimit = vi.fn().mockReturnValue({ maybeSingle: paymentLookupMaybeSingle })
    const paymentLookupOrder = vi.fn().mockReturnValue({ limit: paymentLookupLimit })
    const paymentLookupEq = vi.fn().mockReturnValue({ order: paymentLookupOrder })
    const paymentSelect = vi.fn().mockReturnValue({ eq: paymentLookupEq })

    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: 'blocked',
        booking_id: 'event-booking-2',
        reason: 'capacity_blocked',
      },
      error: null,
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }

        if (table === 'payments') {
          return {
            update: paymentUpdate,
            select: paymentSelect,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    })

    const eventPayload = {
      id: 'evt_seat_increase_blocked_1',
      type: 'checkout.session.completed',
      data: {
        object: {

[truncated at line 200 — original has 1244 lines]
```

### `tests/api/tableBookingStructuredPersistence.test.ts`

```
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A2 regression test — the public POST /api/table-bookings endpoint must
 * persist dietary/allergy arrays onto the booking row and hand structured
 * Sunday lunch pre-order items to saveSundayPreorderByBookingId, rather than
 * losing them into a free-text notes blob.
 */

const {
  saveSundayPreorderByBookingId,
  ensureCustomerForPhone,
  logAuditEvent,
  warn,
  error,
  createTablePaymentToken,
  sendTableBookingCreatedSmsIfAllowed,
  sendManagerTableBookingCreatedEmailIfAllowed,
  alignTablePaymentHoldToScheduledSend,
  mapTableBookingBlockedReason,
  recordAnalyticsEvent,
  verifyTurnstileToken,
} = vi.hoisted(() => ({
  saveSundayPreorderByBookingId: vi.fn().mockResolvedValue({ state: 'saved', item_count: 2, booking_id: 'bk1' }),
  ensureCustomerForPhone: vi.fn(),
  logAuditEvent: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  createTablePaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ sent: true }),
  alignTablePaymentHoldToScheduledSend: vi.fn(async () => undefined),
  mapTableBookingBlockedReason: vi.fn((reason?: string) => (reason as any) ?? null),
  recordAnalyticsEvent: vi.fn(),
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => vi.fn().mockResolvedValue(null)),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request),
  ),
  createApiResponse: (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  createErrorResponse: (message: string, _code: string, status: number) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue({ state: 'claimed' }),
  computeIdempotencyRequestHash: vi.fn(() => 'hash'),
  getIdempotencyKey: vi.fn(() => 'idem-1'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone,
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken,
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent,
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent,
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend,
  createTablePaymentToken,
  mapTableBookingBlockedReason,
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  saveSundayPreorderByBookingId,
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn, error, info: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { POST } from '@/app/api/table-bookings/route'

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'
const DISH_ID = '22222222-2222-4222-8222-222222222222'
const DISH_ID_2 = '33333333-3333-4333-8333-333333333333'

function buildSupabase() {
  const tableBookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const tableBookingsUpdate = vi.fn(() => ({ eq: tableBookingsUpdateEq }))

  const rpc = vi.fn(async () => ({
    data: {
      state: 'pending_payment',
      table_booking_id: BOOKING_ID,
      booking_reference: 'TB-TEST',
      hold_expires_at: new Date(Date.now() + 60_000).toISOString(),
      deposit_amount: 20,
      table_name: 'T1',
    },
    error: null,
  }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'table_bookings') {
        return { update: tableBookingsUpdate }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc,
    _tableBookingsUpdate: tableBookingsUpdate,
    _tableBookingsUpdateEq: tableBookingsUpdateEq,
  }
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/table-bookings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-key',
      'idempotency-key': 'idem-1',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/table-bookings — structured persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureCustomerForPhone.mockResolvedValue({ customerId: 'cust-1' })
    saveSundayPreorderByBookingId.mockResolvedValue({ state: 'saved', item_count: 2, booking_id: BOOKING_ID })
  })

  it('persists dietary_requirements and allergies arrays on the booking row', async () => {
    const supabase = buildSupabase()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const body = {
      phone: '+447000000000',
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      date: '2026-04-26',
      time: '12:00',
      party_size: 2,
      purpose: 'food',
      sunday_lunch: true,
      dietary_requirements: ['vegetarian'],
      allergies: ['nuts', 'shellfish'],
    }

    const response = await POST(buildRequest(body) as any)
    expect(response.status).toBeLessThan(500)

    expect(supabase._tableBookingsUpdate).toHaveBeenCalledWith({
      dietary_requirements: ['vegetarian'],
      allergies: ['nuts', 'shellfish'],
    })
    expect(supabase._tableBookingsUpdateEq).toHaveBeenCalledWith('id', BOOKING_ID)
  })

  // Walk-in launch (spec §6, §8.1): the public POST path no longer persists
  // Sunday pre-order items, regardless of sunday_lunch flag or sunday_preorder_items
  // payload. Pre-orders for legacy `booking_type='sunday_lunch'` bookings are
  // exclusively administered via the staff admin path now.
  it('does NOT call saveSundayPreorderByBookingId from the public POST path even with sunday_lunch=true', async () => {
    const supabase = buildSupabase()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const body = {
      phone: '+447000000000',

[truncated at line 200 — original has 256 lines]
```

### `tests/lib/table-bookings/deposit.test.ts`

```
import { describe, it, expect } from 'vitest';
import {
  requiresDeposit,
  computeDepositAmount,
  getCanonicalDeposit,
} from '../../../src/lib/table-bookings/deposit';

describe('requiresDeposit', () => {
  it('returns false for parties under 10', () => {
    expect(requiresDeposit(1)).toBe(false);
    expect(requiresDeposit(9)).toBe(false);
  });

  it('returns true for parties of 10 or more', () => {
    expect(requiresDeposit(10)).toBe(true);
    expect(requiresDeposit(20)).toBe(true);
  });

  it('returns false when deposit is waived even for 10+', () => {
    expect(requiresDeposit(10, { depositWaived: true })).toBe(false);
    expect(requiresDeposit(50, { depositWaived: true })).toBe(false);
  });
});

describe('computeDepositAmount', () => {
  it('returns 0 below threshold', () => {
    expect(computeDepositAmount(9)).toBe(0);
  });

  it('returns party_size * 10 at and above threshold', () => {
    expect(computeDepositAmount(10)).toBe(100);
    expect(computeDepositAmount(15)).toBe(150);
  });
});

describe('getCanonicalDeposit', () => {
  const baseBooking = {
    party_size: 12,
    deposit_amount: 120,
    deposit_amount_locked: null,
    status: 'confirmed',
    payment_status: null,
    deposit_waived: false,
  };

  it('locked amount always wins, even if other fields disagree', () => {
    const b = { ...baseBooking, deposit_amount_locked: 100, deposit_amount: 999, party_size: 12 };
    expect(getCanonicalDeposit(b)).toBe(100);
  });

  it('uses stored deposit_amount when booking is in payment-required state', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: 110, status: 'pending_payment', payment_status: 'pending' };
    expect(getCanonicalDeposit(b)).toBe(110);
  });

  it('falls back to fresh compute when no locked or stored amount and no payment-required state', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 12 };
    expect(getCanonicalDeposit(b)).toBe(120);
  });

  it('returns 0 fresh-compute when party size is below threshold and nothing is stored', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 4 };
    expect(getCanonicalDeposit(b)).toBe(0);
  });

  it('respects deposit_waived flag and returns 0', () => {
    const b = { ...baseBooking, deposit_amount_locked: null, deposit_amount: null, status: 'confirmed', payment_status: null, party_size: 50, deposit_waived: true };
    expect(getCanonicalDeposit(b)).toBe(0);
  });
});
```

### `tests/lib/tableCheckoutSessionExpiry.test.ts`

```
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createStripeTableDepositCheckoutSessionMock } = vi.hoisted(() => ({
  createStripeTableDepositCheckoutSessionMock: vi.fn(),
}))

vi.mock('@/lib/payments/stripe', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments/stripe')>('@/lib/payments/stripe')
  return {
    ...actual,
    createStripeTableDepositCheckoutSession: createStripeTableDepositCheckoutSessionMock,
  }
})

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((body: string) => body),
}))

vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(),
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  createSundayPreorderToken: vi.fn(),
}))

import { createTableCheckoutSessionByRawToken } from '@/lib/table-bookings/bookings'

function buildSupabase() {
  const guestTokenMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'token-1',
      customer_id: 'customer-1',
      table_booking_id: 'table-booking-1',
      expires_at: '2026-02-24T09:00:00.000Z',
      consumed_at: null,
    },
    error: null,
  })
  const guestTokenEqActionType = vi.fn().mockReturnValue({ maybeSingle: guestTokenMaybeSingle })
  const guestTokenEqHash = vi.fn().mockReturnValue({ eq: guestTokenEqActionType })
  const guestTokenSelect = vi.fn().mockReturnValue({ eq: guestTokenEqHash })

  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'table-booking-1',
      customer_id: 'customer-1',
      status: 'pending_payment',
      payment_status: 'pending',
      hold_expires_at: '2026-02-24T09:00:00.000Z',
      party_size: 2,
      committed_party_size: 2,
      booking_reference: 'TB-123',
      booking_date: '2026-03-08',
      booking_time: '16:30:00',
      start_datetime: '2026-03-08T16:30:00.000Z',
      booking_type: 'regular',
      // Walk-in launch (spec §7.3, §8.3): canonical deposit precedence is
      // locked > stored > computed. This fixture exercises the "stored"
      // path — the booking has a deposit set up but not yet paid/locked.
      deposit_amount: 20,
      deposit_amount_locked: null,
      deposit_waived: false,
    },
    error: null,
  })
  const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const paymentsMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'payment-existing' },
    error: null,
  })
  const paymentsLimit = vi.fn().mockReturnValue({ maybeSingle: paymentsMaybeSingle })
  const paymentsEq = vi.fn().mockReturnValue({ limit: paymentsLimit })
  const paymentsSelect = vi.fn().mockReturnValue({ eq: paymentsEq })

  return {
    from: vi.fn((table: string) => {
      if (table === 'guest_tokens') {
        return { select: guestTokenSelect }
      }
      if (table === 'table_bookings') {
        return { select: bookingSelect }
      }
      if (table === 'payments') {
        return { select: paymentsSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('createTableCheckoutSessionByRawToken expiry handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-23T07:14:00.000Z'))
    createStripeTableDepositCheckoutSessionMock.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://stripe.test/checkout/cs_test_1',
      payment_intent: 'pi_test_1',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clamps long hold windows to a Stripe-safe expires_at value', async () => {
    const result = await createTableCheckoutSessionByRawToken(buildSupabase() as any, {
      rawToken: 'raw-token',
      appBaseUrl: 'https://management.orangejelly.co.uk',
    })

    expect(result).toMatchObject({
      state: 'created',
      checkoutUrl: 'https://stripe.test/checkout/cs_test_1',
      tableBookingId: 'table-booking-1',
    })

    const call = createStripeTableDepositCheckoutSessionMock.mock.calls[0]?.[0]
    expect(call).toBeDefined()

    const expectedClampedMs = Date.parse('2026-02-23T07:14:00.000Z') + 24 * 60 * 60 * 1000 - 60 * 1000
    expect(call.expiresAtUnix).toBe(Math.floor(expectedClampedMs / 1000))
  })
})
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
.claude/agents/ui-standards-enforcer.md
.claude/changes-manifest.log
.claude/skills/bug-fix.md
.claude/skills/code-review.md
.claude/skills/fix-function/SKILL.md
.claude/skills/fix-function/references/review-checklist.md
.claude/skills/techdebt.md
.env.example
.github/ISSUE_TEMPLATE/audit-critical-gdpr.md
.github/ISSUE_TEMPLATE/audit-critical-validation.md
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — Anchor Management Tools

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions (stack, TypeScript rules, Supabase patterns, etc.).

## Quick Profile

```yaml
framework: Next.js 15 App Router + React 19
test_runner: Vitest (config: vitest.config.ts)
database: Supabase (PostgreSQL + Auth + RLS)
integrations: Twilio (SMS), Microsoft Graph (email), Stripe, PayPal
styling: Tailwind CSS v4
hosting: Vercel
size: ~600 files, large multi-module management system
```

---

## Workflow Orchestration

### Plan Mode Default
Enter plan mode for any non-trivial task (3+ steps or architectural decisions). If something goes sideways, STOP and re-plan immediately — don't keep pushing. Use plan mode for verification steps, not just building. Write detailed specs upfront to reduce ambiguity.

### Subagent Strategy
Use subagents liberally to keep the main context window clean. Offload research, exploration, and parallel analysis to subagents. For complex problems, throw more compute at it via subagents. One task per subagent for focused execution. When exploring the codebase, use subagents to read multiple sections in parallel.

### Self-Improvement Loop
After ANY correction from the user, update `tasks/lessons.md` with the pattern. Write rules for yourself that prevent the same mistake. Review `tasks/lessons.md` at session start.

### Verification Before Done
Never mark a task complete without proving it works. Diff behaviour between main and your changes when relevant. Ask yourself: "Would a staff engineer approve this?" Run tests, check logs, demonstrate correctness.

### Demand Elegance (Balanced)
For non-trivial changes, pause and ask "is there a more elegant way?" Skip this for simple, obvious fixes — don't over-engineer. Challenge your own work before presenting it.

### Autonomous Bug Fixing
When given a bug report, just fix it. Don't ask for hand-holding. Check Supabase logs, Vercel deployment logs, and browser console. Point at errors, then resolve them. Zero context switching from the user.

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Test Against Reality**: Don't assume code is correct because it exists. Trace the actual logic.

---

## Domain Rules

- £10 deposit per person for groups of 7 or more (NOT credit card holds — that was old functionality)
- Events hosted by the venue itself are exceptions to deposit rules
- Contracts must be generated for private bookings
- Booking amendments, cancellations, and deletions must track payment state correctly
- All customer-facing language must reflect current policies, not legacy ones
- Legacy "credit card hold" language anywhere in code or templates is always a bug

---

## Prompting Conventions

- **Challenge as reviewer**: "Grill me on these changes and don't make a PR until I pass your test."
- **Demand proof**: "Prove to me this works" — diff behaviour between main and feature branch.
- **Force elegance**: "Knowing everything you know now, scrap this and implement the elegant solution."
- **Section review**: "Do a full review of the /[section-name] section" triggers the fix-function skill.
- **Autonomous mode**: Point at logs, Slack threads, or failing CI and just say "fix."

---

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # ESLint (zero warnings enforced)
npm test         # Run Vitest tests
npx supabase db push   # Apply pending migrations
```

**Node version:** Use Node 20 LTS (as pinned in `.nvmrc`). Run `nvm use` before development. The `engines` field in `package.json` enforces `>=20 <23`.

## Architecture

**Additional integrations**: Twilio (SMS), Microsoft Graph (email), Stripe, PayPal.

**Route groups**:
- `(authenticated)/` — all staff-facing pages, auth enforced at layout level
- `(staff-portal)/portal/` — employee-only views (shifts, pay)
- `(timeclock)/timeclock/` — public kiosk access (no auth)
- `(employee-onboarding)/` — onboarding flows
- `api/cron/` — Vercel cron endpoints (require `Authorization: Bearer CRON_SECRET`)
- `api/webhooks/` — Twilio, Stripe, PayPal webhooks

**Auth**: Supabase Auth with JWT + HTTP-only cookies. `src/middleware.ts` is currently **disabled** (renamed `.disabled` after a Vercel incident); auth is enforced in `(authenticated)/layout.tsx` via `supabase.auth.getUser()`. Public path prefixes: `/timeclock`, `/parking/guest`, `/table-booking`, `/g/`, `/m/`, `/r/`.

## Supabase Clients

- **`src/lib/supabase/server.ts`** — cookie-based auth, use in server actions and API routes
- **`src/lib/supabase/admin.ts`** — service role key, bypasses RLS; use for system/cron operations
- ESLint rule prevents importing the admin singleton in client components

## Permissions (RBAC)

```typescript
await checkUserPermission('module', 'action', userId)
```

Modules: `calendar`, `customers`, `employees`, `events`, `invoices`, `messages`, `parking`, `private-bookings`, `receipts`, `rota`, `leave`, `timeclock`, `payroll`, `settings`, `roles`, etc.
Actions: `view`, `create`, `edit`, `delete`, `publish`, `request`, `clock`, `manage`.
Roles: `super_admin`, `manager`, `staff`. Defined in `src/types/rbac.ts`.

## Key Libraries & Utilities

- **`src/lib/dateUtils.ts`** — `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()` etc. London timezone hardcoded.
- **`src/lib/email/emailService.ts`** — `sendEmail(to, subject, html, cc?, attachments?)` via Microsoft Graph
- **`src/lib/sms/`** — Twilio wrapper with safety guards (hourly/daily rate limits, idempotency)
- **`src/services/`** — business logic services (CustomerService, EmployeeService, PermissionService, etc.)

## UI Components

Migrating from legacy `PageWrapper`/`Page` pattern to `PageLayout` + `HeaderNav` from `src/components/ui-v2/`. New pages must use the `ui-v2` pattern. Navigation defined in `src/components/ui-v2/navigation/AppNavigation.tsx`.

## Data Conventions

- Server actions body size limit: 20 MB (for file uploads)
- Dashboard data cached via `loadDashboardSnapshot()` in `src/app/(authenticated)/dashboard/`
- Date/holiday pre-computation: `buildConfirmedUKDates()` in calendar-notes actions

## Scheduled Jobs (vercel.json crons)

| Route | Schedule |
|---|---|
| `/api/cron/parking-notifications` | 0 5 * * * |
| `/api/cron/rota-auto-close` | 0 5 * * * |
| `/api/cron/rota-manager-alert` | 0 18 * * 0 |
| `/api/cron/rota-staff-email` | 0 21 * * 0 |
| `/api/cron/private-bookings-weekly-summary` | 0 * * * * |

## Key Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID / MICROSOFT_USER_EMAIL
PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID / PAYPAL_ENVIRONMENT
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
OPENAI_API_KEY
CRON_SECRET
PAYROLL_ACCOUNTANT_EMAIL
```

See `.env.example` for the full list.
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md`

```markdown
# Supabase Conventions

## Client Patterns

Two Supabase client patterns — always use the correct one:

```typescript
// Server-side auth (anon key + cookie session) — use for auth checks:
const supabase = await getSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();

// Server-side data (service-role, bypasses RLS) — use for system/cron operations:
const db = await getDb(); // or createClient() with service role
const { data } = await db.from("table").select("*").eq("id", id).single();

// Browser-only (client components):
const supabase = getSupabaseBrowserClient();
```

ESLint rules should prevent importing the admin/service-role client in client components.

## snake_case ↔ camelCase Conversion

DB columns are always `snake_case`; TypeScript types are `camelCase` with Date objects. Always wrap DB results:

```typescript
import { fromDb } from "@/lib/utils";
const record = fromDb<MyType>(dbRow); // converts snake_case keys + ISO strings → Date
```

All type definitions should live in a central types file (e.g. `src/types/database.ts`).

## Row Level Security (RLS)

- RLS is always enabled on all tables
- Use the anon-key client for user-scoped operations (respects RLS)
- Use the service-role client only for system operations, crons, and webhooks
- Never disable RLS "temporarily" — create a proper service-role path instead

## Migrations

```bash
npx supabase db push          # Apply pending migrations
npx supabase migration new    # Create a new migration file
```

- Migrations live in `supabase/migrations/`
- Full schema reference in `supabase/schema.sql` (paste into SQL Editor for fresh setup)
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval
- Test migrations locally with `npx supabase db push --dry-run` before pushing (see `verification-pipeline.md`)

### Dropping columns or tables — mandatory function audit

When a migration drops a column or table, you MUST search for every function and trigger that references it and update them in the same migration. Failing to do so leaves silent breakage: PL/pgSQL functions that reference a dropped column/table throw an exception at runtime, and if any of those functions have an `EXCEPTION WHEN OTHERS THEN` handler, the error is swallowed and returned as a generic blocked/failure state — making the bug invisible until someone notices the feature is broken.

**Before writing any `DROP COLUMN` or `DROP TABLE`:**

```sql
-- Find all functions that reference the column or table
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%column_or_table_name%'
  AND routine_type = 'FUNCTION';
```

Or search the migrations directory:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -l
```

For each function found: update it in the same migration to remove or replace the reference. Never leave a function referencing infrastructure that no longer exists.

This also applies to **triggers** — check trigger functions separately:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -n
```

## Auth

- Supabase Auth with JWT + HTTP-only cookies
- Auth checks happen in layout files or middleware
- Server actions must always re-verify auth server-side (never rely on UI hiding)
- Public routes must be explicitly allowlisted

## Audit Logging

All mutations (create, update, delete) in server actions must call `logAuditEvent()`:

```typescript
await logAuditEvent({
  user_id: user.id,
  operation_type: 'update',
  resource_type: 'thing',
  operation_status: 'success'
});
```
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/testing.md`

```markdown
# Testing Conventions

## Framework

- **Vitest** is the default test runner (not Jest)
- Test files live alongside source: `src/**/*.test.ts` or in a dedicated `tests/` directory
- **Playwright** for end-to-end testing where configured

## Commands

```bash
npm test              # Run tests once
npm run test:watch    # Watch mode (Vitest)
npm run test:ci       # With coverage report
npx vitest run src/lib/some-module.test.ts  # Run a single test file
```

## Patterns

- Use `describe` blocks grouped by function/component
- Test naming: `it('should [expected behaviour] when [condition]')`
- Prefer testing behaviour over implementation details
- Mock external services (Supabase, OpenAI, Twilio) — never hit real APIs in tests
- Use factories or fixtures for test data, not inline object literals

## Test Prioritisation

When adding tests to a feature, prioritise in this order:
1. **Server actions and business logic** — highest value, most likely to catch real bugs
2. **Data transformation utilities** — date formatting, snake_case conversion, parsers
3. **API route handlers** — input validation, error responses, auth checks
4. **Complex UI interactions** — forms, multi-step flows, conditional rendering
5. **Simple UI wrappers** — lowest priority, skip if time-constrained

Minimum per feature: happy path + at least 1 error/edge case.

## Mock Strategy

- **Always mock**: Supabase client, OpenAI/Azure OpenAI, Twilio, Stripe, PayPal, Microsoft Graph, external HTTP
- **Never mock**: Internal utility functions, date formatting, type conversion helpers
- **Use `vi.mock()`** for module-level mocks; `vi.spyOn()` for targeted function mocks
- Reset mocks between tests: `beforeEach(() => { vi.clearAllMocks() })`

## Coverage

- Business logic and server actions: target 90%
- API routes and data layers: target 80%
- UI components: target 70% (focus on interactive behaviour, not rendering)
- Don't chase coverage on trivial wrappers, type definitions, or config files

## Playwright (E2E)

- Local dev: uses native browser
- Production/CI: uses `BROWSERLESS_URL` env var for remote browser
- E2E tests should be independent (no shared state between tests)
- Use page object models for complex flows
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/ui-patterns.md`

```markdown
# UI Patterns & Component Standards

## Server vs Client Components

- Default to **Server Components** — only add `'use client'` when you need interactivity, hooks, or browser APIs
- Server Components can fetch data directly (no useEffect/useState for data loading)
- Client Components should receive data as props from server parents where possible

## Data Fetching & Display

Every data-driven UI must handle all three states:
1. **Loading** — skeleton loaders or spinners (not blank screens)
2. **Error** — user-facing error message or error boundary
3. **Empty** — meaningful empty state component (not just no content)

## Forms

- Use React Hook Form + Zod for validation where configured
- Validation errors displayed inline, not just console logs
- Required field indicators visible
- Loading/disabled state during submission (prevent double-submit)
- Server action errors surfaced to user via toast or inline message
- Form reset after successful submission where appropriate

## Buttons

Check every button for:
- Consistent variant usage (primary, secondary, destructive, ghost) — no ad-hoc Tailwind-only buttons
- Loading states on async actions (spinner/disabled during server action calls)
- Disabled states when form is invalid or submission in progress
- `type="button"` to prevent accidental form submission (use `type="submit"` only on submit buttons)
- Confirmation dialogs on destructive actions (delete, archive, bulk operations)
- `aria-label` on icon-only buttons

## Navigation

- Breadcrumbs on nested pages
- Active state on current nav item
- Back/cancel navigation returns to correct parent page
- New sections added to project navigation with correct permission gating
- Mobile responsiveness of all nav elements

## Permissions (RBAC)

- Every authenticated page must check permissions via the project's permission helper
- UI elements (edit, delete, create buttons) conditionally rendered based on permissions
- Server actions must re-check permissions server-side (never rely on UI hiding alone)

## Accessibility Baseline

These items are also enforced in the Definition of Done (`definition-of-done.md`):

- Interactive elements have visible focus styles
- Colour is not the only indicator of state
- Modal dialogs trap focus and close on Escape
- Tables use proper `<thead>`, `<th scope>` markup
- Images have meaningful `alt` text
- Keyboard navigation works for all interactive elements
```

---

_End of pack._
