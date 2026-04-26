# Review Pack: paypal-refunds

**Generated:** 2026-04-26
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`
**Base ref:** `main~1`
**HEAD:** `b3cc693f`
**Diff range:** `main~1...HEAD`
**Stats:**  19 files changed, 2045 insertions(+), 98 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
src/app/(authenticated)/parking/ParkingClient.tsx
src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx
src/app/(authenticated)/private-bookings/[id]/page.tsx
src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
src/app/(authenticated)/table-bookings/[id]/page.tsx
src/app/actions/__tests__/refundActions.test.ts
src/app/actions/refundActions.ts
src/app/api/webhooks/paypal/parking/route.ts
src/app/api/webhooks/paypal/private-bookings/route.ts
src/app/api/webhooks/paypal/table-bookings/route.ts
src/components/ui-v2/refunds/RefundDialog.tsx
src/components/ui-v2/refunds/RefundHistoryTable.tsx
src/lib/__tests__/paypal-refund.test.ts
src/lib/__tests__/refund-notifications.test.ts
src/lib/parking/payments.ts
src/lib/paypal-refund-webhook.ts
src/lib/paypal.ts
src/lib/refund-notifications.ts
supabase/migrations/20260626000001_payment_refunds.sql
```

## User Concerns

PayPal refund idempotency, concurrent refund race conditions, webhook routing for refund events, note_to_payer leak, parking booking cancellation removal

## Diff (`main~1...HEAD`)

