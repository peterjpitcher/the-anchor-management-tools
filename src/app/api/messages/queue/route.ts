import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type QueueAction = 'reconcile' | 'retry' | 'clear_old'

const QUEUE_LIMIT_DEFAULT = 500
const JOB_LIMIT_DEFAULT = 100
const TWILIO_BATCH_SIZE = 10

const QUEUED_STATUSES = new Set(['queued', 'accepted', 'scheduled'])
const PENDING_STATUSES = new Set(['pending', 'sent', 'sending'])
const SENDING_STATUSES = new Set(['sending'])
const FAILED_STATUSES = new Set(['failed', 'undelivered', 'canceled'])
const DELIVERED_STATUSES = new Set(['delivered', 'received'])

interface QueueResponse {
  messages: any[]
  jobs: any[]
  stats: QueueStats
  lastSyncedAt: string
}

interface QueueStats {
  totalQueued: number
  totalPending: number
  totalSending: number
  totalFailed: number
  totalDelivered: number
  totalJobs: number
  oldestMessage: string | null
}

function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials not configured')
  }

  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
}

function computeStats(messages: any[], jobs: any[]): QueueStats {
  let totalQueued = 0
  let totalPending = 0
  let totalSending = 0
  let totalFailed = 0
  let totalDelivered = 0

  const queueCandidates: string[] = []

  for (const message of messages) {
    const status = (message?.status || '').toLowerCase()
    if (QUEUED_STATUSES.has(status)) {
      totalQueued++
      queueCandidates.push(message.created_at)
      continue
    }

    if (SENDING_STATUSES.has(status)) {
      totalSending++
      queueCandidates.push(message.created_at)
      continue
    }

    if (FAILED_STATUSES.has(status)) {
      totalFailed++
      continue
    }

    if (DELIVERED_STATUSES.has(status)) {
      totalDelivered++
      continue
    }

    if (PENDING_STATUSES.has(status)) {
      totalPending++
      queueCandidates.push(message.created_at)
      continue
    }

    // Treat unknown statuses as pending so they remain visible
    totalPending++
    queueCandidates.push(message.created_at)
  }

  queueCandidates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())

  return {
    totalQueued,
    totalPending,
    totalSending,
    totalFailed,
    totalDelivered,
    totalJobs: jobs.filter(job => job.status === 'pending').length,
    oldestMessage: queueCandidates[0] ?? null
  }
}

async function fetchQueueData(limit: number, jobLimit: number) {
  const supabase = createAdminClient()

  const [{ data: messages, error: messagesError }, { data: jobs, error: jobsError }] = await Promise.all([
    supabase
      .from('messages')
      .select(`
        *,
        customer:customers(first_name, last_name)
      `)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .order('created_at', { ascending: false })
      .limit(jobLimit)
  ])

  if (messagesError) throw messagesError
  if (jobsError) throw jobsError

  return { messages: messages ?? [], jobs: jobs ?? [] }
}

