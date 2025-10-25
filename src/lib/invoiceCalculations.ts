export type InvoiceLineInput = {
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
}

export type InvoiceTotalsResult = {
  subtotalBeforeInvoiceDiscount: number
  invoiceDiscountAmount: number
  vatAmount: number
  totalAmount: number
  lineBreakdown: Array<{
    baseAfterLineDiscount: number
    invoiceDiscountShare: number
    baseAfterAllDiscounts: number
    vat: number
    total: number
  }>
}

/**
 * Calculate invoice totals in a single place so both server and client agree.
 * The function guards against zero-subtotals to avoid NaN propagation.
 */
export function calculateInvoiceTotals(
  lineItems: InvoiceLineInput[],
  invoiceDiscountPercentage: number
): InvoiceTotalsResult {
  const sanitizedDiscount = Number.isFinite(invoiceDiscountPercentage)
    ? Math.max(0, invoiceDiscountPercentage)
    : 0

  const lineBreakdown = lineItems.map((item) => {
    const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
    const unitPrice = Number.isFinite(item.unit_price) ? item.unit_price : 0
    const lineDiscountPercent = Number.isFinite(item.discount_percentage)
      ? Math.max(0, item.discount_percentage)
      : 0
    const vatRate = Number.isFinite(item.vat_rate) ? Math.max(0, item.vat_rate) : 0

    const lineSubtotal = quantity * unitPrice
    const lineDiscountAmount = lineSubtotal * (lineDiscountPercent / 100)
    const baseAfterLineDiscount = lineSubtotal - lineDiscountAmount

    return {
      baseAfterLineDiscount,
      vatRate,
    }
  })

  const subtotalBeforeInvoiceDiscount = lineBreakdown.reduce(
    (acc, line) => acc + line.baseAfterLineDiscount,
    0
  )

  const invoiceDiscountAmount =
    subtotalBeforeInvoiceDiscount > 0
      ? subtotalBeforeInvoiceDiscount * (sanitizedDiscount / 100)
      : 0

  const vatAmount = lineBreakdown.reduce((acc, line) => {
    if (subtotalBeforeInvoiceDiscount <= 0) {
      return acc
    }

    const lineShare = line.baseAfterLineDiscount / subtotalBeforeInvoiceDiscount
    const invoiceDiscountShare = invoiceDiscountAmount * lineShare
    const baseAfterAllDiscounts = line.baseAfterLineDiscount - invoiceDiscountShare
    const vat = baseAfterAllDiscounts * (line.vatRate / 100)

    return acc + vat
  }, 0)

  const totalAmount = subtotalBeforeInvoiceDiscount - invoiceDiscountAmount + vatAmount

  const breakdownWithVat = lineBreakdown.map((line) => {
    if (subtotalBeforeInvoiceDiscount <= 0) {
      return {
        baseAfterLineDiscount: line.baseAfterLineDiscount,
        invoiceDiscountShare: 0,
        baseAfterAllDiscounts: line.baseAfterLineDiscount,
        vat: 0,
        total: line.baseAfterLineDiscount,
      }
    }

    const lineShare = line.baseAfterLineDiscount / subtotalBeforeInvoiceDiscount
    const invoiceDiscountShare = invoiceDiscountAmount * lineShare
    const baseAfterAllDiscounts = line.baseAfterLineDiscount - invoiceDiscountShare
    const vat = baseAfterAllDiscounts * (line.vatRate / 100)

    return {
      baseAfterLineDiscount: line.baseAfterLineDiscount,
      invoiceDiscountShare,
      baseAfterAllDiscounts,
      vat,
      total: baseAfterAllDiscounts + vat,
    }
  })

  return {
    subtotalBeforeInvoiceDiscount,
    invoiceDiscountAmount,
    vatAmount,
    totalAmount,
    lineBreakdown: breakdownWithVat,
  }
}
