import { NextResponse } from 'next/server'
import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateInLondon, parseLondonDateTimeLocal } from '@/lib/dateUtils'
import { queueManagerReportEmail } from '@/lib/manager-report/queue'

// Prepare the maintenance snapshot at 08:00 London on Friday, one hour before the
// combined 09:00 manager report. vercel.json fires two UTC slots so winter and
// summer are both covered; this local-hour gate decides which slot actually runs,
// so British Summer Time can never skip the snapshot.
const TIMEZONE = 'Europe/London'

// Outstanding means any status other than done and cancelled. The filter is an
// exclusion on purpose: a status added to the table later is included by default
// rather than quietly disappearing from the managers' email.
const CLOSED_STATUSES = '("done","cancelled")'

// Supabase caps the rows a single request returns. Pages advance by the number of
// rows actually received and stop only on an empty page, so a server-side cap
// smaller than this page size cannot silently truncate the snapshot.
const PAGE_SIZE = 500
const MAX_PAGES = 200

type MaintenanceItemRow = {
  id: string
  reference: string | null
  kind: string | null
  title: string | null
  area_id: string | null
  status: string | null
  priority: string | null
  responsibility: string | null
  target_date: string | null
}

type MaintenanceAreaRow = {
  id: string
  name: string | null
}

type SupabaseError = { message?: string | null } | null

type PageResponse<T> = { data: T[] | null; error: SupabaseError }

type PagedRows<T> = { rows: T[]; error: string | null }

const STATUS_LABELS: Record<string, string> = {
  reported: 'Reported',
  quoting: 'Quoting',
  // The stored value is tenancy neutral; the managers know it as Greene King.
  awaiting_landlord: 'With Greene King',
  with_third_party: 'With a third party',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  done: 'Done',
  cancelled: 'Cancelled',
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const RESPONSIBILITY_LABELS: Record<string, string> = {
  us: 'Us',
  greene_king: 'Greene King',
  to_confirm: 'To confirm',
}

const KIND_LABELS: Record<string, string> = { issue: 'Issue', improvement: 'Improvement' }

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] as string))
}

/** Known values get their agreed wording; anything new stays readable rather than raw. */
function label(value: string | null, labels: Record<string, string>, fallback: string): string {
  const key = value?.trim()
  if (!key) return fallback
  return labels[key] ?? key.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase())
}

function targetDateLabel(value: string | null): string {
  const parsed = parseLondonDateTimeLocal(value)
  if (!parsed) return 'not set'
  return formatDateInLondon(parsed, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Reads every page of a query. The caller supplies the range because supabase-js
 * builders are single use. Stops only on an empty page, never on a short one, so a
 * page cap below PAGE_SIZE cannot be mistaken for the end of the data.
 */
async function fetchAllPages<T>(
  runPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
): Promise<PagedRows<T>> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await runPage(rows.length, rows.length + PAGE_SIZE - 1)
    if (error) return { rows: [], error: error.message || 'Query failed' }
    const batch = data ?? []
    if (batch.length === 0) return { rows, error: null }
    rows.push(...batch)
  }
  return { rows: [], error: `Maintenance snapshot exceeded ${MAX_PAGES} pages` }
}

type AdminClient = ReturnType<typeof createAdminClient>

const ITEM_COLUMNS = 'id, reference, kind, title, area_id, status, priority, responsibility, target_date'

/**
 * One page of outstanding items. Ordered oldest first: items are never deleted and
 * new ones append, so the offset window stays stable while the pages are read.
 */
function openItemsPage(db: AdminClient, from: number, to: number) {
  return db
    .from('maintenance_items')
    .select(ITEM_COLUMNS)
    .not('status', 'in', CLOSED_STATUSES)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)
}

