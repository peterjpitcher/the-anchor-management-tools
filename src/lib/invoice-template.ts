import { InvoiceWithDetails } from '@/types/invoices'
import { formatDateFull } from '@/lib/dateUtils'
import { COMPANY_DETAILS } from '@/lib/company-details'

export interface InvoiceTemplateData {
  invoice: InvoiceWithDetails
  logoUrl?: string
}

export function generateInvoiceHTML(data: InvoiceTemplateData): string {
  const { invoice, logoUrl } = data
  
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

  const formatPaymentTerms = () => {
    const terms = invoice.vendor?.payment_terms
    if (typeof terms !== 'number') {
      return '30 days'
    }
    return terms === 0 ? 'Due upon receipt' : `${terms} days`
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoice_number} - ${invoice.vendor?.name || 'Customer'}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm;
    }
    
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }
    
    body {
      font-family: Arial, sans-serif;
      line-height: 1.5;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      font-size: 10pt;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 30px;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 20px;
    }
    
    .logo-section {
      flex: 1;
    }
    
    .logo {
      max-width: 108px;
      height: auto;
      margin-bottom: 10px;
    }
    
    .invoice-header {
      flex: 1;
      text-align: right;
    }
    
    h1 {
      color: #111827;
      margin: 0 0 10px 0;
      font-size: 24pt;
      font-weight: 700;
    }
    
    .invoice-number {
      font-size: 14pt;
      color: #6b7280;
      margin-bottom: 5px;
    }
    
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 9pt;
      font-weight: 600;
      color: white;
      margin-top: 10px;
    }
    
    .company-details {
      margin-bottom: 30px;
    }
    
    .addresses {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 30px;
    }
    
    .address-block {
      background: #f9fafb;
      padding: 15px;
      border-radius: 6px;
    }
    
    .address-block h3 {
      margin: 0 0 10px 0;
      color: #111827;
      font-size: 11pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .address-block p {
      margin: 3px 0;
      color: #4b5563;
    }
    
    .invoice-meta {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin-bottom: 30px;
      padding: 15px;
      background: #f9fafb;
      border-radius: 6px;
    }
    
    .meta-item {
      text-align: center;
    }
    
    .meta-label {
      font-size: 8pt;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 3px;
    }
    
    .meta-value {
      font-size: 11pt;
      color: #111827;
      font-weight: 600;
    }
    
    .items-section {
      margin-bottom: 30px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    
    th {
      background: #f3f4f6;
      padding: 10px;
      text-align: left;
      font-weight: 600;
      color: #111827;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid #e5e7eb;
    }
    
    th.text-right {
      text-align: right;
    }
    
    td {
      padding: 12px 10px;
      border-bottom: 1px solid #e5e7eb;
      color: #4b5563;
    }
    
    td.text-right {
      text-align: right;
    }
    
    .item-description {
      font-weight: 500;
      color: #111827;
    }
    
    .discount-text {
      color: #059669;
      font-size: 9pt;
    }
    
    .summary {
      margin-left: auto;
      width: 350px;
      margin-bottom: 30px;
    }
    
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    
    .summary-row.total {
      border-bottom: none;
      border-top: 2px solid #111827;
      padding-top: 15px;
      margin-top: 10px;
      font-size: 14pt;
      font-weight: 700;
      color: #111827;
    }
    
    .summary-label {
      color: #6b7280;
    }
    
    .summary-value {
      font-weight: 600;
      color: #111827;
    }
    
    .notes-section {
      margin-bottom: 30px;
      padding: 20px;
      background: #f9fafb;
      border-radius: 6px;
    }
    
    .notes-section h3 {
      margin: 0 0 10px 0;
      color: #111827;
      font-size: 11pt;
    }
    
    .notes-section p {
      margin: 0;
      color: #4b5563;
      white-space: pre-wrap;
    }
    
    .payment-info {
      margin-bottom: 30px;
      padding: 20px;
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 6px;
    }
    
    .payment-info h3 {
      margin: 0 0 10px 0;
      color: #92400e;
      font-size: 11pt;
    }
    
    .payment-info p {
      margin: 5px 0;
      color: #92400e;
    }
    
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 9pt;
    }
    
    .footer p {
      margin: 3px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-section">
      ${logoUrl ? `<img src="${logoUrl}" alt="Company Logo" class="logo">` : ''}
      <div class="company-details">
        <p style="font-weight: 600; color: #111827; margin: 0;">${COMPANY_DETAILS.legalName}</p>
        <p style="margin: 2px 0; font-size: 9pt; color: #6b7280;">${COMPANY_DETAILS.address.street}</p>
        <p style="margin: 2px 0; font-size: 9pt; color: #6b7280;">${COMPANY_DETAILS.address.city}, ${COMPANY_DETAILS.address.county}</p>
        <p style="margin: 2px 0; font-size: 9pt; color: #6b7280;">${COMPANY_DETAILS.address.postcode}</p>
      </div>
    </div>
    
    <div class="invoice-header">
      <h1>INVOICE</h1>
      <div class="invoice-number">${invoice.invoice_number}</div>
      <div class="status-badge" style="background-color: ${getStatusColor(invoice.status)};">
        ${formatStatus(invoice.status)}
      </div>
    </div>
  </div>

  <div class="addresses">
    <div class="address-block">
      <h3>From</h3>
      <p><strong>${COMPANY_DETAILS.legalName}</strong></p>
      <p>VAT: ${COMPANY_DETAILS.vatNumber}</p>
      <p>Company No: ${COMPANY_DETAILS.registrationNumber}</p>
      <p>Tel: ${COMPANY_DETAILS.phone}</p>
      <p>Email: ${COMPANY_DETAILS.email}</p>
    </div>
    
    <div class="address-block">
      <h3>To</h3>
      ${invoice.vendor ? `
        <p><strong>${invoice.vendor.name}</strong></p>
        ${invoice.vendor.contact_name ? `<p>Attn: ${invoice.vendor.contact_name}</p>` : ''}
        ${invoice.vendor.address ? `<p style="white-space: pre-line;">${invoice.vendor.address}</p>` : ''}
        ${invoice.vendor.vat_number ? `<p>VAT: ${invoice.vendor.vat_number}</p>` : ''}
        ${invoice.vendor.email ? `<p>Email: ${invoice.vendor.email}</p>` : ''}
        ${invoice.vendor.phone ? `<p>Tel: ${invoice.vendor.phone}</p>` : ''}
      ` : '<p>No vendor details</p>'}
    </div>
  </div>

  <div class="invoice-meta">
    <div class="meta-item">
      <span class="meta-label">Invoice Date</span>
      <span class="meta-value">${formatDate(invoice.invoice_date)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Due Date</span>
      <span class="meta-value">${formatDate(invoice.due_date)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Reference</span>
      <span class="meta-value">${invoice.reference || '-'}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Terms</span>
      <span class="meta-value">${formatPaymentTerms()}</span>
    </div>
  </div>

  <div class="items-section">
    <table>
      <thead>
        <tr>
          <th style="width: 40%;">Description</th>
          <th class="text-right" style="width: 10%;">Qty</th>
          <th class="text-right" style="width: 15%;">Unit Price</th>
          <th class="text-right" style="width: 10%;">Discount</th>
          <th class="text-right" style="width: 10%;">VAT</th>
          <th class="text-right" style="width: 15%;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${invoice.line_items?.map(item => `
          <tr>
            <td class="item-description">${item.description}</td>
            <td class="text-right">${item.quantity}</td>
            <td class="text-right">${formatCurrency(item.unit_price)}</td>
            <td class="text-right">
              ${item.discount_percentage > 0 ? 
                `<span class="discount-text">-${item.discount_percentage}%</span>` : 
                '-'}
            </td>
            <td class="text-right">${item.vat_rate}%</td>
            <td class="text-right"><strong>${formatCurrency(calculateLineTotal(item))}</strong></td>
          </tr>
        `).join('') || '<tr><td colspan="6" style="text-align: center; color: #6b7280;">No line items</td></tr>'}
      </tbody>
    </table>

    <div class="summary">
      <div class="summary-row">
        <span class="summary-label">Subtotal</span>
        <span class="summary-value">${formatCurrency(invoice.subtotal_amount)}</span>
      </div>
      
      ${invoice.invoice_discount_percentage > 0 ? `
        <div class="summary-row">
          <span class="summary-label">Invoice Discount (${invoice.invoice_discount_percentage}%)</span>
          <span class="summary-value discount-text">-${formatCurrency(invoice.discount_amount)}</span>
        </div>
      ` : ''}
      
      <div class="summary-row">
        <span class="summary-label">VAT</span>
        <span class="summary-value">${formatCurrency(invoice.vat_amount)}</span>
      </div>
      
      <div class="summary-row total">
        <span>Total</span>
        <span>${formatCurrency(invoice.total_amount)}</span>
      </div>
    </div>
  </div>

  ${invoice.notes ? `
    <div class="notes-section">
      <h3>Notes</h3>
      <p>${invoice.notes}</p>
    </div>
  ` : ''}

  ${invoice.status !== 'paid' && invoice.status !== 'void' ? `
    <div class="payment-info">
      <h3>Payment Information</h3>
      <p><strong>Amount Due: ${formatCurrency(invoice.total_amount - invoice.paid_amount)}</strong></p>
      <p>Please make payment to:</p>
      <p>Bank: ${COMPANY_DETAILS.bankDetails.bankName}</p>
      <p>Sort Code: ${COMPANY_DETAILS.bankDetails.sortCode}</p>
      <p>Account Number: ${COMPANY_DETAILS.bankDetails.accountNumber}</p>
      <p>Reference: ${invoice.invoice_number}</p>
    </div>
  ` : ''}

  <div class="footer">
    <p>${COMPANY_DETAILS.legalName}</p>
    <p>Registered in England and Wales. Company No: ${COMPANY_DETAILS.registrationNumber}</p>
    <p>VAT Registration No: ${COMPANY_DETAILS.vatNumber}</p>
  </div>
</body>
</html>
  `
}
