import { CANCELLATION_REASONS, CANCELLATION_DETAIL_MAX_LENGTH } from '@/lib/table-bookings/cancellation-reasons'
// Imported from the styles module rather than the `guest` barrel on purpose: the barrel pulls in
// `GuestShell` and with it the guest webfont module, which this component has no need of.
import {
  GUEST_CHOICE_ROW_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_TEXTAREA_CLASS,
} from '@/components/features/guest/styles'
import { cn } from '@/lib/utils'

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
      <div className="border-t border-guest-border-strong pt-5">
        <a
          href={`${manageUrl}?confirmCancel=1`}
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-anchor-danger/[0.45] px-8 text-center font-anchor-body text-[16px] font-semibold text-anchor-danger no-underline transition-colors duration-200 ease-out hover:bg-anchor-danger/[0.06]"
        >
          Cancel booking
        </a>
        <p className="mt-2 font-anchor-body text-[12px] leading-[1.55] text-guest-text-muted">
          Cancelling within 24 hours of your booking may incur a late-cancellation fee.
        </p>
      </div>
    )
  }

  return (
    <div className="border-t border-guest-border-strong pt-5">
      <div className="rounded-guest-card border border-anchor-danger/[0.30] bg-anchor-danger/[0.06] p-4">
        <p className="font-anchor-body text-[15px] font-bold leading-[1.4] text-anchor-danger">
          Are you sure you want to cancel?
        </p>
        <p className="mt-1 font-anchor-body text-[13px] leading-[1.55] text-guest-text">
          This cannot be undone. Cancelling within 24 hours may incur a fee.
        </p>

        <form method="post" action={actionUrl} className="mt-4">
          <input type="hidden" name="action" value="cancel" />
          <input type="hidden" name="confirm" value="1" />

          <fieldset className="mt-1">
            <legend className="font-anchor-body text-[14px] font-semibold leading-[1.4] text-guest-text">
              If you don&apos;t mind us asking, why?
            </legend>
            <p className="mt-1 font-anchor-body text-[12px] leading-[1.55] text-guest-text-muted">
              Entirely optional, and it helps us put things right.
            </p>

            <div className="mt-2">
              {CANCELLATION_REASONS.map((reason) => (
                // The whole row is the label, so the full 44px target is clickable rather than
                // just the radio and its text. As a `div` the shared row class showed a pointer
                // cursor over dead padding.
                <label
                  key={reason.code}
                  htmlFor={`cancellation_reason_${reason.code}`}
                  className={GUEST_CHOICE_ROW_CLASS}
                >
                  {/* No size utility: `.guest-theme` sizes every radio at 20px and the row
                      carries the 44px target. */}
                  <input
                    id={`cancellation_reason_${reason.code}`}
                    name="cancellation_reason"
                    type="radio"
                    value={reason.code}
                  />
                  {reason.label}
                </label>
              ))}
            </div>

            <div className="mt-3">
              <label
                htmlFor="cancellation_reason_detail"
                className="block font-anchor-body text-[14px] font-semibold text-guest-text"
              >
                Anything else you&apos;d like to tell us
              </label>
              <textarea
                id="cancellation_reason_detail"
                name="cancellation_reason_detail"
                rows={2}
                maxLength={CANCELLATION_DETAIL_MAX_LENGTH}
                className={cn('mt-2', GUEST_INPUT_CLASS, GUEST_TEXTAREA_CLASS)}
              />
            </div>
          </fieldset>

          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <button
              type="submit"
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-transparent bg-anchor-danger px-8 text-center font-anchor-body text-[16px] font-semibold text-white transition-colors duration-200 ease-out hover:bg-anchor-danger/[0.88] sm:w-auto"
            >
              Yes, cancel my booking
            </button>
            <a
              href={manageUrl}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-anchor-green px-8 text-center font-anchor-body text-[16px] font-semibold text-anchor-green no-underline transition-colors duration-200 ease-out hover:bg-anchor-green hover:text-anchor-cream sm:w-auto"
            >
              No, keep my booking
            </a>
          </div>
        </form>

        {/*
          Fallback for sandboxed frames that block form submission, and for anyone who would rather
          not answer. Cancels with no reason recorded.
        */}
        <p className="mt-3 font-anchor-body text-[12px] leading-[1.55] text-guest-text-muted">
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
