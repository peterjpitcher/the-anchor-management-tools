import { notFound, redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { getPrivateBooking } from '@/app/actions/privateBookingActions'
import { getBookingDepositRefunds, getBookingPaymentHistory } from '@/services/private-bookings'
import { currentUserCanInvoicePrivateBookings } from '@/app/actions/privateBookingInvoice'
import { hasPrivateBookingPermission } from '@/lib/private-bookings/permissions'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { isDepositAwaitingConfirmation, resolveConfirmationHoldExpiry } from '@/lib/private-bookings/deposit-confirmation'
import type { DepositRefundEntry, PaymentHistoryEntry } from '@/types/private-bookings'
import {
  buildHireReadinessView,
  loadOneHireReadiness,
  type HireReadinessView,
} from '@/services/private-bookings/readiness'
import { loadHireNightView, type HireNightView } from '@/services/private-bookings/night-clashes'
import { loadKitchenLoadFor } from '@/services/kitchen-load'
import type { KitchenLoadSummary } from '@/components/kitchen/KitchenLoadEditor'
import PrivateBookingDetailServer from '../PrivateBookingDetailServer'

export const dynamic = 'force-dynamic'
// Sending a document for signature renders its PDF in a headless browser, in a server action
// that runs on this page's function. The default time limit is too tight for a cold start.
export const maxDuration = 60

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

  let canViewPricing = false
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
  let canOverrideCapacity = false

  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }

    console.error('Unable to verify private bookings permissions', permissionsResult.error)
    errors.push('We could not verify your access to private bookings; some actions may be limited.')
  } else {
    const actions = new Set(permissionsResult.actions)

    canView = hasPrivateBookingPermission(actions, 'view')
    canViewPricing = actions.has('view_pricing') || actions.has('manage')
    canEdit = hasPrivateBookingPermission(actions, 'edit')
    canDelete = hasPrivateBookingPermission(actions, 'delete')
    canManageDeposits = actions.has('manage_deposits') || actions.has('manage')
    canSendSms = hasPrivateBookingPermission(actions, 'send')
    canManageSpaces = actions.has('manage_spaces') || actions.has('manage')
    canManageCatering = actions.has('manage_catering') || actions.has('manage')
    canManageVendors = actions.has('manage_vendors') || actions.has('manage')
    canEditPayments = actions.has('manage')
    canRefund = actions.has('refund') || actions.has('manage')
    // D24: a manager can allow more guests than the rooms hold (the action checks again).
    canOverrideCapacity = actions.has('gm_override')
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
  let depositRefunds: DepositRefundEntry[] = []
  if (bookingData) {
    try {
      // Refunds load with the payments: a list missing a refund would show the deposit as still held.
      ;[paymentHistory, depositRefunds] = await Promise.all([
        getBookingPaymentHistory(bookingData.id),
        getBookingDepositRefunds(bookingData.id),
      ])
    } catch (error) {
      console.error('Failed to load booking payment history', error)
      errors.push('Payment history could not be loaded. Refresh before recording a payment.')
      bookingData = null
    }
  }

  if (!bookingData && errors.length === 0) {
    errors.push('We could not load this booking.')
  }

  // Deposit confirmation (flag private_booking_deposit_confirmation): a deposit the guest has not
  // been told about shows on the page with the Confirm deposit action, and the deadline confirming
  // would set.
  let depositConfirmation: { awaiting: boolean; holdExpiryPreview: string | null } = {
    awaiting: false,
    holdExpiryPreview: null,
  }
  if (bookingData && (await isMessagingFlagOn('private_booking_deposit_confirmation')) && isDepositAwaitingConfirmation(bookingData)) {
    let holdExpiryPreview: string | null = null
    try {
      holdExpiryPreview = resolveConfirmationHoldExpiry(bookingData, new Date())
    } catch (_err) {
      // An unreadable event date: the dialog simply leaves the deadline out.
    }
    depositConfirmation = { awaiting: true, holdExpiryPreview }
  }

  // Rooms, guest count and a paid deposit that did not confirm the booking (review BK-005 and
  // BK-007). If this cannot be read the page says so, rather than looking as if all is well.
  let hireReadiness: HireReadinessView | null = null
  let hireReadinessError = false
  if (bookingData) {
    try {
      const { facts, rooms } = await loadOneHireReadiness(bookingData.id)
      hireReadiness = buildHireReadinessView(facts, rooms)
    } catch (error) {
      console.error('Failed to load private hire readiness', error)
      hireReadinessError = true
    }
  }

  // Diners, event seats and events in this hire's rooms that night (BK-070, BK-071, D24). If this
  // cannot be read the page says so, rather than looking as if the night is clear.
  let hireNight: HireNightView | null = null
  let hireNightError = false
  if (bookingData) {
    try {
      hireNight = await loadHireNightView(bookingData.id)
    } catch (error) {
      console.error('Failed to load the private hire night', error)
      hireNightError = true
    }
  }

  // The covers the kitchen counts for this hire against online food bookings (D29, BK-072).
  let kitchen: KitchenLoadSummary | null = null
  let kitchenError = false
  if (bookingData && (bookingData.status === 'draft' || bookingData.status === 'confirmed') && bookingData.event_date && !bookingData.date_tbd) {
    try {
      const load = await loadKitchenLoadFor('private_booking', bookingData.id, bookingData.event_date)
      kitchen = {
        load: load ? { covers: load.covers, foodTime: load.foodTime } : null,
        covers: bookingData.kitchen_covers ?? null,
        foodTime: bookingData.kitchen_food_time ? String(bookingData.kitchen_food_time).slice(0, 5) : null,
      }
    } catch (error) {
      console.error('Failed to load the kitchen covers for a private hire', error)
      kitchenError = true
    }
  }

  // Invoicing is super_admin only. The server action re-checks this on every
  // call; asking here just avoids showing a manager a button that will refuse.
  let canInvoice = false
  try {
    canInvoice = await currentUserCanInvoicePrivateBookings()
  } catch (_err) {
    // Non-fatal: the button simply stays hidden.
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
        canInvoice,
        canViewPricing,
      }}
      paymentHistory={paymentHistory}
      depositRefunds={depositRefunds}
      depositConfirmation={depositConfirmation}
      hireReadiness={hireReadiness}
      hireReadinessError={hireReadinessError}
      hireNight={hireNight}
      hireNightError={hireNightError}
      kitchen={kitchen}
      kitchenError={kitchenError}
      canOverrideCapacity={canOverrideCapacity}
      initialError={initialError}
    />
  )
}