```diff
diff --git a/src/app/(authenticated)/parking/ParkingClient.tsx b/src/app/(authenticated)/parking/ParkingClient.tsx
index 27f126ae..535ef52f 100644
--- a/src/app/(authenticated)/parking/ParkingClient.tsx
+++ b/src/app/(authenticated)/parking/ParkingClient.tsx
@@ -14,6 +14,8 @@ import { Spinner } from '@/components/ui-v2/feedback/Spinner'
 import { toast } from '@/components/ui-v2/feedback/Toast'
 import { Alert } from '@/components/ui-v2/feedback/Alert'
 import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
+import { RefundDialog } from '@/components/ui-v2/refunds/RefundDialog'
+import { RefundHistoryTable } from '@/components/ui-v2/refunds/RefundHistoryTable'
 import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
 import { Textarea } from '@/components/ui-v2/forms/Textarea'
 import { Toggle } from '@/components/ui-v2/forms/Toggle'
@@ -120,6 +122,45 @@ export default function ParkingClient({ permissions, initialError }: Props) {
   const [isMutating, startMutation] = useTransition()
   const pageError = initialError ?? null
 
+  // Refund state
+  const [showRefundDialog, setShowRefundDialog] = useState(false)
+  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null)
+  const [refundPaymentAmount, setRefundPaymentAmount] = useState(0)
+  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 })
+  const [refundHasCapture, setRefundHasCapture] = useState(false)
+
+  const openRefundForBooking = async (booking: ParkingBooking) => {
+    try {
+      const { getParkingPaymentForRefund, getRefundHistory } = await import('@/app/actions/refundActions')
+      const paymentResult = await getParkingPaymentForRefund(booking.id)
+
+      if (paymentResult.error || !paymentResult.data) {
+        toast.error(paymentResult.error || 'No paid payment record found.')
+        return
+      }
+
+      setRefundPaymentId(paymentResult.data.paymentId)
+      setRefundPaymentAmount(paymentResult.data.amount)
+      setRefundHasCapture(paymentResult.data.hasCapture)
+
+      // Load refund totals
+      const result = await getRefundHistory('parking', paymentResult.data.paymentId)
+      if (result.data) {
+        const completed = result.data
+          .filter((r: any) => r.status === 'completed')
+          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
+        const pending = result.data
+          .filter((r: any) => r.status === 'pending')
+          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
+        setRefundTotals({ totalRefunded: completed, totalPending: pending })
+      }
+
+      setShowRefundDialog(true)
+    } catch {
+      toast.error('Failed to load payment details for refund.')
+    }
+  }
+
   useEffect(() => {
     void fetchBookings()
   }, [statusFilter, paymentFilter, search])
@@ -361,7 +402,20 @@ export default function ParkingClient({ permissions, initialError }: Props) {
       className="cursor-pointer transition hover:bg-slate-50"
       onClick={() => {
         setSelectedBooking(booking)
+        setRefundPaymentId(null)
         void loadNotifications(booking.id)
+        // Pre-load payment ID for paid bookings (for refund history)
+        if (booking.payment_status === 'paid' && permissions.canRefund) {
+          import('@/app/actions/refundActions').then(({ getParkingPaymentForRefund }) =>
+            getParkingPaymentForRefund(booking.id).then((result) => {
+              if (result.data) {
+                setRefundPaymentId(result.data.paymentId)
+                setRefundPaymentAmount(result.data.amount)
+                setRefundHasCapture(result.data.hasCapture)
+              }
+            })
+          )
+        }
       }}
     >
       <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-900">{booking.reference}</td>
@@ -451,9 +505,27 @@ export default function ParkingClient({ permissions, initialError }: Props) {
                 {isMutating ? 'Updating…' : 'Mark completed'}
               </Button>
             )}
+
+            {permissions.canRefund && selectedBooking.payment_status === 'paid' && (
+              <Button
+                variant="secondary"
+                disabled={isMutating}
+                onClick={() => openRefundForBooking(selectedBooking)}
+              >
+                Process Refund
+              </Button>
+            )}
           </div>
         )}
 
+        {/* Refund history — only for paid bookings */}
+        {selectedBooking.payment_status === 'paid' && refundPaymentId && (
+          <RefundHistoryTable
+            sourceType="parking"
+            sourceId={refundPaymentId}
+          />
+        )}
+
         <Section title="Recent notifications" description="SMS and email attempts for this booking.">
           <div className="overflow-hidden rounded-md border border-slate-200">
             <table className="min-w-full divide-y divide-slate-200">
@@ -875,6 +947,21 @@ export default function ParkingClient({ permissions, initialError }: Props) {
           </ModalActions>
         </form>
       </Modal>
+
+      {/* Refund dialog for parking */}
+      {permissions.canRefund && refundPaymentId && (
+        <RefundDialog
+          open={showRefundDialog}
+          onOpenChange={setShowRefundDialog}
+          sourceType="parking"
+          sourceId={refundPaymentId}
+          originalAmount={refundPaymentAmount}
+          totalRefunded={refundTotals.totalRefunded}
+          totalPending={refundTotals.totalPending}
+          hasPayPalCapture={refundHasCapture}
+          captureExpired={false}
+        />
+      )}
     </PageLayout>
   )
 }
diff --git a/src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx b/src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx
index e005a831..c3a92c9d 100644
--- a/src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx
+++ b/src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx
@@ -98,6 +98,8 @@ import { FormGroup } from "@/components/ui-v2/forms/FormGroup";
 import { Badge } from "@/components/ui-v2/display/Badge";
 import { Modal } from "@/components/ui-v2/overlay/Modal";
 import { ConfirmDialog } from "@/components/ui-v2/overlay/ConfirmDialog";
+import { RefundDialog } from "@/components/ui-v2/refunds/RefundDialog";
+import { RefundHistoryTable } from "@/components/ui-v2/refunds/RefundHistoryTable";
 import { Skeleton } from "@/components/ui-v2/feedback/Skeleton";
 import { EmptyState } from "@/components/ui-v2/display/EmptyState";
 import { Alert } from "@/components/ui-v2/feedback/Alert";
@@ -150,6 +152,7 @@ interface PrivateBookingDetailClientProps {
     canManageCatering: boolean;
     canManageVendors: boolean;
     canEditPayments: boolean;
+    canRefund: boolean;
   };
   paymentHistory: PaymentHistoryEntry[];
   initialError?: string | null;
@@ -1554,8 +1557,32 @@ export default function PrivateBookingDetailClient({
     canManageCatering,
     canManageVendors,
     canEditPayments,
+    canRefund,
   } = permissions;
 
+  // Refund dialog state
+  const [showRefundDialog, setShowRefundDialog] = useState(false);
+  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 });
+
+  // Load refund totals when booking changes
+  useEffect(() => {
+    if (!booking?.id) return;
+    let cancelled = false;
+    import('@/app/actions/refundActions').then(({ getRefundHistory }) =>
+      getRefundHistory('private_booking', booking.id).then((result) => {
+        if (cancelled || !result.data) return;
+        const completed = result.data
+          .filter((r: any) => r.status === 'completed')
+          .reduce((sum: number, r: any) => sum + Number(r.amount), 0);
+        const pending = result.data
+          .filter((r: any) => r.status === 'pending')
+          .reduce((sum: number, r: any) => sum + Number(r.amount), 0);
+        setRefundTotals({ totalRefunded: completed, totalPending: pending });
+      })
+    );
+    return () => { cancelled = true; };
+  }, [booking?.id]);
+
   const navItems = [
     { label: 'Overview', href: `/private-bookings/${bookingId}` },
     { label: 'Items', href: `/private-bookings/${bookingId}/items` },
@@ -2641,6 +2668,38 @@ export default function PrivateBookingDetailClient({
                   <p className="text-xs text-gray-600 mt-2">
                     Returned after event (subject to terms)
                   </p>
+                  {/* Refund status badge */}
+                  {refundTotals.totalRefunded > 0 && (
+                    <div className="mt-2">
+                      <Badge
+                        variant={refundTotals.totalRefunded >= (booking.deposit_amount ?? 0) ? 'info' : 'warning'}
+                        size="sm"
+                      >
+                        {refundTotals.totalRefunded >= (booking.deposit_amount ?? 0) ? 'Refunded' : 'Partially Refunded'}
+                      </Badge>
+                    </div>
+                  )}
+                  {/* Refund button */}
+                  {canRefund && booking.deposit_paid_date && refundTotals.totalRefunded < (booking.deposit_amount ?? 0) && (
+                    <div className="mt-2">
+                      <Button
+                        variant="secondary"
+                        size="sm"
+                        onClick={() => setShowRefundDialog(true)}
+                      >
+                        Process Refund
+                      </Button>
+                    </div>
+                  )}
+                  {/* Refund history */}
+                  {booking.deposit_paid_date && (
+                    <div className="mt-3">
+                      <RefundHistoryTable
+                        sourceType="private_booking"
+                        sourceId={booking.id}
+                      />
+                    </div>
+                  )}
                 </div>
 
                 {(() => {
@@ -2886,6 +2945,25 @@ export default function PrivateBookingDetailClient({
           onSuccess={refreshBooking}
         />
       )}
+
+      {/* Refund dialog */}
+      {canRefund && booking && (
+        <RefundDialog
+          open={showRefundDialog}
+          onOpenChange={setShowRefundDialog}
+          sourceType="private_booking"
+          sourceId={booking.id}
+          originalAmount={booking.deposit_amount ?? 0}
+          totalRefunded={refundTotals.totalRefunded}
+          totalPending={refundTotals.totalPending}
+          hasPayPalCapture={!!booking.paypal_deposit_capture_id}
+          captureExpired={
+            booking.deposit_paid_date
+              ? (new Date().getTime() - new Date(booking.deposit_paid_date).getTime()) / (1000 * 60 * 60 * 24) > 180
+              : false
+          }
+        />
+      )}
     </PageLayout>
   );
 }
diff --git a/src/app/(authenticated)/private-bookings/[id]/page.tsx b/src/app/(authenticated)/private-bookings/[id]/page.tsx
index 8342a9b1..abfb4de8 100644
--- a/src/app/(authenticated)/private-bookings/[id]/page.tsx
+++ b/src/app/(authenticated)/private-bookings/[id]/page.tsx
@@ -32,6 +32,7 @@ export default async function PrivateBookingDetailPage({ params }: PageProps) {
   let canManageCatering = false
   let canManageVendors = false
   let canEditPayments = false
+  let canRefund = false
 
   const permissionsResult = await getCurrentUserModuleActions('private_bookings')
 
@@ -54,6 +55,7 @@ export default async function PrivateBookingDetailPage({ params }: PageProps) {
     canManageCatering = actions.has('manage_catering') || actions.has('manage')
     canManageVendors = actions.has('manage_vendors') || actions.has('manage')
     canEditPayments = actions.has('manage')
+    canRefund = actions.has('refund') || actions.has('manage')
   }
 
   if (!canView && errors.length === 0) {
@@ -108,6 +110,7 @@ export default async function PrivateBookingDetailPage({ params }: PageProps) {
         canManageCatering,
         canManageVendors,
         canEditPayments,
+        canRefund,
       }}
       paymentHistory={paymentHistory}
       initialError={initialError}
diff --git a/src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx b/src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
index 1c8971ab..8539cf3d 100644
--- a/src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
+++ b/src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
@@ -6,6 +6,9 @@ import toast from 'react-hot-toast'
 import { Modal } from '@/components/ui-v2/overlay/Modal'
 import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
 import { Button } from '@/components/ui-v2/forms/Button'
+import { Badge } from '@/components/ui-v2/display/Badge'
+import { RefundDialog } from '@/components/ui-v2/refunds/RefundDialog'
+import { RefundHistoryTable } from '@/components/ui-v2/refunds/RefundHistoryTable'
 import PreorderTab from './PreorderTab'
 // formatDateInLondon uses toLocaleDateString (date-only); use Intl.DateTimeFormat directly for time display
 const formatLondonTime = (iso: string) =>
@@ -90,6 +93,7 @@ interface Props {
   booking: Booking
   canEdit: boolean
   canManage: boolean
+  canRefund: boolean
 }
 
 type MoveTableOption = {
@@ -108,7 +112,7 @@ type MoveTableAvailabilityResponse = {
   }
 }
 
-export default function BookingDetailClient({ booking, canEdit, canManage }: Props) {
+export default function BookingDetailClient({ booking, canEdit, canManage, canRefund }: Props) {
   const [tab, setTab] = useState<Tab>('overview')
   const isSundayLunch = booking.booking_type === 'sunday_lunch'
 
@@ -133,6 +137,28 @@ export default function BookingDetailClient({ booking, canEdit, canManage }: Pro
   const [partySizeEditSendSms, setPartySizeEditSendSms] = useState(true)
   const [smsBody, setSmsBody] = useState('')
 
+  // Refund state
+  const [showRefundDialog, setShowRefundDialog] = useState(false)
+  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 })
+
+  useEffect(() => {
+    if (!booking.id || booking.payment_status !== 'completed') return
+    let cancelled = false
+    import('@/app/actions/refundActions').then(({ getRefundHistory }) =>
+      getRefundHistory('table_booking', booking.id).then((result) => {
+        if (cancelled || !result.data) return
+        const completed = result.data
+          .filter((r: any) => r.status === 'completed')
+          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
+        const pending = result.data
+          .filter((r: any) => r.status === 'pending')
+          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
+        setRefundTotals({ totalRefunded: completed, totalPending: pending })
+      })
+    )
+    return () => { cancelled = true }
+  }, [booking.id, booking.payment_status])
+
   async function runAction(key: string, fn: () => Promise<void>, successMsg: string) {
     setActionLoadingKey(key)
     try {
@@ -419,6 +445,36 @@ export default function BookingDetailClient({ booking, canEdit, canManage }: Pro
                       Capture ID: {booking.paypal_deposit_capture_id}
                     </p>
                   )}
+                  {/* Refund status */}
+                  {refundTotals.totalRefunded > 0 && (
+                    <div className="pl-4 mt-1">
+                      <Badge
+                        variant={refundTotals.totalRefunded >= (booking.deposit_amount ?? 0) ? 'info' : 'warning'}
+                        size="sm"
+                      >
+                        {refundTotals.totalRefunded >= (booking.deposit_amount ?? 0) ? 'Refunded' : 'Partially Refunded'}
+                      </Badge>
+                    </div>
+                  )}
+                  {/* Refund button */}
+                  {canRefund && refundTotals.totalRefunded < (booking.deposit_amount ?? 0) && (
+                    <div className="pl-4 mt-2">
+                      <Button
+                        variant="secondary"
+                        size="sm"
+                        onClick={() => setShowRefundDialog(true)}
+                      >
+                        Process Refund
+                      </Button>
+                    </div>
+                  )}
+                  {/* Refund history */}
+                  <div className="mt-3">
+                    <RefundHistoryTable
+                      sourceType="table_booking"
+                      sourceId={booking.id}
+                    />
+                  </div>
                 </div>
               ) : (
                 <div className="flex items-center gap-2">
@@ -717,6 +773,21 @@ export default function BookingDetailClient({ booking, canEdit, canManage }: Pro
           </div>
         </div>
       </Modal>
+
+      {/* Refund dialog */}
+      {canRefund && booking.payment_status === 'completed' && (
+        <RefundDialog
+          open={showRefundDialog}
+          onOpenChange={setShowRefundDialog}
+          sourceType="table_booking"
+          sourceId={booking.id}
+          originalAmount={booking.deposit_amount ?? 0}
+          totalRefunded={refundTotals.totalRefunded}
+          totalPending={refundTotals.totalPending}
+          hasPayPalCapture={!!booking.paypal_deposit_capture_id}
+          captureExpired={false}
+        />
+      )}
     </div>
   )
 }
diff --git a/src/app/(authenticated)/table-bookings/[id]/page.tsx b/src/app/(authenticated)/table-bookings/[id]/page.tsx
index 3beedb83..5b33e6d5 100644
--- a/src/app/(authenticated)/table-bookings/[id]/page.tsx
+++ b/src/app/(authenticated)/table-bookings/[id]/page.tsx
@@ -11,10 +11,11 @@ interface Props {
 export default async function BookingDetailPage({ params }: Props) {
   const { id } = await params
 
-  const [canView, canEdit, canManage] = await Promise.all([
+  const [canView, canEdit, canManage, canRefund] = await Promise.all([
     checkUserPermission('table_bookings', 'view'),
     checkUserPermission('table_bookings', 'edit'),
     checkUserPermission('table_bookings', 'manage'),
+    checkUserPermission('table_bookings', 'refund'),
   ])
 
   if (!canView) redirect('/unauthorized')
@@ -69,6 +70,7 @@ export default async function BookingDetailPage({ params }: Props) {
         booking={normalizedBooking}
         canEdit={canEdit}
         canManage={canManage}
+        canRefund={canRefund || canManage}
       />
     </PageLayout>
   )
diff --git a/src/app/actions/__tests__/refundActions.test.ts b/src/app/actions/__tests__/refundActions.test.ts
new file mode 100644
index 00000000..4db7886c
--- /dev/null
+++ b/src/app/actions/__tests__/refundActions.test.ts
@@ -0,0 +1,130 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest'
+
+// Mock all external dependencies before imports
+vi.mock('@/lib/supabase/admin', () => ({
+  createAdminClient: vi.fn(),
+}))
+vi.mock('@/lib/supabase/server', () => ({
+  createClient: vi.fn(),
+}))
+vi.mock('@/lib/paypal', () => ({
+  refundPayPalPayment: vi.fn(),
+}))
+vi.mock('@/lib/refund-notifications', () => ({
+  sendRefundNotification: vi.fn(),
+}))
+vi.mock('@/app/actions/rbac', () => ({
+  checkUserPermission: vi.fn(),
+}))
+vi.mock('@/app/actions/audit', () => ({
+  logAuditEvent: vi.fn(),
+}))
+vi.mock('next/cache', () => ({
+  revalidatePath: vi.fn(),
+}))
+
+import { createAdminClient } from '@/lib/supabase/admin'
+import { createClient } from '@/lib/supabase/server'
+import { refundPayPalPayment } from '@/lib/paypal'
+import { sendRefundNotification } from '@/lib/refund-notifications'
+import { checkUserPermission } from '@/app/actions/rbac'
+
+function mockSupabaseChain(returnData: any = null, returnError: any = null) {
+  const chain: any = {
+    from: vi.fn().mockReturnThis(),
+    select: vi.fn().mockReturnThis(),
+    insert: vi.fn().mockReturnThis(),
+    update: vi.fn().mockReturnThis(),
+    eq: vi.fn().mockReturnThis(),
+    in: vi.fn().mockReturnThis(),
+    maybeSingle: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
+    single: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
+    order: vi.fn().mockResolvedValue({ data: returnData ? [returnData] : [], error: returnError }),
+    rpc: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
+  }
+  return chain
+}
+
+describe('refundActions', () => {
+  beforeEach(() => {
+    vi.clearAllMocks()
+    vi.resetModules()
+    vi.mocked(checkUserPermission).mockResolvedValue(true)
+  })
+
+  describe('processPayPalRefund', () => {
+    it('should reject if user lacks refund permission', async () => {
+      vi.mocked(checkUserPermission).mockResolvedValue(false)
+
+      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
+      vi.mocked(createClient).mockResolvedValue(mockAuth as any)
+
+      const { processPayPalRefund } = await import('../refundActions')
+      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test reason')
+
+      expect(result).toEqual({ error: expect.stringContaining('permission') })
+    })
+
+    it('should reject if no PayPal capture ID on booking', async () => {
+      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
+      vi.mocked(createClient).mockResolvedValue(mockAuth as any)
+
+      const db = mockSupabaseChain({
+        id: 'booking-1',
+        deposit_amount: 100,
+        paypal_deposit_capture_id: null,
+        deposit_paid_date: '2026-04-01',
+        customer_name: 'Test',
+        contact_email: null,
+        contact_phone: null,
+      })
+      vi.mocked(createAdminClient).mockReturnValue(db as any)
+
+      const { processPayPalRefund } = await import('../refundActions')
+      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')
+
+      expect(result).toEqual({ error: expect.stringContaining('No PayPal payment') })
+    })
+
+    it('should reject if capture is older than 180 days', async () => {
+      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
+      vi.mocked(createClient).mockResolvedValue(mockAuth as any)
+
+      const oldDate = new Date()
+      oldDate.setDate(oldDate.getDate() - 181)
+
+      const db = mockSupabaseChain({
+        id: 'booking-1',
+        deposit_amount: 100,
+        paypal_deposit_capture_id: 'CAPTURE-1',
+        deposit_paid_date: oldDate.toISOString(),
+        customer_name: 'Test',
+        contact_email: null,
+        contact_phone: null,
+      })
+      vi.mocked(createAdminClient).mockReturnValue(db as any)
+
+      const { processPayPalRefund } = await import('../refundActions')
+      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')
+
+      expect(result).toEqual({ error: expect.stringContaining('180') })
+    })
+  })
+
+  describe('processManualRefund', () => {
+    it('should succeed without calling PayPal API', async () => {
+      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
+      vi.mocked(createClient).mockResolvedValue(mockAuth as any)
+
+      const db = mockSupabaseChain({ id: 'booking-1', deposit_amount: 100, deposit_paid_date: '2026-04-01', customer_name: 'Test', contact_email: null, contact_phone: null })
+      db.rpc.mockResolvedValue({ data: 100, error: null })
+      vi.mocked(createAdminClient).mockReturnValue(db as any)
+
+      const { processManualRefund } = await import('../refundActions')
+      const result = await processManualRefund('private_booking', 'booking-1', 50, 'cash return', 'cash')
+
+      expect(refundPayPalPayment).not.toHaveBeenCalled()
+      expect(sendRefundNotification).not.toHaveBeenCalled()
+    })
+  })
+})
diff --git a/src/app/actions/refundActions.ts b/src/app/actions/refundActions.ts
new file mode 100644
index 00000000..6f0437a9
--- /dev/null
+++ b/src/app/actions/refundActions.ts
@@ -0,0 +1,444 @@
+'use server'
+
+import { createClient } from '@/lib/supabase/server'
+import { createAdminClient } from '@/lib/supabase/admin'
+import { refundPayPalPayment } from '@/lib/paypal'
+import { sendRefundNotification } from '@/lib/refund-notifications'
+import { checkUserPermission } from '@/app/actions/rbac'
+import { logAuditEvent } from '@/app/actions/audit'
+import { revalidatePath } from 'next/cache'
+import { randomUUID } from 'crypto'
+
+type SourceType = 'private_booking' | 'table_booking' | 'parking'
+type RefundMethod = 'paypal' | 'cash' | 'bank_transfer' | 'other'
+
+const SOURCE_MODULE_MAP: Record<SourceType, string> = {
+  private_booking: 'private_bookings',
+  table_booking: 'table_bookings',
+  parking: 'parking',
+}
+
+const REVALIDATE_PATHS: Record<SourceType, string> = {
+  private_booking: '/private-bookings',
+  table_booking: '/table-bookings',
+  parking: '/parking',
+}
+
+const PAYPAL_REFUND_WINDOW_DAYS = 180
+
+interface SourceBookingData {
+  id: string
+  captureId: string | null
+  captureDate: string | null
+  originalAmount: number
+  customerName: string | null
+  customerEmail: string | null
+  customerPhone: string | null
+}
+
+async function getAuthenticatedUser(): Promise<{ userId: string } | { error: string }> {
+  const supabase = await createClient()
+  const { data: { user } } = await supabase.auth.getUser()
+  if (!user) return { error: 'Not authenticated' }
+  return { userId: user.id }
+}
+
+async function checkRefundPermission(sourceType: SourceType, userId: string): Promise<boolean> {
+  const permModule = SOURCE_MODULE_MAP[sourceType]
+  return checkUserPermission(permModule as any, 'refund', userId)
+}
+
+async function loadSourceBooking(
+  db: ReturnType<typeof createAdminClient>,
+  sourceType: SourceType,
+  sourceId: string
+): Promise<SourceBookingData | null> {
+  if (sourceType === 'private_booking') {
+    const { data } = await db
+      .from('private_bookings')
+      .select('id, paypal_deposit_capture_id, deposit_paid_date, deposit_amount, customer_name, contact_email, contact_phone')
+      .eq('id', sourceId)
+      .maybeSingle()
+    if (!data) return null
+    return {
+      id: data.id,
+      captureId: data.paypal_deposit_capture_id,
+      captureDate: data.deposit_paid_date,
+      originalAmount: Number(data.deposit_amount) || 0,
+      customerName: data.customer_name,
+      customerEmail: data.contact_email,
+      customerPhone: data.contact_phone,
+    }
+  }
+
+  if (sourceType === 'table_booking') {
+    const { data } = await db
+      .from('table_bookings')
+      .select('id, paypal_deposit_capture_id, card_capture_completed_at, deposit_amount, customer_id, customers(first_name, last_name, email, mobile_e164)')
+      .eq('id', sourceId)
+      .maybeSingle()
+    if (!data) return null
+    const customer = (data as any).customers
+    return {
+      id: data.id,
+      captureId: data.paypal_deposit_capture_id,
+      captureDate: data.card_capture_completed_at,
+      originalAmount: Number(data.deposit_amount) || 0,
+      customerName: customer ? `${customer.first_name} ${customer.last_name}`.trim() : null,
+      customerEmail: customer?.email ?? null,
+      customerPhone: customer?.mobile_e164 ?? null,
+    }
+  }
+
+  if (sourceType === 'parking') {
+    const { data } = await db
+      .from('parking_booking_payments')
+      .select('id, transaction_id, paid_at, amount, booking_id, parking_bookings(guest_name, email, phone)')
+      .eq('id', sourceId)
+      .maybeSingle()
+    if (!data) return null
+    const booking = (data as any).parking_bookings
+    return {
+      id: data.id,
+      captureId: data.transaction_id,
+      captureDate: data.paid_at,
+      originalAmount: Number(data.amount) || 0,
+      customerName: booking?.guest_name ?? null,
+      customerEmail: booking?.email ?? null,
+      customerPhone: booking?.phone ?? null,
+    }
+  }
+
+  return null
+}
+
+function isCaptureExpired(captureDate: string | null): boolean {
+  if (!captureDate) return false
+  const capture = new Date(captureDate)
+  const now = new Date()
+  const diffDays = (now.getTime() - capture.getTime()) / (1000 * 60 * 60 * 24)
+  return diffDays > PAYPAL_REFUND_WINDOW_DAYS
+}
+
+async function updateRefundStatus(
+  db: ReturnType<typeof createAdminClient>,
+  sourceType: SourceType,
+  sourceId: string,
+  originalAmount: number
+): Promise<void> {
+  // Sum all completed refunds
+  const { data: refunds } = await db
+    .from('payment_refunds')
+    .select('amount')
+    .eq('source_type', sourceType)
+    .eq('source_id', sourceId)
+    .eq('status', 'completed')
+
+  const totalRefunded = (refunds || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)
+  const status = totalRefunded >= originalAmount ? 'refunded' : 'partially_refunded'
+
+  if (sourceType === 'private_booking') {
+    await db.from('private_bookings').update({ deposit_refund_status: status }).eq('id', sourceId)
+  } else if (sourceType === 'table_booking') {
+    await db.from('table_bookings').update({ deposit_refund_status: status }).eq('id', sourceId)
+  } else if (sourceType === 'parking') {
+    await db.from('parking_booking_payments').update({ refund_status: status }).eq('id', sourceId)
+  }
+}
+
+export async function processPayPalRefund(
+  sourceType: SourceType,
+  sourceId: string,
+  amount: number,
+  reason: string
+): Promise<{ success?: boolean; refundId?: string; pending?: boolean; message?: string; error?: string }> {
+  // 1. Auth
+  const auth = await getAuthenticatedUser()
+  if ('error' in auth) return { error: auth.error }
+  const { userId } = auth
+
+  // 2. Permission
+  const hasPermission = await checkRefundPermission(sourceType, userId)
+  if (!hasPermission) return { error: 'Insufficient permission to process refunds' }
+
+  const db = createAdminClient()
+
+  // 3. Load booking
+  const booking = await loadSourceBooking(db, sourceType, sourceId)
+  if (!booking) return { error: 'Booking not found' }
+
+  // 4. Validate capture exists
+  if (!booking.captureId) return { error: 'No PayPal payment to refund. Use manual refund instead.' }
+
+  // 5. Validate capture date within 180-day window
+  if (isCaptureExpired(booking.captureDate)) {
+    return { error: 'PayPal refund window expired (180 days). Use manual refund instead.' }
+  }
+
+  // 6. Check remaining balance with advisory lock
+  const { data: remaining, error: rpcError } = await db.rpc('calculate_refundable_balance', {
+    p_source_type: sourceType,
+    p_source_id: sourceId,
+    p_original_amount: booking.originalAmount,
+  })
+
+  if (rpcError) return { error: `Balance check failed: ${rpcError.message}` }
+  if (amount > (remaining ?? 0)) return { error: `Amount exceeds refundable balance (£${(remaining ?? 0).toFixed(2)} remaining)` }
+
+  // 7. Insert pending refund row
+  const paypalRequestId = randomUUID()
+  const { data: refundRow, error: insertError } = await db
+    .from('payment_refunds')
+    .insert({
+      source_type: sourceType,
+      source_id: sourceId,
+      paypal_capture_id: booking.captureId,
+      paypal_request_id: paypalRequestId,
+      refund_method: 'paypal',
+      amount,
+      original_amount: booking.originalAmount,
+      reason,
+      status: 'pending',
+      initiated_by: userId,
+      initiated_by_type: 'staff',
+    })
+    .select('id')
+    .single()
+
+  if (insertError || !refundRow) return { error: `Failed to create refund record: ${insertError?.message}` }
+
+  // 8. Call PayPal
+  try {
+    const result = await refundPayPalPayment(booking.captureId, amount, paypalRequestId)
+
+    if (result.status === 'COMPLETED') {
+      // Update refund row
+      await db.from('payment_refunds').update({
+        status: 'completed',
+        paypal_refund_id: result.refundId,
+        paypal_status: 'COMPLETED',
+        completed_at: new Date().toISOString(),
+      }).eq('id', refundRow.id)
+
+      // Update booking refund status
+      await updateRefundStatus(db, sourceType, sourceId, booking.originalAmount)
+
+      // Send notification
+      let notificationStatus: string | null = null
+      if (booking.customerName) {
+        notificationStatus = await sendRefundNotification({
+          customerName: booking.customerName,
+          email: booking.customerEmail,
+          phone: booking.customerPhone,
+          amount,
+        })
+      } else {
+        notificationStatus = 'skipped'
+      }
+      await db.from('payment_refunds').update({ notification_status: notificationStatus }).eq('id', refundRow.id)
+
+      // Audit
+      await logAuditEvent({
+        user_id: userId,
+        operation_type: 'refund',
+        resource_type: sourceType,
+        resource_id: sourceId,
+        operation_status: 'success',
+        additional_info: {
+          refund_id: refundRow.id,
+          paypal_refund_id: result.refundId,
+          amount,
+          method: 'paypal',
+          notification_status: notificationStatus,
+        },
+      })
+
+      revalidatePath(REVALIDATE_PATHS[sourceType])
+      return { success: true, refundId: refundRow.id }
+    }
+
+    if (result.status === 'PENDING') {
+      await db.from('payment_refunds').update({
+        paypal_refund_id: result.refundId,
+        paypal_status: 'PENDING',
+        paypal_status_details: result.statusDetails || null,
+      }).eq('id', refundRow.id)
+
+      await logAuditEvent({
+        user_id: userId,
+        operation_type: 'refund',
+        resource_type: sourceType,
+        resource_id: sourceId,
+        operation_status: 'success',
+        additional_info: {
+          refund_id: refundRow.id,
+          paypal_refund_id: result.refundId,
+          amount,
+          method: 'paypal',
+          paypal_status: 'PENDING',
+          status_details: result.statusDetails,
+        },
+      })
+
+      revalidatePath(REVALIDATE_PATHS[sourceType])
+      return {
+        success: true,
+        refundId: refundRow.id,
+        pending: true,
+        message: 'Refund initiated but pending at PayPal — status will update automatically.',
+      }
+    }
+
+    // FAILED or CANCELLED
+    throw new Error(`PayPal returned status: ${result.status}`)
+  } catch (err) {
+    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
+
+    await db.from('payment_refunds').update({
+      status: 'failed',
+      failed_at: new Date().toISOString(),
+      failure_message: errorMessage,
+    }).eq('id', refundRow.id)
+
+    await logAuditEvent({
+      user_id: userId,
+      operation_type: 'refund',
+      resource_type: sourceType,
+      resource_id: sourceId,
+      operation_status: 'failure',
+      error_message: errorMessage,
+      additional_info: { refund_id: refundRow.id, amount, method: 'paypal' },
+    })
+
+    return { error: `PayPal refund failed: ${errorMessage}. You can try again or use manual refund.` }
+  }
+}
+
+export async function processManualRefund(
+  sourceType: SourceType,
+  sourceId: string,
+  amount: number,
+  reason: string,
+  refundMethod: 'cash' | 'bank_transfer' | 'other'
+): Promise<{ success?: boolean; refundId?: string; error?: string }> {
+  // 1. Auth
+  const auth = await getAuthenticatedUser()
+  if ('error' in auth) return { error: auth.error }
+  const { userId } = auth
+
+  // 2. Permission
+  const hasPermission = await checkRefundPermission(sourceType, userId)
+  if (!hasPermission) return { error: 'Insufficient permission to process refunds' }
+
+  const db = createAdminClient()
+
+  // 3. Load booking
+  const booking = await loadSourceBooking(db, sourceType, sourceId)
+  if (!booking) return { error: 'Booking not found' }
+
+  // 4. Check remaining balance with advisory lock
+  const { data: remaining, error: rpcError } = await db.rpc('calculate_refundable_balance', {
+    p_source_type: sourceType,
+    p_source_id: sourceId,
+    p_original_amount: booking.originalAmount,
+  })
+
+  if (rpcError) return { error: `Balance check failed: ${rpcError.message}` }
+  if (amount > (remaining ?? 0)) return { error: `Amount exceeds refundable balance (£${(remaining ?? 0).toFixed(2)} remaining)` }
+
+  // 5. Insert completed refund row
+  const { data: refundRow, error: insertError } = await db
+    .from('payment_refunds')
+    .insert({
+      source_type: sourceType,
+      source_id: sourceId,
+      refund_method: refundMethod,
+      amount,
+      original_amount: booking.originalAmount,
+      reason,
+      status: 'completed',
+      completed_at: new Date().toISOString(),
+      initiated_by: userId,
+      initiated_by_type: 'staff',
+    })
+    .select('id')
+    .single()
+
+  if (insertError || !refundRow) return { error: `Failed to create refund record: ${insertError?.message}` }
+
+  // 6. Update booking refund status
+  await updateRefundStatus(db, sourceType, sourceId, booking.originalAmount)
+
+  // 7. Audit
+  await logAuditEvent({
+    user_id: userId,
+    operation_type: 'refund',
+    resource_type: sourceType,
+    resource_id: sourceId,
+    operation_status: 'success',
+    additional_info: {
+      refund_id: refundRow.id,
+      amount,
+      method: refundMethod,
+    },
+  })
+
+  revalidatePath(REVALIDATE_PATHS[sourceType])
+  return { success: true, refundId: refundRow.id }
+}
+
+export async function getRefundHistory(
+  sourceType: SourceType,
+  sourceId: string
+): Promise<{ data?: any[]; error?: string }> {
+  // Auth check — view permission on the domain
+  const auth = await getAuthenticatedUser()
+  if ('error' in auth) return { error: auth.error }
+
+  const permModule = SOURCE_MODULE_MAP[sourceType]
+  const hasPermission = await checkUserPermission(permModule as any, 'view', auth.userId)
+  if (!hasPermission) return { error: 'Insufficient permission' }
+
+  const db = createAdminClient()
+  const { data, error } = await db
+    .from('payment_refunds')
+    .select('*')
+    .eq('source_type', sourceType)
+    .eq('source_id', sourceId)
+    .order('created_at', { ascending: false })
+
+  if (error) return { error: error.message }
+  return { data: data || [] }
+}
+
+export async function getParkingPaymentForRefund(
+  bookingId: string
+): Promise<{ data?: { paymentId: string; amount: number; hasCapture: boolean; captureDate: string | null }; error?: string }> {
+  const auth = await getAuthenticatedUser()
+  if ('error' in auth) return { error: auth.error }
+
+  const hasPermission = await checkUserPermission('parking' as any, 'view', auth.userId)
+  if (!hasPermission) return { error: 'Insufficient permission' }
+
+  const db = createAdminClient()
+  const { data: payment, error } = await db
+    .from('parking_booking_payments')
+    .select('id, amount, transaction_id, paid_at')
+    .eq('booking_id', bookingId)
+    .eq('status', 'paid')
+    .order('created_at', { ascending: false })
+    .limit(1)
+    .maybeSingle()
+
+  if (error) return { error: error.message }
+  if (!payment) return { error: 'No paid payment record found for this booking.' }
+
+  return {
+    data: {
+      paymentId: payment.id,
+      amount: Number(payment.amount) || 0,
+      hasCapture: !!payment.transaction_id,
+      captureDate: payment.paid_at,
+    },
+  }
+}
diff --git a/src/app/api/webhooks/paypal/parking/route.ts b/src/app/api/webhooks/paypal/parking/route.ts
index 9a706df9..5bf9c576 100644
--- a/src/app/api/webhooks/paypal/parking/route.ts
+++ b/src/app/api/webhooks/paypal/parking/route.ts
@@ -2,6 +2,7 @@ import { NextRequest, NextResponse } from 'next/server'
 import { verifyPayPalWebhook } from '@/lib/paypal'
 import { createAdminClient } from '@/lib/supabase/admin'
 import { logger } from '@/lib/logger'
+import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
 import {
   claimIdempotencyKey,
   computeIdempotencyRequestHash,
@@ -210,7 +211,9 @@ export async function POST(request: NextRequest) {
         await handlePaymentDenied(supabase, event)
         break
       case 'PAYMENT.CAPTURE.REFUNDED':
-        await handleRefundCompleted(supabase, event)
+      case 'PAYMENT.REFUND.PENDING':
+      case 'PAYMENT.REFUND.FAILED':
+        await handleRefundEvent(supabase, event, 'parking')
         break
       default:
         logger.info('Unhandled PayPal parking webhook event type', {
@@ -532,84 +535,3 @@ async function handlePaymentDenied(supabase: ReturnType<typeof createAdminClient
   }
 }
 
-async function handleRefundCompleted(supabase: ReturnType<typeof createAdminClient>, event: any) {
-  const resource = event.resource
-  const captureLink = resource.links?.find((link: any) => link.rel === 'up')?.href
-  const captureId = captureLink ? captureLink.split('/').pop() : null
-  const refundId = resource.id
-  const amount = parseFloat(resource.amount?.value ?? '0')
-
-  if (!captureId) {
-    throw new Error('Parking refund webhook missing capture ID')
-  }
-
-  const { data: payment, error: paymentLookupError } = await supabase
-    .from('parking_booking_payments')
-    .select('id, booking_id, metadata')
-    .eq('transaction_id', captureId)
-    .maybeSingle()
-
-  if (paymentLookupError) {
-    throw new Error(`Failed to load payment for refund webhook: ${paymentLookupError.message}`)
-  }
-
-  if (!payment) {
-    throw new Error(`Parking payment not found for capture: ${captureId}`)
-  }
-
-  const { data: paymentUpdateRow, error: paymentUpdateError } = await supabase
-    .from('parking_booking_payments')
-    .update({
-      status: 'refunded',
-      refunded_at: new Date().toISOString(),
-      metadata: {
-        ...(payment.metadata || {}),
-        refund_id: refundId,
-        refund_amount: amount
-      }
-    })
-    .eq('id', payment.id)
-    .select('id')
-    .maybeSingle()
-
-  if (paymentUpdateError) {
-    throw new Error(`Failed to mark parking payment refunded: ${paymentUpdateError.message}`)
-  }
-  if (!paymentUpdateRow) {
-    throw new Error(`Parking payment missing during refund webhook update: ${payment.id}`)
-  }
-
-  const { data: refundBookingUpdateRow, error: bookingUpdateError } = await supabase
-    .from('parking_bookings')
-    .update({
-      payment_status: 'refunded',
-      status: 'cancelled'
-    })
-    .eq('id', payment.booking_id)
-    .select('id')
-    .maybeSingle()
-
-  if (bookingUpdateError) {
-    throw new Error(`Failed to update parking booking refund state: ${bookingUpdateError.message}`)
-  }
-  if (!refundBookingUpdateRow) {
-    throw new Error(`Parking booking missing during refund webhook update: ${payment.booking_id}`)
-  }
-
-  const { error: auditError } = await supabase
-    .from('audit_logs')
-    .insert({
-      action: 'payment_webhook_refunded',
-      entity_type: 'parking_booking',
-      entity_id: payment.booking_id,
-      metadata: {
-        refund_id: refundId,
-        amount,
-        event_id: event.id
-      }
-    })
-
-  if (auditError) {
-    throw new Error(`Failed to write refunded parking payment audit log: ${auditError.message}`)
-  }
-}
diff --git a/src/app/api/webhooks/paypal/private-bookings/route.ts b/src/app/api/webhooks/paypal/private-bookings/route.ts
index 0d8e2575..5bb14b7f 100644
--- a/src/app/api/webhooks/paypal/private-bookings/route.ts
+++ b/src/app/api/webhooks/paypal/private-bookings/route.ts
@@ -2,6 +2,7 @@ import { NextRequest, NextResponse } from 'next/server'
 import { verifyPayPalWebhook } from '@/lib/paypal'
 import { createAdminClient } from '@/lib/supabase/admin'
 import { logger } from '@/lib/logger'
+import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
 import {
   claimIdempotencyKey,
   computeIdempotencyRequestHash,
@@ -14,6 +15,13 @@ const IDEMPOTENCY_TTL_HOURS = 24 * 30
 // Prefix used in customId for private booking deposit orders
 const DEPOSIT_CUSTOM_ID_PREFIX = 'pb-deposit-'
 
+// Refund event types that bypass the custom_id prefix check
+const REFUND_EVENT_TYPES = [
+  'PAYMENT.CAPTURE.REFUNDED',
+  'PAYMENT.REFUND.PENDING',
+  'PAYMENT.REFUND.FAILED',
+]
+
 function truncate(value: string | null | undefined, maxLength: number): string | null {
   if (!value) return null
   return value.length > maxLength ? value.slice(0, maxLength) : value
@@ -148,9 +156,11 @@ export async function POST(request: NextRequest) {
       return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
     }
 
-    // Check if this event is for a private booking deposit
+    // Check if this event is for a private booking deposit.
+    // Refund events don't carry custom_id on the refund resource, so bypass the prefix check.
+    const isRefundEvent = REFUND_EVENT_TYPES.includes(eventType)
     const customId = event?.resource?.custom_id ?? ''
-    if (typeof customId !== 'string' || !customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX)) {
+    if (!isRefundEvent && (typeof customId !== 'string' || !customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX))) {
       // Not a private booking event — acknowledge without processing
       await logPayPalWebhook(supabase, {
         status: 'ignored',
@@ -227,6 +237,11 @@ export async function POST(request: NextRequest) {
       case 'PAYMENT.CAPTURE.DENIED':
         await handleDepositCaptureDenied(supabase, event)
         break
+      case 'PAYMENT.CAPTURE.REFUNDED':
+      case 'PAYMENT.REFUND.PENDING':
+      case 'PAYMENT.REFUND.FAILED':
+        await handleRefundEvent(supabase, event, 'private_booking')
+        break
       default:
         logger.info('Unhandled PayPal private-bookings webhook event type', {
           metadata: { eventId, eventType }
diff --git a/src/app/api/webhooks/paypal/table-bookings/route.ts b/src/app/api/webhooks/paypal/table-bookings/route.ts
index 4b48eacf..8e5de474 100644
--- a/src/app/api/webhooks/paypal/table-bookings/route.ts
+++ b/src/app/api/webhooks/paypal/table-bookings/route.ts
@@ -2,6 +2,7 @@ import { NextRequest, NextResponse } from 'next/server'
 import { verifyPayPalWebhook } from '@/lib/paypal'
 import { createAdminClient } from '@/lib/supabase/admin'
 import { logger } from '@/lib/logger'
+import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
 import { logAuditEvent } from '@/app/actions/audit'
 import {
   claimIdempotencyKey,
@@ -220,8 +221,20 @@ export async function POST(request: NextRequest) {
       return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
     }
 
-    // Only handle PAYMENT.CAPTURE.COMPLETED — acknowledge and ignore all others
-    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
+    // Handle capture and refund events — acknowledge and ignore all others
+    const HANDLED_EVENT_TYPES = [
+      'PAYMENT.CAPTURE.COMPLETED',
+      'PAYMENT.CAPTURE.REFUNDED',
+      'PAYMENT.REFUND.PENDING',
+      'PAYMENT.REFUND.FAILED',
+    ]
+    const REFUND_EVENT_TYPES = [
+      'PAYMENT.CAPTURE.REFUNDED',
+      'PAYMENT.REFUND.PENDING',
+      'PAYMENT.REFUND.FAILED',
+    ]
+
+    if (!HANDLED_EVENT_TYPES.includes(eventType)) {
       await logWebhook(supabase, { status: 'ignored', headers, body, eventId, eventType })
       return NextResponse.json({ received: true, ignored: true })
     }
@@ -273,7 +286,11 @@ export async function POST(request: NextRequest) {
 
     await logWebhook(supabase, { status: 'received', headers, body, eventId, eventType })
 
-    await handleDepositCaptureCompleted(supabase, event)
+    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
+      await handleDepositCaptureCompleted(supabase, event)
+    } else if (REFUND_EVENT_TYPES.includes(eventType)) {
+      await handleRefundEvent(supabase, event, 'table_booking')
+    }
 
     try {
       await persistIdempotencyResponse(
diff --git a/src/components/ui-v2/refunds/RefundDialog.tsx b/src/components/ui-v2/refunds/RefundDialog.tsx
new file mode 100644
index 00000000..ef0a7146
--- /dev/null
+++ b/src/components/ui-v2/refunds/RefundDialog.tsx
@@ -0,0 +1,261 @@
+'use client'
+
+import { useState, useEffect } from 'react'
+import { useRouter } from 'next/navigation'
+import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
+import { Button } from '@/components/ui-v2/forms/Button'
+import { Input } from '@/components/ui-v2/forms/Input'
+import { Textarea } from '@/components/ui-v2/forms/Textarea'
+import { RadioGroup, type RadioOption } from '@/components/ui-v2/forms/Radio'
+import { Alert } from '@/components/ui-v2/feedback/Alert'
+import { toast } from '@/components/ui-v2/feedback/Toast'
+import { formatCurrency } from '@/components/ui-v2/utils/format'
+import { processPayPalRefund, processManualRefund } from '@/app/actions/refundActions'
+
+type SourceType = 'private_booking' | 'table_booking' | 'parking'
+
+export interface RefundDialogProps {
+  open: boolean
+  onOpenChange: (open: boolean) => void
+  sourceType: SourceType
+  sourceId: string
+  originalAmount: number
+  totalRefunded: number
+  totalPending: number
+  hasPayPalCapture: boolean
+  captureExpired: boolean
+}
+
+export function RefundDialog({
+  open,
+  onOpenChange,
+  sourceType,
+  sourceId,
+  originalAmount,
+  totalRefunded,
+  totalPending,
+  hasPayPalCapture,
+  captureExpired,
+}: RefundDialogProps) {
+  const router = useRouter()
+  const remaining = Math.max(0, originalAmount - totalRefunded - totalPending)
+
+  const [method, setMethod] = useState<string>(
+    hasPayPalCapture && !captureExpired ? 'paypal' : 'cash'
+  )
+  const [amount, setAmount] = useState(remaining.toFixed(2))
+  const [reason, setReason] = useState('')
+  const [loading, setLoading] = useState(false)
+  const [error, setError] = useState<string | null>(null)
+
+  // Reset form when dialog opens
+  useEffect(() => {
+    if (open) {
+      const newRemaining = Math.max(0, originalAmount - totalRefunded - totalPending)
+      setAmount(newRemaining.toFixed(2))
+      setReason('')
+      setError(null)
+      setMethod(hasPayPalCapture && !captureExpired ? 'paypal' : 'cash')
+    }
+  }, [open, originalAmount, totalRefunded, totalPending, hasPayPalCapture, captureExpired])
+
+  const methodOptions: RadioOption[] = [
+    {
+      value: 'paypal',
+      label: 'PayPal',
+      description: !hasPayPalCapture
+        ? 'No PayPal payment on record'
+        : captureExpired
+          ? 'Refund window expired (180 days)'
+          : 'Refund to original PayPal payment',
+      disabled: !hasPayPalCapture || captureExpired,
+    },
+    { value: 'cash', label: 'Cash', description: 'Cash refund given in person' },
+    { value: 'bank_transfer', label: 'Bank Transfer', description: 'Direct bank transfer' },
+    { value: 'other', label: 'Other', description: 'Other refund method' },
+  ]
+
+  const parsedAmount = parseFloat(amount)
+  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= remaining
+  const canSubmit = isValidAmount && reason.trim().length > 0 && !loading
+
+  const handleRefundInFull = () => {
+    setAmount(remaining.toFixed(2))
+  }
+
+  const handleSubmit = async () => {
+    if (!canSubmit) return
+
+    setLoading(true)
+    setError(null)
+
+    try {
+      let result: { success?: boolean; pending?: boolean; message?: string; error?: string }
+
+      if (method === 'paypal') {
+        result = await processPayPalRefund(sourceType, sourceId, parsedAmount, reason.trim())
+      } else {
+        result = await processManualRefund(
+          sourceType,
+          sourceId,
+          parsedAmount,
+          reason.trim(),
+          method as 'cash' | 'bank_transfer' | 'other'
+        )
+      }
+
+      if (result.error) {
+        setError(result.error)
+        return
+      }
+
+      if (result.pending) {
+        toast.info(result.message || 'Refund is pending at PayPal.')
+      } else {
+        toast.success(`Refund of ${formatCurrency(parsedAmount)} processed successfully.`)
+      }
+
+      onOpenChange(false)
+      router.refresh()
+    } catch (err) {
+      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
+    } finally {
+      setLoading(false)
+    }
+  }
+
+  return (
+    <Modal
+      open={open}
+      onClose={() => !loading && onOpenChange(false)}
+      title="Process Refund"
+      size="md"
+      footer={
+        <ModalActions>
+          <Button
+            variant="secondary"
+            onClick={() => onOpenChange(false)}
+            disabled={loading}
+          >
+            Cancel
+          </Button>
+          <Button
+            variant="danger"
+            onClick={handleSubmit}
+            loading={loading}
+            disabled={!canSubmit}
+          >
+            Process Refund
+          </Button>
+        </ModalActions>
+      }
+    >
+      <div className="space-y-5">
+        {/* Amount summary */}
+        <div className="rounded-lg bg-gray-50 p-4 space-y-2">
+          <div className="flex justify-between text-sm">
+            <span className="text-gray-600">Original amount</span>
+            <span className="font-medium text-gray-900">{formatCurrency(originalAmount)}</span>
+          </div>
+          {totalRefunded > 0 && (
+            <div className="flex justify-between text-sm">
+              <span className="text-gray-600">Already refunded</span>
+              <span className="font-medium text-green-700">-{formatCurrency(totalRefunded)}</span>
+            </div>
+          )}
+          {totalPending > 0 && (
+            <div className="flex justify-between text-sm">
+              <span className="text-gray-600">Pending refunds</span>
+              <span className="font-medium text-amber-700">-{formatCurrency(totalPending)}</span>
+            </div>
+          )}
+          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm">
+            <span className="font-medium text-gray-900">Refundable balance</span>
+            <span className="font-semibold text-gray-900">{formatCurrency(remaining)}</span>
+          </div>
+        </div>
+
+        {remaining <= 0 && (
+          <Alert variant="info">
+            This payment has been fully refunded. No further refunds can be processed.
+          </Alert>
+        )}
+
+        {remaining > 0 && (
+          <>
+            {/* Refund method */}
+            <div>
+              <label className="block text-sm font-medium text-gray-700 mb-2">
+                Refund method
+              </label>
+              <RadioGroup
+                name="refund-method"
+                options={methodOptions}
+                value={method}
+                onChange={(val) => setMethod(val)}
+                size="sm"
+              />
+            </div>
+
+            {/* Amount input */}
+            <div>
+              <div className="flex items-center justify-between mb-1">
+                <label htmlFor="refund-amount" className="block text-sm font-medium text-gray-700">
+                  Refund amount
+                </label>
+                {parsedAmount !== remaining && (
+                  <button
+                    type="button"
+                    onClick={handleRefundInFull}
+                    className="text-xs text-primary-600 hover:text-primary-700 font-medium"
+                  >
+                    Refund in full
+                  </button>
+                )}
+              </div>
+              <Input
+                id="refund-amount"
+                type="number"
+                value={amount}
+                onChange={(e) => setAmount(e.target.value)}
+                min="0.01"
+                max={remaining.toFixed(2)}
+                step="0.01"
+                leftElement={
+                  <span className="pl-3 text-gray-500 text-sm flex items-center h-full">£</span>
+                }
+                error={
+                  amount && !isValidAmount
+                    ? `Enter an amount between £0.01 and ${formatCurrency(remaining)}`
+                    : undefined
+                }
+              />
+            </div>
+
+            {/* Reason */}
+            <div>
+              <label htmlFor="refund-reason" className="block text-sm font-medium text-gray-700 mb-1">
+                Reason <span className="text-gray-400 font-normal">(internal only)</span>
+              </label>
+              <Textarea
+                id="refund-reason"
+                value={reason}
+                onChange={(e) => setReason(e.target.value)}
+                rows={3}
+                placeholder="Why is this refund being processed?"
+                error={reason.length === 0 ? undefined : undefined}
+              />
+            </div>
+
+            {/* Error banner */}
+            {error && (
+              <Alert variant="error">
+                {error}
+              </Alert>
+            )}
+          </>
+        )}
+      </div>
+    </Modal>
+  )
+}
diff --git a/src/components/ui-v2/refunds/RefundHistoryTable.tsx b/src/components/ui-v2/refunds/RefundHistoryTable.tsx
new file mode 100644
index 00000000..924a1858
--- /dev/null
+++ b/src/components/ui-v2/refunds/RefundHistoryTable.tsx
@@ -0,0 +1,168 @@
+'use client'
+
+import { useState, useEffect } from 'react'
+import { Badge } from '@/components/ui-v2/display/Badge'
+import { Spinner } from '@/components/ui-v2/feedback/Spinner'
+import { formatCurrency } from '@/components/ui-v2/utils/format'
+import { formatDateInLondon } from '@/lib/dateUtils'
+import { getRefundHistory } from '@/app/actions/refundActions'
+
+type SourceType = 'private_booking' | 'table_booking' | 'parking'
+
+export interface RefundHistoryTableProps {

[diff truncated at line 1500 — total was 2503 lines. Consider scoping the review to fewer files.]
```

