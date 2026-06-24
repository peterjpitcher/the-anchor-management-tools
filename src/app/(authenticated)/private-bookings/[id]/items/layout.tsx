import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

export default async function PrivateBookingItemsLayout({ children }: { children: React.ReactNode }) {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('private_bookings', 'view'),
    checkUserPermission('private_bookings', 'manage'),
  ])

  if (!canView && !canManage) {
    redirect('/unauthorized')
  }

  return children
}
