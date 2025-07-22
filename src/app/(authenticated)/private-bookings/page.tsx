import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PrivateBookingsClient from './PrivateBookingsClient'

export default async function PrivateBookingsPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Check permissions
  const { data: hasViewPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'view'
  })

  if (!hasViewPermission) {
    redirect('/unauthorized')
  }

  const { data: hasCreatePermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'create'
  })

  const { data: hasDeletePermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'delete'
  })

  const permissions = {
    hasCreatePermission: hasCreatePermission || false,
    hasDeletePermission: hasDeletePermission || false
  }

  // Pass permissions to client component - no data fetching here!
  return <PrivateBookingsClient permissions={permissions} />
}