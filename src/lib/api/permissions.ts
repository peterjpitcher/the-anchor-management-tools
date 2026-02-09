import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type PermissionCheckResult =
  | { ok: true; userId: string; supabase: ReturnType<typeof createAdminClient> }
  | { ok: false; response: NextResponse }

export async function requireModulePermission(moduleName: string, action: string): Promise<PermissionCheckResult> {
  const userClient = await createClient()
  const {
    data: { user }
  } = await userClient.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createAdminClient()
  const { data: allowed, error } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: moduleName,
    p_action: action
  })

  if (error || !allowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  return {
    ok: true,
    userId: user.id,
    supabase
  }
}
