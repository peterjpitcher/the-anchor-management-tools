'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CardBody,
  Textarea,
} from '@/ds'
import { recordSpotCheck } from '@/app/actions/checklists-spotcheck'
import type { SpotCheckView } from '@/app/actions/checklists-spotcheck'

interface SpotChecksClientProps {
  items: SpotCheckView[]
  error?: string
}

export function SpotChecksClient({ items, error }: SpotChecksClientProps) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  async function record(item: SpotCheckView, result: 'pass' | 'fail') {
    setBusyId(item.id)
    const res = await recordSpotCheck({
      spotCheckId: item.id,
      result,
      note: notes[item.id]?.trim() || undefined,
    })
    setBusyId(null)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success(result === 'pass' ? 'Recorded as pass' : 'Recorded as fail')
    router.refresh()
  }

  if (error) {
    return (
      <Alert tone="danger" title="Could not load spot checks">
        {error}
      </Alert>
    )
  }

  if (items.length === 0) {
    return (
      <Alert tone="info" title="Nothing to check yet">
        No spot checks have been drawn today. A check can only be drawn once a spot-checkable
        task has been completed. Open this tab again later in the day.
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const recorded = item.state === 'recorded'
        return (
          <Card key={item.id}>
            <CardHeader
              title={`Draw ${item.drawNumber}: ${item.taskTitle}`}
              subtitle={`${item.checklistName} · Completed by ${item.checkedEmployeeName}`}
              action={
                recorded ? (
                  <Badge tone={item.result === 'pass' ? 'success' : 'danger'}>
                    {item.result === 'pass' ? 'Pass' : 'Fail'}
                  </Badge>
                ) : (
                  <Badge tone="warning">Awaiting check</Badge>
                )
              }
            />
            <CardBody className="space-y-3">
              {recorded ? (
                item.note ? (
                  <p className="text-sm text-text-muted">Note: {item.note}</p>
                ) : (
                  <p className="text-sm text-text-subtle">No note.</p>
                )
              ) : (
                <>
                  <Textarea
                    label="Note (optional)"
                    rows={2}
                    value={notes[item.id] ?? ''}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => record(item, 'pass')}
                      loading={busyId === item.id}
                    >
                      Pass
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => record(item, 'fail')}
                      loading={busyId === item.id}
                    >
                      Fail
                    </Button>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
