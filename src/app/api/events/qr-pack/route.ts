import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { isValidIsoDate } from '@/lib/dateUtils'
import { datedFolderName, sanitizeFilename } from '@/lib/export/filenames'
import {
  buildBriefMarkdown,
  buildReadme,
  isPrintedMediaQrChannel,
  qrFileStem,
  renderQrPng,
  renderQrSvg,
  type BriefEvent,
  type ManifestEntry,
} from '@/lib/export/qr-pack'
import { EventMarketingService, type EventMarketingLink } from '@/services/event-marketing'
import { EVENT_MARKETING_CHANNELS } from '@/lib/event-marketing-links'

export const runtime = 'nodejs'
// Measured: 23 print channels per event, 42ms per PNG plus a negligible SVG, is
// roughly 1s of rendering per event. Forty events is about 40s, plus link resolution
// and zipping. 300 leaves comfortable headroom without pretending the work is
// free.
export const maxDuration = 300

/** Inclusive. 366 days is a year, and 367 dates is the same year on a leap year. */
const MAX_RANGE_DAYS = 366
/**
 * Beyond this the pack stops being a thing a designer opens and starts being an
 * archive nobody reads. It is also where the render budget stops being comfortable.
 */
const MAX_EVENTS = 40
/** Rendering is CPU bound and serverless CPUs are narrow, so this is modest. */
const RENDER_CONCURRENCY = 4

/**
 * Statuses worth putting in front of a designer. Draft is not ready to advertise
 * and cancelled must not be. Postponed and rescheduled are included because the
 * artwork usually still gets made.
 */
const INCLUDED_STATUSES = ['scheduled', 'sold_out', 'rescheduled', 'postponed']

/** Only placements used in physically printed event artwork belong in this pack. */
const PRINT_QR_CHANNELS = EVENT_MARKETING_CHANNELS.filter(isPrintedMediaQrChannel)

