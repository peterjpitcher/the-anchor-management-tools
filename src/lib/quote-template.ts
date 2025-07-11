import { COMPANY_DETAILS } from '@/lib/company-details'
import type { QuoteWithDetails } from '@/types/invoices'

interface QuoteTemplateData {
  quote: QuoteWithDetails
  logoUrl?: string
}

export function generateQuoteHTML(data: QuoteTemplateData): string {
  const { quote, logoUrl } = data
  
  // Calculate subtotals for line items
  const lineItems = quote.line_items || []
  
  // Format dates
  const quoteDate = new Date(quote.quote_date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
  
  const validUntil = new Date(quote.valid_until).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
  
  const isExpired = new Date(quote.valid_until) < new Date()

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote ${quote.quote_number}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      background: white;
    }
    
    .page {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
      background: white;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 2px solid #e0e0e0;
    }
    
    .logo-section img {
      height: 50px;
      width: auto;
    }
    
    .company-details {
      text-align: right;
      font-size: 14px;
      color: #666;
    }
    
    .company-name {
      font-size: 18px;
      font-weight: bold;
      color: #333;
      margin-bottom: 8px;
    }
    
    .quote-title {
      font-size: 32px;
      font-weight: bold;
      margin-bottom: 30px;
      color: #333;
    }
    
    .quote-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 40px;
    }
    
    .meta-section h3 {
      font-size: 14px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }
    
    .meta-content {
      font-size: 15px;
      line-height: 1.6;
    }
    
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-top: 8px;
    }
    
    .status-expired {
      background: #FEF3C7;
      color: #92400E;
    }
    
    .status-valid {
      background: #D1FAE5;
      color: #065F46;
    }
    
    .items-table {
      width: 100%;
      margin-bottom: 30px;
      border-collapse: collapse;
    }
    
    .items-table th {
      background: #f8f8f8;
      padding: 12px;
      text-align: left;
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      border-bottom: 2px solid #e0e0e0;
    }
    
    .items-table th:last-child {
      text-align: right;
    }
    
    .items-table td {
      padding: 12px;
      border-bottom: 1px solid #e0e0e0;
      font-size: 15px;
    }
    
    .items-table td:last-child {
      text-align: right;
    }
    
    .item-description {
      color: #333;
      font-weight: 500;
    }
    
    .summary-section {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 40px;
    }
    
    .summary-table {
      width: 300px;
    }
    
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 15px;
    }
    
    .summary-row.discount {
      color: #dc2626;
    }
    
    .summary-row.total {
      font-size: 18px;
      font-weight: bold;
      border-top: 2px solid #333;
      padding-top: 12px;
      margin-top: 8px;
    }
    
    .notes-section {
      margin-bottom: 40px;
      padding: 20px;
      background: #f8f8f8;
      border-radius: 8px;
    }
    
    .notes-section h3 {
      font-size: 16px;
      margin-bottom: 10px;
      color: #333;
    }
    
    .notes-content {
      font-size: 14px;
      color: #666;
      white-space: pre-wrap;
    }
    
    .terms-section {
      margin-top: 40px;
      padding-top: 30px;
      border-top: 1px solid #e0e0e0;
    }
    
    .terms-section h3 {
      font-size: 16px;
      margin-bottom: 10px;
      color: #333;
    }
    
    .terms-content {
      font-size: 14px;
      color: #666;
      line-height: 1.6;
    }
    
    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      font-size: 12px;
      color: #999;
    }
    
    @media print {
      body {
        background: white;
      }
      
      .page {
        max-width: 100%;
        margin: 0;
        padding: 20px;
      }
      
      .header {
        break-inside: avoid;
      }
      
      .items-table {
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo-section">
        ${logoUrl ? `<img src="${logoUrl}" alt="${COMPANY_DETAILS.legalName}" />` : `<h2>${COMPANY_DETAILS.legalName}</h2>`}
      </div>
      <div class="company-details">
        <div class="company-name">${COMPANY_DETAILS.legalName}</div>
        <div>${COMPANY_DETAILS.address.street}</div>
        <div>${COMPANY_DETAILS.address.city}, ${COMPANY_DETAILS.address.postcode}</div>
        <div>VAT: ${COMPANY_DETAILS.vatNumber}</div>
      </div>
    </div>
    
    <h1 class="quote-title">Quote ${quote.quote_number}</h1>
    
    <div class="quote-meta">
      <div class="meta-section">
        <h3>Quote For</h3>
        <div class="meta-content">
          <strong>${quote.vendor?.name || 'Unknown Vendor'}</strong><br>
          ${quote.vendor?.contact_name ? `${quote.vendor.contact_name}<br>` : ''}
          ${quote.vendor?.address ? `${quote.vendor.address.replace(/\n/g, '<br>')}` : ''}
          ${quote.vendor?.vat_number ? `<br>VAT: ${quote.vendor.vat_number}` : ''}
        </div>
      </div>
      
      <div class="meta-section">
        <h3>Quote Details</h3>
        <div class="meta-content">
          <strong>Quote Date:</strong> ${quoteDate}<br>
          <strong>Valid Until:</strong> ${validUntil}<br>
          ${quote.reference ? `<strong>Reference:</strong> ${quote.reference}<br>` : ''}
          <span class="status-badge ${isExpired ? 'status-expired' : 'status-valid'}">
            ${isExpired ? 'EXPIRED' : 'VALID'}
          </span>
        </div>
      </div>
    </div>
    
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 50%">Description</th>
          <th style="width: 10%; text-align: right">Qty</th>
          <th style="width: 15%; text-align: right">Unit Price</th>
          <th style="width: 10%; text-align: right">Discount</th>
          <th style="width: 15%; text-align: right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems.map(item => {
          const lineSubtotal = item.quantity * item.unit_price
          const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
          const lineTotal = lineSubtotal - lineDiscount
          
          return `
            <tr>
              <td class="item-description">${item.description}</td>
              <td style="text-align: right">${item.quantity}</td>
              <td style="text-align: right">£${item.unit_price.toFixed(2)}</td>
              <td style="text-align: right">${item.discount_percentage > 0 ? `${item.discount_percentage}%` : '-'}</td>
              <td style="text-align: right">£${lineTotal.toFixed(2)}</td>
            </tr>
          `
        }).join('')}
      </tbody>
    </table>
    
    <div class="summary-section">
      <div class="summary-table">
        <div class="summary-row">
          <span>Subtotal:</span>
          <span>£${quote.subtotal_amount.toFixed(2)}</span>
        </div>
        ${quote.discount_amount > 0 ? `
          <div class="summary-row discount">
            <span>Discount (${quote.quote_discount_percentage}%):</span>
            <span>-£${quote.discount_amount.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="summary-row">
          <span>VAT:</span>
          <span>£${quote.vat_amount.toFixed(2)}</span>
        </div>
        <div class="summary-row total">
          <span>Total:</span>
          <span>£${quote.total_amount.toFixed(2)}</span>
        </div>
      </div>
    </div>
    
    ${quote.notes ? `
      <div class="notes-section">
        <h3>Notes</h3>
        <div class="notes-content">${quote.notes}</div>
      </div>
    ` : ''}
    
    <div class="terms-section">
      <h3>Terms & Conditions</h3>
      <div class="terms-content">
        <p>This quote is valid until ${validUntil}. All prices are exclusive of VAT which will be added at the prevailing rate.</p>
        <p>Prices and availability are subject to change. This quote does not constitute a contract.</p>
      </div>
    </div>
    
    <div class="footer">
      <p>${COMPANY_DETAILS.legalName} | Company Registration: ${COMPANY_DETAILS.registrationNumber}</p>
      <p>${COMPANY_DETAILS.email} | ${COMPANY_DETAILS.phone}</p>
    </div>
  </div>
</body>
</html>
  `
}