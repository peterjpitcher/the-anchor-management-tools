import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { getTodayIsoDate, formatDate, formatDateFull } from '@/lib/dateUtils'
import { getOutstandingTodos, EVENT_CHECKLIST_DEFINITIONS } from '@/lib/event-checklist'
import { sendEmail } from '@/lib/email/emailService'

const RECIPIENT = process.env.EVENT_CHECKLIST_EMAIL_RECIPIENT || 'peter@orangejelly.co.uk'

type ChecklistEventSummary = {
  eventId: string
  eventName: string
  eventDate: string
  tasks: Array<{
    label: string
    dueDate: string
    dueDateFormatted: string
    status: 'overdue' | 'due_today'
    channel: string
  }>
}

export async function GET(request: Request) {
// ...
  try {
    const auth = authorizeCronRequest(request)
    if (!auth.authorized) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const supabase = createAdminClient()
    // ...
    const todayIso = getTodayIsoDate()

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, date')
      .gte('date', todayIso)
      .order('date', { ascending: true })

    if (eventsError) {
      console.error('[Checklist Cron] Failed to load events', eventsError)
      return new NextResponse('Failed to load events', { status: 500 })
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ success: true, message: 'No upcoming events' }, { status: 200 })
    }

    const eventIds = events.map(event => event.id)

    const { data: statusRows, error: statusError } = await supabase
      .from('event_checklist_statuses')
      .select('event_id, task_key, completed_at')
      .in('event_id', eventIds)

    if (statusError) {
      console.error('[Checklist Cron] Failed to load statuses', statusError)
      return new NextResponse('Failed to load checklist statuses', { status: 500 })
    }

    const statusMap = new Map<string, { task_key: string; completed_at: string | null }[]>()
    statusRows?.forEach((row) => {
      const existing = statusMap.get(row.event_id) ?? []
      existing.push({ task_key: row.task_key, completed_at: row.completed_at })
      statusMap.set(row.event_id, existing)
    })

    const summaries: ChecklistEventSummary[] = []

    events.forEach((event) => {
      if (!event.date) return
      const statuses = statusMap.get(event.id) ?? []
      const outstanding = getOutstandingTodos(
        { id: event.id, name: event.name, date: event.date },
        statuses.map(status => ({
          event_id: event.id,
          task_key: status.task_key,
          completed_at: status.completed_at
        })),
        todayIso
      )
        .filter(item => item.status === 'overdue' || item.status === 'due_today')
        .sort((a, b) => {
          if (a.status !== b.status) {
            if (a.status === 'overdue') return -1
            if (b.status === 'overdue') return 1
          }
          if (a.dueDate === b.dueDate) {
            return a.order - b.order
          }
          return a.dueDate.localeCompare(b.dueDate)
        })

      if (outstanding.length === 0) {
        return
      }

      const summary: ChecklistEventSummary = {
        eventId: event.id,
        eventName: event.name,
        eventDate: event.date,
        tasks: outstanding.map(item => ({
          label: item.label,
          dueDate: item.dueDate,
          dueDateFormatted: item.dueDateFormatted,
          status: item.status as 'overdue' | 'due_today',
          channel: item.channel
        }))
      }

      summaries.push(summary)
    })

    if (summaries.length === 0) {
      return NextResponse.json({ success: true, message: 'No checklist tasks overdue or due today' }, { status: 200 })
    }

    let overdueCount = 0
    let dueTodayCount = 0

    summaries.forEach(summary => {
      summary.tasks.forEach(task => {
        if (task.status === 'overdue') overdueCount += 1
        if (task.status === 'due_today') dueTodayCount += 1
      })
    })

    const todayDisplay = formatDateFull(new Date())
    const subject = `Event checklist reminder – ${todayDisplay}`

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'

    const htmlBody = [`
      <h2 style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin-bottom: 16px;">Event checklist reminder</h2>
      <p style="margin: 0 0 12px 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #374151;">
        ${overdueCount} overdue • ${dueTodayCount} due today • ${EVENT_CHECKLIST_DEFINITIONS.length} tasks per event
      </p>
      <p style="margin: 0 0 16px 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #4b5563;">
        View full checklist: <a href="${appUrl}/events/todo" style="color: #2563eb;">${appUrl}/events/todo</a>
      </p>
    `]

    summaries
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
      .forEach(summary => {
        const eventDateFormatted = formatDateFull(summary.eventDate)
        const taskItems = summary.tasks.map(task => {
          const badgeColor = task.status === 'overdue' ? '#dc2626' : '#d97706'
          const badgeLabel = task.status === 'overdue' ? 'Overdue' : 'Due today'
          const dueCopy = task.status === 'overdue' ? 'since' : 'on'
          return `
            <li style="margin-bottom: 8px;">
              <span style="display: inline-block; min-width: 90px; font-weight: 600; color: ${badgeColor};">${badgeLabel}</span>
              <span style="font-weight: 500; color: #111827;">${task.label}</span>
              <span style="color: #6b7280;"> – due ${dueCopy} ${task.dueDateFormatted} (${task.channel})</span>
            </li>
          `
        }).join('')

        htmlBody.push(`
          <div style="margin-bottom: 20px;">
            <h3 style="margin: 0 0 4px 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827;">${summary.eventName}</h3>
            <p style="margin: 0 0 8px 0; color: #6b7280; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">Event ${eventDateFormatted}</p>
            <ul style="margin: 0; padding-left: 18px; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #374151;">
              ${taskItems}
            </ul>
          </div>
        `)
      })

    const textBodyLines = [
      `Event checklist reminder`,
      '',
      `${overdueCount} overdue • ${dueTodayCount} due today`,
      `View full checklist: ${appUrl}/events/todo`,
      ''
    ]

    summaries
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
      .forEach(summary => {
        textBodyLines.push(`${summary.eventName} (${formatDate(summary.eventDate)})`)
        summary.tasks.forEach(task => {
          const label = task.status === 'overdue' ? 'Overdue' : 'Due today'
          const dueCopy = task.status === 'overdue' ? 'since' : 'on'
          textBodyLines.push(`  - [${label}] ${task.label} • due ${dueCopy} ${task.dueDateFormatted} (${task.channel})`)
        })
        textBodyLines.push('')
      })

    const emailResult = await sendEmail({
      to: RECIPIENT,
      subject,
      html: htmlBody.join('\n'),
      text: textBodyLines.join('\n')
    })

    if (!emailResult.success) {
      console.error('[Checklist Cron] Failed to send email', emailResult.error)
      return new NextResponse('Failed to send email', { status: 500 })
    }

    return NextResponse.json({
      success: true,
      sent: true,
      recipient: RECIPIENT,
      overdue: overdueCount,
      dueToday: dueTodayCount,
      events: summaries.length
    })
  } catch (error) {
    console.error('[Checklist Cron] Unexpected error', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
