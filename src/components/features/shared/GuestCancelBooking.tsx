import { CANCELLATION_REASONS, CANCELLATION_DETAIL_MAX_LENGTH } from '@/lib/table-bookings/cancellation-reasons'

/**
 * Cancel booking section for the guest manage page.
 *
 * Uses URL state for the confirmation step so the first click works even if the browser has not
 * hydrated the React client yet.
 *
 * The confirmation step offers two routes, on purpose:
 *
 *   - A form POST carrying an optional reason. This is the normal path.
 *   - A plain GET link that cancels with no reason at all. This is the fallback for sandboxed frames
 *     without `allow-forms`, which block form submission before it reaches the server, and it is why
 *     the original implementation used a link. It doubles as the honest answer to "answering is
 *     optional": a guest who would rather not say just uses the link.
 *
 * Nobody is ever prevented from cancelling because they will not give a reason.
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

        <form method="post" action={actionUrl} className="mt-4">
          <input type="hidden" name="action" value="cancel" />
          <input type="hidden" name="confirm" value="1" />

          <fieldset className="mt-1">
            <legend className="text-sm font-medium text-red-800">
              If you don&apos;t mind us asking, why?
            </legend>
            <p className="mt-1 text-xs text-red-700">
              Entirely optional, and it helps us put things right.
            </p>

            <div className="mt-3 space-y-2">
              {CANCELLATION_REASONS.map((reason) => (
                <div key={reason.code} className="flex items-start gap-2">
                  <input
                    id={`cancellation_reason_${reason.code}`}
                    name="cancellation_reason"
                    type="radio"
                    value={reason.code}
                    className="mt-1 h-4 w-4 border-red-300 text-red-600 focus:ring-red-500"
                  />
                  <label
                    htmlFor={`cancellation_reason_${reason.code}`}
                    className="text-sm text-red-900"
                  >
                    {reason.label}
                  </label>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <label htmlFor="cancellation_reason_detail" className="block text-sm text-red-900">
                Anything else you&apos;d like to tell us
              </label>
              <textarea
                id="cancellation_reason_detail"
                name="cancellation_reason_detail"
                rows={2}
                maxLength={CANCELLATION_DETAIL_MAX_LENGTH}
                className="mt-1 w-full rounded-md border border-red-300 px-3 py-2 text-sm"
              />
            </div>
          </fieldset>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 sm:w-auto"
            >
              Yes, cancel my booking
            </button>
            <a
              href={manageUrl}
              className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
            >
              No, keep my booking
            </a>
          </div>
        </form>

        {/*
          Fallback for sandboxed frames that block form submission, and for anyone who would rather
          not answer. Cancels with no reason recorded.
        */}
        <p className="mt-3 text-xs text-red-700">
          <a
            href={`${actionUrl}?action=cancel&confirm=1`}
            rel="nofollow"
            className="underline hover:no-underline"
          >
            Cancel without giving a reason
          </a>
        </p>
      </div>
    </div>
  )
}
