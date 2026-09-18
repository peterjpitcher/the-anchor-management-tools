import { createClient } from '@/lib/supabase/server'

/**
 * Insights are for super admins only (spec decision 4): the report holds takings,
 * invoices and named staff performance. Hiding the nav item is a courtesy; this check
 * runs before any report data is read. It fails closed: any error means no access.
 */
export async function currentUserCanViewInsights(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { data, error } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>)('is_super_admin', { check_user_id: user.id })
    if (error) {
      console.error('[insights] could not verify the caller role', { userId: user.id })
      return false
    }
    return data === true
  } catch {
    return false
  }
}