## Changed File Contents

### `src/app/(authenticated)/parking/ParkingClient.tsx`

```
'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { formatDateTime } from '@/lib/dateUtils'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { RefundDialog } from '@/components/ui-v2/refunds/RefundDialog'
import { RefundHistoryTable } from '@/components/ui-v2/refunds/RefundHistoryTable'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Toggle } from '@/components/ui-v2/forms/Toggle'
import type {
  ParkingBooking,
  ParkingBookingStatus,
  ParkingNotificationRecord,
  ParkingPaymentStatus,
  ParkingPricingResult
} from '@/types/parking'
import { calculateParkingPricing } from '@/lib/parking/pricing'
import {
  createParkingBooking,
  generateParkingPaymentLink,
  markParkingBookingPaid,
  updateParkingBookingStatus,
  listParkingBookings,
  getParkingBookingNotifications,
  getParkingRateConfig
} from '@/app/actions/parking'
import type { ParkingRateConfig } from '@/lib/parking/pricing'

interface ParkingPermissions {
  canCreate: boolean
  canManage: boolean
  canRefund: boolean
}

interface Props {
  permissions: ParkingPermissions
  initialError?: string | null
}

const statusOptions: Array<{ value: 'all' | ParkingBookingStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending_payment', label: 'Pending Payment' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' }
]

const paymentStatusOptions: Array<{ value: 'all' | ParkingPaymentStatus; label: string }> = [
  { value: 'all', label: 'All payment states' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'failed', label: 'Failed' },
  { value: 'expired', label: 'Expired' }
]

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary'

const statusVariants: Record<ParkingBookingStatus, BadgeVariant> = {
  pending_payment: 'warning',
  confirmed: 'success',
  completed: 'info',
  cancelled: 'error',
  expired: 'default'
}

const paymentVariants: Record<ParkingPaymentStatus, BadgeVariant> = {
  pending: 'warning',
  paid: 'success',
  refunded: 'info',
  failed: 'error',
  expired: 'default'
}

const initialFormState = {
  customer_first_name: '',
  customer_last_name: '',
  customer_mobile: '',
  customer_email: '',
  vehicle_registration: '',
  vehicle_make: '',
  vehicle_model: '',
  vehicle_colour: '',
  start_at: '',
  end_at: '',
  notes: '',
  override_price: '',
  override_reason: '',
  capacity_override: false,
  capacity_override_reason: '',
  send_payment_link: true
}

export default function ParkingClient({ permissions, initialError }: Props) {
  const [bookings, setBookings] = useState<ParkingBooking[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [selectedBooking, setSelectedBooking] = useState<ParkingBooking | null>(null)
  const [notifications, setNotifications] = useState<ParkingNotificationRecord[]>([])
  const [loadingNotifications, setLoadingNotifications] = useState(false)
  const [activeRates, setActiveRates] = useState<ParkingRateConfig | null>(null)
  const [pricingPreview, setPricingPreview] = useState<ParkingPricingResult | null>(null)
  const [pricingError, setPricingError] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | ParkingBookingStatus>('all')
  const [paymentFilter, setPaymentFilter] = useState<'all' | ParkingPaymentStatus>('all')
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false)
  const [createForm, setCreateForm] = useState(initialFormState)
  const [isPending, startTransition] = useTransition()
  const [isMutating, startMutation] = useTransition()
  const pageError = initialError ?? null

  // Refund state
  const [showRefundDialog, setShowRefundDialog] = useState(false)
  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null)
  const [refundPaymentAmount, setRefundPaymentAmount] = useState(0)
  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 })
  const [refundHasCapture, setRefundHasCapture] = useState(false)

  const openRefundForBooking = async (booking: ParkingBooking) => {
    try {
      const { getParkingPaymentForRefund, getRefundHistory } = await import('@/app/actions/refundActions')
      const paymentResult = await getParkingPaymentForRefund(booking.id)

      if (paymentResult.error || !paymentResult.data) {
        toast.error(paymentResult.error || 'No paid payment record found.')
        return
      }

      setRefundPaymentId(paymentResult.data.paymentId)
      setRefundPaymentAmount(paymentResult.data.amount)
      setRefundHasCapture(paymentResult.data.hasCapture)

      // Load refund totals
      const result = await getRefundHistory('parking', paymentResult.data.paymentId)
      if (result.data) {
        const completed = result.data
          .filter((r: any) => r.status === 'completed')
          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
        const pending = result.data
          .filter((r: any) => r.status === 'pending')
          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
        setRefundTotals({ totalRefunded: completed, totalPending: pending })
      }

      setShowRefundDialog(true)
    } catch {
      toast.error('Failed to load payment details for refund.')
    }
  }

  useEffect(() => {
    void fetchBookings()
  }, [statusFilter, paymentFilter, search])

  useEffect(() => {
    if (!permissions.canManage) return

    const loadRates = async () => {
      const result = await getParkingRateConfig()
      if (!result || 'error' in result) {
        toast.error((result && 'error' in result ? result.error : undefined) || 'Unable to load parking rates')
        setActiveRates(null)
        return
      }
      setActiveRates(result.data)
    }

    void loadRates()
  }, [permissions.canManage])

  useEffect(() => {
    if (!activeRates || !createForm.start_at || !createForm.end_at) {
      setPricingPreview(null)
      setPricingError(null)
      return
    }

    try {
      const start = new Date(createForm.start_at)
      const end = new Date(createForm.end_at)
      const preview = calculateParkingPricing(start, end, activeRates)
      setPricingPreview(preview)
      setPricingError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to calculate pricing'
      setPricingPreview(null)
      setPricingError(message)

[truncated at line 200 — original has 1021 lines]
```

