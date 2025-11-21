'use server'

import { checkUserPermission } from './rbac'
import { revalidatePath } from 'next/cache'
import { FinancialService, type PnlDashboardData } from '@/services/financials'
import { type PLTimeframe } from '@/types/database'
import { PNL_TIMEFRAMES, type PnlTimeframeKey } from '@/lib/pnl/constants' // Exported from service? No, import from lib
// Actually PnlDashboardData exports PNL_TIMEFRAMES type info implicitly via typeof, but we might need the constant for type usage?
// The original action imported it.

export type { PnlDashboardData, PnlTimeframeKey }

export async function getPlDashboardData(): Promise<PnlDashboardData> {
  await checkUserPermission('receipts', 'view')
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
  const parsed = JSON.parse(raw) as SaveEntry[]
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid payload structure')
  }
  return parsed
}

export async function savePlTargetsAction(formData: FormData) {
  await checkUserPermission('receipts', 'manage')
  try {
    const entries = parseSavePayload(formData)
    await FinancialService.savePlTargets(entries);
    revalidatePath('/receipts/pnl')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to save P&L targets:', error)
    return { error: error.message || 'Failed to save targets' }
  }
}

export async function savePlManualActualsAction(formData: FormData) {
  await checkUserPermission('receipts', 'manage')
  try {
    const entries = parseSavePayload(formData)
    await FinancialService.savePlManualActuals(entries);
    revalidatePath('/receipts/pnl')
    return { success: true }
  } catch (error: any) {
    console.error('Failed to save manual P&L inputs:', error)
    return { error: error.message || 'Failed to save manual inputs' }
  }
}