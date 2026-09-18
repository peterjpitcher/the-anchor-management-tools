import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmailAddress } from '@/lib/notifications/channel'
import { MANAGER_REPORT_SECTIONS, type ManagerReportInput, type ManagerReportQueueResult } from './types'

export { managerReportId } from './ids'
import { managerReportId } from './ids'

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
