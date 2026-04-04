import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getLondonDateIso } from '@/lib/foh/api-auth'
import { generatePDFFromHTML } from '@/lib/pdf-generator'

export const runtime = 'nodejs'
export const maxDuration = 60

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function formatLondonDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${isoDate}T12:00:00Z`))
}

function formatBookingTime(startDatetime: string | null, bookingTime: string | null): string {
  if (startDatetime) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(startDatetime))
  }
  return bookingTime?.slice(0, 5) ?? '—'
}

type PreorderItem = {
  name: string
  quantity: number
  item_type: 'main' | 'side' | 'extra' | string
}

type BookingForSheet = {
  id: string
  guestName: string
  bookingTime: string
  partySize: number | null
  tableNames: string[]
  notes: string | null
  preorderItems: PreorderItem[]
  bookingReference: string | null
}

function generateKitchenSheetHtml(date: string, bookings: BookingForSheet[]): string {
  const formattedDate = formatLondonDate(date)
  const printedAt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())

  const TYPE_ORDER = ['main', 'side', 'extra']
  const TYPE_LABELS: Record<string, string> = { main: 'Mains', side: 'Sides', extra: 'Extras' }

  // Only bookings that have pre-order items go into the pivot table
  const bookingsWithOrders = bookings.filter((b) => b.preorderItems.length > 0)
  // All bookings with notes go into the notes section
  const bookingsWithNotes = bookings.filter((b) => b.notes?.trim())

  // ── Build item list ──────────────────────────────────────────────────────────
  // Key = `{type}::{name}` to keep mains/sides/extras with the same name separate
  const itemMap = new Map<string, { name: string; item_type: string }>()
  for (const booking of bookingsWithOrders) {
    for (const item of booking.preorderItems) {
      const key = `${item.item_type}::${item.name}`
      if (!itemMap.has(key)) itemMap.set(key, { name: item.name, item_type: item.item_type })
    }
  }

  // Sort by type order, then alphabetically within type
  const allItems = Array.from(itemMap.entries())
    .map(([key, val]) => ({ key, ...val }))
    .sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a.item_type) === -1 ? 99 : TYPE_ORDER.indexOf(a.item_type)
      const bi = TYPE_ORDER.indexOf(b.item_type) === -1 ? 99 : TYPE_ORDER.indexOf(b.item_type)
      if (ai !== bi) return ai - bi
      return a.name.localeCompare(b.name)
    })

  // Group items by type for rendering section headers
  const itemsByType: Record<string, typeof allItems> = {}
  for (const item of allItems) {
    if (!itemsByType[item.item_type]) itemsByType[item.item_type] = []
    itemsByType[item.item_type].push(item)
  }
  const orderedTypes = [
    ...TYPE_ORDER.filter((t) => itemsByType[t]),
    ...Object.keys(itemsByType).filter((t) => !TYPE_ORDER.includes(t)),
  ]

  // ── Quantity lookup: qty[itemKey][bookingId] ─────────────────────────────────
  const qty: Record<string, Record<string, number>> = {}
  for (const item of allItems) {
    qty[item.key] = {}
    for (const b of bookingsWithOrders) {
      const found = b.preorderItems.find(
        (pi) => pi.item_type === item.item_type && pi.name === item.name,
      )
      qty[item.key][b.id] = found?.quantity ?? 0
    }
  }

  function rowTotal(itemKey: string): number {
    return bookingsWithOrders.reduce((s, b) => s + (qty[itemKey]?.[b.id] ?? 0), 0)
  }
  function colTotal(bookingId: string): number {
    return allItems.reduce((s, item) => s + (qty[item.key]?.[bookingId] ?? 0), 0)
  }
  function colTypeTotal(bookingId: string, type: string): number {
    return (itemsByType[type] ?? []).reduce((s, item) => s + (qty[item.key]?.[bookingId] ?? 0), 0)
  }
  function typeGrandTotal(type: string): number {
    return (itemsByType[type] ?? []).reduce((s, item) => s + rowTotal(item.key), 0)
  }
  const grandTotal = allItems.reduce((s, item) => s + rowTotal(item.key), 0)

  // ── Render ───────────────────────────────────────────────────────────────────
  const numCols = bookingsWithOrders.length // booking columns

  // Column headers — one per booking
  const colHeaders = bookingsWithOrders
    .map((b) => {
      const tables = b.tableNames.length > 0 ? b.tableNames.join(', ') : 'Unassigned'
      const nameParts = b.guestName.split(' ')
      const shortName =
        nameParts.length >= 2
          ? `${nameParts[0]} ${nameParts[nameParts.length - 1][0]}.`
          : b.guestName
      return `<th class="booking-col">
        <div class="col-time">${escapeHtml(b.bookingTime)}</div>
        <div class="col-name">${escapeHtml(shortName)}</div>
        <div class="col-meta">${b.partySize ?? '?'} cvrs</div>
        <div class="col-meta">${escapeHtml(tables)}</div>
      </th>`
    })
    .join('')

  // Table body rows
  let tbody = ''

  if (allItems.length === 0) {
    tbody = `<tr><td class="empty-cell" colspan="${numCols + 2}">No pre-orders on this date</td></tr>`
  } else {
    for (const type of orderedTypes) {
      const label = TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
      const items = itemsByType[type]

      // Section header row
      tbody += `<tr class="section-header-row">
        <td class="section-label" colspan="${numCols + 2}">${label}</td>
      </tr>`

      // One row per item
      for (const item of items) {
        const cells = bookingsWithOrders
          .map((b) => {
            const q = qty[item.key]?.[b.id] ?? 0
            return `<td class="qty-cell ${q > 0 ? 'qty-has' : 'qty-zero'}">${q > 0 ? q : '—'}</td>`
          })
          .join('')
        tbody += `<tr class="item-row">
          <td class="item-name-cell">${escapeHtml(item.name)}</td>
          ${cells}
          <td class="row-total-cell">${rowTotal(item.key)}</td>
        </tr>`
      }

      // Type subtotal row
      const subtotalCells = bookingsWithOrders
        .map((b) => {
          const t = colTypeTotal(b.id, type)
          return `<td class="subtotal-qty">${t > 0 ? t : '—'}</td>`
        })
        .join('')
      tbody += `<tr class="subtotal-row">
        <td class="subtotal-label">${label} subtotal</td>
        ${subtotalCells}
        <td class="subtotal-total">${typeGrandTotal(type)}</td>
      </tr>`
    }

    // Grand total row
    const grandCells = bookingsWithOrders
      .map((b) => `<td class="grand-qty">${colTotal(b.id)}</td>`)
      .join('')
    tbody += `<tr class="grand-total-row">
      <td class="grand-label">Total dishes</td>
      ${grandCells}
      <td class="grand-qty grand-corner">${grandTotal}</td>
    </tr>`
  }

  // Notes section
  let notesHtml = ''
  if (bookingsWithNotes.length > 0) {
    const noteRows = bookingsWithNotes
      .map(
        (b) => `<tr>
        <td class="note-time">${escapeHtml(b.bookingTime)}</td>
        <td class="note-guest">${escapeHtml(b.guestName)}</td>
        <td class="note-covers">${b.partySize ?? '?'}</td>
        <td class="note-table">${escapeHtml(b.tableNames.join(', ') || 'Unassigned')}</td>
        <td class="note-text">${escapeHtml(b.notes!)}</td>
      </tr>`,
      )
      .join('')
    notesHtml = `
    <div class="notes-section">
      <div class="notes-heading">Special Requirements &amp; Notes</div>
      <table class="notes-table">
        <thead>
          <tr>
            <th style="width:70px">Time</th>
            <th style="width:160px">Guest</th>
            <th style="width:55px">Covers</th>
            <th style="width:140px">Table</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${noteRows}</tbody>
      </table>
    </div>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Kitchen Pre-order Sheet — ${formattedDate}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  @page { size: A4 landscape; margin: 12mm; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    font-size: 10pt;
    color: #111;
    background: #fff;
  }

  /* ── Page header ── */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 3px solid #111;
    padding-bottom: 8px;
    margin-bottom: 14px;
  }
  .page-title { font-size: 17pt; font-weight: 700; }
  .page-date  { font-size: 11pt; font-weight: 600; color: #333; margin-top: 2px; }
  .page-printed { font-size: 8pt; color: #999; text-align: right; }

  /* ── Pivot table ── */
  .pivot-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    table-layout: auto;
  }

  /* Column header row */
  .pivot-table thead th {
    background: #111;
    color: #fff;
    padding: 6px 8px;
    text-align: center;
    vertical-align: bottom;
    border-right: 1px solid #333;
    white-space: nowrap;
  }
  .pivot-table thead th:first-child {
    text-align: left;
    min-width: 160px;
    border-right: 2px solid #444;
  }
  .pivot-table thead th:last-child { border-right: none; background: #2a2a2a; }

  .col-time  { font-size: 11pt; font-weight: 700; }
  .col-name  { font-size: 8pt; color: #ccc; margin-top: 1px; }
  .col-meta  { font-size: 7.5pt; color: #aaa; }

  /* Section header */
  .section-header-row .section-label {
    background: #e8e8e8;
    padding: 5px 8px;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #444;
    border-top: 2px solid #bbb;
    border-bottom: 1px solid #ccc;
  }

  /* Item rows */
  .item-row { page-break-inside: avoid; }
  .item-row:hover { background: #fafafa; }

  .item-name-cell {
    padding: 4px 8px;
    border-right: 2px solid #ccc;
    border-bottom: 1px solid #f0f0f0;
  }

  .qty-cell {
    text-align: center;
    padding: 4px 6px;
    border-right: 1px solid #ebebeb;
    border-bottom: 1px solid #f0f0f0;
  }
  .qty-has  { font-weight: 700; font-size: 10.5pt; }
  .qty-zero { color: #ccc; font-size: 9pt; }

  .row-total-cell {
    text-align: center;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 10.5pt;
    background: #f0f0f0;
    border-left: 2px solid #bbb;
    border-bottom: 1px solid #e0e0e0;
  }

  /* Subtotal rows */
  .subtotal-row { background: #f7f7f7; }
  .subtotal-label {
    padding: 3px 8px 3px 18px;
    font-size: 8pt;
    font-style: italic;
    color: #666;
    border-right: 2px solid #ccc;
    border-bottom: 1px solid #ddd;
  }
  .subtotal-qty {
    text-align: center;
    padding: 3px 6px;
    font-size: 9pt;
    font-weight: 600;
    color: #555;
    border-right: 1px solid #e0e0e0;
    border-bottom: 1px solid #ddd;
  }
  .subtotal-total {
    text-align: center;
    padding: 3px 10px;
    font-size: 9pt;
    font-weight: 700;
    background: #e8e8e8;
    border-left: 2px solid #bbb;
    border-bottom: 1px solid #ddd;
  }

  /* Grand total row */
  .grand-total-row .grand-label {
    padding: 6px 8px;
    font-size: 9.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    background: #111;
    color: #fff;
    border-right: 2px solid #444;
  }
  .grand-qty {
    text-align: center;
    padding: 6px;
    font-weight: 700;
    font-size: 11pt;
    background: #111;
    color: #fff;
    border-right: 1px solid #333;
  }
  .grand-corner { background: #2a2a2a; border-right: none; }

  .empty-cell {
    text-align: center;
    padding: 30px;
    color: #888;
    font-style: italic;
  }

  /* ── Notes section ── */
  .notes-section {
    margin-top: 20px;
    page-break-inside: avoid;
  }
  .notes-heading {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #555;
    padding-bottom: 5px;
    border-bottom: 2px solid #ccc;
    margin-bottom: 6px;
  }
  .notes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
  }
  .notes-table thead th {
    background: #e8e8e8;
    padding: 4px 8px;
    text-align: left;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #555;
    border-bottom: 1px solid #ccc;
  }
  .note-time, .note-guest, .note-covers, .note-table {
    padding: 4px 8px;
    border-bottom: 1px solid #f0f0f0;
    white-space: nowrap;
  }
  .note-time   { font-weight: 700; }
  .note-guest  { font-weight: 600; }
  .note-covers { text-align: center; }
  .note-text   { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; color: #333; }

  /* ── Footer ── */
  .footer {
    margin-top: 16px;
    padding-top: 6px;
    border-top: 1px solid #ddd;
    font-size: 7.5pt;
    color: #aaa;
    text-align: right;
  }
</style>
</head>
<body>
  <div class="page-header">
    <div>
      <div class="page-title">Kitchen Pre-order Sheet</div>
      <div class="page-date">${escapeHtml(formattedDate)}</div>
    </div>
    <div class="page-printed">Printed ${escapeHtml(printedAt)}</div>
  </div>

  <table class="pivot-table">
    <thead>
      <tr>
        <th style="text-align:left">Item</th>
        ${colHeaders}
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${tbody}
    </tbody>
  </table>

  ${notesHtml}

  <div class="footer">Printed ${escapeHtml(printedAt)}</div>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function GET(request: NextRequest) {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const dateParam = request.nextUrl.searchParams.get('date')
  const date = dateParam && isIsoDate(dateParam) ? dateParam : getLondonDateIso()

  const supabase = auth.supabase

  // Fetch bookings for the day — only sunday_lunch or any with pre-orders
  const { data: bookingRows, error: bookingsError } = await supabase.from('table_bookings')
    .select(
      'id, booking_reference, booking_date, booking_time, party_size, status, special_requirements, start_datetime, booking_type, customer:customers!table_bookings_customer_id_fkey(first_name, last_name)'
    )
    .eq('booking_date', date)
    .not('status', 'in', '(cancelled,no_show)')
    .order('booking_time', { ascending: true })

  if (bookingsError) {
    return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 })
  }

  const rows = (bookingRows || [])

  if (rows.length === 0) {
    // Generate empty PDF
    const html = generateKitchenSheetHtml(date, [])
    const pdfBuffer = await generatePDFFromHTML(html)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="kitchen-preorders-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const bookingIds = rows.map((row: any) => row.id as string)

  // Fetch pre-order items and table assignments in parallel
  const [itemsResult, assignmentsResult] = await Promise.all([
    supabase.from('table_booking_items')
      .select('booking_id, custom_item_name, quantity, item_type')
      .in('booking_id', bookingIds)
      .not('menu_dish_id', 'is', null),
    supabase.from('booking_table_assignments')
      .select('table_booking_id, table_id')
      .in('table_booking_id', bookingIds),
  ])

  // Build table name map
  const tableIdSet = new Set<string>()
  for (const row of (assignmentsResult.data || [])) {
    if (typeof row.table_id === 'string') tableIdSet.add(row.table_id)
  }

  const tableNameById = new Map<string, string>()
  if (tableIdSet.size > 0) {
    const { data: tableRows } = await supabase.from('tables')
      .select('id, name, table_number')
      .in('id', Array.from(tableIdSet))

    for (const row of (tableRows || [])) {
      if (typeof row.id === 'string') {
        tableNameById.set(row.id, row.name || row.table_number || 'Unknown')
      }
    }
  }

  // Group items and assignments by booking
  const itemsByBooking = new Map<string, PreorderItem[]>()
  for (const item of (itemsResult.data || [])) {
    const id = item.booking_id as string
    if (!itemsByBooking.has(id)) itemsByBooking.set(id, [])
    itemsByBooking.get(id)!.push({
      name: item.custom_item_name || 'Menu item',
      quantity: Math.max(1, Number(item.quantity || 1)),
      item_type: item.item_type || 'main',
    })
  }

  const tablesByBooking = new Map<string, string[]>()
  for (const row of (assignmentsResult.data || [])) {
    const id = row.table_booking_id as string
    if (!tablesByBooking.has(id)) tablesByBooking.set(id, [])
    const name = tableNameById.get(row.table_id) ?? 'Unknown'
    tablesByBooking.get(id)!.push(name)
  }

  // Build the final booking list — only include sunday_lunch bookings or those with pre-orders
  const bookingsForSheet: BookingForSheet[] = rows
    .filter((row: any) => {
      const isSundayLunch = row.booking_type === 'sunday_lunch'
      const hasPreorder = (itemsByBooking.get(row.id)?.length ?? 0) > 0
      return isSundayLunch || hasPreorder
    })
    .map((row: any) => {
      const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer
      const firstName = (customer?.first_name || '').trim()
      const lastName = (customer?.last_name || '').trim()
      const guestName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown guest'

      return {
        id: row.id,
        guestName,
        bookingTime: formatBookingTime(row.start_datetime, row.booking_time),
        partySize: row.party_size ?? null,
        tableNames: tablesByBooking.get(row.id) ?? [],
        notes: row.special_requirements || null,
        preorderItems: itemsByBooking.get(row.id) ?? [],
        bookingReference: row.booking_reference || null,
      }
    })

  const html = generateKitchenSheetHtml(date, bookingsForSheet)
  const pdfBuffer = await generatePDFFromHTML(html)

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="kitchen-preorders-${date}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
