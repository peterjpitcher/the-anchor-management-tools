'use server'

import { createClient } from '@/lib/supabase/server'

export async function getCurrentUser() {
  try {
    // Use the regular client to get the current user
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) {
      return {
        user_id: null,
        user_email: null
      }
    }
    
    return {
      user_id: user.id,
      user_email: user.email || null
    }
  } catch (error) {
    console.error('Error getting current user for audit:', error)
    return {
      user_id: null,
      user_email: null
    }
  }
}