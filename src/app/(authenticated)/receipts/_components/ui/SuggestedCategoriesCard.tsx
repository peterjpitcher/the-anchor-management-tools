'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/ds'
import { acceptVendorCategoryProposals, getReceiptCategoryProposals } from '@/app/actions/receipt-ai'
import { NO_CATEGORY_LABEL } from '@/lib/receipts/no-category'
import type { CategoryProposal, CategoryProposalGroup } from '@/services/receipts/receiptAiReview'
import { formatCurrency, formatDate } from '@/app/(authenticated)/receipts/utils'

const PREVIEW_ROWS = 5

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function proposalLabel(proposal: Pick<CategoryProposal, 'category' | 'noCategoryApplies'>): string {
  return proposal.noCategoryApplies ? NO_CATEGORY_LABEL : proposal.category ?? 'None'
}

/** "Telephone (10), Licensing (2)": what accepting the whole group would write. */
export function summariseProposals(proposals: CategoryProposal[]): string {
  const counts = new Map<string, number>()
  for (const proposal of proposals) {
    const label = proposalLabel(proposal)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => `${label} (${count})`)
    .join(', ')
}

function groupKey(group: CategoryProposalGroup): string {
  return group.vendorId ?? 'none'
}

interface SuggestedCategoriesCardProps {
  initialGroups: CategoryProposalGroup[]
  /** Set when the suggestions could not be loaded; the rest of the page still works. */
  loadError?: string | null
}

/**
 * Categories the AI has suggested, by vendor. Nothing here has been written to a payment.
 * "Accept all" writes one vendor's suggestions as a recorded run, which Recent runs can undo.
 */
export function SuggestedCategoriesCard({ initialGroups, loadError }: SuggestedCategoriesCardProps) {
  const router = useRouter()
  const [groups, setGroups] = useState(initialGroups)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<CategoryProposalGroup | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setGroups(initialGroups)
  }, [initialGroups])

  if (loadError) {
    return (
      <Alert tone="warning" title="Suggested categories could not be loaded" role="status">
        {loadError}
      </Alert>
    )
  }
  if (groups.length === 0) return null

  const total = groups.reduce((sum, group) => sum + group.proposals.length, 0)

  function acceptAll(group: CategoryProposalGroup) {
    startTransition(async () => {
      const result = await acceptVendorCategoryProposals({ vendorId: group.vendorId })
      setConfirming(null)

      const accepted = result.accepted ?? 0
      const left: string[] = []
      if ((result.skippedChanged ?? 0) > 0) left.push(`${result.skippedChanged} had changed and were left`)
      if ((result.skippedLocked ?? 0) > 0) left.push(`${result.skippedLocked} are on or before the lock date`)
      const detail = left.length ? ` ${left.join('; ')}.` : ''

      if (result.error) {
        toast.error(accepted > 0 ? `${result.error} ${accepted} were accepted before it stopped.${detail}` : result.error)
      } else {
        toast.success(`Accepted ${plural(accepted, 'suggestion', 'suggestions')} for ${group.vendorName}.${detail}`)
      }

      const refreshed = await getReceiptCategoryProposals()
      if (refreshed.groups) setGroups(refreshed.groups)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader
        title="Suggested categories"
        subtitle="Suggested by the AI and not yet written to any transaction. Accept a vendor's suggestions together, or one at a time from the transaction list."
        action={<Badge tone="info">{plural(total, 'suggestion', 'suggestions')}</Badge>}
      />
      <CardBody className="space-y-4">
        {groups.map((group) => {
          const key = groupKey(group)
          const isOpen = expanded === key
          const shown = isOpen ? group.proposals : group.proposals.slice(0, PREVIEW_ROWS)
          return (
            <div key={key} className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-text-strong">{group.vendorName}</p>
                  <p className="text-sm text-text-muted">
                    {plural(group.proposals.length, 'transaction', 'transactions')}: {summariseProposals(group.proposals)}
                  </p>
                </div>
                <Button size="sm" variant="primary" onClick={() => setConfirming(group)} disabled={isPending}>
                  Accept all
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead align="right">Out</TableHead>
                      <TableHead>Suggested</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((proposal) => (
                      <TableRow key={proposal.transactionId}>
                        <TableCell>{formatDate(proposal.transactionDate)}</TableCell>
                        <TableCell>{proposal.details}</TableCell>
                        <TableCell align="right">{formatCurrency(proposal.amount)}</TableCell>
                        <TableCell>{proposalLabel(proposal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {group.proposals.length > PREVIEW_ROWS && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : key)}
                >
                  {isOpen ? 'Show fewer' : `Show all ${group.proposals.length}`}
                </Button>
              )}
            </div>
          )
        })}
      </CardBody>
      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => (isPending ? undefined : setConfirming(null))}
        onConfirm={() => (confirming ? acceptAll(confirming) : undefined)}
        title="Accept all suggestions"
        message={
          confirming
            ? `Write the suggested category to ${plural(confirming.proposals.length, 'transaction', 'transactions')} for ${confirming.vendorName}: ${summariseProposals(confirming.proposals)}. A transaction that has changed since this list loaded, or is on or before the lock date, is left alone. You can undo this from Recent runs in the rules section.`
            : ''
        }
        confirmLabel="Accept all"
        tone="primary"
      />
    </Card>
  )
}