async function syncWithTwilio(messages: any[]) {
  const twilioClient = getTwilioClient()

  const needsSync = messages.filter(message => {
    const status = (message?.status || '').toLowerCase()
    if (!message?.twilio_message_sid) return false
    if (DELIVERED_STATUSES.has(status)) return false
    if (FAILED_STATUSES.has(status)) return false
    return true
  })

  if (needsSync.length === 0) {
    return { messages, updates: [] as any[] }
  }

  const updates: any[] = []
  const sidMap = new Map<string, any>()

  for (let i = 0; i < needsSync.length; i += TWILIO_BATCH_SIZE) {
    const batch = needsSync.slice(i, i + TWILIO_BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async message => {
        try {
          const twilioMessage = await twilioClient.messages(message.twilio_message_sid).fetch()
          return { message, twilioMessage }
        } catch (error) {
          logger.error('Failed to fetch Twilio message', {
            error: error as Error,
            metadata: {
              messageId: message.id,
              twilioSid: message.twilio_message_sid
            }
          })
          return null
        }
      })
    )

    for (const result of results) {
      if (!result?.twilioMessage) continue

      const { message, twilioMessage } = result
      const updatedStatus = (twilioMessage.status || '').toLowerCase()

      const updatePayload = {
        id: message.id,
        status: updatedStatus,
        twilio_status: updatedStatus,
        error_code: twilioMessage.errorCode?.toString() ?? null,
        error_message: twilioMessage.errorMessage ?? null,
        price: twilioMessage.price ? Number(twilioMessage.price) : null,
        sent_at: twilioMessage.dateSent ? new Date(twilioMessage.dateSent).toISOString() : message.sent_at,
        delivered_at: twilioMessage.dateCreated && DELIVERED_STATUSES.has(updatedStatus)
          ? new Date(twilioMessage.dateUpdated ?? twilioMessage.dateSent ?? twilioMessage.dateCreated).toISOString()
          : message.delivered_at,
        failed_at: FAILED_STATUSES.has(updatedStatus)
          ? new Date().toISOString()
          : message.failed_at,
        updated_at: new Date().toISOString()
      }

      updates.push(updatePayload)
      sidMap.set(message.id, updatePayload)
    }
  }

  if (updates.length > 0) {
    const supabase = createAdminClient()
    const { error } = await supabase.from('messages').upsert(updates)
    if (error) {
      logger.error('Failed to persist Twilio status updates', {
        error,
        metadata: { count: updates.length }
      })
    }
  }

  const mergedMessages = messages.map(message => {
    const update = sidMap.get(message.id)
    return update ? { ...message, ...update } : message
  })

  return { messages: mergedMessages, updates }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const limit = Math.max(1, Number(url.searchParams.get('limit') ?? QUEUE_LIMIT_DEFAULT))
    const jobLimit = Math.max(1, Number(url.searchParams.get('jobLimit') ?? JOB_LIMIT_DEFAULT))

    const { messages, jobs } = await fetchQueueData(limit, jobLimit)

    let syncedMessages = messages

    try {
      const result = await syncWithTwilio(messages)
      syncedMessages = result.messages
    } catch (error) {
      logger.error('Failed to sync queue with Twilio', { error: error as Error })
    }

    const stats = computeStats(syncedMessages, jobs)

    const payload: QueueResponse = {
      messages: syncedMessages,
      jobs,
      stats,
      lastSyncedAt: new Date().toISOString()
    }

    return NextResponse.json(payload)
  } catch (error) {
    logger.error('Failed to load SMS queue', { error: error as Error })
    return NextResponse.json({ error: 'Failed to load SMS queue' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action: QueueAction | undefined = body?.action

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 })
    }

    if (action === 'reconcile') {
      const messageId = body?.messageId
      if (!messageId) {
        return NextResponse.json({ error: 'Missing messageId' }, { status: 400 })
      }

      const supabase = createAdminClient()
      const { data: message, error } = await supabase
        .from('messages')
        .select('*')
        .eq('id', messageId)
        .single()

      if (error || !message) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      }

      if (!message.twilio_message_sid) {
        return NextResponse.json({ error: 'Message has no Twilio SID' }, { status: 422 })
      }

      const twilioClient = getTwilioClient()
      const twilioMessage = await twilioClient.messages(message.twilio_message_sid).fetch()

      const updatedStatus = (twilioMessage.status || '').toLowerCase()

      const updatePayload = {
        status: updatedStatus,
        twilio_status: updatedStatus,
        error_code: twilioMessage.errorCode?.toString() ?? null,
        error_message: twilioMessage.errorMessage ?? null,
        price: twilioMessage.price ? Number(twilioMessage.price) : null,
        sent_at: twilioMessage.dateSent ? new Date(twilioMessage.dateSent).toISOString() : message.sent_at,
        delivered_at: twilioMessage.dateUpdated && DELIVERED_STATUSES.has(updatedStatus)
          ? new Date(twilioMessage.dateUpdated).toISOString()
          : message.delivered_at,
        failed_at: FAILED_STATUSES.has(updatedStatus)
          ? new Date().toISOString()
          : message.failed_at,
        updated_at: new Date().toISOString()
      }

      await supabase
        .from('messages')
        .update(updatePayload)
        .eq('id', messageId)

      return NextResponse.json({
        message: { ...message, ...updatePayload }
      })
    }

    if (action === 'clear_old') {
      const supabase = createAdminClient()
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const { error } = await supabase
        .from('messages')
        .delete()
        .in('status', ['queued', 'pending', 'failed'])
        .lt('created_at', sevenDaysAgo.toISOString())

      if (error) {
        throw error
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'retry') {
      // TODO: Implement retry by enqueuing a new job or re-sending via Twilio
      return NextResponse.json({ error: 'Retry not yet implemented' }, { status: 501 })
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    logger.error('Queue action failed', { error: error as Error })
    return NextResponse.json({ error: 'Queue action failed' }, { status: 500 })
  }
}
