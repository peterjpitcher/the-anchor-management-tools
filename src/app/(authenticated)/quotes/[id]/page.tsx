import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getQuote } from '@/app/actions/quotes'
import { getEmailConfigStatus } from '@/app/actions/email'
import QuoteDetailClient from './QuoteDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * The quote is loaded here, on the server, as the invoice page does, so the page is titled with
 * the quote number ("Quote Q-001") from its first render and never shows a different title.
 */
export default async function QuotePage({ params }: Props): Promise<React.JSX.Element> {
  const { id } = await params

  const canView = await checkUserPermission('invoices', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const [quoteResult, emailConfigResult] = await Promise.all([
    getQuote(id),
    getEmailConfigStatus(),
  ])

  if (quoteResult.error || !quoteResult.quote) {
    notFound()
  }

  return (
    <QuoteDetailClient
      initialQuote={quoteResult.quote}
      emailConfigured={!emailConfigResult.error && !!emailConfigResult.configured}
    />
  )
}
