'use client'

import { useState } from 'react'
import { GuestSubmitButton } from './GuestSubmitButton'

/**
 * Cancel booking section for the guest manage page.
 * Shows a confirmation step before submitting the native form POST.
 */
export function GuestCancelBooking({
  actionUrl,
  specialRequirements,
}: {
  actionUrl: string
  specialRequirements: string
}) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <div className="mt-6 border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex w-full items-center justify-center rounded-md border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 sm:w-auto"
        >
          Cancel booking
        </button>
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
          <form method="post" action={actionUrl}>
            <input type="hidden" name="action" value="cancel" />
            <input type="hidden" name="notes" value={specialRequirements} />
            <GuestSubmitButton
              className="inline-flex w-full items-center justify-center rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 sm:w-auto"
              loadingText="Cancelling..."
            >
              Yes, cancel my booking
            </GuestSubmitButton>
          </form>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
          >
            No, keep my booking
          </button>
        </div>
      </div>
    </div>
  )
}
