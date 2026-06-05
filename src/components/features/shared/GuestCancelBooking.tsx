/**
 * Cancel booking section for the guest manage page.
 * Uses URL state for the confirmation step so the first click works even if
 * the browser has not hydrated the React client yet. The final confirmation is
 * a link to a guarded GET action because sandboxed frames without allow-forms
 * block form submissions before they reach the server.
 */
export function GuestCancelBooking({
  actionUrl,
  confirmCancel,
  manageUrl,
}: {
  actionUrl: string
  confirmCancel: boolean
  manageUrl: string
}) {
  if (!confirmCancel) {
    return (
      <div className="mt-6 border-t border-gray-200 pt-4">
        <a
          href={`${manageUrl}?confirmCancel=1`}
          className="inline-flex w-full items-center justify-center rounded-md border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 sm:w-auto"
        >
          Cancel booking
        </a>
        <p className="mt-2 text-xs text-gray-500">
          Cancelling within 24 hours of your booking may incur a late-cancellation fee.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-gray-200 pt-4">
      <div className="rounded-md border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-800">Are you sure you want to cancel?</p>
        <p className="mt-1 text-xs text-red-700">
          This cannot be undone. Cancelling within 24 hours may incur a fee.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <a
            href={`${actionUrl}?action=cancel&confirm=1`}
            rel="nofollow"
            className="inline-flex w-full items-center justify-center rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 sm:w-auto"
          >
            Yes, cancel my booking
          </a>
          <a
            href={manageUrl}
            className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
          >
            No, keep my booking
          </a>
        </div>
      </div>
    </div>
  )
}
