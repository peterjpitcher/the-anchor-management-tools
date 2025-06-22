'use server'

import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

export async function logAuditEvent(
  userId: string,
  action: string,
  details: Record<string, any> = {}
) {
  try {
    const supabase = await createClient()
    const headersList = await headers()
    
    // Get client info
    const userAgent = headersList.get('user-agent') || 'Unknown'
    const forwardedFor = headersList.get('x-forwarded-for')
    const realIp = headersList.get('x-real-ip')
    const ip = forwardedFor?.split(',')[0] || realIp || 'Unknown'

    // Create audit log entry
    const { error } = await supabase
      .from('audit_logs')
      .insert({
        user_id: userId,
        action,
        details,
        ip_address: ip,
        user_agent: userAgent
      })

    if (error) {
      console.error('Failed to create audit log:', error)
    }
  } catch (error) {
    console.error('Exception in audit logging:', error)
  }
}