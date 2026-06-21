#!/usr/bin/env tsx
/**
 * Reusable: message all table-booking guests for a given date (and optional time/
 * status) with a custom SMS or email. Built on the app's canonical senders, so
 * consent/suppression checks, idempotency (SMS) and message logging all apply.
 *
 * Use `{name}` in the message/subject as a placeholder for the guest's first name.
 *
 * Examples:
 *   # Preview (dry run is the default — nothing is sent):
 *   npx tsx scripts/message-bookings.ts \
 *     --date=2026-06-21 --time=13:00 --channel=sms \
 *     --message="Hi {name}, see you at 1pm today!"
 *
 *   # Actually send:
 *   npx tsx scripts/message-bookings.ts \
 *     --date=2026-06-21 --time=13:00 --channel=sms \
 *     --message="Hi {name}, see you at 1pm today!" --send
 *
 *   # Email (subject required):
 *   npx tsx scripts/message-bookings.ts \
 *     --date=2026-06-21 --channel=email --subject="A note about today" \
 *     --message="Hi {name}, ..." --send
 *
 * Flags:
 *   --date=YYYY-MM-DD     (required)
 *   --time=HH:MM          (optional; matches that start time only)
 *   --status=confirmed    (optional; comma-separated; default "confirmed")
 *   --channel=sms|email   (required)
 *   --message="..."       (required; supports {name})
 *   --subject="..."       (required for email; supports {name})
 *   --template-key=...     (optional; SMS metadata + dedup label; default derived from date)
 *   --send                (actually send; omit for a dry run)
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

type Channel = 'sms' | 'email'

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {}
  let send = false
  for (const a of argv) {
    if (a === '--send') { send = true; continue }
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return { out, send }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toHtml(message: string): string {
  const paragraphs = message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;">${paragraphs}</div>`
}

function personalise(template: string, firstName: string | null): string {
  const name = firstName?.trim() || 'there'
  return template.replace(/\{name\}/g, name).replace(/\{first_name\}/g, name)
}

async function main(): Promise<void> {
  const { out, send } = parseArgs(process.argv.slice(2))

  const date = out.date
  const time = out.time
  const channel = out.channel as Channel
  const message = out.message
  const subject = out.subject
  const statuses = (out.status ?? 'confirmed').split(',').map((s) => s.trim()).filter(Boolean)
  const templateKey = out['template-key'] ?? `message_bookings_${(date ?? 'nodate').replace(/-/g, '')}`

  const errors: string[] = []
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('--date=YYYY-MM-DD is required')
  if (channel !== 'sms' && channel !== 'email') errors.push('--channel=sms|email is required')
  if (!message) errors.push('--message="..." is required')
  if (channel === 'email' && !subject) errors.push('--subject="..." is required for email')
  if (time && !/^\d{2}:\d{2}$/.test(time)) errors.push('--time must be HH:MM')
  if (errors.length) {
    console.error('Invalid arguments:\n- ' + errors.join('\n- '))
    process.exit(1)
  }

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  let query = supabase
    .from('table_bookings')
    .select(
      'id, booking_reference, party_size, status, booking_time, customer_id, customers(id, first_name, last_name, email, mobile_e164, sms_opt_in, sms_status)'
    )
    .eq('booking_date', date)
    .in('status', statuses)
  if (time) query = query.eq('booking_time', `${time}:00`)

  const { data: bookings, error } = await query
  if (error) throw error

  const rows = (bookings ?? []) as unknown as Array<{
    id: string
    booking_reference: string
    party_size: number
    status: string
    booking_time: string
    customers: {
      id: string
      first_name: string | null
      last_name: string | null
      email: string | null
      mobile_e164: string | null
      sms_opt_in: boolean | null
      sms_status: string | null
    } | null
  }>

  console.warn(
    `${send ? 'SENDING' : 'DRY RUN'} - channel=${channel} date=${date}${time ? ` time=${time}` : ''} status=[${statuses.join(',')}] - ${rows.length} booking(s)\n`
  )

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const b of rows) {
    const c = b.customers
    const who = `${c?.first_name ?? '?'} ${c?.last_name ?? ''} (${b.booking_reference}, ${b.booking_time?.slice(0, 5)}, party ${b.party_size})`
    if (!c?.id) {
      console.warn(`SKIP  ${who} - no customer record`)
      skipped += 1
      continue
    }

    const body = personalise(message!, c.first_name)

    if (channel === 'sms') {
      if (!c.mobile_e164) {
        console.warn(`SKIP  ${who} - no mobile number`)
        skipped += 1
        continue
      }
      if (!send) {
        console.warn(`WOULD SMS -> ${c.mobile_e164}  ${who}\n  "${body}"\n`)
        continue
      }
      try {
        const { sendSMS } = await import('@/lib/twilio')
        const res = await sendSMS(c.mobile_e164, body, {
          customerId: c.id,
          metadata: { template_key: templateKey, trigger_type: 'manual_announcement', table_booking_id: b.id },
        })
        if (res.success && !res.suppressed) {
          console.warn(`SENT  ${who} -> ${c.mobile_e164}  sid=${res.sid ?? 'n/a'}`)
          sent += 1
        } else if (res.suppressed) {
          console.warn(`SKIP  ${who} - suppressed (${res.suppressionReason ?? 'duplicate'})`)
          skipped += 1
        } else {
          console.error(`FAIL  ${who} - ${res.error ?? 'unknown error'}`)
          failed += 1
        }
      } catch (err) {
        console.error(`FAIL  ${who} - ${err instanceof Error ? err.message : String(err)}`)
        failed += 1
      }
    } else {
      if (!c.email) {
        console.warn(`SKIP  ${who} - no email address`)
        skipped += 1
        continue
      }
      const subj = personalise(subject!, c.first_name)
      if (!send) {
        console.warn(`WOULD EMAIL -> ${c.email}  ${who}\n  Subject: ${subj}\n  ${body.replace(/\n/g, '\n  ')}\n`)
        continue
      }
      try {
        const { sendEmail } = await import('@/lib/email/emailService')
        const res = await sendEmail({
          to: c.email,
          subject: subj,
          html: toHtml(body),
          text: body,
          customerId: c.id,
          commType: 'manual_announcement',
          tableBookingId: b.id,
          metadata: { template_key: templateKey, trigger_type: 'manual_announcement' },
        })
        if (res.success) {
          console.warn(`SENT  ${who} -> ${c.email}  id=${res.messageId ?? 'n/a'}`)
          sent += 1
        } else {
          console.error(`FAIL  ${who} - ${res.error ?? 'unknown error'}`)
          failed += 1
        }
      } catch (err) {
        console.error(`FAIL  ${who} - ${err instanceof Error ? err.message : String(err)}`)
        failed += 1
      }
    }
  }

  console.warn(`\nSummary: sent=${sent} skipped=${skipped} failed=${failed} (mode=${send ? 'SEND' : 'DRY RUN'})`)
}

main().catch((err) => {
  console.error('Script error:', err)
  process.exit(1)
})
