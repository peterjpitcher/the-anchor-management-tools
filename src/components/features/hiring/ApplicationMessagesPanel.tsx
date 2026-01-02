'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Select } from '@/components/ui-v2/forms/Select'
import { Badge } from '@/components/ui-v2/display/Badge'
import {
    generateApplicationMessageDraftAction,
    updateApplicationMessageDraftAction,
    sendApplicationMessageAction,
    markApplicationMessageSentExternallyAction,
} from '@/actions/hiring'
import type { HiringApplicationMessage } from '@/types/database'

type MessageType = 'invite' | 'clarify' | 'reject' | 'feedback'

const MESSAGE_TYPES: Array<{ value: MessageType; label: string }> = [
    { value: 'invite', label: 'Invite' },
    { value: 'clarify', label: 'Clarify' },
    { value: 'reject', label: 'Reject' },
    { value: 'feedback', label: 'Feedback' },
]

function statusVariant(status: HiringApplicationMessage['status']) {
    switch (status) {
        case 'sent':
            return 'success'
        case 'failed':
            return 'error'
        case 'cancelled':
            return 'warning'
        case 'draft':
        default:
            return 'info'
    }
}

function formatStatus(status: HiringApplicationMessage['status']) {
    if (status === 'sent') return 'Sent'
    if (status === 'failed') return 'Failed'
    if (status === 'cancelled') return 'Cancelled'
    return 'Draft'
}

function formatDateTime(value?: string | null) {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString()
}

interface ApplicationMessagesPanelProps {
    applicationId: string
    initialMessages: HiringApplicationMessage[]
    canSend: boolean
    initialMessageType?: MessageType
}

