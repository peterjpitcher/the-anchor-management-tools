import { notFound, redirect } from 'next/navigation'
import { Alert, LinkButton, PageLayout } from '@/ds'
import { getPermissionStatus, getUserPermissions } from '@/app/actions/rbac'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'
import { createAdminClient } from '@/lib/supabase/admin'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { canDownloadBookingSheet, type BookingSheetModel } from '@/lib/table-bookings/booking-sheet'
import { loadBookingSheetModel } from '@/lib/table-bookings/booking-sheet-load'
import { renderBookingOnePager } from '@/lib/table-booking-one-pager-template'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Props {
  params: Promise<{ id: string }>
}

/**
 * The booking's one-pager for the kitchen and the floor (owner decision D14, spec section 3.5).
 *
 * Front of house and back of house can both view it; the shared FOH login is the reason this page,
 * unlike the booking detail page, does not send FOH-only users away. Only people the PDF route
 * serves (`requireBohTableBookingPermission`) see Download PDF, and for everyone else the print
 * stylesheet hides the sheet, so front of house gets no paper copy. The route refuses them too:
 * hiding the button is never the only check.
 */
export default async function BookingSheetPage({ params }: Props) {
  const { id } = await params

  const [viewStatus, permissionsResult] = await Promise.all([
    getPermissionStatus('table_bookings', 'view'),
    getUserPermissions(),
  ])

  // A failed lookup is a connection problem, not a refusal (BK-095).
  if (viewStatus === 'unavailable') return <PermissionsUnavailable />
  if (viewStatus !== 'allowed') redirect('/unauthorized')

  const permissions = permissionsResult.success && permissionsResult.data ? permissionsResult.data : []
  // Fail closed: if the permission list did not load, nobody is offered the download.
  const canDownload = permissionsResult.success === true && canDownloadBookingSheet(permissions)
  const fohOnly = isFohOnlyUser(permissions)
  const backButton = fohOnly
    ? { label: 'Back to Front of House', href: '/table-bookings/foh' }
    : { label: 'Back to the booking', href: `/table-bookings/${id}` }

  if (!UUID_REGEX.test(id)) notFound()

  let model: BookingSheetModel | null
  try {
    // Permission was proven above. The pre-order and refund tables are service-role only.
    model = await loadBookingSheetModel(createAdminClient(), id)
  } catch (error) {
    console.error('Booking sheet could not be loaded:', error instanceof Error ? error.message : error)
    return (
      <PageLayout title="Booking sheet" backButton={backButton}>
        <Alert tone="danger" title="The sheet could not be loaded">
          Nothing is shown rather than a sheet with seats missing. Reload the page, and if it still fails
          check the booking before service.
        </Alert>
      </PageLayout>
    )
  }
  if (!model) notFound()

  const headerActions = canDownload ? (
    <LinkButton href={`/api/boh/table-bookings/booking-sheets/${id}`} download variant="secondary" size="sm">
      Download PDF
    </LinkButton>
  ) : undefined

  return (
    <PageLayout
      title="Booking sheet"
      subtitle={`${model.header.reference} · ${model.header.dayDate} · ${model.header.time}`}
      backButton={backButton}
      headerActions={headerActions}
      showHeaderActionsOnMobile
    >
      {/* The same escaped HTML the PDF prints, so the screen and the paper cannot disagree. */}
      <div
        data-testid="booking-sheet"
        dangerouslySetInnerHTML={{ __html: renderBookingOnePager(model, { allowPrint: canDownload }) }}
      />
    </PageLayout>
  )
}
