import type { MgdReturn } from '@/app/actions/mgd'

/**
 * How an MGD return's status looks on staff screens. Pure module, safe to import from server and
 * client components. Open is still collecting, submitted waits for payment, paid is done.
 */
export const MGD_RETURN_STATUS_TONE: Record<MgdReturn['status'], 'info' | 'warning' | 'success'> = {
  open: 'info',
  submitted: 'warning',
  paid: 'success',
}

export function mgdReturnStatusLabel(status: MgdReturn['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
