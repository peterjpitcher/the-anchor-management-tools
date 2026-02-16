import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import { saveSundayPreorderByRawToken } from '@/lib/table-bookings/sunday-preorder'

function redirectWithStatus(request: NextRequest, token: string, status: string) {
  return NextResponse.redirect(new URL(`/g/${token}/sunday-preorder?status=${encodeURIComponent(status)}`, request.url), 303)
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_sunday_preorder_submit',
    maxAttempts: 10
  })

  if (!throttle.allowed) {
    return redirectWithStatus(request, token, 'rate_limited')
  }

  const formData = await request.formData()

  const items: Array<{ menu_dish_id: string; quantity: number }> = []

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('qty_')) continue
    const menuDishId = key.slice(4)

    const quantity = typeof value === 'string'
      ? Number.parseInt(value, 10)
      : 0

    if (!Number.isFinite(quantity) || quantity <= 0) continue

    items.push({
      menu_dish_id: menuDishId,
      quantity
    })
  }

  const supabase = createAdminClient()

  try {
    const result = await saveSundayPreorderByRawToken(supabase, {
      rawToken: token,
      items
    })

    if (result.state === 'saved') {
      return redirectWithStatus(request, token, 'saved')
    }

    if (result.reason === 'submit_cutoff_passed') {
      return redirectWithStatus(request, token, 'cutoff')
    }

    return redirectWithStatus(request, token, 'error')
  } catch (error) {
    logger.warn('Guest Sunday-preorder submission failed unexpectedly', {
      metadata: {
        token,
        error: error instanceof Error ? error.message : String(error)
      }
    })
    return redirectWithStatus(request, token, 'error')
  }
}
