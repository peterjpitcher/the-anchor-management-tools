import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'

/**
 * Staff event sheet (SOP pack §29) — an internal, print-friendly A4 run
 * sheet for the duty manager and staff. NOT customer-facing.
 *
 * §29's closing rule drives the data shape: do not put more sensitive
 * personal information on the sheet than staff need to run the event
 * safely. Allergy/dietary and accessibility notes are included (staff need
 * them) but are marked as sensitive / need-to-know.
 */

export type EventSheetSupplier = {
  name: string
  supplierType: string | null
  contactDetails: string | null
  arrivalTime: string | null
  departureTime: string | null
  vehicleNotes: string | null
  powerRequirements: string | null
  documentsRequired: string[]
  documentsReceived: string[]
  status: string
}

export type EventSheetItem = {
  itemType: string
  description: string
  quantity: number
  spaceName: string | null
  packageName: string | null
  vendorName: string | null
}

export type EventSheetData = {
  bookingId: string
  bookingStatus: string
  hostName: string | null
  contactPhone: string | null
  eventType: string | null
  eventDate: string
  startTime: string | null
  endTime: string | null
  endTimeNextDay: boolean
  setupDate: string | null
  setupTime: string | null
  cleardownTime: string | null
  guestCount: number | null
  guestCountAdults: number | null
  guestCountUnder18: number | null
  layout: string | null
  items: EventSheetItem[]
  barTabRequired: boolean
  barTabLimit: number | null
  barTabPrepaidAmount: number | null
  barTabPreauthReference: string | null
  accessibilityNotes: string | null
  dietaryNotes: string | null
  outsideFood: boolean
  waiverStatus: string
  supplierStatus: string
  suppliers: EventSheetSupplier[]
  highPowerEquipment: boolean
  highPowerEquipmentApprovedAt: string | null
  decorationsPlan: string | null
  dogsExpected: boolean
  riskStatus: string
  specialRiskNotes: string | null
  depositAmount: number | null
  depositStatus: string | null
  paymentStatus: string | null
  grossTotal: number | null
  totalBalancePaid: number | null
  balanceRemaining: number | null
  balanceDueDate: string | null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function text(value: string | null | undefined, fallback = '—'): string {
  const trimmed = value?.trim()
  return trimmed ? escapeHtml(trimmed) : fallback
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `£${value.toFixed(2)}`
}

function time(value: string | null | undefined): string {
  if (!value) return 'TBC'
  return escapeHtml(formatTime12Hour(value))
}

function date(value: string | null | undefined): string {
  if (!value) return 'TBC'
  return escapeHtml(
    formatDateInLondon(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  )
}

function checklist(items: string[]): string {
  return `<ul class="checklist">${items
    .map((item) => `<li><span class="box"></span>${escapeHtml(item)}</li>`)
    .join('')}</ul>`
}

function buildBlockers(data: EventSheetData): string[] {
  const blockers: string[] = []
  if (data.waiverStatus === 'required' || data.waiverStatus === 'sent') {
    blockers.push('Self-catering waiver is NOT signed — outside food must not be served until it is')
  }
  if (data.supplierStatus === 'incomplete') {
    blockers.push('Supplier documents incomplete — unapproved suppliers may be refused entry')
  }
  if ((data.balanceRemaining ?? 0) > 0) {
    blockers.push(`Balance outstanding: ${money(data.balanceRemaining)} still due`)
  }
  if (data.riskStatus === 'high' || data.riskStatus === 'gm_approval_required') {
    blockers.push('Risk review required — escalate to the General Manager before the event runs')
  }
  return blockers
}

const END_OF_EVENT_CHECKLIST = [
  'Stop licensable activities within authorised hours',
  'Close or settle the bar tab',
  'Check suppliers clear down within one hour',
  'Check outside food and rubbish removed',
  'Check decorations removed',
  'Complete initial walk-through',
  'Record obvious damage or incident notes',
  'Do not promise a full deposit refund until the 48-hour cleaning and inspection window is complete',
]

const POST_EVENT_INSPECTION_CHECKLIST = [
  'Full cleaning and inspection completed within 48 hours of the event',
  'Any damage or issues documented with photos, staff notes, receipts or estimates',
  'Proposed deductions discussed with the customer before deducting',
  'Deductions approved or rejected by the General Manager',
  'Itemised deduction explanation sent to the customer',
  'Remaining deposit refund processed (same payment method where possible)',
  'Booking marked completed',
]

const LICENSING_HOURS: Array<{ activity: string; times: string }> = [
  { activity: 'Supply of alcohol', times: '11:00–00:00 Mon–Thu; 11:00–01:00 Fri–Sat; 12:00–23:30 Sun' },
  { activity: 'Live music & dancing facilities', times: '19:30–00:00 Mon–Sat; 19:30–23:30 Sun' },
  { activity: 'Recorded music', times: '11:00–00:00 Mon–Sat; 12:00–23:30 Sun' },
  { activity: 'Late night refreshment', times: '23:00–00:30 Mon–Thu; 23:00–01:30 Fri–Sat; 23:00–00:00 Sun' },
  { activity: 'Opening hours', times: '08:00–00:30 Mon–Thu; 08:00–01:30 Fri–Sat; 11:00–00:00 Sun' },
]

export function generateEventSheetHTML(data: EventSheetData): string {
  const blockers = buildBlockers(data)
  const bookingRef = data.bookingId.slice(0, 8).toUpperCase()

  const spaceItems = data.items.filter((item) => item.itemType === 'space')
  const cateringItems = data.items.filter((item) => item.itemType === 'catering')
  const otherItems = data.items.filter((item) => item.itemType === 'other')
  const vendorItems = data.items.filter((item) => item.itemType === 'vendor')

  const spacesText =
    spaceItems.length > 0
      ? spaceItems.map((item) => escapeHtml(item.spaceName ?? item.description)).join(', ')
      : 'No space recorded'

  const guestSplit: string[] = []
  if (data.guestCountAdults !== null && data.guestCountAdults !== undefined) {
    guestSplit.push(`${data.guestCountAdults} adults`)
  }
  if (data.guestCountUnder18 !== null && data.guestCountUnder18 !== undefined) {
    guestSplit.push(`${data.guestCountUnder18} under-18s`)
  }

  const setupWindow = `${date(data.setupDate ?? data.eventDate)}, ${
    data.setupTime ? time(data.setupTime) : `${time(data.startTime)} minus 1 hour (standard access)`
  } until ${time(data.startTime)}`
  const cleardownWindow = data.cleardownTime
    ? `Until ${time(data.cleardownTime)}${data.endTimeNextDay ? ' (next day)' : ''}`
    : `One hour after the booked end time (standard)${data.endTimeNextDay ? ' — event ends next day' : ''}`

  const cateringRows =
    cateringItems.length + otherItems.length > 0
      ? [...cateringItems, ...otherItems]
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.packageName ?? item.description)}</td><td>${item.quantity}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="2">No packages or catering selections recorded</td></tr>'

  const supplierRows =
    data.suppliers.length > 0
      ? data.suppliers
          .map((supplier) => {
            const missingDocs = supplier.documentsRequired.filter(
              (doc) => !supplier.documentsReceived.includes(doc)
            )
            const docsText =
              supplier.documentsRequired.length === 0
                ? '—'
                : missingDocs.length === 0
                  ? 'All received'
                  : `Missing: ${missingDocs.map(escapeHtml).join(', ')}`
            return `<tr>
              <td>${text(supplier.name)}${supplier.supplierType ? ` <span class="muted">(${escapeHtml(supplier.supplierType)})</span>` : ''}</td>
              <td>${time(supplier.arrivalTime)}–${time(supplier.departureTime)}</td>
              <td>${docsText}</td>
              <td class="status status-${escapeHtml(supplier.status)}">${escapeHtml(supplier.status.toUpperCase())}</td>
            </tr>`
          })
          .join('')
      : '<tr><td colspan="4">No external suppliers recorded</td></tr>'

  const entertainmentText =
    vendorItems.length > 0
      ? vendorItems.map((item) => escapeHtml(item.vendorName ?? item.description)).join(', ')
      : 'None recorded'

  const electricityText = data.highPowerEquipment
    ? data.highPowerEquipmentApprovedAt
      ? 'High-power equipment APPROVED — £25 electricity charge applies'
      : 'High-power equipment declared — approval PENDING (£25 electricity charge applies once approved)'
    : 'No high-power equipment declared'

  const barTabText = data.barTabRequired
    ? `Bar tab agreed. Limit: ${money(data.barTabLimit)}. Pre-paid: ${money(data.barTabPrepaidAmount)}. Pre-auth ref: ${text(data.barTabPreauthReference, 'none')}. Close or settle at end of event.`
    : 'No bar tab arranged — guests pay as they go. Bar tabs must be pre-arranged with the General Manager.'

  const selfCateringText = data.outsideFood
    ? `Outside food IS involved. Waiver status: ${escapeHtml(data.waiverStatus.toUpperCase())}. No kitchen access, heating, or refrigeration; host removes food and rubbish at the end.`
    : `No outside food approved. Waiver status: ${escapeHtml(data.waiverStatus.toUpperCase())}. No external food or drink without prior written approval.`

  const riskLine = `${escapeHtml(data.riskStatus.toUpperCase())}${data.dogsExpected ? ' — dogs expected on site' : ''}`

  const incidentRows = Array.from({ length: 6 })
    .map(
      () =>
        '<tr><td class="fill-line"></td><td class="fill-line"></td><td class="fill-line"></td><td class="fill-line"></td></tr>'
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Event Sheet — ${escapeHtml(bookingRef)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1.5px solid #111; padding-bottom: 3px; margin: 14px 0 6px; }
  .subtitle { color: #444; margin: 0 0 10px; }
  .banner { border: 2.5px solid #b91c1c; color: #b91c1c; padding: 8px 10px; margin: 10px 0; }
  .banner strong { display: block; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .banner ul { margin: 0; padding-left: 18px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
  .kv td:first-child { width: 32%; font-weight: 600; background: #f6f6f6; }
  .grid { display: flex; gap: 12px; }
  .grid > div { flex: 1; }
  .sensitive { border: 1.5px dashed #92400e; background: #fffbeb; padding: 6px 8px; }
  .sensitive .tag { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #92400e; letter-spacing: 0.05em; }
  .muted { color: #666; font-weight: 400; }
  .checklist { list-style: none; margin: 2px 0; padding: 0; }
  .checklist li { margin: 3px 0; }
  .box { display: inline-block; width: 10px; height: 10px; border: 1.5px solid #111; margin-right: 6px; vertical-align: -1px; }
  .notes-box { border: 1px solid #999; height: 70px; }
  .fill-line { height: 18px; }
  .status { font-weight: 700; }
  .status-approved { color: #166534; }
  .status-rejected, .status-incomplete { color: #b91c1c; }
  .footer { margin-top: 14px; font-size: 9px; color: #555; border-top: 1px solid #999; padding-top: 6px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Staff Event Sheet — Booking ${escapeHtml(bookingRef)}</h1>
  <p class="subtitle">The Anchor — internal staff document. Booking status: ${escapeHtml(data.bookingStatus.toUpperCase())}. Not for customers.</p>

  ${
    blockers.length > 0
      ? `<div class="banner"><strong>Blockers — resolve before the event runs</strong><ul>${blockers
          .map((blocker) => `<li>${escapeHtml(blocker)}</li>`)
          .join('')}</ul></div>`
      : ''
  }

  <h2>Booking &amp; Host</h2>
  <table class="kv">
    <tr><td>Booking reference</td><td>${escapeHtml(bookingRef)}</td></tr>
    <tr><td>Host name</td><td>${text(data.hostName)}</td></tr>
    <tr><td>Host contact number</td><td>${text(data.contactPhone)}</td></tr>
    <tr><td>Event type</td><td>${text(data.eventType)}</td></tr>
    <tr><td>Event date &amp; time</td><td>${date(data.eventDate)}, ${time(data.startTime)}–${time(data.endTime)}${data.endTimeNextDay ? ' (next day)' : ''}</td></tr>
    <tr><td>Setup window</td><td>${setupWindow}</td></tr>
    <tr><td>Clear-down window</td><td>${cleardownWindow}</td></tr>
    <tr><td>Space(s) booked</td><td>${spacesText}</td></tr>
  </table>

  <h2>Guests &amp; Layout</h2>
  <table class="kv">
    <tr><td>Expected guests</td><td>${data.guestCount ?? 'TBC'}${guestSplit.length > 0 ? ` (${guestSplit.join(', ')})` : ''}</td></tr>
    <tr><td>Layout</td><td>${text(data.layout, 'Not recorded')}</td></tr>
  </table>

  <h2>Packages &amp; Catering</h2>
  <table>
    <thead><tr><th>Selection</th><th>Qty</th></tr></thead>
    <tbody>${cateringRows}</tbody>
  </table>

  <h2>Bar Tab</h2>
  <p>${barTabText}</p>

  <div class="grid">
    <div>
      <h2>Accessibility Notes</h2>
      <p>${text(data.accessibilityNotes, 'None recorded')}</p>
    </div>
    <div>
      <h2>Allergy &amp; Dietary Notes</h2>
      <div class="sensitive">
        <span class="tag">Sensitive — need-to-know only</span>
        <p>${text(data.dietaryNotes, 'None recorded')}</p>
      </div>
    </div>
  </div>

  <h2>Self-Catering &amp; Waiver</h2>
  <p>${selfCateringText}</p>

  <h2>Suppliers</h2>
  <p class="muted">Booking supplier status: <span class="status status-${escapeHtml(data.supplierStatus)}">${escapeHtml(data.supplierStatus.toUpperCase())}</span>. Unapproved suppliers may be refused entry; suppliers must clear down within one hour of the event end.</p>
  <table>
    <thead><tr><th>Supplier</th><th>Arrival–Departure</th><th>Documents</th><th>Status</th></tr></thead>
    <tbody>${supplierRows}</tbody>
  </table>

  <h2>Entertainment &amp; Equipment</h2>
  <table class="kv">
    <tr><td>Entertainment / vendors</td><td>${entertainmentText}</td></tr>
    <tr><td>Electricity charge status</td><td>${electricityText}</td></tr>
  </table>

  <h2>Decorations</h2>
  <p>${text(data.decorationsPlan, 'No decorations plan recorded — only pre-approved decorations are allowed.')}</p>
  <p class="muted">No confetti, glitter, adhesives, nails/pins, smoke, pyrotechnics or flame effects. Open flames only as brief cake candles under adult supervision. Decorations must be removed at the end.</p>

  <h2>Licensing Considerations</h2>
  <table>
    <thead><tr><th>Activity</th><th>Authorised times</th></tr></thead>
    <tbody>${LICENSING_HOURS.map(
      (row) => `<tr><td>${escapeHtml(row.activity)}</td><td>${escapeHtml(row.times)}</td></tr>`
    ).join('')}</tbody>
  </table>
  <p class="muted">Challenge 25 applies (passport or photocard driving licence). No external drinks of any kind. Under-18s must be accompanied and supervised by adults between 11:00 and 21:00 (dining area until 23:00); the host is responsible for supervision. No under-18s in the pool table area unsupervised.</p>

  <h2>Risk</h2>
  <table class="kv">
    <tr><td>Risk status</td><td>${riskLine}</td></tr>
    <tr><td>Special risk notes</td><td>${text(data.specialRiskNotes, 'None recorded')}</td></tr>
  </table>

  <h2>Payment &amp; Deposit</h2>
  <table class="kv">
    <tr><td>Deposit</td><td>${money(data.depositAmount)} — ${text(data.depositStatus, 'Unknown')}</td></tr>
    <tr><td>Payment status</td><td>${text(data.paymentStatus, 'Unknown')}</td></tr>
    <tr><td>Total (incl. VAT)</td><td>${money(data.grossTotal)}</td></tr>
    <tr><td>Paid to date</td><td>${money(data.totalBalancePaid)}</td></tr>
    <tr><td>Balance remaining</td><td>${money(data.balanceRemaining)}${data.balanceDueDate ? ` (due ${date(data.balanceDueDate)})` : ''}</td></tr>
  </table>

  <h2>Duty Manager Notes</h2>
  <div class="notes-box"></div>

  <h2>Incident Log</h2>
  <table>
    <thead><tr><th style="width:12%">Time</th><th>Incident</th><th>Action taken</th><th style="width:18%">Staff</th></tr></thead>
    <tbody>${incidentRows}</tbody>
  </table>

  <div class="grid">
    <div>
      <h2>End-of-Event Checklist</h2>
      ${checklist(END_OF_EVENT_CHECKLIST)}
    </div>
    <div>
      <h2>Post-Event Inspection Checklist</h2>
      ${checklist(POST_EVENT_INSPECTION_CHECKLIST)}
    </div>
  </div>

  <div class="footer">
    Internal document — contains only the personal information staff need to run this event safely (SOP §29).
    Escalate anything unusual to the duty manager or General Manager. Generated by Anchor Management Tools.
  </div>
</body>
</html>`
}
