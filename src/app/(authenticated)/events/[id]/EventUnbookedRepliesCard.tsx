'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/ds'
import { listUnbookedEventReplies, type UnbookedEventReply } from '@/app/actions/unbooked-event-replies'
import { formatDateTimeInLondon } from '@/lib/dateUtils'

/**
 * Text replies to this event's promotion that nobody could book (BK-034). Each stays here until
 * someone reads the conversation in Messages. Hidden when there are none.
 */
export function EventUnbookedRepliesCard({ eventId }: { eventId: string }): React.JSX.Element | null {
  const [replies, setReplies] = useState<UnbookedEventReply[]>([])
  useEffect(() => {
    let cancelled = false
    listUnbookedEventReplies({ eventId })
      .then((result) => { if (!cancelled && result.data) setReplies(result.data) })
      .catch(() => { /* The card is a prompt; the replies are still in Messages. */ })
    return () => { cancelled = true }
  }, [eventId])

  if (replies.length === 0) return null
  return (
    <Card>
      <CardHeader
        title="Unbooked Event Replies"
        subtitle={`${replies.length} text ${replies.length === 1 ? 'reply' : 'replies'} we could not book automatically. Read each one and book the guest by hand.`}
      />
      <CardBody>
        <ul className="space-y-2">
          {replies.map((reply) => (
            <li key={reply.messageId} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium text-text">{reply.firstName}</span>
                <span className="text-text-muted"> · {formatDateTimeInLondon(reply.receivedAt, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              </span>
              <Link className="text-primary underline" href={`/messages?customer=${reply.customerId}`}>Open conversation</Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