### `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`

```
"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateFull, formatTime12Hour, formatDateTime12Hour } from "@/lib/dateUtils";
import {
  PencilIcon,
  UserGroupIcon,
  CurrencyPoundIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  PhoneIcon,
  ClockIcon,
  CheckIcon,
  CheckCircleIcon,
  BanknotesIcon,
  CreditCardIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
  MapPinIcon,
  SparklesIcon,
  ClipboardDocumentListIcon,
  PercentBadgeIcon,
  ChatBubbleLeftRightIcon,
  DocumentIcon,
  CalendarDaysIcon,
  BuildingOfficeIcon,
  BoltIcon,
  Bars3Icon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import {
  DndContext,
  type DragEndEvent,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  getPrivateBooking,
  updateBookingStatus,
  recordDepositPayment,
  recordFinalPayment,
  addBookingItem,
  updateBookingItem,
  deleteBookingItem,
  reorderBookingItems,
  getVenueSpaces,
  getCateringPackages,
  getVendors,
  applyBookingDiscount,
  cancelPrivateBooking,
  addPrivateBookingNote,
  createDepositPaymentOrder,
  captureDepositPayment,
  resendCalendarInvite,
  getBookingPortalLink,
  sendDepositPaymentLink,
  editPrivateBookingPayment,
  getCancellationPreview,
  getCompletionPreview,
} from '@/app/actions/privateBookingActions'
import type {
  PrivateBookingWithDetails,
  BookingStatus,
  CateringPackage,
  VenueSpace,
  Vendor,
  PrivateBookingItem,
  PrivateBookingPayment,
  PaymentHistoryEntry,
} from "@/types/private-bookings";
import PaymentHistoryTable from './PaymentHistoryTable'
// New UI components
import { PageLayout } from "@/components/ui-v2/layout/PageLayout";
import { Card } from "@/components/ui-v2/layout/Card";
import { Section } from "@/components/ui-v2/layout/Section";
import { Button } from "@/components/ui-v2/forms/Button";
import { LinkButton } from "@/components/ui-v2/navigation/LinkButton";
import { Input } from "@/components/ui-v2/forms/Input";
import { Select } from "@/components/ui-v2/forms/Select";
import { Textarea } from "@/components/ui-v2/forms/Textarea";
import { Form } from "@/components/ui-v2/forms/Form";
import { FormGroup } from "@/components/ui-v2/forms/FormGroup";
import { Badge } from "@/components/ui-v2/display/Badge";
import { Modal } from "@/components/ui-v2/overlay/Modal";
import { ConfirmDialog } from "@/components/ui-v2/overlay/ConfirmDialog";
import { RefundDialog } from "@/components/ui-v2/refunds/RefundDialog";
import { RefundHistoryTable } from "@/components/ui-v2/refunds/RefundHistoryTable";
import { Skeleton } from "@/components/ui-v2/feedback/Skeleton";
import { EmptyState } from "@/components/ui-v2/display/EmptyState";
import { Alert } from "@/components/ui-v2/feedback/Alert";
import { toast } from "@/components/ui-v2/feedback/Toast";
import { formatCurrency } from "@/components/ui-v2/utils/format";
// Using types from private-bookings.ts

// Status configuration
const statusConfig: Record<
  BookingStatus,
  {
    label: string;
    variant: "success" | "info" | "warning" | "error" | "default";
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  draft: {
    label: "Draft",
    variant: "default",
    icon: PencilIcon,
  },
  confirmed: {
    label: "Confirmed",
    variant: "success",
    icon: CheckCircleIcon,
  },
  completed: {
    label: "Completed",
    variant: "info",
    icon: CheckCircleIcon,
  },
  cancelled: {
    label: "Cancelled",
    variant: "error",
    icon: XMarkIcon,
  },
};

const NOTE_MAX_LENGTH = 2000;

interface PrivateBookingDetailClientProps {
  bookingId: string;
  initialBooking: PrivateBookingWithDetails | null;
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canManageDeposits: boolean;
    canSendSms: boolean;
    canManageSpaces: boolean;
    canManageCatering: boolean;
    canManageVendors: boolean;
    canEditPayments: boolean;
    canRefund: boolean;
  };
  paymentHistory: PaymentHistoryEntry[];
  initialError?: string | null;
}

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  if (value === null || value === undefined) {
    return fallback
  }
  return fallback
};

const normalizeItem = (item: PrivateBookingItem): PrivateBookingItem => {
  const discountValue = item.discount_value === null || item.discount_value === undefined
    ? undefined
    : toNumber(item.discount_value);

  return {
    ...item,
    quantity: toNumber(item.quantity),
    unit_price: toNumber(item.unit_price),
    discount_value: discountValue,
    line_total: toNumber(item.line_total),
    display_order: item.display_order === null || item.display_order === undefined
      ? undefined
      : toNumber(item.display_order)
  };
};

const normalizeBooking = (booking: PrivateBookingWithDetails): PrivateBookingWithDetails => {
  const guestCount = booking.guest_count === null || booking.guest_count === undefined
    ? undefined
    : toNumber(booking.guest_count);

  const discountAmount = booking.discount_amount === null || booking.discount_amount === undefined
    ? undefined
    : toNumber(booking.discount_amount);


[truncated at line 200 — original has 2969 lines]
```

