import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { getSundayPreorderPageDataByRawToken } from '@/lib/table-bookings/sunday-preorder'

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

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2
  }).format(amount)
}

function mapBlockedReason(reason?: string): string {
  switch (reason) {
    case 'invalid_token':
      return 'This Sunday pre-order link is not valid.'
    case 'token_expired':
      return 'This Sunday pre-order link has expired.'
    case 'token_used':
      return 'This Sunday pre-order link has already been used.'
    case 'booking_not_found':
      return 'This booking was not found.'
    case 'booking_not_active':
      return 'This booking can no longer be changed.'
    case 'not_sunday_lunch':
      return 'This booking is not a Sunday lunch booking.'
    case 'rate_limited':
      return 'Too many attempts were made with this link. Please wait a few minutes and try again.'
    default:
      return 'This Sunday pre-order page is unavailable.'
  }
}

function readQuantityByDish(items: Array<{ menu_dish_id: string; quantity: number }>): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of items) {
    map.set(item.menu_dish_id, Math.max(0, Math.trunc(Number(item.quantity || 0))))
  }
  return map
}

export default async function SundayPreorderPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_sunday_preorder_view',
    maxAttempts: 60
  })

  if (!throttle.allowed) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Sunday pre-order unavailable</h1>
          <p className="mt-3 text-sm text-gray-600">{mapBlockedReason('rate_limited')}</p>
        </div>
      </div>
    )
  }

  const supabase = createAdminClient()
  const pageData = await getSundayPreorderPageDataByRawToken(supabase, token)

  if (pageData.state !== 'ready') {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Sunday pre-order unavailable</h1>
          <p className="mt-3 text-sm text-gray-600">{mapBlockedReason(pageData.reason)}</p>
        </div>
      </div>
    )
  }

  const menuItems = pageData.menu_items || []
  const quantities = readQuantityByDish(pageData.existing_items || [])
  const groupedByCategory = menuItems.reduce<Record<string, typeof menuItems>>((acc, item) => {
    const key = item.category_name || 'Other'
    if (!acc[key]) {
      acc[key] = []
    }
    acc[key].push(item)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Sunday lunch pre-order</h1>

        {query.status === 'saved' && (
          <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Pre-order saved.
          </div>
        )}

        {query.status === 'error' && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            We could not save your pre-order. Please try again.
          </div>
        )}

        {query.status === 'cutoff' && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Pre-order changes are now closed for this booking.
          </div>
        )}

        {query.status === 'rate_limited' && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Too many attempts were made with this link. Please wait a few minutes and try again.
          </div>
        )}

        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p><span className="font-medium text-gray-900">Booking:</span> {pageData.booking_reference || pageData.booking_id}</p>
          <p className="mt-1"><span className="font-medium text-gray-900">Time:</span> {formatDateTime(pageData.start_datetime)}</p>
          <p className="mt-1"><span className="font-medium text-gray-900">Party size:</span> {Math.max(1, Number(pageData.party_size || 1))}</p>
          <p className="mt-1"><span className="font-medium text-gray-900">Pre-order deadline:</span> {formatDateTime(pageData.submit_deadline_at)}</p>
          {pageData.sunday_preorder_completed_at && (
            <p className="mt-1"><span className="font-medium text-gray-900">Last saved:</span> {formatDateTime(pageData.sunday_preorder_completed_at)}</p>
          )}
        </div>

        {menuItems.length === 0 ? (
          <p className="mt-6 text-sm text-gray-600">Sunday lunch menu is not currently available.</p>
        ) : (
          <form method="post" action={`/g/${token}/sunday-preorder/action`} className="mt-6 space-y-6">
            {Object.entries(groupedByCategory).map(([category, items]) => (
              <section key={category} className="rounded-md border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-900">{category}</h2>
                <div className="mt-3 space-y-3">
                  {items.map((item) => (
                    <div key={item.menu_dish_id} className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.name}</p>
                        <p className="text-xs text-gray-500">{formatMoney(item.price)}</p>
                      </div>
                      <label className="text-xs text-gray-500" htmlFor={`qty_${item.menu_dish_id}`}>
                        Quantity
                      </label>
                      <input
                        id={`qty_${item.menu_dish_id}`}
                        name={`qty_${item.menu_dish_id}`}
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={String(quantities.get(item.menu_dish_id) || 0)}
                        disabled={!pageData.can_submit}
                        className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {pageData.can_submit ? (
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                Save pre-order
              </button>
            ) : (
              <p className="text-sm text-gray-600">Pre-order changes are now closed for this booking.</p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
