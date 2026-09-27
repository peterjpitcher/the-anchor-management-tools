import { redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { privateBookingSettingsNav } from '../_shared/nav'

/**
 * Private Bookings Settings has no page of its own: the Settings tab opens the first settings tab
 * (Catering, Vendors, Spaces) this person can use. The General tab it replaced only repeated the
 * SMS Queue tab (owner decision, 27 September 2026).
 */
export default async function PrivateBookingsSettingsPage() {
  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  const first = privateBookingSettingsNav(new Set(permissionsResult.actions))[0]
  redirect(first?.href ?? '/unauthorized')
}
