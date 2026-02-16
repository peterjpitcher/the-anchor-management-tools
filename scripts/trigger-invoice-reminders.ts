#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import {
  assertInvoiceReminderScriptCompletedWithoutErrors,
  hasSentInvoiceEmailLog,
  insertSentInvoiceEmailLogs,
} from '@/lib/invoice-reminder-safety'
import {
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { InvoiceWithDetails } from '@/types/invoices'

const SCRIPT_NAME = 'trigger-invoice-reminders'
const RUN_MUTATION_ENV = 'RUN_TRIGGER_INVOICE_REMINDERS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_INVOICE_REMINDER_TRIGGER_SCRIPT'
const HARD_CAP = 50
const MAX_EMAIL_RECIPIENTS = 5

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  return parsed
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`[${SCRIPT_NAME}] invalid --url (must start with http:// or https://): ${trimmed}`)
  }
  return trimmed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
  url: string
  internalEmail: string | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  const urlFlag = findFlagValue(rest, '--url')
  const urlEnv = process.env.NEXT_PUBLIC_APP_URL
  const rawUrl = urlFlag ?? urlEnv ?? (dryRun ? 'http://localhost:3000' : '')
  const url = normalizeBaseUrl(rawUrl)
  const internalEmail = process.env.MICROSOFT_USER_EMAIL?.trim() || null

  return {
    confirm,
    dryRun,
    limit,
    url,
    internalEmail,
  }
}

// Configuration for reminder intervals (days)
const REMINDER_INTERVALS = {
  DUE_TODAY: 0, // On the due date
  FIRST_REMINDER: 7, // 7 days after due date
  SECOND_REMINDER: 14, // 14 days after due date
  FINAL_REMINDER: 30, // 30 days after due date
}

function toUtcMidnightMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000Z`)
}

function formatIsoDateForUk(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(dt.getTime())) {
    return isoDate
  }
  return dt.toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

function resolveVendorEmail(invoice: any): string | null {
  const direct = invoice?.vendor?.email
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim()
  }

  const contacts = invoice?.vendor?.contacts
  if (!Array.isArray(contacts)) {
    return null
  }

  const primary = contacts.find((c) => c?.is_primary && typeof c?.email === 'string' && c.email.trim().length > 0)
  if (primary?.email) {
    return primary.email.trim()
  }

  const first = contacts.find((c) => typeof c?.email === 'string' && c.email.trim().length > 0)
  return first?.email ? String(first.email).trim() : null
}

function resolveReminderType(daysOverdue: number): string | null {
  if (daysOverdue === REMINDER_INTERVALS.DUE_TODAY) return 'Due Today'
  if (daysOverdue === REMINDER_INTERVALS.FIRST_REMINDER) return 'First Reminder'
  if (daysOverdue === REMINDER_INTERVALS.SECOND_REMINDER) return 'Second Reminder'
  if (daysOverdue === REMINDER_INTERVALS.FINAL_REMINDER) return 'Final Reminder'
  return null
}

function parseRecipients(raw: string): { to: string; cc: string[] } | { error: string } {
  const recipients = raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (recipients.length === 0) {
    return { error: 'No recipient emails after parsing vendor email field' }
  }

  if (recipients.length > MAX_EMAIL_RECIPIENTS) {
    return { error: `Vendor email contains too many recipients (${recipients.length} > ${MAX_EMAIL_RECIPIENTS})` }
  }

  const to = recipients[0]
  const cc = recipients.slice(1)
  return { to, cc }
}

async function loadInvoices(supabase: any, todayIso: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      `
      *,
      vendor:invoice_vendors(
        id,
        name,
        email,
        contact_name,
        contacts:invoice_vendor_contacts(
          email,
          is_primary
        )
      ),
      line_items:invoice_line_items(*),
      payments:invoice_payments(*)
    `
    )
    .in('status', ['sent', 'partially_paid', 'overdue'])
    .lte('due_date', todayIso)
    .order('due_date', { ascending: true })

  const rows = assertScriptQuerySucceeded({
    operation: `[${SCRIPT_NAME}] load invoices due <= ${todayIso}`,
    error,
    data: data as any[] | null,
    allowMissing: true,
  })

  return Array.isArray(rows) ? rows : []
}

async function main(): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (!args.dryRun) {
    if (!args.confirm) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
    }
    if (args.limit === null) {
      throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
    }
    if (args.limit > HARD_CAP) {
      throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
    }
    if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
      throw new Error(
        `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
      )
    }
    assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

    if (!isGraphConfigured()) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: Microsoft Graph is not configured`)
    }
    if (!args.internalEmail) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: MICROSOFT_USER_EMAIL is required`)
    }
    if (!args.url) {
      throw new Error(
        `[${SCRIPT_NAME}] mutation blocked: set NEXT_PUBLIC_APP_URL or pass --url https://... to avoid sending incorrect invoice links`
      )
    }
  }

  const supabase = createAdminClient()
  const todayIso = getTodayIsoDate()
  const todayUtcMs = toUtcMidnightMs(todayIso)

  const invoices = await loadInvoices(supabase, todayIso)
  console.log(`[${SCRIPT_NAME}] invoice candidates=${invoices.length}`)

  const results = {
    scanned: invoices.length,
    processed: 0,
    status_updates: 0,
    internal_sent: 0,
    customer_sent: 0,
    errors: [] as Array<{ invoice_number: string; vendor?: string; error: string }>,
  }

  let mutationCandidatesProcessed = 0
  for (const invoice of invoices) {
    const invoiceId = String(invoice?.id || '')
    const invoiceNumber = String(invoice?.invoice_number || '')
    const vendorName = typeof invoice?.vendor?.name === 'string' ? invoice.vendor.name : undefined

    if (!invoiceId || !invoiceNumber) {
      results.errors.push({
        invoice_number: invoiceNumber || '<missing invoice_number>',
        vendor: vendorName,
        error: 'Invoice missing id or invoice_number',
      })
      continue
    }

    const dueDateIso = String(invoice?.due_date || '').slice(0, 10)
    const dueDateUtcMs = toUtcMidnightMs(dueDateIso)
    if (!dueDateIso || Number.isNaN(dueDateUtcMs)) {
      results.errors.push({
        invoice_number: invoiceNumber,
        vendor: vendorName,
        error: `Invoice due_date is invalid (${String(invoice?.due_date)})`,
      })
      continue
    }

    const daysOverdue = Math.floor((todayUtcMs - dueDateUtcMs) / (1000 * 60 * 60 * 24))
    const reminderType = resolveReminderType(daysOverdue)
    const needsOverdueTransition = daysOverdue > 0 && invoice?.status !== 'overdue'

    const isMutationCandidate = Boolean(reminderType || needsOverdueTransition)
    if (isMutationCandidate && !args.dryRun) {
      if (mutationCandidatesProcessed >= (args.limit ?? 0)) {
        console.log(
          `[${SCRIPT_NAME}] cap reached (${mutationCandidatesProcessed}/${args.limit}). Stopping before invoice ${invoiceNumber}.`
        )
        break
      }
      mutationCandidatesProcessed += 1
    }

    results.processed += 1

    if (needsOverdueTransition) {
      if (args.dryRun) {
        console.log(`[${SCRIPT_NAME}] DRY RUN would mark invoice overdue: ${invoiceNumber} (due ${dueDateIso})`)
      } else {
        const { data: updatedRows, error } = await supabase
          .from('invoices')
          .update({
            status: 'overdue',
            updated_at: new Date().toISOString(),
          })
          .eq('id', invoiceId)
          .in('status', ['sent', 'partially_paid'])
          .select('id')

        const { updatedCount } = assertScriptMutationSucceeded({
          operation: `[${SCRIPT_NAME}] mark invoice overdue (${invoiceNumber})`,
          error,
          updatedRows: updatedRows as Array<{ id?: string }> | null,
          allowZeroRows: true,
        })

        if (updatedCount > 0) {
          results.status_updates += updatedCount
        } else {
          console.log(`[${SCRIPT_NAME}] overdue transition skipped (state changed): ${invoiceNumber}`)
        }
      }
    }

    if (!reminderType) {
      continue
    }

    const outstandingAmount = Number(invoice?.total_amount || 0) - Number(invoice?.paid_amount || 0)
    const vendorEmail = resolveVendorEmail(invoice)
    const invoiceUrl = `${args.url}/invoices/${invoiceId}`

    if (args.dryRun) {
      console.log(
        `[${SCRIPT_NAME}] DRY RUN would send ${reminderType} for ${invoiceNumber} (${daysOverdue} days overdue) vendor=${vendorName || 'Unknown'} amount=GBP ${outstandingAmount.toFixed(2)} link=${invoiceUrl}`
      )
      continue
    }

    let internalReminderSent = false
    let customerReminderSent = false

    // Internal notification (required in mutation mode).
    try {
      const internalEmail = args.internalEmail!
      const internalSubject = `[${reminderType}] Invoice ${invoiceNumber} - ${vendorName || 'Unknown'}`
      const internalBody = `
Invoice Reminder Alert

Invoice: ${invoiceNumber}
Vendor: ${vendorName || 'Unknown'}
Contact: ${invoice?.vendor?.contact_name || 'N/A'}
Email: ${vendorEmail || 'No email'}

Amount Due: GBP ${outstandingAmount.toFixed(2)}
Days Overdue: ${daysOverdue}
Due Date: ${formatIsoDateForUk(dueDateIso)}
Reminder Type: ${reminderType}

${vendorEmail ? 'Customer reminder will be sent.' : 'No vendor email on file - manual follow-up required.'}

View invoice: ${invoiceUrl}
      `.trim()

      const logCheck = await hasSentInvoiceEmailLog(supabase, {
        invoiceId,
        subject: internalSubject,
      })

      if (logCheck.error) {
        results.errors.push({
          invoice_number: invoiceNumber,
          vendor: vendorName,
          error: `Internal reminder dedupe check failed: ${logCheck.error}`,
        })
      } else if (logCheck.exists) {
        console.log(`[${SCRIPT_NAME}] internal reminder already sent; skipping: ${invoiceNumber} (${reminderType})`)
      } else {
        const internalInvoice = {
          ...invoice,
          invoice_number: `REMINDER: ${invoiceNumber}`,
        }

        const sendResult = await sendInvoiceEmail(
          internalInvoice as InvoiceWithDetails,
          internalEmail,
          internalSubject,
          internalBody
        )

        if (!sendResult.success) {
          results.errors.push({
            invoice_number: invoiceNumber,
            vendor: vendorName,
            error: sendResult.error || 'Failed to send internal reminder',
          })
        } else {
          internalReminderSent = true
          results.internal_sent += 1
          const logResult = await insertSentInvoiceEmailLogs(supabase, [
            {
              invoice_id: invoiceId,
              sent_to: internalEmail,
              sent_by: 'system',
              subject: internalSubject,
              body: `Internal ${reminderType} - ${daysOverdue} days overdue`,
              status: 'sent',
            },
          ])

          if (logResult.error) {
            results.errors.push({
              invoice_number: invoiceNumber,
              vendor: vendorName,
              error: `Internal reminder sent but log persistence failed: ${logResult.error}`,
            })
          }
        }
      }
    } catch (error) {
      results.errors.push({
        invoice_number: invoiceNumber,
        vendor: vendorName,
        error: error instanceof Error ? error.message : 'Failed to send internal reminder',
      })
    }

    // Customer reminder (optional when vendor email exists).
    if (vendorEmail) {
      try {
        const customerSubject =
          daysOverdue === 0
            ? `Payment Due Today: Invoice ${invoiceNumber} from Orange Jelly Limited`
            : `${reminderType}: Invoice ${invoiceNumber} from Orange Jelly Limited`

        const recipientParse = parseRecipients(vendorEmail)
        if ('error' in recipientParse) {
          results.errors.push({
            invoice_number: invoiceNumber,
            vendor: vendorName,
            error: recipientParse.error,
          })
        } else {
          const greetingTarget = invoice?.vendor?.contact_name || vendorName || 'there'
          const customerBodyLines = [
            `Dear ${greetingTarget},`,
            '',
            daysOverdue === 0
              ? `This is a friendly reminder that invoice ${invoiceNumber} is due for payment today.`
              : `This is a friendly reminder that invoice ${invoiceNumber} is now ${daysOverdue} days overdue.`,
            '',
            'Invoice Details:',
            `- Invoice Number: ${invoiceNumber}`,
            `- Amount Due: GBP ${outstandingAmount.toFixed(2)}`,
            `- Due Date: ${formatIsoDateForUk(dueDateIso)}`,
            '',
            daysOverdue >= REMINDER_INTERVALS.FINAL_REMINDER
              ? 'This is our final reminder. Please arrange payment immediately to avoid any disruption to services.'
              : 'Please arrange payment at your earliest convenience.',
            '',
            "If you have already made payment, please disregard this reminder. If you have any questions about this invoice, please don't hesitate to contact us.",
            '',
            'Best regards,',
            'Orange Jelly Limited',
          ]

          const logCheck = await hasSentInvoiceEmailLog(supabase, {
            invoiceId,
            subject: customerSubject,
          })

          if (logCheck.error) {
            results.errors.push({
              invoice_number: invoiceNumber,
              vendor: vendorName,
              error: `Customer reminder dedupe check failed: ${logCheck.error}`,
            })
          } else if (logCheck.exists) {
            console.log(`[${SCRIPT_NAME}] customer reminder already sent; skipping: ${invoiceNumber} (${reminderType})`)
          } else {
            const sendResult = await sendInvoiceEmail(
              invoice as InvoiceWithDetails,
              recipientParse.to,
              customerSubject,
              customerBodyLines.join('\n'),
              recipientParse.cc
            )

            if (!sendResult.success) {
              results.errors.push({
                invoice_number: invoiceNumber,
                vendor: vendorName,
                error: sendResult.error || 'Failed to send customer reminder',
              })
            } else {
              customerReminderSent = true
              results.customer_sent += 1
              const logRows = [
                {
                  invoice_id: invoiceId,
                  sent_to: recipientParse.to,
                  sent_by: 'system',
                  subject: customerSubject,
                  body: `${reminderType} - ${daysOverdue} days overdue`,
                  status: 'sent' as const,
                },
                ...recipientParse.cc.map((cc) => ({
                  invoice_id: invoiceId,
                  sent_to: cc,
                  sent_by: 'system',
                  subject: customerSubject,
                  body: `${reminderType} - ${daysOverdue} days overdue`,
                  status: 'sent' as const,
                })),
              ]

              const logResult = await insertSentInvoiceEmailLogs(supabase, logRows)
              if (logResult.error) {
                results.errors.push({
                  invoice_number: invoiceNumber,
                  vendor: vendorName,
                  error: `Customer reminder sent but log persistence failed: ${logResult.error}`,
                })
              }
            }
          }
        }
      } catch (error) {
        results.errors.push({
          invoice_number: invoiceNumber,
          vendor: vendorName,
          error: error instanceof Error ? error.message : 'Failed to send customer reminder',
        })
      }
    }

    // Audit trail is required for mutation mode (fail closed).
    try {
      const { data: auditRows, error: auditError } = await supabase
        .from('audit_logs')
        .insert({
          operation_type: 'update',
          resource_type: 'invoice',
          resource_id: invoiceId,
          user_id: 'system',
          operation_status: 'success',
          operation_details: {
            action: 'reminder_sent',
            reminder_type: reminderType,
            days_overdue: daysOverdue,
            invoice_number: invoiceNumber,
            vendor: vendorName,
            internal_notification: internalReminderSent,
            customer_reminder: customerReminderSent,
          },
        })
        .select('id')

      const { updatedCount } = assertScriptMutationSucceeded({
        operation: `[${SCRIPT_NAME}] insert audit log (${invoiceNumber})`,
        error: auditError,
        updatedRows: auditRows as Array<{ id?: string }> | null,
      })

      if (updatedCount !== 1) {
        results.errors.push({
          invoice_number: invoiceNumber,
          vendor: vendorName,
          error: `Audit log insert returned unexpected row count (${updatedCount})`,
        })
      }
    } catch (error) {
      results.errors.push({
        invoice_number: invoiceNumber,
        vendor: vendorName,
        error: error instanceof Error ? error.message : 'Failed to write reminder audit log',
      })
    }
  }

  console.log(`[${SCRIPT_NAME}] completed`, {
    scanned: results.scanned,
    processed: results.processed,
    status_updates: results.status_updates,
    internal_sent: results.internal_sent,
    customer_sent: results.customer_sent,
    errors: results.errors.length,
  })

  assertInvoiceReminderScriptCompletedWithoutErrors(results.errors)
}

main().catch((error) => {
  process.exitCode = 1
  console.error(`[${SCRIPT_NAME}] fatal error`, error)
})

