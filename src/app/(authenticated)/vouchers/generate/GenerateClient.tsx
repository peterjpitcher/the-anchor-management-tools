'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Card,
  Button,
  LinkButton,
  Input,
  Textarea,
  Alert,
  Spinner,
  ConfirmDialog,
  toast,
} from '@/ds'
import {
  MAX_PER_TYPE_PER_BATCH,
  MAX_CARDS_PER_BATCH,
  PDF_PAGES_PER_CARD,
} from '@/lib/vouchers/constants'
import { createVoucherBatch, getVoucherBatchProgress } from '@/app/actions/vouchers'
import type { VoucherBatchProgress } from '@/app/actions/vouchers'
import { formatDateInLondon } from '@/lib/dateUtils'

interface GenerateTypeOption {
  typeId: string
  displayTitle: string
  inStock: number
}

interface GenerateClientProps {
  types: GenerateTypeOption[]
  initialBatchId: string | null
}

type Phase = 'form' | 'creating' | 'rendering' | 'ready' | 'failed' | 'blocked'

interface RenderRefusal {
  message: string
  retryable: boolean
}

const POLL_INTERVAL_MS = 2000
const POLL_LIMIT = 240

export function GenerateClient({ types, initialBatchId }: GenerateClientProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>(initialBatchId ? 'rendering' : 'form')
  const [batchId, setBatchId] = useState<string | null>(initialBatchId)
  const [progress, setProgress] = useState<VoucherBatchProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<RenderRefusal | null>(null)
  const [downloadWarning, setDownloadWarning] = useState<{ deadCount: number } | null>(null)
  const pollCount = useRef(0)
  const stopped = useRef(false)

  const total = types.reduce((sum, type) => sum + (quantities[type.typeId] ?? 0), 0)
  const overCap = total > MAX_CARDS_PER_BATCH

  const setQuantity = (typeId: string, value: number) => {
    const clamped = Math.max(0, Math.min(MAX_PER_TYPE_PER_BATCH, Math.round(value)))
    setQuantities((prev) => ({ ...prev, [typeId]: clamped }))
  }

  const pollBatch = useCallback(async (id: string) => {
    if (stopped.current) return
    pollCount.current += 1
    const result = await getVoucherBatchProgress(id)
    if (stopped.current) return
    if (result.error || !result.data) {
      setError(result.error ?? 'Could not check the batch status.')
      setPhase('failed')
      return
    }
    setProgress(result.data)
    const status = result.data.batch.pdfStatus
    if (status === 'ready') {
      setPhase('ready')
      return
    }
    if (status === 'failed') {
      setPhase('failed')
      return
    }
    if (pollCount.current >= POLL_LIMIT) {
      setError('The render is taking longer than expected. Leave this page and come back, nothing is lost.')
      setPhase('failed')
      return
    }
    setTimeout(() => void pollBatch(id), POLL_INTERVAL_MS)
  }, [])

  useEffect(() => {
    stopped.current = false
    if (initialBatchId) {
      void pollBatch(initialBatchId)
    }
    return () => {
      stopped.current = true
    }
  }, [initialBatchId, pollBatch])

  const triggerRender = useCallback(
    async (id: string) => {
      setPhase('rendering')
      setError(null)
      setRefusal(null)
      pollCount.current = 0
      // Cleared before the request, never after it: if the page unmounts while
      // the request is in flight, the cleanup must still win and stop polling.
      stopped.current = false
      try {
        const response = await fetch(`/api/vouchers/batches/${id}/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        // The server refuses rather than starting a render: say why and stop,
        // instead of spinning on a poll that will never turn green.
        if (response.status === 409) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null
          stopped.current = true
          setRefusal({
            message: payload?.error ?? 'This batch cannot be rendered at the moment.',
            retryable: payload?.code !== 'RENDER_ATTEMPTS_EXHAUSTED',
          })
          setPhase('blocked')
          return
        }
      } catch {
        // The batch exists and the render can be retried; polling reports the truth.
      }
      void pollBatch(id)
    },
    [pollBatch]
  )

  const handleSubmit = async () => {
    const items = types
      .filter((type) => (quantities[type.typeId] ?? 0) > 0)
      .map((type) => ({ typeId: type.typeId, quantity: quantities[type.typeId] ?? 0 }))
    if (items.length === 0) {
      toast.error('Choose at least one voucher to print.')
      return
    }
    if (overCap) return

    setPhase('creating')
    setError(null)
    const result = await createVoucherBatch({ items, note: note.trim() || undefined })
    if (result.error || !result.data) {
      setError(result.error ?? 'Could not create the batch.')
      setPhase('form')
      return
    }
    setBatchId(result.data.batchId)
    await triggerRender(result.data.batchId)
  }

  const handleDownload = async () => {
    if (!batchId) return
    try {
      const response = await fetch(`/api/vouchers/batches/${batchId}/download?info=1`)
      if (response.ok) {
        const info = (await response.json()) as { deadCount?: number }
        if ((info.deadCount ?? 0) > 0) {
          setDownloadWarning({ deadCount: info.deadCount ?? 0 })
          return
        }
      }
    } catch {
      // If the info check fails, fall through to the download itself.
    }
    window.open(`/api/vouchers/batches/${batchId}/download`, '_blank', 'noopener')
  }

  const resetForm = () => {
    setQuantities({})
    setNote('')
    setBatchId(null)
    setProgress(null)
    setError(null)
    setRefusal(null)
    setPhase('form')
  }

  if (phase === 'form' || phase === 'creating') {
    return (
      <div className="max-w-3xl space-y-6">
        <Card title="How many of each card?" subtitle={`Maximum ${MAX_PER_TYPE_PER_BATCH} per type, ${MAX_CARDS_PER_BATCH} cards per batch`}>
          <div className="divide-y divide-gray-100">
            {types.map((type) => {
              const value = quantities[type.typeId] ?? 0
              return (
                <div
                  key={type.typeId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">{type.displayTitle}</div>
                    <div className="text-sm text-gray-500">In stock: {type.inStock}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Fewer ${type.displayTitle}`}
                      onClick={() => setQuantity(type.typeId, value - 1)}
                      disabled={value <= 0}
                    >
                      -
                    </Button>
                    <div className="w-20">
                      <Input
                        type="number"
                        min={0}
                        max={MAX_PER_TYPE_PER_BATCH}
                        value={String(value)}
                        aria-label={`Quantity of ${type.displayTitle}`}
                        onChange={(event) => setQuantity(type.typeId, Number(event.target.value) || 0)}
                        className="text-center"
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`More ${type.displayTitle}`}
                      onClick={() => setQuantity(type.typeId, value + 1)}
                      disabled={value >= MAX_PER_TYPE_PER_BATCH}
                    >
                      +
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card>
          <Textarea
            label="Batch note (optional)"
            hint="For example: Quiz night prizes, autumn stock"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={500}
          />
        </Card>

        {overCap && (
          <Alert tone="warning" title={`A batch can hold at most ${MAX_CARDS_PER_BATCH} cards`}>
            Split larger runs into separate batches. You have {total} cards selected.
          </Alert>
        )}
        {error && (
          <Alert tone="danger" title="Could not create the batch">
            {error}
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-gray-700" aria-live="polite">
            {total} vouchers · {total} A4 sheets · {total * PDF_PAGES_PER_CARD} PDF pages
          </div>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={total === 0 || overCap || phase === 'creating'}
            loading={phase === 'creating'}
          >
            Generate batch
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'rendering') {
    return (
      <div className="max-w-3xl">
        <Card>
          <div className="flex items-center gap-3 py-6">
            <Spinner size="md" />
            <div>
              <div className="font-medium text-gray-900">Rendering the print PDF</div>
              <div className="text-sm text-gray-500">
                This can take a minute for larger batches. If you close this page the batch is
                safe: come back via the overview to download or retry.
              </div>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  if (phase === 'blocked') {
    return (
      <div className="max-w-3xl space-y-4">
        <Alert tone="warning" title="This batch cannot be rendered right now">
          {refusal?.message ?? 'This batch cannot be rendered at the moment.'}
        </Alert>
        {batchId && (
          <p className="text-sm text-gray-600">
            Nothing has been lost: the vouchers still exist. Quote batch reference{' '}
            <span className="font-mono text-gray-900">{batchId}</span> if you need help.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {batchId && refusal?.retryable !== false && (
            <Button variant="primary" onClick={() => void triggerRender(batchId)}>
              Try the render again
            </Button>
          )}
          <Button variant="secondary" onClick={resetForm}>
            Start a new batch
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="max-w-3xl space-y-4">
        <Alert tone="danger" title="The PDF render failed">
          {progress?.batch.renderError ?? error ?? 'Unknown render error.'}
        </Alert>
        {batchId && (
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void triggerRender(batchId)}>
              Retry render
            </Button>
            <Button variant="secondary" onClick={resetForm}>
              Start a new batch
            </Button>
          </div>
        )}
      </div>
    )
  }

  const batch = progress?.batch

  return (
    <div className="max-w-3xl space-y-6">
      <Alert tone="success" title="Batch ready to print">
        The PDF has rendered and every card in it now counts as stock.
      </Alert>

      <Card
        title="Batch summary"
        subtitle={
          batch
            ? `Created ${formatDateInLondon(batch.createdAt, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })} by ${batch.createdByName}${batch.note ? `, note: ${batch.note}` : ''}`
            : undefined
        }
      >
        <div className="space-y-3">
          <ul className="space-y-1">
            {(progress?.countsByType ?? []).map((row) => (
              <li key={row.typeId} className="flex justify-between text-sm">
                <span className="text-gray-700">{row.displayTitle}</span>
                <span className="font-medium text-gray-900">{row.count}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-gray-100 pt-3 text-sm text-gray-700">
            Numbers{' '}
            <span className="font-mono font-medium text-gray-900">
              {progress?.firstNumber ?? '?'}
            </span>{' '}
            to{' '}
            <span className="font-mono font-medium text-gray-900">
              {progress?.lastNumber ?? '?'}
            </span>
            {batch ? `, ${batch.totalCount} cards, ${batch.totalCount * PDF_PAGES_PER_CARD} PDF pages` : ''}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="primary" onClick={() => void handleDownload()}>
              Download PDF
            </Button>
            {batchId && (
              <LinkButton
                variant="secondary"
                href={`/api/vouchers/batches/${batchId}/manifest`}
                target="_blank"
              >
                Download manifest CSV
              </LinkButton>
            )}
            <Button variant="ghost" onClick={resetForm}>
              Generate another batch
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Print instructions">
        <blockquote className="border-l-4 border-gray-300 pl-4 text-sm text-gray-700">
          A4 landscape · print <strong>double sided, flip on short edge</strong> · 100% scale, no
          &quot;fit to page&quot; · fold each sheet down the middle. Pages come in pairs: odd pages
          are the outside (back cover + front cover), even pages are the inside spread.
        </blockquote>
      </Card>

      <ConfirmDialog
        open={downloadWarning !== null}
        onClose={() => setDownloadWarning(null)}
        onConfirm={() => {
          setDownloadWarning(null)
          if (batchId) window.open(`/api/vouchers/batches/${batchId}/download`, '_blank', 'noopener')
        }}
        title="This file contains cards that are no longer stock"
        message={`This file contains ${downloadWarning?.deadCount ?? 0} card${
          (downloadWarning?.deadCount ?? 0) === 1 ? '' : 's'
        } that have since been issued or cancelled. Only reprint pages you know are safe to print.`}
        confirmLabel="Download anyway"
        tone="warning"
      />
    </div>
  )
}
