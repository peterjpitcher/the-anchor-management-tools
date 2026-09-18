import type { VoucherStatus } from '@/types/vouchers'
import {
  VOUCHER_STATUS_LABELS,
  VOUCHER_STATUS_TONES,
  type BadgeTone
} from '../../_shared/voucher-ui'

// Status is always conveyed as text as well as colour (F46). The words and tones come from the
// ledger's map in vouchers/_shared/voucher-ui.tsx (owner decision D5), so the kiosk shows
// "Issued" and "Redeemed" in the same colours as the ledger and the voucher detail page.
export function statusLabel(status: VoucherStatus): string {
  return VOUCHER_STATUS_LABELS[status] ?? status
}

export function statusTone(status: VoucherStatus): BadgeTone {
  return VOUCHER_STATUS_TONES[status] ?? 'neutral'
}
