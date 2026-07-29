export type GroupableReceiptTransaction = {
  vendor_name?: string | null
  amount_in?: number | null
  amount_out?: number | null
  amount_total?: number | null
}

export type VendorGroup<TTransaction extends GroupableReceiptTransaction> = {
  key: string
  vendorName: string
  transactions: TTransaction[]
  totalIn: number
  totalOut: number
  totalAmount: number
}

export const MISSING_VENDOR_LABEL = 'Missing vendor'

function getVendorGroupLabel(transaction: GroupableReceiptTransaction) {
  const vendorName = transaction.vendor_name?.trim()
  return vendorName || MISSING_VENDOR_LABEL
}

export function getTransactionValue(transaction: GroupableReceiptTransaction) {
  const amountIn = Number(transaction.amount_in ?? 0)
  const amountOut = Number(transaction.amount_out ?? 0)
  return Number(transaction.amount_total ?? amountIn + amountOut)
}

export function buildVendorGroups<TTransaction extends GroupableReceiptTransaction>(
  transactions: TTransaction[],
): VendorGroup<TTransaction>[] {
  const groups = new Map<string, VendorGroup<TTransaction>>()

  transactions.forEach((transaction) => {
    const vendorName = getVendorGroupLabel(transaction)
    const key = vendorName.toLocaleLowerCase('en-GB')
    const group = groups.get(key) ?? {
      key,
      vendorName,
      transactions: [],
      totalIn: 0,
      totalOut: 0,
      totalAmount: 0,
    }

    group.transactions.push(transaction)
    group.totalIn += Number(transaction.amount_in ?? 0)
    group.totalOut += Number(transaction.amount_out ?? 0)
    group.totalAmount += getTransactionValue(transaction)
    groups.set(key, group)
  })

  return Array.from(groups.values()).sort((a, b) =>
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
  const low = { red: 25, green: 95, blue: 235 }
  const high = { red: 220, green: 38, blue: 38 }

  const mix = (lowChannel: number, highChannel: number) => {
    const base = lowChannel + (highChannel - lowChannel) * level
    return Math.round(255 + (base - 255) * clampedStrength)
  }

  return `rgb(${mix(low.red, high.red)} ${mix(low.green, high.green)} ${mix(low.blue, high.blue)})`
}
