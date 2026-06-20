import { NextRequest, NextResponse } from 'next/server'
import { requireSettingsManagePermission } from '@/lib/settings/api-auth'
import { AuditService } from '@/services/audit'
import {
  getPacingSettings,
  savePacingSettings,
  toPublicPacingSettings,
  validatePacingSettings,
} from '@/lib/table-bookings/load'

export async function GET() {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) {
    return auth.response
  }

  try {
    const settings = await getPacingSettings(auth.supabase)
    return NextResponse.json({ success: true, data: toPublicPacingSettings(settings) })
  } catch (error) {
    console.error('Failed to load table-booking pacing settings', error)
    return NextResponse.json({ error: 'Failed to load pacing settings' }, { status: 500 })
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
  const validated = validatePacingSettings({
    busyThresholdCovers: source.busy_threshold_covers,
    fillingThresholdCovers: source.filling_threshold_covers,
    windowMinutes: source.window_minutes,
  })

  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const previous = await getPacingSettings(auth.supabase)
  const saved = await savePacingSettings(auth.supabase, validated.settings)
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 })
  }

  await AuditService.logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'table_booking_pacing_settings',
    operation_status: 'success',
    old_values: toPublicPacingSettings(previous),
    new_values: toPublicPacingSettings(validated.settings),
  })

  return NextResponse.json({ success: true, data: toPublicPacingSettings(validated.settings) })
}
