'use server'

import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { revalidatePath } from 'next/cache'
import { FinancialService, type PnlDashboardData } from '@/services/financials'
import { type PLTimeframe } from '@/types/database'
import { PNL_TIMEFRAMES, type PnlTimeframeKey } from '@/lib/pnl/constants' // Exported from service? No, import from lib
import { getErrorMessage } from '@/lib/errors';
// Actually PnlDashboardData exports PNL_TIMEFRAMES type info implicitly via typeof, but we might need the constant for type usage?
// The original action imported it.

export type { PnlDashboardData, PnlTimeframeKey }

export async function getPlDashboardData(): Promise<PnlDashboardData> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) throw new Error('Insufficient permissions')
  return await FinancialService.getPlDashboardData();
}

type SaveEntry = {
  metric: string
  timeframe: PLTimeframe
  value: number | null
}

function parseSavePayload(formData: FormData) {
  const raw = formData.get('data')
  if (typeof raw !== 'string') {
    throw new Error('Invalid payload')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as SaveEntry[]
  } catch {
    throw new Error('Invalid data format')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid payload structure')
  }
  return parsed as SaveEntry[]
}

export async function savePlTargetsAction(formData: FormData) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) return { error: 'Insufficient permissions' }
  try {
    const entries = parseSavePayload(formData)
    await FinancialService.savePlTargets(entries);
    revalidatePath('/receipts/pnl')
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'pl_targets',
      operation_status: 'success',
    })
    return { success: true }
  } catch (error: unknown) {
    console.error('Failed to save P&L targets:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function savePlManualActualsAction(formData: FormData) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) return { error: 'Insufficient permissions' }
  try {
    const entries = parseSavePayload(formData)
    await FinancialService.savePlManualActuals(entries);
    revalidatePath('/receipts/pnl')
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'pl_manual_actuals',
      operation_status: 'success',
    })
    return { success: true }
  } catch (error: unknown) {
    console.error('Failed to save manual P&L inputs:', error)
    return { error: getErrorMessage(error) }
  }
}