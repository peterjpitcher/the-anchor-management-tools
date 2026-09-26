import { Card } from '@/ds'
import { OrangeJellyShell } from '@/components/shells/OrangeJellyShell'
import { InvoiceQuestions } from './InvoiceQuestions'

/**
 * A payment link that does not verify, or points at an invoice that no longer exists. Drawn in
 * the same Orange Jelly frame as the payment page rather than the bare Next.js 404, and just as
 * generic: this URL reaches inboxes and link previewers.
 */
export default function InvoiceNotFound(): React.JSX.Element {
  return (
    <OrangeJellyShell>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-text-strong">This link is not working</h1>
        <p className="text-sm text-text-muted">We could not find an invoice for this link.</p>
      </div>

      <Card padding="lg">
        <p className="text-sm text-text">
          Please check you used the whole link from your invoice email. If it still does not open,
          get in touch using the details below.
        </p>
      </Card>

      <InvoiceQuestions />
    </OrangeJellyShell>
  )
}