export function ApplicationMessagesPanel({
    applicationId,
    initialMessages,
    canSend,
    initialMessageType,
}: ApplicationMessagesPanelProps) {
    const [messageType, setMessageType] = useState<MessageType>(initialMessageType || 'invite')
    const [messages, setMessages] = useState<HiringApplicationMessage[]>(initialMessages)
    const [activeMessageId, setActiveMessageId] = useState<string | null>(() => {
        const draft = initialMessages.find((msg) => msg.status === 'draft')
        return draft?.id || initialMessages[0]?.id || null
    })
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [rejectionReason, setRejectionReason] = useState('')
    const [actionState, setActionState] = useState<'generate' | 'save' | 'send' | 'external' | 'asking-reason' | null>(null)

    const activeMessage = useMemo(
        () => messages.find((message) => message.id === activeMessageId) || null,
        [messages, activeMessageId]
    )

    useEffect(() => {
        setMessages(initialMessages)
        if (!activeMessageId && initialMessages.length > 0) {
            setActiveMessageId(initialMessages[0].id)
        }
    }, [initialMessages, activeMessageId])

    useEffect(() => {
        if (!activeMessage) {
            setSubject('')
            setBody('')
            return
        }
        setSubject(activeMessage.subject || '')
        setBody(activeMessage.body || '')
    }, [activeMessage])

    useEffect(() => {
        if (initialMessageType) {
            setMessageType(initialMessageType)
        }
    }, [initialMessageType])

    const updateMessageInState = (updated: HiringApplicationMessage) => {
        setMessages((prev) => prev.map((msg) => (msg.id === updated.id ? updated : msg)))
    }

    const handleGenerateDraft = async () => {
        if (!canSend) {
            toast.error('You do not have permission to send messages.')
            return
        }
        setActionState('generate')
        const result = await generateApplicationMessageDraftAction({
            applicationId,
            messageType,
            rejectionReason: messageType === 'reject' ? rejectionReason : undefined,
        })
        setActionState(null)
        if (messageType === 'reject') setRejectionReason('')

        if (!result.success || !result.data) {
            toast.error(result.error || 'Failed to generate draft')
            return
        }

        setMessages((prev) => [result.data, ...prev])
        setActiveMessageId(result.data.id)
        toast.success('Draft generated')
    }

    const handleSaveDraft = async () => {
        if (!activeMessage) return
        setActionState('save')
        const result = await updateApplicationMessageDraftAction({
            messageId: activeMessage.id,
            subject,
            body,
        })
        setActionState(null)

        if (!result.success || !result.data) {
            toast.error(result.error || 'Failed to save draft')
            return
        }

        updateMessageInState(result.data)
        toast.success('Draft saved')
    }

    const handleSend = async () => {
        if (!activeMessage) return
        if (!canSend) {
            toast.error('You do not have permission to send messages.')
            return
        }
        setActionState('send')
        const result = await sendApplicationMessageAction({
            messageId: activeMessage.id,
            subject,
            body,
        })
        setActionState(null)

        if (!result.success || !result.data) {
            toast.error(result.error || 'Failed to send email')
            return
        }

        updateMessageInState(result.data)
        toast.success('Email sent')
    }

    const handleMarkExternal = async () => {
        if (!activeMessage) return
        if (!canSend) {
            toast.error('You do not have permission to send messages.')
            return
        }
        setActionState('external')
        const result = await markApplicationMessageSentExternallyAction({
            messageId: activeMessage.id,
            subject,
            body,
        })
        setActionState(null)

        if (!result.success || !result.data) {
            toast.error(result.error || 'Failed to update message')
            return
        }

        updateMessageInState(result.data)
        toast.success('Marked as sent externally')
    }

    const isDraft = activeMessage?.status === 'draft'

    return (
        <div className="bg-white shadow rounded-lg p-6 space-y-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-medium text-gray-900">Candidate Messages</h3>
                    <p className="text-sm text-gray-500">Generate, review, and send replies.</p>
                    {!canSend && (
                        <p className="text-sm text-amber-600 mt-1">You have read-only access to messages.</p>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <Select
                        value={messageType}
                        onChange={(event) => setMessageType(event.target.value as MessageType)}
                        fullWidth={false}
                        wrapperClassName="min-w-[160px]"
                    >
                        {MESSAGE_TYPES.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                    <Button
                        type="button"
                        onClick={() => {
                            if (messageType === 'reject') {
                                setActionState('asking-reason')
                            } else {
                                handleGenerateDraft()
                            }
                        }}
                        loading={actionState === 'generate'}
                        disabled={!canSend}
                    >
                        Generate Draft
                    </Button>
                </div>
            </div>

            {actionState === 'asking-reason' && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-4">
                    <h4 className="text-sm font-medium text-amber-900 mb-2">Why are you rejecting this candidate?</h4>
                    <p className="text-xs text-amber-700 mb-3">
                        Providing a specific reason prevents the AI from making assumptions (e.g. about Right to Work).
                    </p>
                    <Textarea
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="e.g. Not enough experience with cocktails, Availability doesn't match rota..."
                        className="mb-3 bg-white"
                        rows={2}
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setActionState(null)
                                setRejectionReason('')
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => handleGenerateDraft()}
                        >
                            Generate Rejection Email
                        </Button>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                <FormGroup label="Subject">
                    <Input
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                        disabled={!isDraft || !canSend}
                    />
                </FormGroup>
                <FormGroup label="Message Body">
                    <Textarea
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                        rows={8}
                        disabled={!isDraft || !canSend}
                    />
                </FormGroup>
                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleSaveDraft}
                        disabled={!isDraft || !canSend}
                        loading={actionState === 'save'}
                    >
                        Save Draft
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSend}
                        disabled={!isDraft || !canSend}
                        loading={actionState === 'send'}
                    >
                        Send Email
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleMarkExternal}
                        disabled={!isDraft || !canSend}
                        loading={actionState === 'external'}
                    >
                        Mark Sent Externally
                    </Button>
                    {!isDraft && activeMessage && (
                        <span className="text-sm text-gray-500">
                            Drafts can be edited or sent. Sent messages are read-only.
                        </span>
                    )}
                </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Comms Log</h4>
                {messages.length === 0 && (
                    <p className="text-sm text-gray-500">No messages yet.</p>
                )}
                <div className="space-y-3">
                    {messages.map((message) => (
                        <button
                            key={message.id}
                            type="button"
                            onClick={() => setActiveMessageId(message.id)}
                            className={`w-full text-left border rounded-lg px-4 py-3 transition ${activeMessageId === message.id
                                ? 'border-green-500 bg-green-50'
                                : 'border-gray-200 hover:border-gray-300'
                                }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="font-medium text-gray-900 truncate">{message.subject || 'Untitled message'}</div>
                                <Badge variant={statusVariant(message.status)}>{formatStatus(message.status)}</Badge>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {message.status === 'sent' ? 'Sent' : 'Created'} {formatDateTime(message.sent_at || message.created_at)}
                                {message.sent_via ? ` - ${message.sent_via}` : ''}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
