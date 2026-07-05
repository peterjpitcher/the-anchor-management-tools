import { NextRequest, NextResponse } from 'next/server'
import { requireSettingsManagePermission } from '@/lib/settings/api-auth'
import { AuditService } from '@/services/audit'
import {
  getKitchenPacingSettings,
  saveKitchenPacingSettings,
  toPublicKitchenPacingSettings,
  validateKitchenPacingSettings,
} from '@/lib/table-bookings/kitchen-pacing'

export async function GET() {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) {
    return auth.response
  }

  try {
    const settings = await getKitchenPacingSettings(auth.supabase)
    return NextResponse.json({ success: true, data: toPublicKitchenPacingSettings(settings) })
  } catch (error) {
    console.error('Failed to load table-booking kitchen pacing settings', error)
    return NextResponse.json({ error: 'Failed to load kitchen pacing settings' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const validated = validateKitchenPacingSettings({
    enabled: source.enabled,
    windowMinutes: source.window_minutes,
    paceCoversRegular: source.pace_covers_regular,
    paceCoversSunday: source.pace_covers_sunday,
    walkInReserveRegular: source.walk_in_reserve_regular,
    walkInReserveSunday: source.walk_in_reserve_sunday,
  })

  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const previous = await getKitchenPacingSettings(auth.supabase)
  const saved = await saveKitchenPacingSettings(auth.supabase, validated.settings)
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 })
  }

  await AuditService.logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'kitchen_pacing_settings',
    operation_status: 'success',
    old_values: toPublicKitchenPacingSettings(previous),
    new_values: toPublicKitchenPacingSettings(validated.settings),
  })

  return NextResponse.json({ success: true, data: toPublicKitchenPacingSettings(validated.settings) })
}
