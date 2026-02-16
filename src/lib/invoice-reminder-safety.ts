type ReminderLogLookupInput = {
  invoiceId: string
  subject: string
}

type ReminderLogInsertRow = {
  invoice_id: string
  sent_to: string
  sent_by: string
  subject: string
  body: string
  status: 'sent'
}

export async function hasSentInvoiceEmailLog(
  supabase: any,
  input: ReminderLogLookupInput
): Promise<{ exists: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('invoice_email_logs')
    .select('id')
    .eq('invoice_id', input.invoiceId)
    .eq('status', 'sent')
    .eq('subject', input.subject)
    .maybeSingle()

  if (error) {
    return {
      // Fail closed: if we cannot confirm the dedupe log, assume it exists so callers skip sending.
      exists: true,
      error: error.message || 'Failed to verify reminder dedupe log'
    }
  }

  return { exists: Boolean(data) }
}

export async function insertSentInvoiceEmailLogs(
  supabase: any,
  rows: ReminderLogInsertRow[]
): Promise<{ error?: string }> {
  if (rows.length === 0) {
    return {}
  }

  const { error } = await supabase
    .from('invoice_email_logs')
    .insert(rows)

  if (error) {
    return { error: error.message || 'Failed to persist reminder send logs' }
  }

  return {}
}

type ReminderScriptError = {
  invoice_number: string
  vendor?: string
  error: string
}

export function assertInvoiceReminderScriptCompletedWithoutErrors(
  errors: ReminderScriptError[]
): void {
  if (errors.length === 0) {
    return
  }

  const preview = errors
    .slice(0, 3)
    .map((entry) => `${entry.invoice_number}:${entry.error}`)
    .join(' | ')

  throw new Error(
    `Invoice reminders script completed with ${errors.length} error(s): ${preview}`
  )
}
