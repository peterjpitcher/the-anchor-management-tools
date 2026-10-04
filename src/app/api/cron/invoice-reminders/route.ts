import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { previewInvoiceReminders, runInvoiceReminders } from '@/lib/invoices/reminder-job'

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

  // `?preview=true&go_live=YYYY-MM-DD` answers "what would a run send if reminders went live
  // from that date?" and does nothing else: no email, no record, no change. It is how the list
  // for the owner's go-live check is produced. `as_of=YYYY-MM-DD` asks about another day.
  const url = new URL(request.url)
  if (url.searchParams.get('preview') === 'true') {
    const preview = await previewInvoiceReminders({
      goLiveDate: url.searchParams.get('go_live'),
      asOf: url.searchParams.get('as_of'),
    })
    return NextResponse.json(preview.body, { status: preview.status })
  }

  // The scheduler calls this route with no query string. Anything else is a person asking for
  // a preview and getting it slightly wrong (`preview=1`, a misspelt name). That must never fall
  // through to a real run, which uses up the day's run and, once live, emails customers.
  if ([...url.searchParams.keys()].length > 0) {
    return NextResponse.json(
      { error: 'Unrecognised query. For a preview use ?preview=true&go_live=YYYY-MM-DD. A real run takes no query.' },
      { status: 400 }
    )
  }

  const { status, body } = await runInvoiceReminders()
  return NextResponse.json(body, { status })
}
