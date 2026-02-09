import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import {
  formatChargeRequestType,
  getChargeApprovalPreviewByRawToken,
  type ChargeApprovalPreview
} from '@/lib/table-bookings/charge-approvals'

function formatMoney(amount: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2
  }).format(amount)
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Unknown'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(value))
  } catch {
    return 'Unknown'
  }
}

function mapBlockedReason(reason?: string): string {
  switch (reason) {
    case 'invalid_token':
      return 'This approval link is not valid.'
    case 'token_expired':
      return 'This approval link has expired.'
    case 'token_used':
      return 'This approval link has already been used.'
    case 'charge_request_not_found':
      return 'This charge request no longer exists.'
    case 'token_customer_mismatch':
      return 'This approval link does not match the charge request.'
    case 'rate_limited':
      return 'Too many attempts were made with this approval link. Please wait a few minutes and try again.'
    default:
      return 'This approval page is unavailable.'
  }
}

function renderStatusBanner(status: string | undefined) {
  if (!status) return null

  switch (status) {
    case 'waived':
      return (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Charge request waived.
        </div>
      )
    case 'approved_succeeded':
      return (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Charge approved and payment succeeded.
        </div>
      )
    case 'approved_pending':
      return (
        <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Charge approved. Payment is still processing.
        </div>
      )
    case 'approved_failed':
      return (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Charge approved but payment failed.
        </div>
      )
    case 'error':
      return (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          We could not process that action. Please try again.
        </div>
      )
    case 'rate_limited':
      return (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Too many attempts were made with this approval link. Please wait a few minutes and try again.
        </div>
      )
    default:
      return null
  }
}

function readAmount(preview: ChargeApprovalPreview): string {
  const amount = typeof preview.amount === 'number' ? preview.amount : Number(preview.amount || 0)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return safeAmount.toFixed(2)
}

export default async function ChargeRequestApprovalPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const supabase = createAdminClient()
  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'manager_charge_approval_view',
    maxAttempts: 60
  })

  if (!throttle.allowed) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="mx-auto w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Charge request approval</h1>
          {renderStatusBanner('rate_limited')}
          <p className="mt-4 text-sm text-gray-600">{mapBlockedReason('rate_limited')}</p>
        </div>
      </div>
    )
  }

  let preview: ChargeApprovalPreview
  try {
    preview = await getChargeApprovalPreviewByRawToken(supabase, token)
  } catch {
    preview = {
      state: 'blocked',
      reason: 'invalid_token'
    }
  }

  const amountText = preview.amount != null
    ? formatMoney(Number(preview.amount), preview.currency || 'GBP')
    : formatMoney(0, 'GBP')

  const customerName = `${preview.customer_first_name || ''} ${preview.customer_last_name || ''}`.trim() || 'Guest'
  const partySize = Math.max(1, Number(preview.party_size || preview.committed_party_size || 1))

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Charge request approval</h1>

        {renderStatusBanner(query.status)}

        {preview.state === 'blocked' && (
          <p className="mt-4 text-sm text-gray-600">{mapBlockedReason(preview.reason)}</p>
        )}

        {preview.state === 'already_decided' && (
          <div className="mt-4 space-y-2 text-sm text-gray-700">
            <p>
              This request has already been decided: <span className="font-semibold">{preview.manager_decision || 'completed'}</span>
            </p>
            <p>Status: <span className="font-semibold">{preview.charge_status || 'updated'}</span></p>
            <p>Amount: <span className="font-semibold">{amountText}</span></p>
          </div>
        )}

        {preview.state === 'ready' && (
          <>
            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <p><span className="font-medium text-gray-900">Type:</span> {formatChargeRequestType(preview.type)}</p>
              <p className="mt-1"><span className="font-medium text-gray-900">Amount:</span> {amountText}</p>
              <p className="mt-1"><span className="font-medium text-gray-900">Booking:</span> {preview.booking_reference || preview.table_booking_id}</p>
              <p className="mt-1"><span className="font-medium text-gray-900">Time:</span> {formatDateTime(preview.start_datetime)}</p>
              <p className="mt-1"><span className="font-medium text-gray-900">Table:</span> {preview.table_name || 'Unassigned'}</p>
              <p className="mt-1"><span className="font-medium text-gray-900">Guest:</span> {customerName}</p>
              <p className="mt-1"><span className="font-medium text-gray-900">Party size:</span> {partySize}</p>
            </div>

            {preview.warning_over_200 && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                Warning: amount is over £200. Extra confirmation is required to approve.
              </div>
            )}

            {preview.warning_over_50_per_head && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                Warning: amount is over £50 per head. Extra confirmation is required to approve.
              </div>
            )}

            {!preview.payment_method_available && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                No completed card capture found for this booking. Approving will fail unless card capture exists.
              </div>
            )}

            <form method="post" action={`/m/${token}/charge-request/action`} className="mt-6 space-y-4">
              <input type="hidden" name="decision" value="approve" />

              <div>
                <label className="block text-sm font-medium text-gray-900" htmlFor="approved_amount">
                  Approved amount (GBP)
                </label>
                <input
                  id="approved_amount"
                  name="approved_amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  defaultValue={readAmount(preview)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>

              {preview.requires_amount_reentry && (
                <div>
                  <label className="block text-sm font-medium text-gray-900" htmlFor="confirm_amount">
                    Re-enter amount to confirm walkout charge
                  </label>
                  <input
                    id="confirm_amount"
                    name="confirm_amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    required
                  />
                </div>
              )}

              {preview.warning_needs_extra_confirmation && (
                <label className="flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    name="threshold_confirmed"
                    value="yes"
                    className="mt-0.5"
                    required
                  />
                  <span>I confirm I have reviewed the high-value warning and still approve this charge.</span>
                </label>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  Approve and attempt charge
                </button>
              </div>
            </form>

            <form method="post" action={`/m/${token}/charge-request/action`} className="mt-3">
              <input type="hidden" name="decision" value="waive" />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Waive charge request
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
