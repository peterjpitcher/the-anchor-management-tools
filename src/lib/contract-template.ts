import { PrivateBookingWithDetails, PrivateBookingItem } from '@/types/private-bookings'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'

export interface ContractData {
  booking: PrivateBookingWithDetails
  logoUrl?: string
  companyDetails?: {
    name: string
    registrationNumber?: string
    vatNumber?: string
    address: string
    phone: string
    email: string
  }
}

export function generateContractHTML(data: ContractData): string {
  const { booking, logoUrl, companyDetails } = data

  // Helper functions
  const formatDate = (date: string | null) => {
    return formatDateFull(date)
  }

  const formatTime = (time: string | null) => {
    return formatTime12Hour(time)
  }

  const formatCurrency = (amount: number) => {
    return `£${amount.toFixed(2)}`
  }

  const escapeHtml = (value: string) => {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  const formatPlainText = (value?: string | null) => {
    if (!value) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? escapeHtml(trimmed) : null
  }

  // Calculate totals including discounts
  const calculateSubtotal = () => {
    return booking.items?.reduce((sum: number, item: PrivateBookingItem) => {
      // Use line_total directly since it's a database-generated column
      const lineTotal = typeof item.line_total === 'string' ? parseFloat(item.line_total) : item.line_total
      return sum + (lineTotal || 0)
    }, 0) || 0
  }

  // Calculate the original price before any item-level discounts
  const calculateOriginalTotal = () => {
    return booking.items?.reduce((sum: number, item: PrivateBookingItem) => {
      const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : item.quantity
      const price = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : item.unit_price
      return sum + (qty * price)
    }, 0) || 0
  }

  // Calculate total item-level discounts
  const calculateItemDiscounts = () => {
    return booking.items?.reduce((sum: number, item: PrivateBookingItem) => {
      if (item.discount_value && item.discount_value > 0) {
        const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : item.quantity
        const price = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : item.unit_price
        const originalPrice = qty * price

        if (item.discount_type === 'percent') {
          return sum + (originalPrice * (item.discount_value / 100))
        } else {
          return sum + item.discount_value
        }
      }
      return sum
    }, 0) || 0
  }

  const calculateDiscountAmount = () => {
    const subtotal = calculateSubtotal()
    if (!booking.discount_amount || booking.discount_amount === 0) return 0

    if (booking.discount_type === 'percent') {
      return subtotal * (booking.discount_amount / 100)
    } else {
      return booking.discount_amount
    }
  }

  const calculateTotal = () => {
    return calculateSubtotal() - calculateDiscountAmount()
  }

  // Extract details
  const customerName = booking.customer_full_name || booking.customer_name || 'To be confirmed'
  const isTbd = isBookingDateTbd(booking)
  const eventDate = isTbd ? 'Date to be confirmed' : formatDate(booking.event_date)
  const startTime = isTbd ? 'To be confirmed' : formatTime(booking.start_time)
  const rawEndTime = formatTime(booking.end_time || null)
  const endTime = booking.end_time && booking.end_time_next_day
    ? `${rawEndTime} (+1 day)`
    : rawEndTime
  const eventType = booking.event_type || 'To be confirmed'
  const guestCount = booking.guest_count || 'To be confirmed'
  const depositAmount = booking.deposit_amount ?? 250
  const subtotal = calculateSubtotal()
  const discountAmount = calculateDiscountAmount()
  const total = calculateTotal()
  // The deposit is separate from the event balance and cannot be used towards it.
  // Only event-balance payments (stored in private_booking_payments) reduce the balance.
  const totalPaid = booking.final_payment_date
    ? total
    : ((booking.payments || []) as Array<{ amount: number | string }>).reduce((sum, p) => {
        const paid = typeof p.amount === 'string' ? parseFloat(p.amount) : (p.amount ?? 0)
        return sum + (Number.isFinite(paid) ? paid : 0)
      }, 0)
  const balanceDue = Math.max(0, total - totalPaid)
  const contractNote = formatPlainText(booking.contract_note)

  // Pre-escaped variables for safe HTML interpolation
  const safeCustomerName = escapeHtml(customerName)
  const safeEventType = escapeHtml(eventType)
  const safeSpecialRequirements = booking.special_requirements
    ? escapeHtml(booking.special_requirements)
    : null
  const safeAccessibilityNeeds = booking.accessibility_needs
    ? escapeHtml(booking.accessibility_needs)
    : null

  // Calculate balance due date — prefer explicit field, fall back to 14 days before event
  let balanceDueDate = 'To be confirmed'
  let finalDetailsDate = 'To be confirmed'
  if (isTbd) {
    balanceDueDate = 'To be confirmed (date TBD)'
    finalDetailsDate = 'To be confirmed (date TBD)'
  } else if (booking.balance_due_date) {
    balanceDueDate = formatDate(booking.balance_due_date)
    finalDetailsDate = balanceDueDate
  } else if (booking.event_date) {
    const eventDateObj = new Date(booking.event_date)
    const dueDate = new Date(eventDateObj.getTime() - (14 * 24 * 60 * 60 * 1000))
    balanceDueDate = formatDate(dueDate.toISOString())
    finalDetailsDate = balanceDueDate
  }

  // Group items by type
  const spaceItems = booking.items?.filter((i: PrivateBookingItem) => i.item_type === 'space') || []
  const cateringItems = booking.items?.filter((i: PrivateBookingItem) => i.item_type === 'catering') || []
  const vendorItems = booking.items?.filter((i: PrivateBookingItem) => i.item_type === 'vendor') || []
  const otherItems = booking.items?.filter((i: PrivateBookingItem) => i.item_type === 'other') || []

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Private Booking Contract - ${safeCustomerName}</title>
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
      line-height: 1.4;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      font-size: 9pt;
    }
    
    .header {
      text-align: center;
      margin-bottom: 20px;
    }
    
    .logo {
      max-width: 150px;
      height: auto;
      margin-bottom: 10px;
    }
    
    h1 {
      color: #005131;
      margin: 5px 0;
      font-size: 18pt;
    }
    
    h2 {
      color: #005131;
      margin-top: 15px;
      margin-bottom: 10px;
      font-size: 12pt;
      border-bottom: 1px solid #005131;
      padding-bottom: 3px;
    }
    
    h3 {
      color: #005131;
      margin-top: 10px;
      margin-bottom: 5px;
      font-size: 10pt;
    }
    
    .contract-info {
      text-align: center;
      margin-bottom: 15px;
      font-size: 8pt;
      color: #666;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 15px;
    }
    
    .info-section {
      background: #f9f9f9;
      padding: 10px;
      border-radius: 3px;
      border: 1px solid #e0e0e0;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    .info-section h3 {
      margin-top: 0;
      color: #005131;
    }
    
    .info-section p {
      margin: 3px 0;
      font-size: 8pt;
    }

    .plain-text {
      white-space: pre-wrap;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-size: 8pt;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    th, td {
      text-align: left;
      padding: 5px;
      border-bottom: 1px solid #ddd;
    }
    
    th {
      background-color: #005131;
      color: white;
      font-weight: bold;
    }
    
    .total-row {
      font-weight: bold;
      background-color: #f0f0f0;
    }
    
    .discount-row {
      color: #10b981;
      font-style: italic;
      background-color: #f0fdf4;
      font-weight: 500;
    }
    
    .discount-row td {
      padding: 8px 5px;
    }
    
    .discount-note {
      color: #10b981;
      font-style: italic;
      font-weight: normal;
      display: inline-block;
      margin-top: 2px;
    }
    
    .deposit-section {
      background: #fffbeb;
      border: 1px solid #f59e0b;
      padding: 10px;
      margin: 10px 0;
      border-radius: 3px;
      font-size: 8pt;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    .deposit-section h3 {
      color: #d97706;
      margin-top: 0;
    }
    
    .agreement-section {
      background: #f3f4f6;
      padding: 10px;
      margin: 15px 0;
      border: 1px solid #d1d5db;
      border-radius: 3px;
      font-size: 8pt;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    .terms-section {
      margin-top: 20px;
      font-size: 7pt;
      line-height: 1.3;
    }
    
    .terms-section h3 {
      background: #005131;
      color: white;
      padding: 5px;
      margin: 10px 0 5px 0;
      font-size: 9pt;
    }
    
    .terms-section ul, .terms-section ol {
      margin-left: 15px;
      margin-bottom: 8px;
    }
    
    .terms-section li {
      margin-bottom: 3px;
    }
    
    .signature-section {
      margin-top: 20px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      font-size: 8pt;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    .signature-box {
      text-align: center;
    }
    
    .signature-line {
      border-bottom: 1px solid #333;
      margin: 30px 0 5px 0;
    }
    
    .footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #ddd;
      text-align: center;
      font-size: 7pt;
      color: #666;
    }
    
    .print-button {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 10px 20px;
      background-color: #005131;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    
    .print-button:hover {
      background-color: #003d24;
    }
    
    .back-button {
      position: fixed;
      top: 20px;
      left: 20px;
      padding: 10px 20px;
      background-color: #6b7280;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    
    .back-button:hover {
      background-color: #4b5563;
    }
    
    .keep-together {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    /* Ensure financial summary section stays together */
    .financial-summary-wrapper {
      page-break-inside: avoid;
      break-inside: avoid;
    }
  </style>
</head>
<body>
  <a href="/private-bookings/${booking.id}" class="back-button no-print">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 20px; height: 20px;">
      <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
    Back to Booking
  </a>
  <button class="print-button no-print" onclick="window.print()">Print Contract</button>
  
  <div class="header">
    ${logoUrl ? `<img src="${encodeURI(logoUrl)}" alt="The Anchor Logo" class="logo">` : ''}
    <h1>PRIVATE BOOKING CONTRACT</h1>
  </div>

  <div class="contract-info">
    <p><strong>Contract Reference:</strong> PB-${booking.id.slice(0, 8).toUpperCase()}</p>
    <p><strong>Date Generated:</strong> ${formatDate(new Date().toISOString())}</p>
  </div>

  <div class="info-grid">
    <div class="info-section">
      <h3>Customer Details</h3>
      <p><strong>Name:</strong> ${safeCustomerName}</p>
      ${booking.contact_phone ? `<p><strong>Phone:</strong> ${escapeHtml(booking.contact_phone)}</p>` : ''}
      ${booking.contact_email ? `<p><strong>Email:</strong> ${escapeHtml(booking.contact_email)}</p>` : ''}
    </div>
    
    <div class="info-section">
      <h3>Event Details</h3>
      <p><strong>Date:</strong> ${eventDate}</p>
      <p><strong>Time:</strong> ${startTime} to ${endTime}</p>
      ${booking.setup_time ? `<p><strong>Setup Time:</strong> ${formatTime(booking.setup_time)}</p>` : ''}
      <p><strong>Expected Guests:</strong> ${guestCount}</p>
      <p><strong>Event Type:</strong> ${safeEventType}</p>
    </div>
  </div>

  ${safeSpecialRequirements || safeAccessibilityNeeds ? `
  <div class="info-section" style="margin-bottom: 30px;">
    <h3>Special Requirements</h3>
    ${safeSpecialRequirements ? `<p><strong>Event Requirements:</strong> ${safeSpecialRequirements}</p>` : ''}
    ${safeAccessibilityNeeds ? `<p><strong>Accessibility Needs:</strong> ${safeAccessibilityNeeds}</p>` : ''}
  </div>
  ` : ''}

  ${contractNote ? `
  <div class="info-section" style="margin-bottom: 30px;">
    <h3>Contract Note</h3>
    <p class="plain-text">${contractNote}</p>
  </div>
  ` : ''}

  <h2>Booking Items</h2>

  ${spaceItems.length > 0 ? `
    <h3>Venue Spaces</h3>
    <table>
      <thead>
        <tr>
          <th>Space</th>
          <th>Hours</th>
          <th>Rate</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${spaceItems.map((item: PrivateBookingItem) => {
    const originalPrice = item.quantity * item.unit_price;
    const hasDiscount = item.discount_value && item.discount_value > 0;

    return `
          <tr>
            <td>
              ${escapeHtml(item.description || '')}
              ${hasDiscount ? `
                <br/><small class="discount-note">
                  <strong>✓ Discount: ${item.discount_type === 'percent' ? `${item.discount_value}% off` : `£${item.discount_value} off`}</strong>
                  ${item.notes ? ` - ${escapeHtml(item.notes || '')}` : ''}
                </small>
              ` : ''}
            </td>
            <td>${item.quantity}</td>
            <td>
              ${hasDiscount && item.discount_type === 'percent' && item.discount_value === 100 ?
        `<s style="color: #999;">${formatCurrency(item.unit_price)}/hour</s><br/><strong>FREE</strong>` :
        `${formatCurrency(item.unit_price)}/hour`
      }
            </td>
            <td>
              ${hasDiscount && originalPrice !== item.line_total ?
        `<s style="color: #999;">${formatCurrency(originalPrice)}</s><br/><strong>${formatCurrency(item.line_total)}</strong>` :
        formatCurrency(item.line_total)
      }
            </td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  ` : ''}

  ${cateringItems.length > 0 ? `
    <h3>Catering</h3>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Details</th>
          <th>Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${cateringItems.map((item: PrivateBookingItem) => {
        const originalPrice = item.quantity * item.unit_price;
        const hasDiscount = item.discount_value && item.discount_value > 0;

        return `
          <tr>
            <td>
              ${escapeHtml(item.description || '')}
              ${item.package?.guest_description ? `
                <br/><small style="color: #666; font-weight: normal;">${escapeHtml(item.package.guest_description)}</small>
              ` : ''}
              ${hasDiscount ? `
                <br/><small class="discount-note">
                  <strong>✓ Discount: ${item.discount_type === 'percent' ? `${item.discount_value}% off` : `£${item.discount_value} off`}</strong>
                  ${item.notes ? ` - ${escapeHtml(item.notes || '')}` : ''}
                </small>
              ` : ''}
            </td>
            <td>
              ${item.package?.pricing_model === 'total_value'
            ? 'Total Package'
            : `${item.quantity} guests`
          }
            </td>
            <td>
              ${item.package?.pricing_model === 'total_value'
            ? 'See total'
            : `${formatCurrency(item.unit_price)} per head`
          }
            </td>
            <td>
              ${hasDiscount && originalPrice !== item.line_total ?
            `<s style="color: #999;">${formatCurrency(originalPrice)}</s><br/><strong>${formatCurrency(item.line_total)}</strong>` :
            formatCurrency(item.line_total)
          }
            </td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  ` : ''}

  ${vendorItems.length > 0 ? `
    <h3>External Vendors</h3>
    <table>
      <thead>
        <tr>
          <th>Vendor/Service</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        ${vendorItems.map((item: PrivateBookingItem) => `
          <tr>
            <td>${escapeHtml(item.description || '')}</td>
            <td>${formatCurrency(item.line_total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}

  ${otherItems.length > 0 ? `
    <h3>Additional Items</h3>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Quantity</th>
          <th>Unit Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${otherItems.map((item: PrivateBookingItem) => `
          <tr>
            <td>${escapeHtml(item.description || '')}</td>
            <td>${item.quantity}</td>
            <td>${formatCurrency(item.unit_price)}</td>
            <td>${formatCurrency(item.line_total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}

  <div class="financial-summary-wrapper">
  <h2>Financial Summary</h2>
  <table>
    <tbody>
      <tr>
        <td><strong>Original Price (before discounts)</strong></td>
        <td style="text-align: right;">${formatCurrency(calculateOriginalTotal())}</td>
      </tr>
      ${calculateItemDiscounts() > 0 ? `
        <tr style="color: #10b981;">
          <td><strong>Item Discounts</strong></td>
          <td style="text-align: right;"><strong>-${formatCurrency(calculateItemDiscounts())}</strong></td>
        </tr>
      ` : ''}
      <tr>
        <td><strong>Subtotal</strong></td>
        <td style="text-align: right;">${formatCurrency(subtotal)}</td>
      </tr>
      ${booking.discount_amount && booking.discount_amount > 0 ? `
        <tr class="discount-row">
          <td>
            <strong>✓ Booking Discount</strong>
            ${booking.discount_type === 'percent' ? ` (${booking.discount_amount}% off)` : ` (£${booking.discount_amount} off)`}
            ${booking.discount_reason ? `<br/><small style="font-weight: normal; color: #059669;">Reason: ${escapeHtml(booking.discount_reason)}</small>` : ''}
          </td>
          <td style="text-align: right; vertical-align: middle;">
            <strong>-${formatCurrency(discountAmount)}</strong>
          </td>
        </tr>
      ` : ''}
      ${(calculateItemDiscounts() > 0 || (booking.discount_amount && booking.discount_amount > 0)) ? `
        <tr>
          <td colspan="2" style="text-align: center; padding: 8px; background-color: #f0fdf4; color: #059669; font-weight: bold;">
            Total Savings: ${formatCurrency(calculateOriginalTotal() - total)}
          </td>
        </tr>
      ` : ''}
      <tr class="total-row">
        <td><strong>Total Event Cost</strong></td>
        <td style="text-align: right;"><strong>${formatCurrency(total)}</strong></td>
      </tr>
    </tbody>
  </table>
  
  <table style="margin-top: 15px;">
    <tbody>
      <tr style="background: #fef3c7;">
        <td style="padding: 10px; border: 1px solid #d97706;">
          <strong style="color: #92400e;">Booking and Damage Deposit</strong>
          <br/><small style="color: #b45309;">Deposit status: ${booking.deposit_paid_date ? `Paid ${formatDate(booking.deposit_paid_date)}` : 'Due'}</small>
        </td>
        <td style="text-align: right; padding: 10px; border: 1px solid #d97706; color: #92400e;">
          <strong>${formatCurrency(depositAmount)}</strong>
        </td>
      </tr>
      <tr class="total-row">
        <td><strong>Event Balance Due</strong></td>
        <td style="text-align: right;"><strong>${formatCurrency(balanceDue)}</strong></td>
      </tr>
      ${!booking.final_payment_date && total > 0 ? `
      <tr>
        <td style="color: #666;">Balance due by:</td>
        <td style="text-align: right; color: #666;">${balanceDueDate} (14 days before event)</td>
      </tr>
      <tr>
        <td style="color: #666;">Final guest numbers due by:</td>
        <td style="text-align: right; color: #666;">${finalDetailsDate} (14 days before event)</td>
      </tr>
      ` : ''}
      ${booking.final_payment_date ? `
      <tr>
        <td colspan="2" style="text-align: center; color: #10b981; font-weight: bold; padding: 10px;">
          ✓ EVENT BALANCE FULLY PAID
        </td>
      </tr>
      ` : ''}
    </tbody>
  </table>
  <p style="font-size: 8pt; color: #92400e; margin-top: 8px; padding: 6px; background: #fef3c7; border-radius: 2px;">
    <strong>Important:</strong> The deposit is separate from the event balance and cannot be used towards payment of the event balance. The full event balance remains payable separately.
  </p>
  </div>

  <div class="deposit-section">
    <h3>DEPOSIT INFORMATION</h3>
    <p>To secure the desired date and time for the event, a booking and damage deposit is required. The deposit is paid to secure the booking, remove the agreed date and time from general availability, and protect Orange Jelly Limited, trading as The Anchor, against cancellation, damage, additional cleaning, overtime, unpaid charges, third-party supplier costs and other sums arising from the event.</p>

    <p>The booking is not confirmed until the deposit has been received in cleared funds by Orange Jelly Limited. Before the deposit is paid, Orange Jelly Limited may place a temporary hold on the requested date and time. A temporary hold is provisional only and may be released if the deposit is not received in cleared funds within 14 calendar days, unless Orange Jelly Limited agrees otherwise in writing.</p>

    <p>The deposit may be paid by cash, card, bank transfer or PayPal. Payment of the deposit constitutes acceptance of this Agreement and these Terms and Conditions in full.</p>

    <p>The deposit is separate from and additional to the total event cost. The deposit cannot be used by the Host as payment towards the event balance, bar spend, catering, entertainment, venue hire, supplier charges or any other event cost. The full event balance must be paid separately by the due date stated in this Agreement.</p>

    <p>If the event proceeds as booked, Orange Jelly Limited will refund the deposit within 48 hours after the event, provided that the full event balance has been paid, all charges have been settled, and no deductions are required.</p>

    <p>The Host remains fully responsible for any significant damage, excessive cleaning, unauthorised overtime, unpaid bar tabs, supplier charges, staffing costs, special-order items or other costs arising from the event. Orange Jelly Limited will not charge for ordinary incidental wear and minor glass breakages that are reasonably expected during normal event use. However, significant damage, malicious or accidental damage, specialist cleaning, missing items, unpaid balances, overtime, or costs caused by the Host, their guests, suppliers or entertainers may be deducted from the deposit. If the deposit is not enough to cover the full amount owed, the Host must pay the remaining balance on demand.</p>
  </div>

  <div style="background: #fee2e2; border: 1px solid #dc2626; padding: 10px; margin: 10px 0; border-radius: 3px; font-size: 8pt; page-break-inside: avoid; break-inside: avoid;">
    <h3 style="color: #dc2626; margin-top: 0; font-size: 10pt;">IMPORTANT: SERVICES NOT INCLUDED</h3>
    <p style="margin-bottom: 5px;"><strong>This contract covers ONLY the specific items and services listed above. The following are NOT included unless explicitly itemised in the booking details:</strong></p>
    <ul style="margin-left: 15px; color: #7f1d1d; margin-bottom: 5px;">
      <li><strong>Bar Service:</strong> Drinks must be purchased separately at standard bar prices during your event</li>
      <li><strong>Waiting Staff:</strong> No table service staff are provided unless specifically listed above</li>
      <li><strong>Linens &amp; Decorations:</strong> Table cloths, centrepieces, decorations, etc. are NOT included</li>
      <li><strong>Audio/Visual Equipment:</strong> PA systems, projectors, screens, microphones, etc. must be arranged separately</li>
      <li><strong>Set-up/Clear-down:</strong> Basic venue preparation only - detailed decoration or set-up services are not included</li>
      <li><strong>Music/Entertainment:</strong> No DJ, band, or entertainment provided unless listed as a vendor item above</li>
      <li><strong>Photography/Videography:</strong> No photo or video services included unless contracted separately</li>
      <li><strong>Security:</strong> Additional security staff are not provided as standard</li>
      <li><strong>Additional Hours:</strong> Strictly limited to booked times - extensions charged separately</li>
    </ul>
    <p style="margin-top: 5px; font-weight: bold;">Note: Basic tables and chairs are included with venue hire. If you require any additional services not listed in your booking details above, these must be arranged and paid for separately. Please contact us immediately if you believe any service you require is missing from this contract.</p>
  </div>

  <div class="agreement-section">
    <h3>AGREEMENT</h3>
    <p>I, <strong>${safeCustomerName}</strong>, hereby agree to engage Orange Jelly Limited, operating as The Anchor Pub, to host my event described as "<strong>${safeEventType}</strong>" on <strong>${eventDate}</strong> from <strong>${startTime}</strong> to <strong>${endTime}</strong>. In accordance with the terms of this agreement, I commit to paying the total cost of the event, amounting to <strong>${formatCurrency(total)}</strong>.</p>
    
    <p>To secure this booking, I will pay the booking and damage deposit of <strong>${formatCurrency(depositAmount)}</strong> shown in the booking summary. I understand and agree that the deposit is paid to secure the agreed event date and time, remove that date and time from general availability, and protect Orange Jelly Limited against cancellation, damage, additional cleaning, overtime, unpaid charges, supplier costs and other sums arising from the event.</p>

    <p>I understand that the deposit is separate from and additional to the total event cost. I understand that the deposit cannot be used by me as payment towards the event balance, bar spend, catering, entertainment, venue hire, supplier charges or any other event cost. I must pay the full event balance separately by the due date stated in this Agreement.</p>

    <p>I understand that the full event balance of <strong>${formatCurrency(total)}</strong> and final guest numbers are due no later than <strong>${balanceDueDate}</strong>, which is 14 calendar days before the event date. I understand that failure to pay the full event balance by the due date may result in cancellation of the booking and forfeiture of the deposit, except only where a refund is required by law.</p>

    <p>I understand that if the event proceeds as booked, the deposit will be refunded within 48 hours after the event, provided that the full event balance has been paid, all charges have been settled, and no deductions are required for damage, additional cleaning, overtime, unpaid charges, supplier costs or any other sums owed by me.</p>

    <p>I understand that if I cancel the booking less than 30 calendar days before the event date, fail to attend, fail to pay the full event balance by the due date, or otherwise do not proceed with the event, the deposit will be retained in full, except only where a refund is required by law.</p>

    <p>I understand that if I cancel the booking 30 calendar days or more before the event date, the deposit may be refunded, less a 5% cancellation administration deduction and any direct costs, supplier charges, payment processing costs, staffing costs, special-order items or other charges already incurred or committed by Orange Jelly Limited in connection with the booking.</p>

    <p>By signing below, I, <strong>${safeCustomerName}</strong>, confirm my understanding and agreement to these terms, and commit to upholding my responsibilities as outlined in this agreement.</p>
  </div>

  <div style="background: #f9fafb; border: 1px solid #d1d5db; padding: 10px; margin: 15px 0 10px 0; border-radius: 3px; font-size: 8pt; page-break-inside: avoid; break-inside: avoid;">
    <p>By signing below, paying the deposit, or otherwise confirming the booking in writing, I confirm that I have read, understood and agree to be bound by this Agreement and these Terms and Conditions. I understand that payment of the deposit creates a confirmed booking and that the deposit is subject to the cancellation, payment, damage and deduction terms set out in this Agreement.</p>
  </div>

  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-line"></div>
      <p><strong>Host Name:</strong> ${safeCustomerName}</p>
      <p><strong>Date:</strong> ${formatDate(new Date().toISOString())}</p>
    </div>
    <div class="signature-box">
      <div class="signature-line"></div>
      <p><strong>For The Anchor Pub (Orange Jelly Limited)</strong></p>
      <p><strong>Date:</strong> ${formatDate(new Date().toISOString())}</p>
    </div>
  </div>

  <div class="page-break"></div>

  <div class="terms-section">
    <h2>TERMS & CONDITIONS</h2>
    
    <h3>Reservation and Deposit</h3>
    <ul>
      <li>All event bookings require a booking and damage deposit, as specified in the booking details above.</li>
      <li>Before the deposit is paid, Orange Jelly Limited may place a temporary hold on the requested date and time. A temporary hold is provisional only and does not create a confirmed booking. Unless Orange Jelly Limited agrees otherwise in writing, a temporary hold may be released if the deposit is not received in cleared funds within 14 calendar days.</li>
      <li>The booking is confirmed only when Orange Jelly Limited has received the deposit in cleared funds. Once the deposit has been received, Orange Jelly Limited may remove the agreed date and time from general availability and may decline other enquiries or bookings for that date and time.</li>
      <li>The deposit is paid to secure the agreed event date and time and to protect Orange Jelly Limited against cancellation, damage, additional cleaning, overtime, unpaid charges, third-party supplier costs and other sums arising from the event.</li>
      <li>The deposit is separate from and additional to the total event cost. The Host may not use the deposit as payment towards the event balance, bar spend, catering, entertainment, venue hire, supplier charges or any other event cost. The full event balance remains payable separately by the due date stated in this Agreement.</li>
      <li>If the event proceeds as booked, the deposit will be refunded within 48 hours after the event, provided that the full event balance has been paid, all charges have been settled, and no deductions are required.</li>
      <li>Orange Jelly Limited may deduct from the deposit any sums owed by the Host, including but not limited to damage, specialist cleaning, missing items, unpaid balances, unpaid bar tabs, overtime, supplier costs, staffing costs, special-order items, cancellation costs and any other charges arising from the event. If the deposit is not enough to cover the sums owed, the Host must pay the remaining balance on demand.</li>
    </ul>

    <h3>Cancellation Policy</h3>
    <ul>
      <li>The Host may cancel the event only by giving written notice to Orange Jelly Limited. The cancellation date will be the date on which Orange Jelly Limited receives the written notice.</li>
      <li>If the Host cancels the booking 30 calendar days or more before the event date, the deposit may be refunded, less a 5% cancellation administration deduction and any direct costs, supplier charges, payment processing costs, staffing costs, special-order items or other charges already incurred or committed by Orange Jelly Limited in connection with the booking.</li>
      <li>If the Host cancels the booking less than 30 calendar days before the event date, the deposit will be retained in full, except only where a refund is required by law. This is because Orange Jelly Limited may have removed the date from availability, declined other enquiries, committed staff, ordered stock, arranged suppliers, incurred administrative time, or suffered loss of opportunity.</li>
      <li>If the Host fails to attend, fails to pay the full event balance by the due date, fails to confirm final guest numbers by the due date, or otherwise does not proceed with the event, Orange Jelly Limited may treat the booking as cancelled by the Host and may retain the deposit in full, except only where a refund is required by law.</li>
      <li>Cancellation by the Host does not release the Host from responsibility for any other sums that are already due or have already been incurred in connection with the event, including third-party supplier costs, entertainer costs, special-order items, staffing costs, stock ordered specifically for the event, or any other costs committed to by Orange Jelly Limited or its suppliers.</li>
      <li>If Orange Jelly Limited is able to secure another booking for the same date following the Host's cancellation, Orange Jelly Limited may refund an appropriate additional amount of the deposit after deducting any costs, losses, charges or administration arising from the cancellation or change. The Host acknowledges that a replacement booking may not be possible, particularly where cancellation is close to the event date.</li>
      <li>Where required by law, Orange Jelly Limited will take reasonable steps to reduce its losses, including attempting to re-sell the date where reasonably practical.</li>
    </ul>

    <h3>Date Changes</h3>
    <ul>
      <li>The Host may request a change of event date by giving written notice to Orange Jelly Limited.</li>
      <li>Date changes are subject to availability and are not guaranteed. Orange Jelly Limited is under no obligation to agree to a date change unless it confirms the change in writing.</li>
      <li>Where the Host requests a date change at least 14 calendar days before the event date, Orange Jelly Limited will use reasonable efforts to accommodate the request where a suitable alternative date is available.</li>
      <li>Any financial impact arising from a date change will be payable by the Host. This includes but is not limited to supplier charges, entertainer charges, staffing costs, stock costs, special-order items, administration, price increases and any other costs incurred or committed by Orange Jelly Limited as a result of the change.</li>
      <li>Orange Jelly Limited may deduct any such costs from the deposit. If the deposit is not enough to cover the costs, the Host must pay the remaining balance on demand.</li>
      <li>A request to change the date less than 14 calendar days before the event date may be refused and may be treated as a cancellation by the Host. In that case, the cancellation policy will apply.</li>
    </ul>

    <h3>Payment</h3>
    <ul>
      <li>The full event balance must be paid no later than 14 calendar days before the scheduled event date, unless Orange Jelly Limited agrees otherwise in writing.</li>
      <li>Final guest numbers, catering requirements, dietary requirements, accessibility requirements and any other final event details must also be confirmed no later than 14 calendar days before the scheduled event date.</li>
      <li>The deposit is payable to secure the booking. Payment of the deposit constitutes acceptance of this Agreement and these Terms and Conditions in full.</li>
      <li>The deposit is separate from and additional to the event balance. The Host may not use the deposit as payment towards the event balance or any other event charge. The full event balance must be paid separately by the due date.</li>
      <li>If the full event balance is not paid by the due date, Orange Jelly Limited may treat the booking as cancelled by the Host. In that case, the deposit may be retained in full, except only where a refund is required by law. Orange Jelly Limited may also recover any further losses, costs or charges arising from the non-payment or cancellation.</li>
    </ul>

    <h3>Final Guest Numbers, Catering and Event Details</h3>
    <ul>
      <li>Final guest numbers must be confirmed no later than 14 calendar days before the event date.</li>
      <li>Once final guest numbers have been confirmed, Orange Jelly Limited may commit to staffing, catering, stock, suppliers and other event arrangements on the basis of those numbers.</li>
      <li>If guest numbers reduce after the 14 calendar day deadline, Orange Jelly Limited is not obliged to reduce the event balance, particularly where catering, staffing, stock or supplier commitments have already been made.</li>
      <li>Any increase in guest numbers after the 14 calendar day deadline is subject to availability and may result in additional charges. Orange Jelly Limited is not obliged to accommodate late increases.</li>
      <li>All allergies, dietary requirements and accessibility requirements must be provided as early as possible and no later than 14 calendar days before the event date. Orange Jelly Limited will use reasonable efforts to accommodate requirements notified by the deadline, but cannot guarantee accommodation of requirements notified late.</li>
    </ul>

    <h3>Age Restrictions</h3>
    <ul>
      <li>We adhere to the Challenge25 policy. Those appearing under 25 will be asked to present valid ID to purchase alcohol. Those unable to provide adequate proof of age will be denied service in compliance with the law.</li>
    </ul>

    <h3>Liability</h3>
    <ul>
      <li>Nothing in this Agreement limits or excludes Orange Jelly Limited's liability for death or personal injury caused by its negligence, fraud or fraudulent misrepresentation, or any other liability that cannot lawfully be limited or excluded.</li>
      <li>Subject to the above, Orange Jelly Limited will not be responsible for loss, damage, injury, delay or disruption caused by the Host, their guests, external suppliers, entertainers, contractors, or any matter outside Orange Jelly Limited's reasonable control.</li>
      <li>The Host is responsible for the conduct of their guests, suppliers, entertainers and contractors during the event. The Host agrees to indemnify Orange Jelly Limited against claims, losses, damages, liabilities, costs and expenses arising from any act or omission by the Host, their guests, suppliers, entertainers or contractors.</li>
    </ul>

    <h3>What's Included and Not Included</h3>
    <ul>
      <li>Only the specific items, services, and vendors explicitly listed in the "Booking Items" section of this contract are included in your booking.</li>
      <li>The venue provides the physical space only, unless additional services are itemized above.</li>
      <li>All drinks must be purchased from the bar at standard prices - no drinks are included unless specifically contracted.</li>
      <li>Clients are responsible for arranging any services not explicitly listed in this contract.</li>
    </ul>

    <h3>External Catering & Provisions</h3>
    <ul>
      <li>Any external caterers must be pre-approved by Orange Jelly Limited prior to the event. External caterers must provide evidence of their own public liability insurance and all relevant certifications. They should also conform to our set hygiene standards. Any non-compliance may result in denial of entry to the premises.</li>
      <li>We do not provide any catering facilities, nor do we have fridge or freezer storage for external caterers. All necessary provisions, including equipment and storage, should be arranged by the external caterer or host.</li>
      <li>Any allergies or dietary requirements should be communicated to us at the point of event booking. Please be aware that there may be additional costs to provide specific dietary catering options beyond those advertised.</li>
    </ul>

    <h3>Entertainment & Equipment</h3>
    <ul>
      <li>All entertainers brought in by the Host must be pre-approved by Orange Jelly Limited and must provide evidence of public liability insurance where requested.</li>
      <li>Any equipment that requires electricity, including but not limited to DJ equipment, live band equipment, lighting, sound systems and bouncy castles, must be approved by Orange Jelly Limited in advance.</li>
      <li>Electrical equipment must be PAT tested where applicable and must be safe, suitable and properly maintained.</li>
      <li>Any equipment requiring electricity may incur a standing charge for power use, as specified by Orange Jelly Limited.</li>
    </ul>

    <h3>Decoration and Setup</h3>
    <ul>
      <li>Any plans to decorate the premises must be agreed upon in advance with Orange Jelly Limited. Unapproved items such as certain furniture, entertainment gear, or decorations are not permitted.</li>
      <li>The use of open flames, nails, thumbtacks, and cello tape on paint or wallpaper is strictly prohibited.</li>
      <li>All set-up and decoration must be completed within the allocated one hour before and after the event booking. Any extra time or unapproved deviations will result in additional hourly charges.</li>
    </ul>

    <h3>Licensing and Conduct</h3>
    <ul>
      <li>Supply of alcohol: 11.00 to 00.00 Monday to Thursday; 11.00 to 01.00 Fridays and Saturdays; 12.00 to 23.30 on Sundays.</li>
      <li>Live music/provision of facilities for dancing: 19.30 to 00.00 Monday to Saturday; 19.30 to 23.30 on Sundays.</li>
      <li>Recorded music: 11.00 to 00.00 Monday to Saturday; 12.00 to 23.30 on Sundays.</li>
      <li>Late night Refreshment: 23.00 to 00.30 Monday to Thursday; 23.00 to 01.30 Friday and Saturday, and 23.00 to 00.00 on Sundays.</li>
      <li>Guests are expected to conduct themselves respectfully and be considerate of our neighbours, given our location within a village.</li>
    </ul>

    <h3>Additional Charges & Overtime</h3>
    <ul>
      <li>If an event goes beyond the agreed-upon timeframe, additional hourly rates will apply and will be payable by the Host on demand.</li>
      <li>In cases where specific services or provisions are required outside of our standard offerings, additional charges may apply.</li>
    </ul>

    <h3>Allergies & Dietary Restrictions</h3>
    <ul>
      <li>We endeavour to cater to a wide range of dietary requirements. However, any allergies or specific dietary needs must be communicated to us at the time of event booking.</li>
      <li>While we strive to accommodate all guests, there may be additional costs associated with providing specific dietary catering options beyond those advertised. It's always best to discuss these needs in advance to ensure a smooth and satisfactory service on the day of the event.</li>
    </ul>

    <h3>Intellectual Property</h3>
    <ul>
      <li>Organisations and hosts are not permitted to use the logo or any branding associated with Orange Jelly Limited or The Anchor without explicit written permission. All intellectual property rights remain with Orange Jelly Limited.</li>
    </ul>

    <h3>Force Majeure</h3>
    <ul>
      <li>Neither party shall be held liable or responsible to the other party nor be deemed to have defaulted under or breached this Agreement for failure or delay in fulfilling or performing any term of this Agreement to the extent, and for so long as, such failure or delay is caused by or results from causes beyond the reasonable control of the affected party including but not limited to fire, floods, embargoes, war, acts of war (whether war is declared or not), acts of terrorism, insurrections, riots, civil commotions, strikes, lockouts or other labour disturbances, acts of God or acts, omissions or delays in acting by any governmental authority or the other party.</li>
      <li>In the event that the event cannot proceed due to force majeure, Orange Jelly Limited may, where reasonably possible, offer the Host an alternative date. If an alternative date cannot reasonably be agreed, any refund will be assessed in accordance with applicable law, taking into account any costs already incurred, work already carried out, third-party commitments, supplier costs, staffing costs, special-order items and the status of the booking deposit.</li>
    </ul>

    <h3>Indemnification & Liability</h3>
    <ul>
      <li>The Host agrees to indemnify and hold harmless Orange Jelly Limited, its affiliates, and their respective directors, officers, employees and agents from and against any claims, losses, damages, liabilities, judgements, fees, costs and expenses related to or arising out of any act or omission by the Host, their guests, suppliers, entertainers or contractors.</li>
      <li>Nothing in this Agreement limits or excludes Orange Jelly Limited's liability for death or personal injury caused by its negligence, fraud or fraudulent misrepresentation, or any other liability that cannot lawfully be limited or excluded.</li>
      <li>Subject to the above, Orange Jelly Limited's total liability for any claim arising out of or in connection with the organisation or hosting of an event shall be limited to the amount paid by the Host for the event.</li>
    </ul>

    <h3>Event Insurance</h3>
    <ul>
      <li>While not mandatory, hosts are encouraged to consider securing event insurance to cover potential unforeseen costs or damages. This can provide additional peace of mind and protection for both the host and their guests.</li>
    </ul>

    <h3>Dispute Resolution & Governing Law</h3>
    <ul>
      <li>This Agreement shall be governed by and construed in accordance with the laws of England and Wales.</li>
      <li>Any dispute arising under or in connection with this Agreement shall be resolved through good faith negotiations between the parties. If the dispute cannot be resolved through negotiations, it shall be submitted to a competent court in England and Wales.</li>
    </ul>
  </div>

  <div class="footer">
    <p><strong>${escapeHtml(companyDetails?.name || 'Orange Jelly Limited')}</strong></p>
    <p>Trading as The Anchor Pub</p>
    ${companyDetails?.registrationNumber ? `<p>Company Registration No: ${escapeHtml(companyDetails.registrationNumber)}</p>` : ''}
    ${companyDetails?.vatNumber ? `<p>VAT Registration No: ${escapeHtml(companyDetails.vatNumber)}</p>` : ''}
    <p>${escapeHtml(companyDetails?.address || 'High Street, Location')}</p>
    <p>Phone: ${escapeHtml(companyDetails?.phone || process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682 707')}</p>
    <p>${escapeHtml(companyDetails?.email || 'manager@the-anchor.pub')}</p>
    <p>Website: management.orangejelly.co.uk</p>
  </div>
</body>
</html>
  `
}
