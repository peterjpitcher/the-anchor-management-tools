import type { NextRequest } from 'next/server'
import { handleStaffDepositAction } from '@/lib/table-bookings/staff-deposit-action-handler'

// Waive, take at the bar, or give longer to pay, from the FOH iPad (BK-045). Managers only.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleStaffDepositAction(request, context, 'foh')
}
