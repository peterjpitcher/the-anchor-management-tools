import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmailAddress } from '@/lib/notifications/channel'
import { MANAGER_REPORT_SECTIONS, type ManagerReportInput, type ManagerReportQueueResult } from './types'

/** Stable UUIDs make insertion atomic without resetting a previously delivered item. */
export function managerReportId(parts: string[]): string {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

export async function queueManagerReportEmail(input: ManagerReportInput): Promise<ManagerReportQueueResult> {
  try {
    const to = input.to.trim().toLowerCase()
    if (!isValidEmailAddress(to) || /[,;<>]/.test(to) || !input.key.trim() || !input.subject.trim() || !MANAGER_REPORT_SECTIONS.includes(input.section)) {
      return { success: false, error: 'Manager report item needs a recipient, source key, subject and valid section' }
    }
    const id = managerReportId(['manager_report_item', input.section, input.key, to])
    const { error } = await createAdminClient().from('email_messages').upsert({
      id, to_address: to, comm_type: 'manager_report_item', status: 'queued',
      subject: input.subject, body_html: input.html ?? null, body_text: input.text ?? null,
      metadata: { ...input.metadata, section: input.section, key: input.key },
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (error) return { success: false, error: error.message }
    return { success: true, queued: true, emailMessageId: id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Manager report queue failed' }
  }
}
