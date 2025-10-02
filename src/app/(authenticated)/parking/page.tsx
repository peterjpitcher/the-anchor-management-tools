import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ParkingClient from './ParkingClient'

export default async function ParkingPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: canView } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'parking',
    p_action: 'view'
  })

  if (!canView) {
    redirect('/unauthorized')
  }

  const { data: canManage } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'parking',
    p_action: 'manage'
  })

  const { data: canRefund } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'parking',
    p_action: 'refund'
  })

  const permissions = {
    canCreate: !!canManage,
    canManage: !!canManage,
    canRefund: !!canRefund
  }

  return <ParkingClient permissions={permissions} />
}
