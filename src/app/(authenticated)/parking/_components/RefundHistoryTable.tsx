'use client'

import {
  RefundHistoryTable as SharedRefundHistoryTable,
  type RefundHistoryTableProps,
} from '@/components/features/invoices/RefundHistoryTable'

/**
 * Parking uses the one shared refund table. ParkingClient already frames it in a Card titled
 * "Refund History" with a padding-free body, so it takes the bare table rather than a second card.
 */
export function RefundHistoryTable(props: Omit<RefundHistoryTableProps, 'variant'>) {
  return <SharedRefundHistoryTable {...props} variant="bare" />
}