### `src/app/(authenticated)/private-bookings/[id]/page.tsx`

```
import { notFound, redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { getPrivateBooking } from '@/app/actions/privateBookingActions'
import { getBookingPaymentHistory } from '@/services/private-bookings'
import type { PaymentHistoryEntry } from '@/types/private-bookings'
import PrivateBookingDetailServer from '../PrivateBookingDetailServer'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

export default async function PrivateBookingDetailPage({ params }: PageProps) {
  const resolvedParams = await Promise.resolve(params)
  const bookingId = resolvedParams?.id

  if (!bookingId) {
    notFound()
  }

  const errors: string[] = []

  let canView = false
  let canEdit = false
  let canDelete = false
  let canManageDeposits = false
  let canSendSms = false
  let canManageSpaces = false
  let canManageCatering = false
  let canManageVendors = false
  let canEditPayments = false
  let canRefund = false

  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }

    console.error('Unable to verify private bookings permissions', permissionsResult.error)
    errors.push('We could not verify your access to private bookings; some actions may be limited.')
  } else {
    const actions = new Set(permissionsResult.actions)

    canView = actions.has('view') || actions.has('manage')
    canEdit = actions.has('edit') || actions.has('manage')
    canDelete = actions.has('delete')
    canManageDeposits = actions.has('manage_deposits') || actions.has('manage')
    canSendSms = actions.has('send') || actions.has('manage')
    canManageSpaces = actions.has('manage_spaces') || actions.has('manage')
    canManageCatering = actions.has('manage_catering') || actions.has('manage')
    canManageVendors = actions.has('manage_vendors') || actions.has('manage')
    canEditPayments = actions.has('manage')
    canRefund = actions.has('refund') || actions.has('manage')
  }

  if (!canView && errors.length === 0) {
    redirect('/unauthorized')
  }

  let bookingData = null

  const result = await getPrivateBooking(bookingId)

  if (!result || result.error) {
    const message = result?.error ?? 'Failed to load booking details.'

    if (message.toLowerCase().includes('permission')) {
      redirect('/unauthorized')
    }

    if (message === 'Booking not found') {
      notFound()
    }

    errors.push(message)
  } else {
    bookingData = result.data ?? null
  }

  let paymentHistory: PaymentHistoryEntry[] = []
  if (bookingData) {
    try {
      paymentHistory = await getBookingPaymentHistory(bookingData.id)
    } catch (_err) {
      // Non-fatal: page still renders, payment history will be empty
    }
  }

  if (!bookingData && errors.length === 0) {
    errors.push('We could not load this booking.')
  }

  const initialError = errors.length > 0 ? errors.join(' ') : null

  return (
    <PrivateBookingDetailServer
      bookingId={bookingId}
      booking={bookingData}
      permissions={{
        canEdit,
        canDelete,
        canManageDeposits,
        canSendSms,
        canManageSpaces,
        canManageCatering,
        canManageVendors,
        canEditPayments,
        canRefund,
      }}
      paymentHistory={paymentHistory}
      initialError={initialError}
    />
  )
}
```

### `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`

