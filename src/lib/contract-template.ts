import { PrivateBookingWithDetails, PrivateBookingItem } from '@/types/private-bookings'

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
    if (!date) return 'To be confirmed'
    return new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  const formatTime = (time: string | null) => {
    if (!time) return 'To be confirmed'
    return time.substring(0, 5)
  }

  const formatCurrency = (amount: number) => {
    return `£${amount.toFixed(2)}`
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
  const eventDate = formatDate(booking.event_date)
  const startTime = formatTime(booking.start_time)
  const endTime = formatTime(booking.end_time || null)
  const eventType = booking.event_type || 'To be confirmed'
  const guestCount = booking.guest_count || 'To be confirmed'
  const depositAmount = booking.deposit_amount || 250
  const subtotal = calculateSubtotal()
  const discountAmount = calculateDiscountAmount()
  const total = calculateTotal()
  // Balance due is the total event cost (deposit is separate and refundable)
  const balanceDue = booking.final_payment_date ? 0 : total
  
  // Calculate balance due date (7 days before event)
  let balanceDueDate = 'To be confirmed'
  if (booking.event_date) {
    const eventDateObj = new Date(booking.event_date)
    const dueDate = new Date(eventDateObj.getTime() - (7 * 24 * 60 * 60 * 1000))
    balanceDueDate = formatDate(dueDate.toISOString())
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
  <title>Private Booking Contract - ${customerName}</title>
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
    ${logoUrl ? `<img src="${logoUrl}" alt="The Anchor Logo" class="logo">` : ''}
    <h1>PRIVATE BOOKING CONTRACT</h1>
  </div>

  <div class="contract-info">
    <p><strong>Contract Reference:</strong> PB-${booking.id.slice(0, 8).toUpperCase()}</p>
    <p><strong>Date Generated:</strong> ${formatDate(new Date().toISOString())}</p>
  </div>

  <div class="info-grid">
    <div class="info-section">
      <h3>Customer Details</h3>
      <p><strong>Name:</strong> ${customerName}</p>
      ${booking.contact_phone ? `<p><strong>Phone:</strong> ${booking.contact_phone}</p>` : ''}
      ${booking.contact_email ? `<p><strong>Email:</strong> ${booking.contact_email}</p>` : ''}
    </div>
    
    <div class="info-section">
      <h3>Event Details</h3>
      <p><strong>Date:</strong> ${eventDate}</p>
      <p><strong>Time:</strong> ${startTime} to ${endTime}</p>
      ${booking.setup_time ? `<p><strong>Setup Time:</strong> ${formatTime(booking.setup_time)}</p>` : ''}
      <p><strong>Expected Guests:</strong> ${guestCount}</p>
      <p><strong>Event Type:</strong> ${eventType}</p>
    </div>
  </div>

  ${booking.special_requirements || booking.accessibility_needs ? `
  <div class="info-section" style="margin-bottom: 30px;">
    <h3>Special Requirements</h3>
    ${booking.special_requirements ? `<p><strong>Event Requirements:</strong> ${booking.special_requirements}</p>` : ''}
    ${booking.accessibility_needs ? `<p><strong>Accessibility Needs:</strong> ${booking.accessibility_needs}</p>` : ''}
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
              ${item.description}
              ${hasDiscount ? `
                <br/><small class="discount-note">
                  <strong>✓ Discount: ${item.discount_type === 'percent' ? `${item.discount_value}% off` : `£${item.discount_value} off`}</strong>
                  ${item.notes ? ` - ${item.notes}` : ''}
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
              ${item.description}
              ${hasDiscount ? `
                <br/><small class="discount-note">
                  <strong>✓ Discount: ${item.discount_type === 'percent' ? `${item.discount_value}% off` : `£${item.discount_value} off`}</strong>
                  ${item.notes ? ` - ${item.notes}` : ''}
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
        ${vendorItems.map((item: any) => `
          <tr>
            <td>${item.description}</td>
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
        ${otherItems.map((item: any) => `
          <tr>
            <td>${item.description}</td>
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
            ${booking.discount_reason ? `<br/><small style="font-weight: normal; color: #059669;">Reason: ${booking.discount_reason}</small>` : ''}
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
      <tr style="background: #e0f2fe;">
        <td style="padding: 10px; border: 1px solid #0284c7;">
          <strong style="color: #0c4a6e;">Refundable Security Deposit</strong>
          <br/><small style="color: #0369a1;">Returned after event (subject to terms)</small>
        </td>
        <td style="text-align: right; padding: 10px; border: 1px solid #0284c7; color: #0c4a6e;">
          <strong>${formatCurrency(depositAmount)}</strong>
          ${booking.deposit_paid_date ? `<br/><small style="color: #0369a1;">Paid ${formatDate(booking.deposit_paid_date)}</small>` : `<br/><small style="color: #dc2626;">Not yet paid</small>`}
        </td>
      </tr>
      <tr class="total-row">
        <td><strong>Balance Due for Event</strong></td>
        <td style="text-align: right;"><strong>${formatCurrency(balanceDue)}</strong></td>
      </tr>
      ${!booking.final_payment_date && total > 0 ? `
      <tr>
        <td colspan="2" style="text-align: right; font-size: 10pt; color: #666;">
          Balance due by: ${balanceDueDate} (7 days before event)
        </td>
      </tr>
      ` : ''}
      ${booking.final_payment_date ? `
      <tr>
        <td colspan="2" style="text-align: center; color: #10b981; font-weight: bold; padding: 10px;">
          ✓ FULLY PAID - Thank you!
        </td>
      </tr>
      ` : ''}
    </tbody>
  </table>
  </div>

  <div class="deposit-section">
    <h3>DEPOSIT INFORMATION</h3>
    <p>To secure your desired date for the event and to cover any potential damages that may occur during your event, a deposit is required. This deposit is both a date reservation fee and a security measure against damage. Please note that we do not charge for incidental damages, such as minor glass breakages, which are understood to happen during normal event usage. However, we will deduct charges from the deposit for any significant damages requiring repairs or special cleaning.</p>
    
    <p>The deposit must be paid in cash and is essential for the final confirmation of your booking. This approach ensures we can manage any repair costs directly and expediently, should they arise. We aim to return the deposit within 48 hours following the conclusion of your event. This timeframe allows us ample opportunity to thoroughly clean and inspect the space, ensuring everything is in order before we release the deposit. We appreciate your understanding and cooperation in helping us maintain The Anchor Pub in the best possible condition for all our patrons and events.</p>
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
    <p>I, <strong>${customerName}</strong>, hereby agree to engage Orange Jelly Limited, operating as The Anchor Pub, to host my event described as "<strong>${eventType}</strong>" on <strong>${eventDate}</strong> from <strong>${startTime}</strong> to <strong>${endTime}</strong>. In accordance with the terms of this agreement, I commit to paying the total cost of the event, amounting to <strong>${formatCurrency(total)}</strong>.</p>
    
    <p>To secure this booking, I will pay a refundable security deposit of <strong>${formatCurrency(depositAmount)}</strong> in cash. This deposit is to cover any potential damages from the event and is <strong>separate from and additional to</strong> the total event cost. The deposit will be returned within 48 hours after the event's conclusion, provided that no significant damages occur beyond normal wear and incidental breakages.</p>
    
    <p>The total event cost of <strong>${formatCurrency(total)}</strong> is due no later than <strong>${balanceDueDate}</strong>, which is 7 days before the event date. This payment is for the booking items and services only, and does not include the refundable security deposit. I understand that failure to pay the full amount by this due date may result in the cancellation of my event without a refund of my deposit.</p>
    
    <p>By signing below, I, <strong>${customerName}</strong>, confirm my understanding and agreement to these terms, and commit to upholding my responsibilities as outlined in this agreement.</p>
  </div>

  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-line"></div>
      <p><strong>Host Name:</strong> ${customerName}</p>
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
      <li>All event bookings require a £250 cash deposit to secure the desired date and time.</li>
      <li>The deposit serves to cover any damages that may arise from the event, with minor breakages (e.g., glassware) being exempted. Significant damages, be they malicious or accidental, will result in deductions from the deposit.</li>
      <li>Deposits will be returned within 48 hours following the event's conclusion, allowing for a thorough review of the premises and any cleaning or damage assessments.</li>
    </ul>

    <h3>Cancellation Policy</h3>
    <ul>
      <li>If an event is cancelled, the deposit becomes non-refundable.</li>
      <li>The host assumes responsibility for any cancellation fees tied to third-party vendors or entertainers if the event is cancelled beyond the stipulated cancellation policy of those entities.</li>
    </ul>

    <h3>Payment</h3>
    <ul>
      <li>All payments associated with the event must be settled no less than 7 days before the scheduled event date.</li>
    </ul>

    <h3>Age Restrictions</h3>
    <ul>
      <li>We adhere to the Challenge25 policy. Those appearing under 25 will be asked to present valid ID to purchase alcohol. Those unable to provide adequate proof of age will be denied service in compliance with the law.</li>
    </ul>

    <h3>Liability</h3>
    <ul>
      <li>Orange Jelly Limited, trading as The Anchor, will not be held liable for any injuries or accidents that transpire during the event, except in cases where gross negligence on our part can be proven. By agreeing to these terms, the host pledges to indemnify and exempt Orange Jelly Limited from claims, damages, losses, and expenses stemming from the event.</li>
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
      <li>All entertainers brought in by the host must be pre-approved and must present evidence of their public liability insurance.</li>
      <li>Any equipment that requires electricity, including but not limited to bouncy castles, DJs, live bands, etc., will incur a £25 standing charge for power use. All equipment must undergo PAC testing and be approved in advance.</li>
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
      <li>If an event goes beyond the agreed-upon timeframe, additional hourly rates will apply, and these charges can be deducted from the deposit if not settled by the host.</li>
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
      <li>In the event of a cancellation due to force majeure, Orange Jelly Limited will provide a full refund minus any costs already borne by the company in preparation for the event.</li>
    </ul>

    <h3>Indemnification & Liability</h3>
    <ul>
      <li>The host agrees to indemnify and hold harmless Orange Jelly Limited, its affiliates, and their respective directors, officers, employees, and agents from and against any and all claims, losses, damages, liabilities, judgements, fees, costs, and expenses (including reasonable solicitors' fees and costs) related to or arising out of any act or omission by the host, their guests, or their vendors.</li>
      <li>Orange Jelly Limited's total liability for any claim arising out of or in connection with the organisation or hosting of an event shall be limited to the amount paid by the host for the event.</li>
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
    <p><strong>${companyDetails?.name || 'Orange Jelly Limited'}</strong></p>
    <p>Trading as The Anchor Pub</p>
    ${companyDetails?.registrationNumber ? `<p>Company Registration No: ${companyDetails.registrationNumber}</p>` : ''}
    ${companyDetails?.vatNumber ? `<p>VAT Registration No: ${companyDetails.vatNumber}</p>` : ''}
    <p>${companyDetails?.address || 'High Street, Location'}</p>
    <p>Phone: ${companyDetails?.phone || process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682 707'}</p>
    <p>${companyDetails?.email || 'manager@the-anchor.pub'}</p>
    <p>Website: management.orangejelly.co.uk</p>
  </div>
</body>
</html>
  `
}