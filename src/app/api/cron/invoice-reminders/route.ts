import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { runInvoiceReminders } from '@/lib/invoices/reminder-job'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Each reminder renders the invoice PDF in a headless browser. The job stops starting new sends
// well inside this limit (see SEND_TIME_BUDGET_MS), because a send cut off part way is an
// unknown outcome that ends that invoice's automatic reminders.
export const maxDuration = 300

// Automatic invoice reminders, weekdays at 09:30 UTC (`vercel.json`). Customers are emailed
// only once INVOICE_REMINDERS_GO_LIVE_DATE is set; until then the job marks invoices overdue
// and sends the owner his summary, nothing else. The whole job lives in
// src/lib/invoices/reminder-job.ts; the schedule it follows is src/lib/invoices/reminder-rules.ts.
// See tasks/spec-2026-10-04-invoice-issuing-and-chasing.md (R2).
export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { status, body } = await runInvoiceReminders()
  return NextResponse.json(body, { status })
}