```
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { RefundDialog } from '@/components/ui-v2/refunds/RefundDialog'
import { RefundHistoryTable } from '@/components/ui-v2/refunds/RefundHistoryTable'
import PreorderTab from './PreorderTab'
// formatDateInLondon uses toLocaleDateString (date-only); use Intl.DateTimeFormat directly for time display
const formatLondonTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }).format(new Date(iso))

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    confirmed: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    seated: 'bg-blue-100 text-blue-800',
    completed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-800',
    no_show: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${colours[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

type Tab = 'overview' | 'preorder' | 'sms'

interface BookingCustomer {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
}

interface BookingTableInner {
  id: string
  name: string
  table_number: string | null
  capacity: number | null
}

interface BookingTable {
  table: BookingTableInner | null
}

export interface Booking {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string
  special_requirements: string | null
  dietary_requirements: string | null
  allergies: string | null
  celebration_type: string | null
  seated_at: string | null
  left_at: string | null
  no_show_at: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
  sunday_preorder_cutoff_at: string | null
  sunday_preorder_completed_at: string | null
  deposit_waived: boolean | null
  payment_status: string | null
  payment_method: string | null
  paypal_deposit_capture_id: string | null
  deposit_amount: number | null
  customer: BookingCustomer | null
  table_booking_tables: BookingTable[]
}

interface Props {
  booking: Booking
  canEdit: boolean
  canManage: boolean
  canRefund: boolean
}

type MoveTableOption = {
  id: string
  name: string
  table_number?: string | null
  capacity?: number | null
}

type MoveTableAvailabilityResponse = {
  success?: boolean
  error?: string
  data?: {
    booking_id: string
    tables: MoveTableOption[]
  }
}

export default function BookingDetailClient({ booking, canEdit, canManage, canRefund }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const isSundayLunch = booking.booking_type === 'sunday_lunch'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(isSundayLunch ? [{ id: 'preorder' as Tab, label: 'Pre-order' }] : []),
    { id: 'sms', label: 'SMS' },
  ]

  const router = useRouter()
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null)
  const [moveTableId, setMoveTableId] = useState<string>('')
  const [availableMoveTables, setAvailableMoveTables] = useState<
    { id: string; name: string; table_number: string | null; capacity: number | null }[]
  >([])
  const [loadingMoveTables, setLoadingMoveTables] = useState(false)
  const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [partySizeEditOpen, setPartySizeEditOpen] = useState(false)
  const [partySizeEditValue, setPartySizeEditValue] = useState('')
  const [partySizeEditSendSms, setPartySizeEditSendSms] = useState(true)
  const [smsBody, setSmsBody] = useState('')

  // Refund state
  const [showRefundDialog, setShowRefundDialog] = useState(false)
  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 })

  useEffect(() => {
    if (!booking.id || booking.payment_status !== 'completed') return
    let cancelled = false
    import('@/app/actions/refundActions').then(({ getRefundHistory }) =>
      getRefundHistory('table_booking', booking.id).then((result) => {
        if (cancelled || !result.data) return
        const completed = result.data
          .filter((r: any) => r.status === 'completed')
          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
        const pending = result.data
          .filter((r: any) => r.status === 'pending')
          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
        setRefundTotals({ totalRefunded: completed, totalPending: pending })
      })
    )
    return () => { cancelled = true }
  }, [booking.id, booking.payment_status])

  async function runAction(key: string, fn: () => Promise<void>, successMsg: string) {
    setActionLoadingKey(key)
    try {
      await fn()
      toast.success(successMsg)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setActionLoadingKey(null)
    }
  }

  async function handleStatusAction(
    action: 'seated' | 'left' | 'no_show' | 'cancelled' | 'confirmed' | 'completed'
  ) {
    await runAction(
      `status:${action}`,
      async () => {
        const response = await fetch(`/api/boh/table-bookings/${booking.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const payload = (await response.json()) as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Failed to update booking status')
      },
      'Booking updated'
    )
  }

  async function handleMoveTable() {
    if (!moveTableId) {
      toast.error('Select a table to move this booking')
      return
    }
    await runAction(
      'move-table',
      async () => {

[truncated at line 200 — original has 793 lines]
```

### `src/app/(authenticated)/table-bookings/[id]/page.tsx`

```
import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import BookingDetailClient, { type Booking } from './BookingDetailClient'

interface Props {
  params: Promise<{ id: string }>
}

export default async function BookingDetailPage({ params }: Props) {
  const { id } = await params

  const [canView, canEdit, canManage, canRefund] = await Promise.all([
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('table_bookings', 'manage'),
    checkUserPermission('table_bookings', 'refund'),
  ])

  if (!canView) redirect('/unauthorized')

  const supabase = await createClient()
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select(`
      id, booking_reference, booking_date, booking_time, party_size,
      booking_type, booking_purpose, status, special_requirements,
      dietary_requirements, allergies, celebration_type,
      seated_at, left_at, no_show_at, confirmed_at, cancelled_at,
      start_datetime, end_datetime, duration_minutes,
      sunday_preorder_cutoff_at, sunday_preorder_completed_at,
      deposit_waived,
      payment_status, payment_method, paypal_deposit_capture_id, deposit_amount,
      customer:customers!table_bookings_customer_id_fkey(
        id, first_name, last_name, mobile_number
      )
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Error loading booking:', error)
    }
    notFound()
  }
  if (!booking) notFound()

  // Supabase infers nested joins as arrays; normalise to scalar before passing to the client component
  const customer = Array.isArray(booking.customer) ? (booking.customer[0] ?? null) : booking.customer
  const normalizedBooking: Booking = {
    ...booking,
    customer: customer ?? null,
    table_booking_tables: [],
  } as unknown as Booking

  const guestName = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(' ')
  const title = guestName || booking.booking_reference || 'Booking'

  return (
    <PageLayout
      title={title}
      subtitle={`${booking.booking_reference ?? ''} · ${booking.booking_date} · ${booking.booking_time ?? ''}`}
      backButton={{ label: 'Back to BOH', href: '/table-bookings/boh' }}
    >
      <BookingDetailClient
        booking={normalizedBooking}
        canEdit={canEdit}
        canManage={canManage}
        canRefund={canRefund || canManage}
      />
    </PageLayout>
  )
}
```

### `src/app/actions/__tests__/refundActions.test.ts`

```
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before imports
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/paypal', () => ({
  refundPayPalPayment: vi.fn(),
}))
vi.mock('@/lib/refund-notifications', () => ({
  sendRefundNotification: vi.fn(),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { refundPayPalPayment } from '@/lib/paypal'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { checkUserPermission } from '@/app/actions/rbac'

function mockSupabaseChain(returnData: any = null, returnError: any = null) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
    single: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
    order: vi.fn().mockResolvedValue({ data: returnData ? [returnData] : [], error: returnError }),
    rpc: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  }
  return chain
}

describe('refundActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
  })

  describe('processPayPalRefund', () => {
    it('should reject if user lacks refund permission', async () => {
      vi.mocked(checkUserPermission).mockResolvedValue(false)

      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test reason')

      expect(result).toEqual({ error: expect.stringContaining('permission') })
    })

    it('should reject if no PayPal capture ID on booking', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const db = mockSupabaseChain({
        id: 'booking-1',
        deposit_amount: 100,
        paypal_deposit_capture_id: null,
        deposit_paid_date: '2026-04-01',
        customer_name: 'Test',
        contact_email: null,
        contact_phone: null,
      })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')

      expect(result).toEqual({ error: expect.stringContaining('No PayPal payment') })
    })

    it('should reject if capture is older than 180 days', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 181)

      const db = mockSupabaseChain({
        id: 'booking-1',
        deposit_amount: 100,
        paypal_deposit_capture_id: 'CAPTURE-1',
        deposit_paid_date: oldDate.toISOString(),
        customer_name: 'Test',
        contact_email: null,
        contact_phone: null,
      })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')

      expect(result).toEqual({ error: expect.stringContaining('180') })
    })
  })

  describe('processManualRefund', () => {
    it('should succeed without calling PayPal API', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const db = mockSupabaseChain({ id: 'booking-1', deposit_amount: 100, deposit_paid_date: '2026-04-01', customer_name: 'Test', contact_email: null, contact_phone: null })
      db.rpc.mockResolvedValue({ data: 100, error: null })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processManualRefund } = await import('../refundActions')
      const result = await processManualRefund('private_booking', 'booking-1', 50, 'cash return', 'cash')

      expect(refundPayPalPayment).not.toHaveBeenCalled()
      expect(sendRefundNotification).not.toHaveBeenCalled()
    })
  })
})
```

### `src/app/actions/refundActions.ts`

```
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refundPayPalPayment } from '@/lib/paypal'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'

type SourceType = 'private_booking' | 'table_booking' | 'parking'
type RefundMethod = 'paypal' | 'cash' | 'bank_transfer' | 'other'

const SOURCE_MODULE_MAP: Record<SourceType, string> = {
  private_booking: 'private_bookings',
  table_booking: 'table_bookings',
  parking: 'parking',
}

const REVALIDATE_PATHS: Record<SourceType, string> = {
  private_booking: '/private-bookings',
  table_booking: '/table-bookings',
  parking: '/parking',
}

const PAYPAL_REFUND_WINDOW_DAYS = 180

interface SourceBookingData {
  id: string
  captureId: string | null
  captureDate: string | null
  originalAmount: number
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
}

async function getAuthenticatedUser(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  return { userId: user.id }
}

async function checkRefundPermission(sourceType: SourceType, userId: string): Promise<boolean> {
  const permModule = SOURCE_MODULE_MAP[sourceType]
  return checkUserPermission(permModule as any, 'refund', userId)
}

async function loadSourceBooking(
  db: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  sourceId: string
): Promise<SourceBookingData | null> {
  if (sourceType === 'private_booking') {
    const { data } = await db
      .from('private_bookings')
      .select('id, paypal_deposit_capture_id, deposit_paid_date, deposit_amount, customer_name, contact_email, contact_phone')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    return {
      id: data.id,
      captureId: data.paypal_deposit_capture_id,
      captureDate: data.deposit_paid_date,
      originalAmount: Number(data.deposit_amount) || 0,
      customerName: data.customer_name,
      customerEmail: data.contact_email,
      customerPhone: data.contact_phone,
    }
  }

  if (sourceType === 'table_booking') {
    const { data } = await db
      .from('table_bookings')
      .select('id, paypal_deposit_capture_id, card_capture_completed_at, deposit_amount, customer_id, customers(first_name, last_name, email, mobile_e164)')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    const customer = (data as any).customers
    return {
      id: data.id,
      captureId: data.paypal_deposit_capture_id,
      captureDate: data.card_capture_completed_at,
      originalAmount: Number(data.deposit_amount) || 0,
      customerName: customer ? `${customer.first_name} ${customer.last_name}`.trim() : null,
      customerEmail: customer?.email ?? null,
      customerPhone: customer?.mobile_e164 ?? null,
    }
  }

  if (sourceType === 'parking') {
    const { data } = await db
      .from('parking_booking_payments')
      .select('id, transaction_id, paid_at, amount, booking_id, parking_bookings(guest_name, email, phone)')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    const booking = (data as any).parking_bookings
    return {
      id: data.id,
      captureId: data.transaction_id,
      captureDate: data.paid_at,
      originalAmount: Number(data.amount) || 0,
      customerName: booking?.guest_name ?? null,
      customerEmail: booking?.email ?? null,
      customerPhone: booking?.phone ?? null,
    }
  }

  return null
}

function isCaptureExpired(captureDate: string | null): boolean {
  if (!captureDate) return false
  const capture = new Date(captureDate)
  const now = new Date()
  const diffDays = (now.getTime() - capture.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays > PAYPAL_REFUND_WINDOW_DAYS
}

async function updateRefundStatus(
  db: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  sourceId: string,
  originalAmount: number
): Promise<void> {
  // Sum all completed refunds
  const { data: refunds } = await db
    .from('payment_refunds')
    .select('amount')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('status', 'completed')

  const totalRefunded = (refunds || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)
  const status = totalRefunded >= originalAmount ? 'refunded' : 'partially_refunded'

  if (sourceType === 'private_booking') {
    await db.from('private_bookings').update({ deposit_refund_status: status }).eq('id', sourceId)
  } else if (sourceType === 'table_booking') {
    await db.from('table_bookings').update({ deposit_refund_status: status }).eq('id', sourceId)
  } else if (sourceType === 'parking') {
    await db.from('parking_booking_payments').update({ refund_status: status }).eq('id', sourceId)
  }
}

export async function processPayPalRefund(
  sourceType: SourceType,
  sourceId: string,
  amount: number,
  reason: string
): Promise<{ success?: boolean; refundId?: string; pending?: boolean; message?: string; error?: string }> {
  // 1. Auth
  const auth = await getAuthenticatedUser()
  if ('error' in auth) return { error: auth.error }
  const { userId } = auth

  // 2. Permission
  const hasPermission = await checkRefundPermission(sourceType, userId)
  if (!hasPermission) return { error: 'Insufficient permission to process refunds' }

  const db = createAdminClient()

  // 3. Load booking
  const booking = await loadSourceBooking(db, sourceType, sourceId)
  if (!booking) return { error: 'Booking not found' }

  // 4. Validate capture exists
  if (!booking.captureId) return { error: 'No PayPal payment to refund. Use manual refund instead.' }

  // 5. Validate capture date within 180-day window
  if (isCaptureExpired(booking.captureDate)) {
    return { error: 'PayPal refund window expired (180 days). Use manual refund instead.' }
  }

  // 6. Check remaining balance with advisory lock
  const { data: remaining, error: rpcError } = await db.rpc('calculate_refundable_balance', {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_original_amount: booking.originalAmount,
  })

  if (rpcError) return { error: `Balance check failed: ${rpcError.message}` }
  if (amount > (remaining ?? 0)) return { error: `Amount exceeds refundable balance (£${(remaining ?? 0).toFixed(2)} remaining)` }

  // 7. Insert pending refund row
  const paypalRequestId = randomUUID()
  const { data: refundRow, error: insertError } = await db
    .from('payment_refunds')
    .insert({
      source_type: sourceType,
      source_id: sourceId,
      paypal_capture_id: booking.captureId,
      paypal_request_id: paypalRequestId,
      refund_method: 'paypal',
      amount,
      original_amount: booking.originalAmount,
      reason,

[truncated at line 200 — original has 444 lines]
```

### `src/app/api/webhooks/paypal/parking/route.ts`

```
import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

const IDEMPOTENCY_TTL_HOURS = 24 * 30

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id',
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-time'
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  sanitized['paypal-transmission-sig-present'] = headers['paypal-transmission-sig'] ? 'true' : 'false'
  return sanitized
}

async function logPayPalWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
    errorDetails?: unknown
  }
) {
  const { error } = await (supabase.from('webhook_logs') as any).insert({
    webhook_type: 'paypal',
    status: input.status,
    headers: sanitizeHeadersForLog(input.headers),
    body: truncate(input.body, 10000),
    params: {
      event_id: input.eventId ?? null,
      event_type: input.eventType ?? null
    },
    error_message: truncate(input.errorMessage, 500),
    error_details: input.errorDetails ?? null
  })

  if (error) {
    logger.error('Failed to store PayPal parking webhook log', {
      error: new Error(error instanceof Error ? error.message : String(error)),
      metadata: {
        status: input.status,
        eventId: input.eventId,
        eventType: input.eventType
      }
    })
  }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const webhookId = (process.env.PAYPAL_PARKING_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)?.trim()

  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false

  try {
    if (!webhookId) {
      const errorMessage = 'PAYPAL_WEBHOOK_ID not configured'
      logger.error(errorMessage)
      await logPayPalWebhook(supabase, {
        status: 'configuration_error',
        headers,
        body,
        errorMessage
      })

      return NextResponse.json(
        { received: false, error: errorMessage },
        { status: process.env.NODE_ENV === 'production' ? 500 : 200 }
      )
    }

    const isValid = await verifyPayPalWebhook(headers, body, webhookId)
    if (!isValid) {
      await logPayPalWebhook(supabase, {
        status: 'signature_failed',
        headers,
        body,
        errorMessage: 'Invalid PayPal signature'
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let event: any
    try {
      event = JSON.parse(body)
    } catch (parseError) {
      await logPayPalWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        errorMessage: 'Invalid JSON payload',
        errorDetails: parseError instanceof Error ? { message: parseError.message } : null
      })
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const eventId = typeof event?.id === 'string' ? event.id.trim() : ''
    const eventType = typeof event?.event_type === 'string' ? event.event_type : 'unknown'

    if (!eventId) {
      await logPayPalWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        eventType,
        errorMessage: 'Missing event id'
      })
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }

    idempotencyKey = `webhook:paypal:parking:${eventId}`
    requestHash = computeIdempotencyRequestHash(event)

    const claim = await claimIdempotencyKey(
      supabase,
      idempotencyKey,
      requestHash,
      IDEMPOTENCY_TTL_HOURS
    )

    if (claim.state === 'conflict') {
      await logPayPalWebhook(supabase, {
        status: 'idempotency_conflict',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: 'Event id reused with a different payload'
      })
      return NextResponse.json({ error: 'Conflict' }, { status: 409 })
    }

    if (claim.state === 'in_progress') {
      await logPayPalWebhook(supabase, {
        status: 'in_progress',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: 'Event is currently being processed'
      })
      return NextResponse.json(
        { error: 'Event is currently being processed' },
        { status: 409 }
      )
    }

    if (claim.state === 'replay') {
      await logPayPalWebhook(supabase, {
        status: 'duplicate',
        headers,
        body,
        eventId,
        eventType
      })
      return NextResponse.json({ received: true, duplicate: true })
    }

    claimHeld = true

    await logPayPalWebhook(supabase, {
      status: 'received',
      headers,

[truncated at line 200 — original has 537 lines]
```

### `src/app/api/webhooks/paypal/private-bookings/route.ts`

```
import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

const IDEMPOTENCY_TTL_HOURS = 24 * 30

// Prefix used in customId for private booking deposit orders
const DEPOSIT_CUSTOM_ID_PREFIX = 'pb-deposit-'

// Refund event types that bypass the custom_id prefix check
const REFUND_EVENT_TYPES = [
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.REFUND.PENDING',
  'PAYMENT.REFUND.FAILED',
]

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id',
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-time'
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  sanitized['paypal-transmission-sig-present'] = headers['paypal-transmission-sig'] ? 'true' : 'false'
  return sanitized
}

async function logPayPalWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
    errorDetails?: unknown
  }
) {
  const { error } = await (supabase.from('webhook_logs') as any).insert({
    webhook_type: 'paypal',
    status: input.status,
    headers: sanitizeHeadersForLog(input.headers),
    body: truncate(input.body, 10000),
    params: {
      event_id: input.eventId ?? null,
      event_type: input.eventType ?? null,
      source: 'private_bookings'
    },
    error_message: truncate(input.errorMessage, 500),
    error_details: input.errorDetails ?? null
  })

  if (error) {
    logger.error('Failed to store PayPal private-bookings webhook log', {
      error: new Error(error instanceof Error ? error.message : String(error)),
      metadata: {
        status: input.status,
        eventId: input.eventId,
        eventType: input.eventType
      }
    })
  }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const webhookId = (process.env.PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)?.trim()

  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false

  try {
    if (!webhookId) {
      const errorMessage = 'PAYPAL_WEBHOOK_ID not configured'
      logger.error(errorMessage)
      await logPayPalWebhook(supabase, {
        status: 'configuration_error',
        headers,
        body,
        errorMessage
      })

      return NextResponse.json(
        { received: false, error: errorMessage },
        { status: process.env.NODE_ENV === 'production' ? 500 : 200 }
      )
    }

    const isValid = await verifyPayPalWebhook(headers, body, webhookId)
    if (!isValid) {
      await logPayPalWebhook(supabase, {
        status: 'signature_failed',
        headers,
        body,
        errorMessage: 'Invalid PayPal signature'
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let event: any
    try {
      event = JSON.parse(body)
    } catch (parseError) {
      await logPayPalWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        errorMessage: 'Invalid JSON payload',
        errorDetails: parseError instanceof Error ? { message: parseError.message } : null
      })
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const eventId = typeof event?.id === 'string' ? event.id.trim() : ''
    const eventType = typeof event?.event_type === 'string' ? event.event_type : 'unknown'

    if (!eventId) {
      await logPayPalWebhook(supabase, {
        status: 'invalid_payload',
        headers,
        body,
        eventType,
        errorMessage: 'Missing event id'
      })
      return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
    }

    // Check if this event is for a private booking deposit.
    // Refund events don't carry custom_id on the refund resource, so bypass the prefix check.
    const isRefundEvent = REFUND_EVENT_TYPES.includes(eventType)
    const customId = event?.resource?.custom_id ?? ''
    if (!isRefundEvent && (typeof customId !== 'string' || !customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX))) {
      // Not a private booking event — acknowledge without processing
      await logPayPalWebhook(supabase, {
        status: 'ignored',
        headers,
        body,
        eventId,
        eventType
      })
      return NextResponse.json({ received: true, ignored: true })
    }

    idempotencyKey = `webhook:paypal:private-bookings:${eventId}`
    requestHash = computeIdempotencyRequestHash(event)

    const claim = await claimIdempotencyKey(
      supabase,
      idempotencyKey,
      requestHash,
      IDEMPOTENCY_TTL_HOURS
    )

    if (claim.state === 'conflict') {
      await logPayPalWebhook(supabase, {
        status: 'idempotency_conflict',
        headers,
        body,
        eventId,
        eventType,
        errorMessage: 'Event id reused with a different payload'
      })
      return NextResponse.json({ error: 'Conflict' }, { status: 409 })
    }

    if (claim.state === 'in_progress') {
      await logPayPalWebhook(supabase, {
        status: 'in_progress',
        headers,

[truncated at line 200 — original has 457 lines]
```

### `src/app/api/webhooks/paypal/table-bookings/route.ts`

```
import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { handleRefundEvent } from '@/lib/paypal-refund-webhook'
import { logAuditEvent } from '@/app/actions/audit'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'

const IDEMPOTENCY_TTL_HOURS = 24 * 30

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id',
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-time',
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  sanitized['paypal-transmission-sig-present'] = headers['paypal-transmission-sig'] ? 'true' : 'false'
  return sanitized
}

async function logWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
    errorDetails?: unknown
  },
) {
  const { error } = await (supabase.from('webhook_logs') as any).insert({
    webhook_type: 'paypal',
    status: input.status,
    headers: sanitizeHeadersForLog(input.headers),
    body: truncate(input.body, 10000),
    params: {
      event_id: input.eventId ?? null,
      event_type: input.eventType ?? null,
      source: 'table_bookings',
    },
    error_message: truncate(input.errorMessage, 500),
    error_details: input.errorDetails ?? null,
  })

  if (error) {
    logger.error('Failed to store PayPal table-bookings webhook log', {
      error: new Error(
        error instanceof Error ? error.message : String(error), // Supabase error shape is not fully typed
      ),
      metadata: {
        status: input.status,
        eventId: input.eventId,
        eventType: input.eventType,
      },
    })
  }
}

async function handleDepositCaptureCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  event: any, // PayPal webhook event payload is not typed in this project
) {
  const resource = event.resource
  const captureId: string = resource.id ?? ''
  // PayPal includes the originating order ID in supplementary_data
  const orderId: string =
    resource.supplementary_data?.related_ids?.order_id ?? ''

  if (!captureId) {
    throw new Error('Table-bookings capture webhook missing captureId (resource.id)')
  }

  if (!orderId) {
    throw new Error(
      'Table-bookings capture webhook missing orderId (resource.supplementary_data.related_ids.order_id)',
    )
  }

  const { data: booking, error: fetchError } = await supabase
    .from('table_bookings')
    .select('id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id')
    .eq('paypal_deposit_order_id', orderId)
    .maybeSingle()

  if (fetchError) {
    throw new Error(`Failed to look up table booking for deposit webhook: ${fetchError.message}`)
  }

  if (!booking) {
    logger.error('Table booking not found for PayPal deposit webhook', {
      metadata: { orderId, captureId, eventId: event.id },
    })
    // Return — acknowledge PayPal without error so it doesn't retry
    return
  }

  if (booking.paypal_deposit_capture_id) {
    // Already processed (e.g. browser capture succeeded before webhook arrived)
    logger.info('Table booking deposit already captured; ignoring webhook', {
      metadata: { bookingId: booking.id, captureId, orderId },
    })
    return
  }

  const { error: updateError } = await supabase
    .from('table_bookings')
    .update({
      payment_status: 'completed',
      status: 'confirmed',
      payment_method: 'paypal',
      paypal_deposit_capture_id: captureId,
    })
    .eq('id', booking.id)
    .is('paypal_deposit_capture_id', null) // Guard against race with browser-side capture

  if (updateError) {
    throw new Error(
      `Failed to update table booking for deposit webhook: ${updateError.message}`,
    )
  }

  await logAuditEvent({
    operation_type: 'payment.captured',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    additional_info: {
      capture_id: captureId,
      order_id: orderId,
      event_id: event.id,
      source: 'webhook',
      amount: resource.amount?.value ?? null,
    },
  })
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const webhookId = (process.env.PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)?.trim()

  let idempotencyKey: string | null = null
  let requestHash: string | null = null
  let claimHeld = false

  try {
    if (!webhookId) {
      const errorMessage = 'PAYPAL_WEBHOOK_ID not configured'
      logger.error(errorMessage)
      await logWebhook(supabase, { status: 'configuration_error', headers, body, errorMessage })
      return NextResponse.json(
        { received: false, error: errorMessage },
        { status: process.env.NODE_ENV === 'production' ? 500 : 200 },
      )
    }

    const isValid = await verifyPayPalWebhook(headers, body, webhookId)
    if (!isValid) {
      await logWebhook(supabase, {
        status: 'signature_failed',
        headers,
        body,
        errorMessage: 'Invalid PayPal signature',
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let event: any // PayPal webhook event payload is not typed in this project
    try {
      event = JSON.parse(body)
    } catch (parseError) {
      await logWebhook(supabase, {

[truncated at line 200 — original has 358 lines]
```

### `src/components/ui-v2/refunds/RefundDialog.tsx`

```
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { RadioGroup, type RadioOption } from '@/components/ui-v2/forms/Radio'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { processPayPalRefund, processManualRefund } from '@/app/actions/refundActions'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

export interface RefundDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceType: SourceType
  sourceId: string
  originalAmount: number
  totalRefunded: number
  totalPending: number
  hasPayPalCapture: boolean
  captureExpired: boolean
}

export function RefundDialog({
  open,
  onOpenChange,
  sourceType,
  sourceId,
  originalAmount,
  totalRefunded,
  totalPending,
  hasPayPalCapture,
  captureExpired,
}: RefundDialogProps) {
  const router = useRouter()
  const remaining = Math.max(0, originalAmount - totalRefunded - totalPending)

  const [method, setMethod] = useState<string>(
    hasPayPalCapture && !captureExpired ? 'paypal' : 'cash'
  )
  const [amount, setAmount] = useState(remaining.toFixed(2))
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      const newRemaining = Math.max(0, originalAmount - totalRefunded - totalPending)
      setAmount(newRemaining.toFixed(2))
      setReason('')
      setError(null)
      setMethod(hasPayPalCapture && !captureExpired ? 'paypal' : 'cash')
    }
  }, [open, originalAmount, totalRefunded, totalPending, hasPayPalCapture, captureExpired])

  const methodOptions: RadioOption[] = [
    {
      value: 'paypal',
      label: 'PayPal',
      description: !hasPayPalCapture
        ? 'No PayPal payment on record'
        : captureExpired
          ? 'Refund window expired (180 days)'
          : 'Refund to original PayPal payment',
      disabled: !hasPayPalCapture || captureExpired,
    },
    { value: 'cash', label: 'Cash', description: 'Cash refund given in person' },
    { value: 'bank_transfer', label: 'Bank Transfer', description: 'Direct bank transfer' },
    { value: 'other', label: 'Other', description: 'Other refund method' },
  ]

  const parsedAmount = parseFloat(amount)
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= remaining
  const canSubmit = isValidAmount && reason.trim().length > 0 && !loading

  const handleRefundInFull = () => {
    setAmount(remaining.toFixed(2))
  }

  const handleSubmit = async () => {
    if (!canSubmit) return

    setLoading(true)
    setError(null)

    try {
      let result: { success?: boolean; pending?: boolean; message?: string; error?: string }

      if (method === 'paypal') {
        result = await processPayPalRefund(sourceType, sourceId, parsedAmount, reason.trim())
      } else {
        result = await processManualRefund(
          sourceType,
          sourceId,
          parsedAmount,
          reason.trim(),
          method as 'cash' | 'bank_transfer' | 'other'
        )
      }

      if (result.error) {
        setError(result.error)
        return
      }

      if (result.pending) {
        toast.info(result.message || 'Refund is pending at PayPal.')
      } else {
        toast.success(`Refund of ${formatCurrency(parsedAmount)} processed successfully.`)
      }

      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !loading && onOpenChange(false)}
      title="Process Refund"
      size="md"
      footer={
        <ModalActions>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
          >
            Process Refund
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-5">
        {/* Amount summary */}
        <div className="rounded-lg bg-gray-50 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Original amount</span>
            <span className="font-medium text-gray-900">{formatCurrency(originalAmount)}</span>
          </div>
          {totalRefunded > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Already refunded</span>
              <span className="font-medium text-green-700">-{formatCurrency(totalRefunded)}</span>
            </div>
          )}
          {totalPending > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Pending refunds</span>
              <span className="font-medium text-amber-700">-{formatCurrency(totalPending)}</span>
            </div>
          )}
          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm">
            <span className="font-medium text-gray-900">Refundable balance</span>
            <span className="font-semibold text-gray-900">{formatCurrency(remaining)}</span>
          </div>
        </div>

        {remaining <= 0 && (
          <Alert variant="info">
            This payment has been fully refunded. No further refunds can be processed.
          </Alert>
        )}

        {remaining > 0 && (
          <>
            {/* Refund method */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Refund method
              </label>
              <RadioGroup
                name="refund-method"
                options={methodOptions}
                value={method}
                onChange={(val) => setMethod(val)}
                size="sm"
              />
            </div>

            {/* Amount input */}

[truncated at line 200 — original has 261 lines]
```

### `src/components/ui-v2/refunds/RefundHistoryTable.tsx`

```
'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { formatDateInLondon } from '@/lib/dateUtils'
import { getRefundHistory } from '@/app/actions/refundActions'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

export interface RefundHistoryTableProps {
  sourceType: SourceType
  sourceId: string
}

interface RefundRow {
  id: string
  amount: number
  refund_method: string
  status: 'completed' | 'pending' | 'failed'
  reason: string | null
  paypal_refund_id: string | null
  initiated_by_type: string | null
  created_at: string
  completed_at: string | null
  failure_message: string | null
}

const statusVariant: Record<string, 'success' | 'warning' | 'error'> = {
  completed: 'success',
  pending: 'warning',
  failed: 'error',
}

const methodLabel: Record<string, string> = {
  paypal: 'PayPal',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
}

export function RefundHistoryTable({ sourceType, sourceId }: RefundHistoryTableProps) {
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const result = await getRefundHistory(sourceType, sourceId)
      if (cancelled) return

      if (result.error) {
        setError(result.error)
      } else {
        setRefunds((result.data ?? []) as RefundRow[])
      }
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [sourceType, sourceId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" />
        <span className="ml-2 text-sm text-gray-500">Loading refund history...</span>
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-red-600 py-2">Failed to load refund history: {error}</p>
    )
  }

  if (refunds.length === 0) {
    return null
  }

  const completedTotal = refunds
    .filter((r) => r.status === 'completed')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  const pendingTotal = refunds
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + Number(r.amount), 0)

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900">Refund History</h4>
      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Date</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Amount</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Method</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Reason</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {refunds.map((refund) => (
              <tr
                key={refund.id}
                className={refund.status === 'failed' ? 'opacity-50' : undefined}
              >
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                  {formatDateInLondon(refund.created_at, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-sm font-medium text-gray-900">
                  {formatCurrency(Number(refund.amount))}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                  {methodLabel[refund.refund_method] ?? refund.refund_method}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Badge
                    variant={statusVariant[refund.status] ?? 'default'}
                    size="sm"
                  >
                    {refund.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-sm text-gray-500 max-w-[200px] truncate" title={refund.reason ?? undefined}>
                  {refund.reason || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-400">
                  {refund.initiated_by_type === 'system' ? 'System' : ''}
                  {refund.paypal_refund_id ? ` ${refund.paypal_refund_id}` : refund.id.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="flex gap-4 text-sm">
        {completedTotal > 0 && (
          <span className="text-green-700">
            Refunded: {formatCurrency(completedTotal)}
          </span>
        )}
        {pendingTotal > 0 && (
          <span className="text-amber-700">
            Pending: {formatCurrency(pendingTotal)}
          </span>
        )}
      </div>
    </div>
  )
}
```

### `src/lib/__tests__/paypal-refund.test.ts`

```
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock retry to pass through
vi.mock('../retry', () => ({
  retry: vi.fn((fn: () => Promise<any>) => fn()),
  RetryConfigs: { api: {} },
}))

describe('refundPayPalPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    // Set env vars for PayPal config
    process.env.PAYPAL_CLIENT_ID = 'test-client-id'
    process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
    process.env.PAYPAL_ENVIRONMENT = 'sandbox'
  })

  function mockFetchForRefund(refundResponse: object) {
    return vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        // Mock access token response
        new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        // Mock refund response
        new Response(JSON.stringify(refundResponse), { status: 201 })
      )
  }

  it('should send PayPal-Request-Id header for idempotency', async () => {
    const fetchSpy = mockFetchForRefund({
      id: 'REFUND-123',
      status: 'COMPLETED',
      amount: { value: '10.00', currency_code: 'GBP' },
    })

    const { refundPayPalPayment } = await import('../paypal')
    await refundPayPalPayment('CAPTURE-ABC', 10, 'test-request-id-uuid')

    const refundCall = fetchSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('/refund')
    )
    expect(refundCall).toBeDefined()
    const headers = (refundCall![1] as RequestInit).headers as Record<string, string>
    expect(headers['PayPal-Request-Id']).toBe('test-request-id-uuid')
  })

  it('should NOT include note_to_payer in request body', async () => {
    const fetchSpy = mockFetchForRefund({
      id: 'REFUND-123',
      status: 'COMPLETED',
      amount: { value: '10.00', currency_code: 'GBP' },
    })

    const { refundPayPalPayment } = await import('../paypal')
    await refundPayPalPayment('CAPTURE-ABC', 10, 'req-id')

    const refundCall = fetchSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('/refund')
    )
    expect(refundCall).toBeDefined()
    const body = JSON.parse(refundCall![1]!.body as string)
    expect(body.note_to_payer).toBeUndefined()
  })

  it('should return status and statusDetails from PayPal response', async () => {
    mockFetchForRefund({
      id: 'REFUND-456',
      status: 'PENDING',
      status_details: { reason: 'ECHECK' },
      amount: { value: '25.00', currency_code: 'GBP' },
    })

    const { refundPayPalPayment } = await import('../paypal')
    const result = await refundPayPalPayment('CAPTURE-DEF', 25, 'req-id-2')

    expect(result.refundId).toBe('REFUND-456')
    expect(result.status).toBe('PENDING')
    expect(result.statusDetails).toBe('ECHECK')
    expect(result.amount).toBe('25.00')
  })
})
```

### `src/lib/__tests__/refund-notifications.test.ts`

```
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

const mockSendEmail = vi.mocked(sendEmail)
const mockSendSMS = vi.mocked(sendSMS)

describe('sendRefundNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should send email when email is available', async () => {
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })

    const result = await sendRefundNotification({
      customerName: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+447700900000',
      amount: 25.5,
    })

    expect(result).toBe('email_sent')
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'jane@example.com',
      subject: 'Refund Confirmation \u2014 The Anchor',
      html: expect.stringContaining('\u00a325.50'),
    })
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('should fall back to SMS when email fails', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'Graph error' })
    mockSendSMS.mockResolvedValue({ success: true } as ReturnType<typeof sendSMS> extends Promise<infer R> ? R : never)

    const result = await sendRefundNotification({
      customerName: 'John Doe',
      email: 'john@example.com',
      phone: '+447700900001',
      amount: 10.0,
    })

    expect(result).toBe('sms_sent')
    expect(mockSendEmail).toHaveBeenCalled()
    expect(mockSendSMS).toHaveBeenCalledWith(
      '+447700900001',
      expect.stringContaining('\u00a310.00'),
      { skipSafetyGuards: true }
    )
  })

  it('should fall back to SMS when no email provided', async () => {
    mockSendSMS.mockResolvedValue({ success: true } as ReturnType<typeof sendSMS> extends Promise<infer R> ? R : never)

    const result = await sendRefundNotification({
      customerName: 'Alice',
      email: null,
      phone: '+447700900002',
      amount: 50.0,
    })

    expect(result).toBe('sms_sent')
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockSendSMS).toHaveBeenCalledWith(
      '+447700900002',
      expect.stringContaining('\u00a350.00'),
      { skipSafetyGuards: true }
    )
  })

  it('should return skipped when no contact info', async () => {
    const result = await sendRefundNotification({
      customerName: 'Bob',
      email: null,
      phone: null,
      amount: 15.0,
    })

    expect(result).toBe('skipped')
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('should return failed when both channels fail', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'Graph error' })
    mockSendSMS.mockResolvedValue({ success: false, error: 'Twilio error' } as ReturnType<typeof sendSMS> extends Promise<infer R> ? R : never)

    const result = await sendRefundNotification({
      customerName: 'Charlie',
      email: 'charlie@example.com',
      phone: '+447700900003',
      amount: 100.0,
    })

    expect(result).toBe('failed')
    expect(mockSendEmail).toHaveBeenCalled()
    expect(mockSendSMS).toHaveBeenCalled()
  })
})
```

### `src/lib/parking/payments.ts`

```
import { createSimplePayPalOrder, capturePayPalPayment, getPayPalOrder, refundPayPalPayment } from '@/lib/paypal'
import { insertParkingPayment, getPendingParkingPayment, updateParkingBooking, logParkingNotification } from './repository'
import { ParkingBooking, ParkingPaymentRecord } from '@/types/parking'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendEmail } from '@/lib/email/emailService'
import {
  buildPaymentConfirmationSms,
  buildPaymentConfirmationManagerEmail,
  buildPaymentRequestSms,
} from '@/lib/parking/notifications'
import { resolveParkingSmsEligibility } from '@/lib/parking/sms-safety'

interface CreatePaymentOptions {
  returnUrl: string
  cancelUrl: string
  description?: string
  currency?: string
  client?: SupabaseClient<any, 'public', any>
}

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const thrownCode = typeof (error as any)?.code === 'string' ? (error as any).code : null
  const thrownLogFailure = (error as any)?.logFailure === true || thrownCode === 'logging_failed'

  if (thrownLogFailure) {
    return {
      code: 'logging_failed',
      logFailure: true
    }
  }

  if (
    thrownCode === 'safety_unavailable'
    || thrownCode === 'idempotency_conflict'
  ) {
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

export async function createParkingPaymentOrder(
  booking: ParkingBooking,
  options: CreatePaymentOptions
): Promise<{ payment: ParkingPaymentRecord; orderId: string; approveUrl: string }> {
  const amount = booking.override_price ?? booking.calculated_price
  if (!amount || amount <= 0) {
    throw new Error('Parking booking amount must be greater than zero to create a payment')
  }

  if (!booking.payment_due_at) {
    throw new Error('Parking booking is missing payment_due_at')
  }

  const supabase = options.client ?? createAdminClient()

  const existingPending = await getPendingParkingPayment(booking.id, supabase)
  if (existingPending) {
    logger.info('Reusing existing pending parking payment', {
      metadata: { bookingId: booking.id, paymentId: existingPending.id }
    })
    return {
      payment: existingPending,
      orderId: existingPending.paypal_order_id || '',
      approveUrl: (existingPending.metadata as any)?.approve_url || ''
    }
  }

  const description =
    options.description ||
    `Parking booking ${booking.reference} from ${formatDateTime(new Date(booking.start_at))} to ${formatDateTime(
      new Date(booking.end_at)
    )}`

  const { orderId, approveUrl } = await createSimplePayPalOrder({
    customId: booking.id,
    reference: booking.reference,
    description,
    amount,
    returnUrl: options.returnUrl,
    cancelUrl: options.cancelUrl,
    currency: options.currency
  })

  if (!approveUrl) {
    throw new Error('PayPal did not return an approval URL')
  }

  const payment = await insertParkingPayment(
    {
      booking_id: booking.id,
      amount,
      currency: options.currency ?? 'GBP',
      status: 'pending',
      paypal_order_id: orderId,
      expires_at: booking.payment_due_at,
      metadata: {
        approve_url: approveUrl,
        amount,
        description
      }
    },
    supabase
  )

  return { payment, orderId, approveUrl }
}

export async function sendParkingPaymentRequest(
  booking: ParkingBooking,
  paymentLink: string,
  options: { client?: SupabaseClient<any, 'public', any> } = {}
): Promise<{ sent: boolean; skipped: boolean; code: string | null; logFailure: boolean }> {
  const supabase = options.client ?? createAdminClient()
  const replyNumber = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined

  let smsAllowed = true
  let smsSkipReason: string | null = null
  if (booking.customer_id) {
    const smsEligibility = await resolveParkingSmsEligibility(supabase, booking.customer_id)

    if (!smsEligibility.allowed) {
      smsAllowed = false
      smsSkipReason =
        smsEligibility.reason === 'customer_opted_out'
          ? 'Customer has opted out of SMS'
          : 'Customer SMS eligibility lookup failed'

      if (smsEligibility.reason === 'customer_lookup_failed') {
        logger.warn('Failed to load customer sms preference for payment request; blocking send', {
          metadata: {
            bookingId: booking.id,
            customerId: booking.customer_id,
            detail: smsEligibility.detail
          }
        })
      }
    }
  }

  if (!booking.customer_mobile) {
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: 'skipped',
      payload: {
        template_key: 'parking_payment_request',
        stage: 'week_before_expiry',
        reason: 'No customer mobile number on booking'
      }
    }, supabase)
    return { sent: false, skipped: true, code: null, logFailure: false }
  }

  if (!smsAllowed) {
    await logParkingNotification({
      booking_id: booking.id,
      channel: 'sms',
      event_type: 'payment_request',
      status: 'skipped',
      payload: {
        template_key: 'parking_payment_request',
        stage: 'week_before_expiry',
        reason: smsSkipReason || 'Customer not eligible for SMS'
      }
    }, supabase)
    return { sent: false, skipped: true, code: null, logFailure: false }
  }

  const smsBody = ensureReplyInstruction(buildPaymentRequestSms(booking, paymentLink), replyNumber)

  let smsResult: Awaited<ReturnType<typeof sendSMS>>
  try {
    smsResult = await sendSMS(booking.customer_mobile, smsBody, {
      customerId: booking.customer_id ?? undefined,
      metadata: {
        parking_booking_id: booking.id,
        event_type: 'payment_request',
        template_key: 'parking_payment_request'
      },
      customerFallback: {
        email: (booking as any)?.customer_email ?? null
      }
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    const normalizedSmsSafety = normalizeThrownSmsSafety(error)
    logger.error('Unexpected error sending parking payment request SMS', {
      error: err,

[truncated at line 200 — original has 591 lines]
```

### `src/lib/paypal-refund-webhook.ts`

```
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

/**
 * Column used to store the deposit refund status on the source booking/payment table.
 * - private_bookings & table_bookings use `deposit_refund_status`
 * - parking_booking_payments uses `refund_status`
 */
const REFUND_STATUS_COLUMN: Record<SourceType, string> = {
  private_booking: 'deposit_refund_status',
  table_booking: 'deposit_refund_status',
  parking: 'refund_status',
}

/**
 * Table where the source booking lives (or the payment row for parking).
 */
const SOURCE_TABLE: Record<SourceType, string> = {
  private_booking: 'private_bookings',
  table_booking: 'table_bookings',
  parking: 'parking_booking_payments',
}

/**
 * Column on the source table that stores the PayPal capture ID used for lookup.
 */
const CAPTURE_ID_COLUMN: Record<SourceType, string> = {
  private_booking: 'paypal_deposit_capture_id',
  table_booking: 'paypal_deposit_capture_id',
  parking: 'transaction_id',
}

/**
 * Shared refund webhook handler. Called from each PayPal webhook route for
 * PAYMENT.CAPTURE.REFUNDED, PAYMENT.REFUND.PENDING, and PAYMENT.REFUND.FAILED events.
 *
 * Handles two scenarios:
 * 1. Refund already exists in `payment_refunds` (initiated via our UI) — update its status.
 * 2. Refund not found (initiated via PayPal dashboard) — create a system-originated row.
 */
export async function handleRefundEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  sourceType: SourceType
): Promise<void> {
  const resource = event.resource
  const paypalRefundId: string = resource?.id ?? ''
  const paypalStatus: string = resource?.status ?? '' // COMPLETED, PENDING, FAILED, CANCELLED
  const statusDetails: string | null = resource?.status_details?.reason ?? null
  const amount: string | null = resource?.amount?.value ?? null

  // Extract capture ID from the HATEOAS "up" link
  const captureLink = resource?.links?.find((link: any) => link.rel === 'up')?.href
  const paypalCaptureId = captureLink ? captureLink.split('/').pop() ?? null : null

  if (!paypalRefundId) {
    throw new Error(`Refund webhook missing refund ID (resource.id) for ${sourceType}`)
  }

  logger.info('Processing refund webhook event', {
    metadata: {
      sourceType,
      paypalRefundId,
      paypalCaptureId,
      paypalStatus,
      eventId: event.id,
    },
  })

  // ----- Step 1: Try to match by paypal_refund_id -----
  const { data: existingRefund, error: lookupError } = await supabase
    .from('payment_refunds')
    .select('id, source_type, source_id, status, paypal_status, original_amount')
    .eq('paypal_refund_id', paypalRefundId)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up refund by paypal_refund_id: ${lookupError.message}`)
  }

  if (existingRefund) {
    // Already exists — update status if needed
    return await handleExistingRefund(supabase, existingRefund, paypalStatus, statusDetails, sourceType)
  }

  // ----- Step 2: Dashboard reconciliation — refund not in our system -----
  await handleDashboardRefund(supabase, event, sourceType, paypalRefundId, paypalCaptureId, paypalStatus, statusDetails, amount)
}

/**
 * Update an existing refund row that was initiated via our UI.
 */
async function handleExistingRefund(
  supabase: ReturnType<typeof createAdminClient>,
  existingRefund: {
    id: string
    source_type: string
    source_id: string
    status: string
    paypal_status: string | null
    original_amount: number
  },
  paypalStatus: string,
  statusDetails: string | null,
  sourceType: SourceType
): Promise<void> {
  // Already completed — no-op
  if (existingRefund.status === 'completed') {
    logger.info('Refund already completed, ignoring duplicate webhook', {
      metadata: { refundId: existingRefund.id, sourceType },
    })
    return
  }

  const normalizedStatus = paypalStatus.toUpperCase()

  if (normalizedStatus === 'COMPLETED') {
    const { error: updateError } = await supabase
      .from('payment_refunds')
      .update({
        status: 'completed',
        paypal_status: 'COMPLETED',
        paypal_status_details: statusDetails,
        completed_at: new Date().toISOString(),
      })
      .eq('id', existingRefund.id)

    if (updateError) {
      throw new Error(`Failed to update refund to completed: ${updateError.message}`)
    }

    await updateBookingRefundStatus(
      supabase,
      sourceType,
      existingRefund.source_id,
      existingRefund.original_amount
    )
  } else if (normalizedStatus === 'FAILED' || normalizedStatus === 'CANCELLED') {
    const { error: updateError } = await supabase
      .from('payment_refunds')
      .update({
        status: 'failed',
        paypal_status: normalizedStatus as 'FAILED' | 'CANCELLED',
        paypal_status_details: statusDetails,
        failed_at: new Date().toISOString(),
        failure_message: statusDetails ?? `PayPal status: ${normalizedStatus}`,
      })
      .eq('id', existingRefund.id)

    if (updateError) {
      throw new Error(`Failed to update refund to failed: ${updateError.message}`)
    }
  } else if (normalizedStatus === 'PENDING') {
    const { error: updateError } = await supabase
      .from('payment_refunds')
      .update({
        paypal_status: 'PENDING',
        paypal_status_details: statusDetails,
      })
      .eq('id', existingRefund.id)

    if (updateError) {
      throw new Error(`Failed to update refund paypal_status to PENDING: ${updateError.message}`)
    }
  }
}

/**
 * Handle a refund that was initiated via the PayPal dashboard (not in our system).
 * Creates a system-originated refund row and updates booking status.
 */
async function handleDashboardRefund(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  sourceType: SourceType,
  paypalRefundId: string,
  paypalCaptureId: string | null,
  paypalStatus: string,
  statusDetails: string | null,
  amount: string | null
): Promise<void> {
  if (!paypalCaptureId) {
    logger.error('Dashboard refund webhook missing capture ID — cannot reconcile', {
      metadata: { paypalRefundId, sourceType, eventId: event.id },
    })
    throw new Error(`Refund webhook missing capture ID for dashboard reconciliation (${sourceType})`)
  }

  // Look up the source booking by capture ID
  const table = SOURCE_TABLE[sourceType]
  const captureColumn = CAPTURE_ID_COLUMN[sourceType]

  const { data: sourceRow, error: sourceLookupError } = await (supabase
    .from(table) as any)
    .select('id')
    .eq(captureColumn, paypalCaptureId)
    .maybeSingle()


[truncated at line 200 — original has 359 lines]
```

### `src/lib/paypal.ts`

```
import { retry, RetryConfigs } from './retry';

type PayPalConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type PayPalLink = { rel: string; href: string };

let cachedToken: { token: string; expiresAt: number } | null = null;

function getPayPalConfig(): PayPalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const baseUrl = process.env.PAYPAL_ENVIRONMENT === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured. Please check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables.');
  }

  return { baseUrl, clientId, clientSecret };
}

function extractApproveUrl(links?: PayPalLink[]) {
  if (!links) return undefined;
  const candidate = links.find((link) => link.rel === 'payer-action') || links.find((link) => link.rel === 'approve');
  return candidate?.href;
}

function cacheAccessToken(token: string, expiresInSeconds?: number) {
  const safeExpires = typeof expiresInSeconds === 'number' && expiresInSeconds > 0
    ? Date.now() + expiresInSeconds * 1000
    : Date.now() + 5 * 60 * 1000; // fallback 5 minutes
  cachedToken = { token, expiresAt: safeExpires - 60_000 }; // refresh one minute early
}

async function getAccessToken(): Promise<string> {
  const { baseUrl, clientId, clientSecret } = getPayPalConfig();

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await retry(
    async () => fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    }),
    RetryConfigs.api
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('PayPal access token error:', errorText);
    throw new Error(`Failed to get PayPal access token: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  cacheAccessToken(data.access_token, data.expires_in);
  return data.access_token;
}

type CheckoutOrderOptions = {
  customId: string;
  reference: string;
  description: string;
  amount: number;
  currency?: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
  requestId?: string;
};

function buildCheckoutPayload(options: CheckoutOrderOptions) {
  const {
    customId,
    reference,
    description,
    amount,
    currency = 'GBP',
    returnUrl,
    cancelUrl,
    brandName = 'The Anchor Pub',
  } = options;

  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: reference,
        custom_id: customId,
        description,
        amount: {
          currency_code: currency,
          value: amount.toFixed(2),
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          brand_name: brandName,
          locale: 'en-GB',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  };
}

async function createCheckoutOrder(options: CheckoutOrderOptions) {
  const accessToken = await getAccessToken();
  const { baseUrl } = getPayPalConfig();
  const payload = buildCheckoutPayload(options);
  const requestId = options.requestId || `order-${options.customId}`;

  const response = await retry(
    async () => fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'PayPal-Request-Id': requestId,
      },
      body: JSON.stringify(payload),
    }),
    RetryConfigs.api
  );

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'Failed to create PayPal order';

    try {
      const errorJson = JSON.parse(errorText);
      console.error('PayPal order creation error:', errorJson);

      if (errorJson.details && errorJson.details.length > 0) {
        errorMessage = errorJson.details[0].description || errorJson.message || errorMessage;
      } else if (errorJson.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      console.error('PayPal order creation error (raw):', errorText);
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  const approveUrl = extractApproveUrl(data.links);

  if (!approveUrl) {
    throw new Error('PayPal did not return an approval URL');
  }

  return {
    orderId: data.id,
    approveUrl,
  };
}

export interface PayPalOrderOptions {
  customId: string;
  reference: string;
  description: string;
  amount: number;
  returnUrl: string;
  cancelUrl: string;
  currency?: string;
  brandName?: string;
  requestId?: string;
}

export async function createSimplePayPalOrder(options: PayPalOrderOptions) {
  return createCheckoutOrder({
    ...options,
    requestId: options.requestId || `parking-${options.customId}`,
  });
}

export interface InlinePayPalOrderOptions {
  customId: string;
  reference: string;
  description: string;
  amount: number;

[truncated at line 200 — original has 407 lines]
```

### `src/lib/refund-notifications.ts`

```
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'

export type NotificationStatus = 'email_sent' | 'sms_sent' | 'skipped' | 'failed'

interface RefundNotificationParams {
  customerName: string
  email: string | null
  phone: string | null
  amount: number
}

function formatAmount(amount: number): string {
  return `\u00a3${amount.toFixed(2)}`
}

function buildEmailHtml(customerName: string, amount: string): string {
  return `
    <p>Hi ${customerName},</p>
    <p>We've initiated a refund of ${amount} to your original payment method.</p>
    <p>Please allow up to 5 business days for this to appear in your account.</p>
    <p>If you have any questions, please don't hesitate to contact us.</p>
    <p>Kind regards,<br/>The Anchor Team</p>
  `.trim()
}

function buildSmsBody(customerName: string, amount: string): string {
  return `Hi ${customerName}, we've initiated a refund of ${amount} to your original payment method. Please allow up to 5 business days for this to appear. \u2014 The Anchor`
}

export async function sendRefundNotification(
  params: RefundNotificationParams
): Promise<NotificationStatus> {
  const amount = formatAmount(params.amount)

  // Try email first
  if (params.email) {
    const emailResult = await sendEmail({
      to: params.email,
      subject: 'Refund Confirmation \u2014 The Anchor',
      html: buildEmailHtml(params.customerName, amount),
    })
    if (emailResult.success) return 'email_sent'
  }

  // Fall back to SMS
  if (params.phone) {
    const smsResult = await sendSMS(
      params.phone,
      buildSmsBody(params.customerName, amount),
      { skipSafetyGuards: true }
    )
    if (smsResult.success) return 'sms_sent'
  }

  // No contact info or both failed
  if (!params.email && !params.phone) return 'skipped'
  return 'failed'
}
```

### `supabase/migrations/20260626000001_payment_refunds.sql`

```
-- Migration: payment_refunds table, indexes, RLS, RPC function, new columns, and RBAC permissions
-- Part of PayPal refunds feature (2026-04-26-paypal-refunds plan, Task 1)

--------------------------------------------------------------------------------
-- 1. payment_refunds table
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('private_booking', 'table_booking', 'parking')),
  source_id UUID NOT NULL,
  paypal_capture_id TEXT,
  paypal_refund_id TEXT,
  paypal_request_id UUID,
  paypal_status TEXT CHECK (paypal_status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  paypal_status_details TEXT,
  refund_method TEXT NOT NULL CHECK (refund_method IN ('paypal', 'cash', 'bank_transfer', 'other')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  original_amount NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  initiated_by UUID REFERENCES auth.users(id),
  initiated_by_type TEXT NOT NULL DEFAULT 'staff' CHECK (initiated_by_type IN ('staff', 'system')),
  notification_status TEXT CHECK (notification_status IN ('email_sent', 'sms_sent', 'skipped', 'failed')),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

--------------------------------------------------------------------------------
-- 2. Indexes
--------------------------------------------------------------------------------
CREATE INDEX idx_payment_refunds_source
  ON public.payment_refunds (source_type, source_id);

CREATE UNIQUE INDEX idx_payment_refunds_paypal_refund_id
  ON public.payment_refunds (paypal_refund_id)
  WHERE paypal_refund_id IS NOT NULL;

CREATE INDEX idx_payment_refunds_paypal_capture_id
  ON public.payment_refunds (paypal_capture_id)
  WHERE paypal_capture_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 3. Row Level Security — service role only (all access via server actions)
--------------------------------------------------------------------------------
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on payment_refunds"
  ON public.payment_refunds
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

--------------------------------------------------------------------------------
-- 4. RPC: calculate_refundable_balance (advisory-lock protected)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_refundable_balance(
  p_source_type TEXT,
  p_source_id UUID,
  p_original_amount NUMERIC(10,2)
) RETURNS NUMERIC(10,2) AS $$
DECLARE
  v_total_reserved NUMERIC(10,2);
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_source_type || ':' || p_source_id::text)
  );

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_reserved
  FROM public.payment_refunds
  WHERE source_type = p_source_type
    AND source_id = p_source_id
    AND status IN ('completed', 'pending');

  RETURN p_original_amount - v_total_reserved;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