function daysBetweenInclusive(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`)
  const b = Date.parse(`${end}T00:00:00Z`)
  return Math.floor((b - a) / 86_400_000) + 1
}

/** Run tasks with a ceiling on how many are in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * POST, not GET.
 *
 * This creates short links for any channel an event does not have yet. Those are
 * durable, externally scannable tracking assets, so the operation is not safe to
 * repeat on a prefetch, a retry or a link someone pastes into a chat.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    // events:manage, not events:export. The pack creates links, and export
    // permission is for reading data out, not minting tracking assets.
    const canManage = await checkUserPermission('events', 'manage', user.id)
    if (!canManage) {
      return NextResponse.json(
        { error: 'You need events manage permission to build a QR pack, because it creates any missing QR links.' },
        { status: 403 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const startDate = String(body?.startDate ?? '')
    const endDate = String(body?.endDate ?? '')

    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
      return NextResponse.json({ error: 'Give a real start and end date.' }, { status: 400 })
    }
    if (endDate < startDate) {
      return NextResponse.json({ error: 'The end date is before the start date.' }, { status: 400 })
    }
    if (daysBetweenInclusive(startDate, endDate) > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `That range is longer than ${MAX_RANGE_DAYS} days. Please split it.` },
        { status: 400 },
      )
    }

    const admin = createAdminClient()

    // An explicit select list: the shared events export omits slug, alt text and
    // accessibility notes, all of which the brief needs.
    const { data: eventRows, error: eventsError } = await admin
      .from('events')
      .select(`
        id, name, slug, date, time, end_time, doors_time, last_entry_time,
        capacity, price, is_free, event_status,
        short_description, brief, image_alt_text, accessibility_notes,
        performer_name, performer_type,
        category:event_categories(name)
      `)
      .gte('date', startDate)
      .lte('date', endDate)
      .in('event_status', INCLUDED_STATUSES)
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    if (eventsError) {
      console.error('QR pack: failed to load events', eventsError)
      return NextResponse.json({ error: 'Could not load the events.' }, { status: 500 })
    }

    const events = (eventRows ?? []) as unknown as (BriefEvent & { event_status: string })[]

    if (events.length === 0) {
      return NextResponse.json(
        { error: 'No events in that range. Draft and cancelled events are left out on purpose.' },
        { status: 404 },
      )
    }
    if (events.length > MAX_EVENTS) {
      return NextResponse.json(
        { error: `That range has ${events.length} events, more than the ${MAX_EVENTS} this can build at once. Please split it.` },
        { status: 400 },
      )
    }

    // Preflight everything BEFORE creating a single link. A pack that fails
    // halfway would otherwise leave new tracking links behind for a download the
    // user never received, and a retry would look like it had already run.
    const unusable = events.filter(e => !e.slug).map(e => `${e.date} ${e.name}`)
    if (unusable.length > 0) {
      return NextResponse.json(
        {
          error: 'Some events have no web address yet, so their QR codes would have nowhere to point.',
          events: unusable,
        },
        { status: 400 },
      )
    }

    const zip = new JSZip()
    const manifest: ManifestEntry[] = []
    const createdLinkIds: string[] = []

    for (const event of events) {
      const existing = await EventMarketingService.getLinks(event.id)
      const byChannel = new Map(existing.map(l => [l.channel, l]))

      const missing = PRINT_QR_CHANNELS.filter(c => !byChannel.has(c.key))
      for (const channel of missing) {
        const created = await EventMarketingService.generateSingleLink(event.id, channel.key)
        byChannel.set(created.channel, created)
        createdLinkIds.push(created.id)
      }

      const links: EventMarketingLink[] = PRINT_QR_CHANNELS
        .map(c => byChannel.get(c.key))
        .filter((l): l is EventMarketingLink => Boolean(l))

      const folder = datedFolderName(event.date, event.name, event.id)
      const entry: ManifestEntry = {
        eventId: event.id,
        eventName: event.name,
        eventDate: event.date,
        folder,
        links: [],
      }

      const rendered = await mapWithConcurrency(links, RENDER_CONCURRENCY, async (link, index) => {
        const [png, svg] = await Promise.all([renderQrPng(link.shortUrl), renderQrSvg(link.shortUrl)])
        return { link, index, png, svg }
      })

      for (const { link, index, png, svg } of rendered) {
        const stem = sanitizeFilename(qrFileStem(link, index), `qr-${index}`)
        zip.file(`${folder}/print/${stem}.png`, png)
        zip.file(`${folder}/print/${stem}.svg`, svg)

        entry.links.push({
          channel: link.channel,
          label: link.label,
          type: link.type,
          shortCode: link.shortCode,
          shortUrl: link.shortUrl,
          destinationUrl: link.destinationUrl,
          files: [`print/${stem}.png`, `print/${stem}.svg`],
        })
      }

      zip.file(`${folder}/brief.md`, buildBriefMarkdown(event, links))
      manifest.push(entry)
    }

    // A folder per event, or something collided and files were silently replaced.
    const folders = new Set(manifest.map(m => m.folder))
    if (folders.size !== events.length) {
      console.error('QR pack: folder collision', { events: events.length, folders: folders.size })
      return NextResponse.json({ error: 'Two events produced the same folder name. Nothing was downloaded.' }, { status: 500 })
    }

    zip.file('README.md', buildReadme(startDate, endDate, manifest))
    zip.file('manifest.json', JSON.stringify({ startDate, endDate, events: manifest }, null, 2))

    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const filename = `anchor-qr-pack-${startDate}-to-${endDate}.zip`

    try {
      await logAuditEvent({
        user_id: user.id,
        ...(user.email && { user_email: user.email }),
        operation_type: 'export',
        resource_type: 'events',
        resource_id: `qr-pack:${startDate}:${endDate}`,
        operation_status: 'success',
        new_values: {
          events: events.length,
          links_created: createdLinkIds.length,
          created_link_ids: createdLinkIds,
          archive_bytes: archive.length,
          duration_ms: Date.now() - startedAt,
        },
      })
    } catch (auditError) {
      // A logging failure must not lose the user their pack.
      console.error('QR pack: audit log failed', auditError)
    }

    return new NextResponse(new Uint8Array(archive), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(archive.length),
        // Authenticated bulk extract: never cached, anywhere.
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('QR pack: build failed', error)
    return NextResponse.json({ error: 'Could not build the QR pack.' }, { status: 500 })
  }
}
