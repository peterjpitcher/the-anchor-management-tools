import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ParkingClient from './ParkingClient'

export default async function ParkingPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const errors: string[] = []

  const {
    data: canView,
    error: canViewError,
  } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'parking',
    p_action: 'view',
  })

  if (canViewError) {
    console.error('Unable to verify parking view permission', canViewError)
    errors.push('We could not verify your parking access. Some functionality might be limited.')
  }

  if (!canView && !canViewError) {
    redirect('/unauthorized')
  }

  const {
    data: canManage,
    error: canManageError,
  } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'parking',
    p_action: 'manage',
  })

  if (canManageError) {
    console.error('Unable to verify parking manage permission', canManageError)
    errors.push('We could not confirm manage permissions; booking creation is currently disabled.')
  }

  const {
    data: canRefund,
    error: canRefundError,
  } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'parking',
    p_action: 'refund',
  })

  if (canRefundError) {
    console.error('Unable to verify parking refund permission', canRefundError)
    errors.push('Refund actions may be temporarily unavailable.')
  }

  const permissions = {
    canCreate: Boolean(canManage) && !canManageError,
    canManage: Boolean(canManage) && !canManageError,
    canRefund: Boolean(canRefund) && !canRefundError,
  }

  const initialError = errors.length > 0 ? errors.join(' ') : null

  return <ParkingClient permissions={permissions} initialError={initialError} />
}
