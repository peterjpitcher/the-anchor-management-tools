'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CardBody,
  Empty,
  PageLayout,
  Textarea,
  toast,
} from '@/ds'
import { recordSpotCheck } from '@/app/actions/checklists-spotcheck'
import type { SpotCheckView } from '@/app/actions/checklists-spotcheck'
import { checklistsManageLayout } from '../../_shared/nav'
import { CHECKLIST_SPOT_CHECK_STATUS } from '../../_shared/status-ui'

/** This tab's page chrome: the same title, subtitle and tabs in every state. */
const LAYOUT = checklistsManageLayout('spot-checks')

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
      <PageLayout {...LAYOUT}>
        <Alert tone="danger" title="Could not load spot checks">
          {error}
        </Alert>
      </PageLayout>
    )
  }

  if (items.length === 0) {
    return (
      <PageLayout {...LAYOUT}>
        <Card>
          <Empty
            title="Nothing to check yet"
            description="No spot checks have been drawn today. A check can only be drawn once a spot-checkable task has been completed. Open this tab again later in the day."
          />
        </Card>
      </PageLayout>
    )
  }

  return (
    <PageLayout {...LAYOUT}>
      {items.map((item) => {
        const recorded = item.state === 'recorded'
        const status =
          CHECKLIST_SPOT_CHECK_STATUS[recorded ? (item.result === 'pass' ? 'pass' : 'fail') : 'awaiting']
        return (
          <Card key={item.id}>
            <CardHeader
              title={`Draw ${item.drawNumber}: ${item.taskTitle}`}
              subtitle={`${item.checklistName} · Completed by ${item.checkedEmployeeName}`}
              action={<Badge tone={status.tone}>{status.label}</Badge>}
            />
            <CardBody className="space-y-3">
              {recorded ? (
                item.note ? (
                  <p className="text-sm text-text-muted">Note: {item.note}</p>
                ) : (
                  <p className="text-sm text-text-soft">No note.</p>
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
                    {/* Secondary, not danger: a fail is a result to record, not something destroyed,
                        and a danger button always opens a danger confirm. */}
                    <Button
                      type="button"
                      variant="secondary"
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
    </PageLayout>
  )
}
