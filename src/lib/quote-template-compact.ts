import { QuoteWithDetails } from '@/types/invoices'
import { formatDateFull } from '@/lib/dateUtils'
import { COMPANY_DETAILS } from '@/lib/company-details'

export interface QuoteTemplateData {
  quote: QuoteWithDetails
  logoUrl?: string
}

export function generateCompactQuoteHTML(data: QuoteTemplateData): string {
  const { quote, logoUrl } = data
  
  // Check if any line items have discounts or if there's a quote discount
  const hasDiscounts = quote.quote_discount_percentage > 0 || 
    (quote.line_items?.some(item => item.discount_percentage > 0) ?? false)
  
  // Helper functions
  const formatDate = (date: string | null) => {
    return formatDateFull(date)
  }

  const formatCurrency = (amount: number) => {
    return `£${amount.toFixed(2)}`
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

  // Calculate line VAT after all discounts (including quote discount)
  const calculateLineVat = (item: any) => {
    const lineAfterDiscount = calculateLineAfterDiscount(item)
    const lineShare = quote.subtotal_amount > 0 ? lineAfterDiscount / quote.subtotal_amount : 0
    const lineAfterQuoteDiscount = lineAfterDiscount - (quote.discount_amount * lineShare)
    return lineAfterQuoteDiscount * (item.vat_rate / 100)
  }

  const calculateLineTotal = (item: any) => {
    const lineAfterDiscount = calculateLineAfterDiscount(item)
    const lineShare = quote.subtotal_amount > 0 ? lineAfterDiscount / quote.subtotal_amount : 0
    const lineAfterQuoteDiscount = lineAfterDiscount - (quote.discount_amount * lineShare)
    const vat = calculateLineVat(item)
    return lineAfterQuoteDiscount + vat
  }

  // Format status for display
  const formatStatus = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')
  }

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted': return '#22c55e'
      case 'rejected': return '#ef4444'
      case 'expired': return '#f59e0b'
      case 'sent': return '#3b82f6'
      default: return '#6b7280'
    }
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote ${quote.quote_number} - ${quote.vendor?.name || 'Customer'}</title>
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
      max-width: 150px;
      height: auto;
      margin-bottom: 5px;
    }
    
    .quote-header {
      flex: 1;
      text-align: right;
    }
    
    h1 {
      color: #111827;
      margin: 0 0 5px 0;
      font-size: 16pt;
      font-weight: 700;
    }
    
    .quote-number {
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
    
    .quote-meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
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
    
    .acceptance-section {
      background: #f0f9ff;
      padding: 12px;
      border-radius: 4px;
      margin-top: 15px;
      page-break-inside: avoid;
      border: 1px solid #60a5fa;
    }
    
    .acceptance-section h3 {
      margin: 0 0 8px 0;
      color: #1e40af;
      font-size: 10pt;
    }
    
    .acceptance-section p {
      margin: 4px 0;
      color: #1e40af;
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
    <div class="quote-header">
      <h1>QUOTE</h1>
      <div class="quote-number">#${quote.quote_number}</div>
      <span class="status-badge" style="background-color: ${getStatusColor(quote.status)}">
        ${formatStatus(quote.status)}
      </span>
    </div>
  </div>

  <div class="addresses">
    <div class="address-block">
      <h3>From</h3>
      <p><strong>${COMPANY_DETAILS.name}</strong></p>
      <p>${COMPANY_DETAILS.fullAddress.split(',').join('<br>')}</p>
      <p>${COMPANY_DETAILS.phone}</p>
      <p>${COMPANY_DETAILS.email}</p>
    </div>
    <div class="address-block">
      <h3>Quote For</h3>
      <p><strong>${quote.vendor?.name || 'Customer'}</strong></p>
      ${quote.vendor?.contact_name ? `<p>${quote.vendor.contact_name}</p>` : ''}
      ${quote.vendor?.address ? `<p>${quote.vendor.address.split(',').join('<br>')}</p>` : ''}
      ${quote.vendor?.email ? `<p>${quote.vendor.email}</p>` : ''}
      ${quote.vendor?.phone ? `<p>${quote.vendor.phone}</p>` : ''}
      ${quote.vendor?.vat_number ? `<p>VAT: ${quote.vendor.vat_number}</p>` : ''}
    </div>
  </div>

  <div class="quote-meta">
    <div class="meta-item">
      <span class="meta-label">Quote Date</span>
      <span class="meta-value">${formatDate(quote.quote_date)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Valid Until</span>
      <span class="meta-value">${formatDate(quote.valid_until)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Reference</span>
      <span class="meta-value">${quote.reference || '-'}</span>
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
        ${quote.line_items?.map(item => `
          <tr>
            <td>
              <div class="item-description">${item.description}</div>
              ${hasDiscounts && item.discount_percentage > 0 ? `<div class="item-line-discount">Line disbadge: ${item.discount_percentage}%</div>` : ''}
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
        <span>${formatCurrency(quote.subtotal_amount)}</span>
      </div>
      ${quote.quote_discount_percentage > 0 ? `
        <div class="summary-row">
          <span>Quote Discount (${quote.quote_discount_percentage}%)</span>
          <span>-${formatCurrency(quote.discount_amount)}</span>
        </div>
      ` : ''}
      <div class="summary-row">
        <span>VAT</span>
        <span>${formatCurrency(quote.vat_amount)}</span>
      </div>
      <div class="summary-row total">
        <span>Total</span>
        <span>${formatCurrency(quote.total_amount)}</span>
      </div>
    </div>
  </div>

  <div class="acceptance-section keep-together">
    <h3>How to Accept This Quote</h3>
    <p>To accept this quote and proceed with the work:</p>
    <p>• Email us at ${COMPANY_DETAILS.email} with your acceptance</p>
    <p>• Call Peter Pitcher directly on 07995087315</p>
    <p>• Call our office on ${COMPANY_DETAILS.phone}</p>
    <p>• Reply to the email this quote was attached to</p>
    <p><strong>This quote is valid until ${formatDate(quote.valid_until)}</strong></p>
  </div>

  ${quote.notes ? `
    <div class="notes-section keep-together">
      <h3>Notes</h3>
      <p>${quote.notes}</p>
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