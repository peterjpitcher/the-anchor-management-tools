import type { SupabaseClient } from '@supabase/supabase-js'
import { displayName } from '@/lib/employees/display-name'
import { logger } from '@/lib/logger'
import type { CustomerCommunication } from '@/types/communications'

/**
 * Who wrote a text by hand (BK-182). Staff-typed texts (the Messages inbox reply and the table
 * booking page) carry sent_by_user_id in the message's metadata; this names that person on the
 * outbound bubble. Automated texts carry none and show no name.
 */

const ID_CHUNK = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The messages row id behind a timeline row ('sms:<uuid>' or 'whatsapp:<uuid>'), or null. */
export function messageIdFromCommunicationId(id: string): string | null {
  const [channel, rest] = id.split(':')
  if ((channel !== 'sms' && channel !== 'whatsapp') || !rest || !UUID.test(rest)) return null
  return rest
}

/**
 * Adds sent_by to outbound texts that a member of staff wrote. Never throws: a failed lookup
 * leaves the thread exactly as it was, without names.
 */
export async function attachSentBy(
  supabase: SupabaseClient<any, 'public', any>,
  communications: CustomerCommunication[]
): Promise<CustomerCommunication[]> {
  const messageIdByCommunication = new Map<string, string>()
  for (const communication of communications) {
    if (communication.direction !== 'outbound') continue
    const messageId = messageIdFromCommunicationId(communication.id)
    if (messageId) messageIdByCommunication.set(communication.id, messageId)
  }
  if (messageIdByCommunication.size === 0) return communications

  try {
    // Chunked, so a long history never builds a URL too long for the API.
    const ids = Array.from(new Set(messageIdByCommunication.values()))
    const messages: Array<{ id: string; metadata: unknown }> = []
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
      const { data, error } = await supabase
        .from('messages')
        .select('id, metadata')
        .in('id', ids.slice(start, start + ID_CHUNK))
      if (error) throw new Error(error.message)
      messages.push(...((data ?? []) as Array<{ id: string; metadata: unknown }>))
    }

    const senderByMessage = new Map<string, string>()
    for (const message of messages) {
      const metadata = (message?.metadata ?? null) as Record<string, unknown> | null
      const userId = typeof metadata?.sent_by_user_id === 'string' ? metadata.sent_by_user_id : null
      if (userId) senderByMessage.set(message.id as string, userId)
    }
    if (senderByMessage.size === 0) return communications

    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('auth_user_id, first_name, last_name, preferred_name')
      .in('auth_user_id', Array.from(new Set(senderByMessage.values())))
    if (employeesError) throw new Error(employeesError.message)

    const nameByUser = new Map<string, string>()
    for (const employee of employees ?? []) {
      if (typeof employee?.auth_user_id === 'string') nameByUser.set(employee.auth_user_id, displayName(employee))
    }

    return communications.map((communication) => {
      if (communication.direction !== 'outbound') return communication
      const messageId = messageIdByCommunication.get(communication.id)
      const userId = messageId ? senderByMessage.get(messageId) : undefined
      if (!userId) return communication
      return { ...communication, sent_by: nameByUser.get(userId) ?? 'a team member' }
    })
  } catch (error) {
    logger.error('Could not name the staff who sent texts in a conversation', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return communications
  }
}