async function countOpenItems(db: AdminClient): Promise<{ count: number | null; error: string | null }> {
  const { count, error } = await db
    .from('maintenance_items')
    .select('id', { count: 'exact', head: true })
    .not('status', 'in', CLOSED_STATUSES)
  if (error) return { count: null, error: error.message || 'Could not count maintenance items' }
  return { count: typeof count === 'number' ? count : null, error: null }
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowUtc = new Date()
  const nowLocal = toZonedTime(nowUtc, TIMEZONE)
  if (nowLocal.getDay() !== 5 || nowLocal.getHours() !== 8) {
    return NextResponse.json({ skipped: true, reason: 'Not Friday 08:00 London' })
  }

  const today = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')

  try {
    const db = createAdminClient()

    // Counted before paging so a truncated read can be told apart from an empty one.
    const expected = await countOpenItems(db)
    if (expected.error) {
      return NextResponse.json({ error: 'Could not read maintenance items' }, { status: 500 })
    }

    const itemsResult = await fetchAllPages<MaintenanceItemRow>((from, to) => openItemsPage(db, from, to))
    if (itemsResult.error) {
      return NextResponse.json({ error: 'Could not read maintenance items' }, { status: 500 })
    }

    // Belt and braces against a row appearing twice if the window shifted mid-read.
    const seen = new Set<string>()
    const items = itemsResult.rows.filter((row) => {
      if (!row?.id || seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })

    if (expected.count !== null && items.length < expected.count) {
      // An item closed between the count and the last page is a harmless race, so
      // the count is taken again. Genuine truncation leaves it stubbornly higher.
      const recount = await countOpenItems(db)
      if (recount.error || (recount.count !== null && items.length < recount.count)) {
        return NextResponse.json(
          { error: 'Maintenance snapshot was incomplete', expected: recount.count ?? expected.count, fetched: items.length },
          { status: 500 },
        )
      }
    }

    const areasResult = await fetchAllPages<MaintenanceAreaRow>((from, to) =>
      db.from('maintenance_areas').select('id, name').order('id', { ascending: true }).range(from, to),
    )
    if (areasResult.error) {
      return NextResponse.json({ error: 'Could not read maintenance areas' }, { status: 500 })
    }
    const areaNames = new Map<string, string>()
    for (const area of areasResult.rows) {
      if (area?.id) areaNames.set(area.id, (area.name ?? '').trim() || 'Area unknown')
    }

    items.sort((a, b) => {
      const priority = (PRIORITY_ORDER[a.priority ?? ''] ?? 99) - (PRIORITY_ORDER[b.priority ?? ''] ?? 99)
      if (priority !== 0) return priority
      // Undated items sort last within their priority rather than first.
      const targetA = a.target_date ?? '9999-12-31'
      const targetB = b.target_date ?? '9999-12-31'
      if (targetA !== targetB) return targetA.localeCompare(targetB)
      return (a.reference ?? '').localeCompare(b.reference ?? '')
    })

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '')
    // Both dates are London calendar dates already, so this is a plain string compare.
    const overdue = items.filter((item) => item.target_date !== null && item.target_date < today).length
    const counts = {
      critical: items.filter((item) => item.priority === 'critical').length,
      high: items.filter((item) => item.priority === 'high').length,
      medium: items.filter((item) => item.priority === 'medium').length,
      low: items.filter((item) => item.priority === 'low').length,
    }

    const lines = items.map((item) => {
      const reference = (item.reference ?? '').trim() || 'No reference'
      const title = (item.title ?? '').trim() || 'Untitled item'
      const area = areaNames.get(item.area_id ?? '') ?? 'Area unknown'
      const details = [
        label(item.kind, KIND_LABELS, 'Kind not set'),
        area,
        `Status: ${label(item.status, STATUS_LABELS, 'Status not set')}`,
        `Priority: ${label(item.priority, PRIORITY_LABELS, 'Priority not set')}`,
        `Responsibility: ${label(item.responsibility, RESPONSIBILITY_LABELS, 'To confirm')}`,
        `Target date: ${targetDateLabel(item.target_date)}`,
      ].join(' | ')
      const url = `${appUrl}/maintenance/${item.id}`
      return { reference, title, details, url }
    })

    const summary = items.length === 0
      ? 'No outstanding maintenance items.'
      : `${items.length} outstanding ${items.length === 1 ? 'item' : 'items'}: `
        + `${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low. `
        + `${overdue} past target date.`

    const bodyHtml = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <h2>Maintenance, outstanding items at ${esc(today)}</h2>
    <p>${esc(summary)}</p>
    <ul>${lines
      .map((line) => `<li><strong>${esc(line.reference)}: ${esc(line.title)}</strong><br>${esc(line.details)}<br><a href="${esc(line.url)}">Open ${esc(line.reference)}</a></li>`)
      .join('') || '<li>Nothing outstanding.</li>'}</ul>
  </div>`

    const bodyText = [
      `Maintenance, outstanding items at ${today}`,
      summary,
      ...lines.map((line) => `${line.reference}: ${line.title}\n${line.details}\n${line.url}`),
    ].join('\n\n')

    const queued = await queueManagerReportEmail({
      section: 'maintenance',
      key: today,
      to: process.env.MANAGER_EMAIL || 'manager@the-anchor.pub',
      subject: items.length === 0
        ? 'Maintenance: no outstanding items'
        : `Maintenance: ${items.length} outstanding ${items.length === 1 ? 'item' : 'items'}`,
      html: bodyHtml,
      text: bodyText,
      metadata: {
        snapshot_date: today,
        outstanding_items: items.length,
        overdue_items: overdue,
        critical_items: counts.critical,
        high_items: counts.high,
      },
    })
    if (!queued.success) {
      return NextResponse.json({ error: queued.error || 'Could not queue maintenance snapshot' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      queued: true,
      snapshotDate: today,
      outstanding: items.length,
      overdue,
      localTime: format(nowLocal, 'HH:mm zzz', { timeZone: TIMEZONE }),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Maintenance snapshot failed' },
      { status: 500 },
    )
  }
}
