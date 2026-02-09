import { InvoiceWithDetails } from '@/types/invoices'
import { formatDateFull } from '@/lib/dateUtils'
import { COMPANY_DETAILS } from '@/lib/company-details'

export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'

export interface InvoiceRemittanceDetails {
  paymentDate?: string | null
  paymentAmount?: number | null
  paymentMethod?: string | null
  paymentReference?: string | null
}

export interface InvoiceTemplateData {
  invoice: InvoiceWithDetails
  logoUrl?: string
  documentKind?: InvoiceDocumentKind
  remittance?: InvoiceRemittanceDetails
}

export function generateCompactInvoiceHTML(data: InvoiceTemplateData): string {
  const { invoice, logoUrl, documentKind = 'invoice', remittance } = data
  const isRemittanceAdvice = documentKind === 'remittance_advice'

  // Check if any line items have discounts or if there's an invoice discount
  const hasDiscounts = invoice.invoice_discount_percentage > 0 ||
    (invoice.line_items?.some(item => item.discount_percentage > 0) ?? false)

  // Helper functions
  const escapeHtml = (value: string) => {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  const formatAddressHtml = (value: string | null | undefined) => {
    if (!value) return ''

    const normalized = String(value).replace(/\r\n/g, '\n').trim()
    if (!normalized) return ''

    const parts = normalized.includes('\n')
      ? normalized.split('\n')
      : normalized.split(',')

    return parts
      .map((part) => escapeHtml(part.trim()))
      .filter(Boolean)
      .join('<br>')
  }

  const formatDate = (date: string | null) => {
    return formatDateFull(date)
  }

  const formatCurrency = (amount: number) => {
    return `£${amount.toFixed(2)}`
  }

  const formatPaymentTerms = () => {
    const terms = invoice.vendor?.payment_terms
    if (typeof terms !== 'number') {
      return '30 days'
    }
    return terms === 0 ? 'Due upon receipt' : `${terms} days`
  }

  const formatDateOrDash = (date: string | null | undefined) => {
    if (!date) return '-'
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return '-'
    return formatDateFull(date)
  }

  const formatPaymentMethod = (method: string | null | undefined) => {
    if (!method) return '-'
    return String(method)
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  // Calculate line item totals
  const calculateLineSubtotal = (item: any) => {
    return item.quantity * item.unit_price
  }

  const calculateLineDiscount = (item: any) => {
    const subtotal = calculateLineSubtotal(item)
    return subtotal * (item.discount_percentage / 100)
  }

  const calculateLineAfterDiscount = (item: any) => {
    return calculateLineSubtotal(item) - calculateLineDiscount(item)
  }

  // Calculate line VAT after all discounts (including invoice discount)
  const calculateLineVat = (item: any) => {
    const lineAfterDiscount = calculateLineAfterDiscount(item)
    const lineShare = invoice.subtotal_amount > 0 ? lineAfterDiscount / invoice.subtotal_amount : 0
    const lineAfterInvoiceDiscount = lineAfterDiscount - (invoice.discount_amount * lineShare)
    return lineAfterInvoiceDiscount * (item.vat_rate / 100)
  }

  const calculateLineTotal = (item: any) => {
    const lineAfterDiscount = calculateLineAfterDiscount(item)
    const lineShare = invoice.subtotal_amount > 0 ? lineAfterDiscount / invoice.subtotal_amount : 0
    const lineAfterInvoiceDiscount = lineAfterDiscount - (invoice.discount_amount * lineShare)
    const vat = calculateLineVat(item)
    return lineAfterInvoiceDiscount + vat
  }

  // Format status for display
  const formatStatus = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')
  }

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return '#22c55e'
      case 'overdue': return '#ef4444'
      case 'partially_paid': return '#f59e0b'
      case 'sent': return '#3b82f6'
      default: return '#6b7280'
    }
  }

  const latestPayment = (invoice.payments || [])
    .slice()
    .sort((a, b) => {
      const aDate = new Date(a.payment_date || a.created_at || 0).getTime()
      const bDate = new Date(b.payment_date || b.created_at || 0).getTime()
      return bDate - aDate
    })[0]

  const remittancePaymentAmount = remittance?.paymentAmount ?? latestPayment?.amount ?? invoice.paid_amount
  const remittancePaymentDate = remittance?.paymentDate ?? latestPayment?.payment_date ?? null
  const remittancePaymentMethod = remittance?.paymentMethod ?? latestPayment?.payment_method ?? null
  const remittancePaymentReference =
    remittance?.paymentReference ?? latestPayment?.reference ?? invoice.reference ?? null
  const outstandingBalance = Math.max(0, invoice.total_amount - invoice.paid_amount)

  const documentTitle = isRemittanceAdvice ? 'Remittance Advice' : 'Invoice'
  const documentHeader = isRemittanceAdvice ? 'REMITTANCE ADVICE' : 'INVOICE'
  const documentNumberLabel = isRemittanceAdvice
    ? `For Invoice #${invoice.invoice_number}`
    : `#${invoice.invoice_number}`

  const secondMetaLabel = isRemittanceAdvice ? 'Payment Date' : 'Due Date'
  const secondMetaValue = isRemittanceAdvice
    ? formatDateOrDash(remittancePaymentDate)
    : formatDate(invoice.due_date)

  const thirdMetaLabel = isRemittanceAdvice ? 'Payment Method' : 'Reference'
  const thirdMetaValue = isRemittanceAdvice
    ? formatPaymentMethod(remittancePaymentMethod)
    : invoice.reference || '-'

  const fourthMetaLabel = isRemittanceAdvice ? 'Payment Ref' : 'Terms'
  const fourthMetaValue = isRemittanceAdvice
    ? remittancePaymentReference || '-'
    : formatPaymentTerms()

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${documentTitle} ${invoice.invoice_number} - ${invoice.vendor?.name || 'Customer'}</title>
  <style>
    @page {
      size: A4;
      margin: 8mm;
    }
    
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      .keep-together { page-break-inside: avoid; }
    }
    
    body {
      font-family: Arial, sans-serif;
      line-height: 1.3;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 5px;
      font-size: 8pt;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 8px;
    }
    
    .logo-section {
      flex: 1;
    }
    
    .logo {
      max-width: 90px;
      height: auto;
      margin-bottom: 5px;
    }
    
    .invoice-header {
      flex: 1;
      text-align: right;
    }
    
    h1 {
      color: #111827;
      margin: 0 0 5px 0;
      font-size: 16pt;
      font-weight: 700;
    }
    
    .invoice-number {
      font-size: 10pt;
      color: #6b7280;
      margin-bottom: 2px;
    }
    
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 8pt;
      font-weight: 600;
      color: white;
      margin-top: 5px;
    }
    
    .company-details {
      margin-bottom: 10px;
      font-size: 8pt;
      color: #6b7280;
    }
    
    .addresses {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 10px;
    }
    
    .address-block {
      background: #f9fafb;
      padding: 8px;
      border-radius: 4px;
    }
    
    .address-block h3 {
      margin: 0 0 5px 0;
      color: #111827;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    
    .address-block p {
      margin: 2px 0;
      color: #4b5563;
      font-size: 8pt;
    }
    
    .invoice-meta {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 10px;
      padding: 8px;
      background: #f9fafb;
      border-radius: 4px;
      font-size: 8pt;
    }
    
    .meta-item {
      text-align: center;
    }
    
    .meta-label {
      font-size: 7pt;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      display: block;
      margin-bottom: 1px;
    }
    
    .meta-value {
      font-size: 9pt;
      color: #111827;
      font-weight: 600;
    }
    
    .items-section {
      margin-bottom: 10px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-size: 8pt;
    }
    
    th {
      background: #f3f4f6;
      padding: 6px 8px;
      text-align: left;
      font-weight: 600;
      color: #111827;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-bottom: 1px solid #e5e7eb;
    }
    
    th.text-right {
      text-align: right;
    }
    
    td {
      padding: 6px 8px;
      border-bottom: 1px solid #e5e7eb;
      color: #4b5563;
      vertical-align: top;
    }
    
    td.text-right {
      text-align: right;
    }
    
    .item-description {
      font-weight: 500;
      color: #111827;
      margin-bottom: 2px;
    }
    
    .item-line-discount {
      font-size: 7pt;
      color: #059669;
    }
    
    .summary-section {
      margin-top: 15px;
      page-break-inside: avoid;
    }
    
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    
    .summary-row.total {
      border-bottom: none;
      border-top: 2px solid #111827;
      padding-top: 8px;
      margin-top: 5px;
      font-size: 11pt;
      font-weight: 700;
      color: #111827;
    }
    
    .payment-section {
      background: #f9fafb;
      padding: 12px;
      border-radius: 4px;
      margin-top: 15px;
      page-break-inside: avoid;
    }
    
    .payment-section h3 {
      margin: 0 0 8px 0;
      color: #111827;
      font-size: 10pt;
    }
    
    .payment-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }
    
    .payment-method h4 {
      margin: 0 0 4px 0;
      color: #111827;
      font-size: 9pt;
    }
    
    .payment-method p {
      margin: 2px 0;
      color: #4b5563;
      font-size: 8pt;
    }
    
    .notes-section {
      margin-top: 15px;
      padding: 10px;
      background: #fefce8;
      border-radius: 4px;
      page-break-inside: avoid;
    }
    
    .notes-section h3 {
      margin: 0 0 5px 0;
      color: #111827;
      font-size: 9pt;
    }
    
    .notes-section p {
      margin: 0;
      color: #4b5563;
      white-space: pre-wrap;
      font-size: 8pt;
    }
    
    .footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 7pt;
    }
    
    .footer p {
      margin: 2px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-section">
      ${logoUrl ? `<img src="${logoUrl}" alt="${COMPANY_DETAILS.name}" class="logo">` : ''}
      <div class="company-details">
        <strong>${COMPANY_DETAILS.name}</strong><br>
        ${COMPANY_DETAILS.fullAddress}<br>
        VAT: ${COMPANY_DETAILS.vatNumber}
      </div>
    </div>
    <div class="invoice-header">
      <h1>${documentHeader}</h1>
      <div class="invoice-number">${escapeHtml(documentNumberLabel)}</div>
      <span class="status-badge" style="background-color: ${getStatusColor(invoice.status)}">
        ${formatStatus(invoice.status)}
      </span>
    </div>
  </div>

  <div class="addresses">
    <div class="address-block">
      <h3>From</h3>
      <p><strong>${COMPANY_DETAILS.name}</strong></p>
      <p>${formatAddressHtml(COMPANY_DETAILS.fullAddress)}</p>
      <p>${COMPANY_DETAILS.phone}</p>
      <p>${COMPANY_DETAILS.email}</p>
    </div>
    <div class="address-block">
      <h3>Bill To</h3>
      <p><strong>${invoice.vendor?.name || 'Customer'}</strong></p>
      ${invoice.vendor?.contact_name ? `<p>${invoice.vendor.contact_name}</p>` : ''}
      ${invoice.vendor?.address ? `<p>${formatAddressHtml(invoice.vendor.address)}</p>` : ''}
      ${invoice.vendor?.email ? `<p>${invoice.vendor.email}</p>` : ''}
      ${invoice.vendor?.phone ? `<p>${invoice.vendor.phone}</p>` : ''}
      ${invoice.vendor?.vat_number ? `<p>VAT: ${invoice.vendor.vat_number}</p>` : ''}
    </div>
  </div>

  <div class="invoice-meta">
    <div class="meta-item">
      <span class="meta-label">Invoice Date</span>
      <span class="meta-value">${formatDate(invoice.invoice_date)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">${secondMetaLabel}</span>
      <span class="meta-value">${escapeHtml(secondMetaValue)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">${thirdMetaLabel}</span>
      <span class="meta-value">${escapeHtml(thirdMetaValue)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">${fourthMetaLabel}</span>
      <span class="meta-value">${escapeHtml(fourthMetaValue)}</span>
    </div>
  </div>

  <div class="items-section">
    <table>
      <thead>
        <tr>
          <th style="width: ${hasDiscounts ? '40%' : '45%'}">Description</th>
          <th class="text-right" style="width: 10%">Qty</th>
          <th class="text-right" style="width: 15%">Unit Price</th>
          ${hasDiscounts ? '<th class="text-right" style="width: 10%">Disc %</th>' : ''}
          <th class="text-right" style="width: ${hasDiscounts ? '10%' : '15%'}">VAT %</th>
          <th class="text-right" style="width: 15%">Total</th>
        </tr>
      </thead>
      <tbody>
        ${invoice.line_items?.map(item => `
          <tr>
            <td>
              <div class="item-description">${item.description}</div>
              ${hasDiscounts && item.discount_percentage > 0 ? `<div class="item-line-discount">Line discount: ${item.discount_percentage}%</div>` : ''}
            </td>
            <td class="text-right">${item.quantity}</td>
            <td class="text-right">${formatCurrency(item.unit_price)}</td>
            ${hasDiscounts ? `<td class="text-right">${item.discount_percentage || 0}%</td>` : ''}
            <td class="text-right">${item.vat_rate}%</td>
            <td class="text-right">${formatCurrency(calculateLineTotal(item))}</td>
          </tr>
        `).join('') || ''}
      </tbody>
    </table>

    <div class="summary-section">
      <div class="summary-row">
        <span>Subtotal</span>
        <span>${formatCurrency(invoice.subtotal_amount)}</span>
      </div>
      ${invoice.invoice_discount_percentage > 0 ? `
        <div class="summary-row">
          <span>Invoice Discount (${invoice.invoice_discount_percentage}%)</span>
          <span>-${formatCurrency(invoice.discount_amount)}</span>
        </div>
      ` : ''}
      <div class="summary-row">
        <span>VAT</span>
        <span>${formatCurrency(invoice.vat_amount)}</span>
      </div>
      ${isRemittanceAdvice ? `
        <div class="summary-row">
          <span>Invoice Total</span>
          <span>${formatCurrency(invoice.total_amount)}</span>
        </div>
        <div class="summary-row">
          <span>Total Paid</span>
          <span>${formatCurrency(invoice.paid_amount)}</span>
        </div>
        <div class="summary-row total">
          <span>Outstanding Balance</span>
          <span>${formatCurrency(outstandingBalance)}</span>
        </div>
      ` : `
        <div class="summary-row total">
          <span>Total Due</span>
          <span>${formatCurrency(invoice.total_amount)}</span>
        </div>
      `}
    </div>
  </div>

  ${isRemittanceAdvice ? `
    <div class="payment-section keep-together">
      <h3>Remittance Details</h3>
      <div class="payment-grid">
        <div class="payment-method">
          <h4>Payment Summary</h4>
          <p><strong>Invoice Total:</strong> ${formatCurrency(invoice.total_amount)}</p>
          <p><strong>Payment Received:</strong> ${formatCurrency(remittancePaymentAmount)}</p>
          <p><strong>Total Paid:</strong> ${formatCurrency(invoice.paid_amount)}</p>
          <p><strong>Outstanding Balance:</strong> ${formatCurrency(outstandingBalance)}</p>
        </div>
        <div class="payment-method">
          <h4>Payment Reference</h4>
          <p><strong>Invoice Number:</strong> ${escapeHtml(invoice.invoice_number)}</p>
          <p><strong>Payment Date:</strong> ${escapeHtml(formatDateOrDash(remittancePaymentDate))}</p>
          <p><strong>Method:</strong> ${escapeHtml(formatPaymentMethod(remittancePaymentMethod))}</p>
          <p><strong>Reference:</strong> ${escapeHtml(remittancePaymentReference || '-')}</p>
        </div>
      </div>
    </div>
  ` : `
    <div class="payment-section keep-together">
      <h3>Payment Information</h3>
      <div class="payment-grid">
        <div class="payment-method">
          <h4>Bank Transfer</h4>
          <p><strong>Bank:</strong> ${COMPANY_DETAILS.bank.name}</p>
          <p><strong>Account Name:</strong> ${COMPANY_DETAILS.bank.accountName}</p>
          <p><strong>Sort Code:</strong> ${COMPANY_DETAILS.bank.sortCode}</p>
          <p><strong>Account: </strong> ${COMPANY_DETAILS.bank.accountNumber}</p>
          <p><strong>Reference:</strong> ${invoice.invoice_number}</p>
        </div>
        <div class="payment-method">
          <h4>Other Methods</h4>
          <p><strong>Card Payments:</strong> Subject to additional fees</p>
          <p>For payment queries or to arrange card payment:</p>
          <p>Contact: Peter Pitcher</p>
          <p>Mobile: 07995087315</p>
          <p>Office: ${COMPANY_DETAILS.phone}</p>
          <p>Email: ${COMPANY_DETAILS.email}</p>
        </div>
      </div>
    </div>
  `}

  ${invoice.notes ? `
    <div class="notes-section keep-together">
      <h3>Notes</h3>
      <p>${escapeHtml(invoice.notes)}</p>
    </div>
  ` : ''}

  <div class="footer">
    <p>${COMPANY_DETAILS.name} | Company Reg: ${COMPANY_DETAILS.companyNumber} | VAT: ${COMPANY_DETAILS.vatNumber}</p>
    <p>${COMPANY_DETAILS.fullAddress} | ${COMPANY_DETAILS.phone} | ${COMPANY_DETAILS.email}</p>
    <p>Contact: Peter Pitcher | Mobile: 07995087315</p>
  </div>
</body>
</html>
  `
}
