import {
  paymentValue,
  vendorGroupKey,
  vendorGroupLabel,
  type VendorGroupTotal,
} from '@/lib/receipts/vendor-group-key'

export type GroupableReceiptTransaction = {
  vendor_name?: string | null
  amount_in?: number | null
  amount_out?: number | null
  amount_total?: number | null
}

export type VendorGroup<TTransaction extends GroupableReceiptTransaction> = {
  key: string
  vendorName: string
  /** The group's payments on this page. */
  transactions: TTransaction[]
  /** Payments in the group across every page. */
  count: number
  totalIn: number
  totalOut: number
  totalAmount: number
}

export function getTransactionValue(transaction: GroupableReceiptTransaction) {
  return paymentValue(transaction)
}

/**
 * The page's payments under their vendor headings.
 *
 * `serverTotals` are the totals of each group across every matching payment, worked out on the
 * server. With them, the groups stay in the order the server sent the rows (it keeps each vendor
 * together across pages) and a heading shows the whole group, not the part on this page. Without
 * them the page's own rows are totalled and the groups are put in alphabetical order.
 */
export function buildVendorGroups<TTransaction extends GroupableReceiptTransaction>(
  transactions: TTransaction[],
  serverTotals?: Record<string, VendorGroupTotal> | null,
): VendorGroup<TTransaction>[] {
  const groups = new Map<string, VendorGroup<TTransaction>>()

  transactions.forEach((transaction) => {
    const key = vendorGroupKey(transaction.vendor_name)
    const group = groups.get(key) ?? {
      key,
      vendorName: vendorGroupLabel(transaction.vendor_name),
      transactions: [],
      count: 0,
      totalIn: 0,
      totalOut: 0,
      totalAmount: 0,
    }

    group.transactions.push(transaction)
    group.count += 1
    group.totalIn += Number(transaction.amount_in ?? 0)
    group.totalOut += Number(transaction.amount_out ?? 0)
    group.totalAmount += getTransactionValue(transaction)
    groups.set(key, group)
  })

  const list = Array.from(groups.values())

  if (serverTotals) {
    return list.map((group) => {
      const total = serverTotals[group.key]
      // A group the server did not total (a row changed since) keeps what the page adds up to.
      return total ? { ...group, ...total } : group
    })
  }

  return list.sort((a, b) =>
    a.vendorName.localeCompare(b.vendorName, 'en-GB', {
      sensitivity: 'base',
      numeric: true,
    }),
  )
}

export function getValueHeatLevel(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || maximum <= minimum) return 0.5
  return Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)))
}

export function getValueHeatColour(
  value: number,
  minimum: number,
  maximum: number,
  strength = 1,
) {
  const level = getValueHeatLevel(value, minimum, maximum)
  const clampedStrength = Math.min(1, Math.max(0, strength))
  // The channels of the --color-info and --color-danger tokens (globals.css), which the legend
  // draws as a gradient. Mixed as numbers here because a row needs one solid colour per value.
  const low = { red: 2, green: 132, blue: 199 }
  const high = { red: 220, green: 38, blue: 38 }

  const mix = (lowChannel: number, highChannel: number) => {
    const base = lowChannel + (highChannel - lowChannel) * level
    return Math.round(255 + (base - 255) * clampedStrength)
  }

  return `rgb(${mix(low.red, high.red)} ${mix(low.green, high.green)} ${mix(low.blue, high.blue)})`
}