--------------------------------------------------------------------------------
-- 5. Add deposit_refund_status columns to existing tables
--------------------------------------------------------------------------------
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS deposit_refund_status TEXT
  CHECK (deposit_refund_status IN ('partially_refunded', 'refunded'));

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS deposit_refund_status TEXT
  CHECK (deposit_refund_status IN ('partially_refunded', 'refunded'));

ALTER TABLE public.parking_booking_payments
  ADD COLUMN IF NOT EXISTS refund_status TEXT
  CHECK (refund_status IN ('partially_refunded', 'refunded'));

--------------------------------------------------------------------------------
-- 6. RBAC: seed 'refund' action on existing domain modules for super_admin
--    Uses the existing module names (private_bookings, table_bookings, parking)
--    with the existing 'refund' ActionType
--    Schema: permissions(id, module_name, action, description) unique on (module_name, action)
--            role_permissions(role_id, permission_id)
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_super_admin_role_id UUID;
  v_perm_id UUID;
  v_module TEXT;
BEGIN
  -- Insert refund permission for each domain module (idempotent)
  FOREACH v_module IN ARRAY ARRAY['private_bookings', 'table_bookings', 'parking']
  LOOP
    INSERT INTO public.permissions (module_name, action, description)
    VALUES (v_module, 'refund', 'Process refunds (PayPal, cash, bank transfer)')
    ON CONFLICT (module_name, action) DO NOTHING;
  END LOOP;

  -- Get super_admin role ID
  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin';

  -- Grant refund permissions to super_admin only
  IF v_super_admin_role_id IS NOT NULL THEN
    FOR v_perm_id IN
      SELECT p.id FROM public.permissions p
      WHERE p.module_name IN ('private_bookings', 'table_bookings', 'parking')
        AND p.action = 'refund'
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_super_admin_role_id, v_perm_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RAISE NOTICE 'refund permissions created for private_bookings, table_bookings, parking and assigned to super_admin';
END $$;
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
.github/workflows/cron-jobs.yml
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
