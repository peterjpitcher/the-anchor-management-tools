'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import type { ReengagementSuggestion } from '@/lib/hiring/reengagement'
import {
  generateOutreachMessageDraftAction,
  markOutreachMessageSentExternallyAction,
  sendOutreachMessageAction,
  updateOutreachMessageDraftAction,
} from '@/actions/hiring-outreach'

interface ReengagementPanelProps {
  jobId: string
  suggestions: ReengagementSuggestion[]
  canSend: boolean
}

export function ReengagementPanel({ jobId, suggestions, canSend }: ReengagementPanelProps) {
  const [items, setItems] = useState<ReengagementSuggestion[]>(suggestions)
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null)

  const updateMessage = (candidateId: string, updater: (message: any) => any) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.candidate.id !== candidateId) return item
        const nextMessage = item.message ? updater(item.message) : item.message
        return { ...item, message: nextMessage }
      })
    )
  }

  const handleGenerate = async (candidateId: string) => {
    if (!canSend) return
    setBusyCandidateId(candidateId)
    try {
      const result = await generateOutreachMessageDraftAction({ jobId, candidateId })
      if (!result.success) {
        toast.error(result.error || 'Failed to generate outreach draft')
        return
      }
      setItems((prev) =>
        prev.map((item) =>
          item.candidate.id === candidateId
            ? { ...item, message: result.data }
            : item
        )
      )
      toast.success('Draft generated')
    } finally {
      setBusyCandidateId(null)
    }
  }

  const handleSave = async (candidateId: string, messageId: string) => {
    const message = items.find((item) => item.candidate.id === candidateId)?.message
    if (!message) return

    setBusyCandidateId(candidateId)
    try {
      const result = await updateOutreachMessageDraftAction({
        messageId,
        subject: message.subject || '',
        body: message.body || '',
      })
      if (!result.success) {
        toast.error(result.error || 'Failed to update draft')
        return
      }
      updateMessage(candidateId, () => result.data)
      toast.success('Draft updated')
    } finally {
      setBusyCandidateId(null)
    }
  }

  const handleSend = async (candidateId: string, messageId: string) => {
    setBusyCandidateId(candidateId)
    try {
      const message = items.find((item) => item.candidate.id === candidateId)?.message
      const result = await sendOutreachMessageAction({
        messageId,
        subject: message?.subject || undefined,
        body: message?.body || undefined,
      })
      if (!result.success) {
        toast.error(result.error || 'Failed to send outreach message')
        return
      }
      updateMessage(candidateId, () => result.data)
      toast.success('Outreach email sent')
    } finally {
      setBusyCandidateId(null)
    }
  }

  const handleExternal = async (candidateId: string, messageId: string) => {
    setBusyCandidateId(candidateId)
    try {
      const message = items.find((item) => item.candidate.id === candidateId)?.message
      const result = await markOutreachMessageSentExternallyAction({
        messageId,
        subject: message?.subject || undefined,
        body: message?.body || undefined,
      })
      if (!result.success) {
        toast.error(result.error || 'Failed to log outreach message')
        return
      }
      updateMessage(candidateId, () => result.data)
      toast.success('Outreach logged')
    } finally {
      setBusyCandidateId(null)
    }
  }

  if (!items.length) {
    return (
      <EmptyState
        title="No re-engagement suggestions yet"
        description="Past candidates will appear here when we have a fit for this role."
        icon="users"
      />
    )
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const message = item.message
        const isDraft = message?.status === 'draft'
        const isBusy = busyCandidateId === item.candidate.id

        return (
          <div key={item.candidate.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-gray-900">
                  {item.candidate.first_name} {item.candidate.last_name}
                </div>
                <div className="text-xs text-gray-500">{item.candidate.email}</div>
                {item.lastApplication?.jobTitle && (
                  <div className="text-xs text-gray-400">
                    Last role: {item.lastApplication.jobTitle} ({item.lastApplication.stage || item.lastApplication.outcomeStatus || 'status unknown'})
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {message && (
                  <Badge variant={message.status === 'sent' ? 'success' : message.status === 'failed' ? 'error' : 'warning'}>
                    {message.status}
                  </Badge>
                )}
                {canSend && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isBusy}
                    onClick={() => handleGenerate(item.candidate.id)}
                  >
                    {message ? 'New draft' : 'Generate draft'}
                  </Button>
                )}
              </div>
            </div>

            {message && (
              <div className="space-y-3">
                <Input
                  value={message.subject || ''}
                  onChange={(event) =>
                    updateMessage(item.candidate.id, (current) => ({
                      ...current,
                      subject: event.target.value,
                    }))
                  }
                  disabled={!canSend || !isDraft}
                  placeholder="Subject"
                />
                <Textarea
                  rows={5}
                  value={message.body || ''}
                  onChange={(event) =>
                    updateMessage(item.candidate.id, (current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  disabled={!canSend || !isDraft}
                  placeholder="Outreach message"
                />

                {canSend && isDraft && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isBusy}
                      onClick={() => handleSave(item.candidate.id, message.id)}
                    >
                      Save draft
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={isBusy}
                      onClick={() => handleSend(item.candidate.id, message.id)}
                    >
                      Send email
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={isBusy}
                      onClick={() => handleExternal(item.candidate.id, message.id)}
                    >
                      Mark sent externally
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!canSend && (
              <div className="text-xs text-gray-400">You do not have permission to send outreach messages.</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
