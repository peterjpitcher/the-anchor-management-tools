import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'
import { normalizeBulkRecipientIds, validateBulkSmsRecipientCount } from '@/lib/sms/bulk-dispatch-key'

type BulkSmsRequest = {
  customerIds: string[]
  message: string
  eventId?: string
  categoryId?: string
  bulkJobId?: string
  chunkSize?: number
  concurrency?: number
  batchDelayMs?: number
}

type BulkSmsResult = {
  success: true
  sent: number
  failed: number
  total: number
  results: Array<{ customerId: string; messageSid: string }>
  errors?: Array<{ customerId: string; error: string }>
} | { success: false; error: string }

type BulkAbortSignal = {
  code: string
  error: string
}

function normalizePositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  const normalized = Math.floor(value as number)
  if (normalized < 1) {
    return fallback
  }
  return Math.min(normalized, max)
}

function normalizeNonNegativeInt(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  const normalized = Math.floor(value as number)
  if (normalized < 0) {
    return fallback
  }
  return Math.min(normalized, max)
}

// Helper to get a smart first name (e.g., "there" for "Guest")
export function getSmartFirstName(firstName: string | null | undefined): string {
  const name = firstName || ''
  const isPlaceholderName = /^(guest|unknown|customer|client|user|admin)$/i.test(name)
  return isPlaceholderName ? 'there' : (name || 'there')
}

// Helper to build personalized message with smart greeting
export function applySmartVariables(
  base: string,
  customer: { first_name: string; last_name: string | null },
  eventDetails?: { name: string; date: string; time: string | null },
  categoryDetails?: { name: string | null },
  contactPhone?: string
) {
  const fullName = [customer.first_name, customer.last_name ?? ''].filter(Boolean).join(' ').trim()
  let personalized = base

  // Smart Greeting Logic
  const smartFirstName = getSmartFirstName(customer.first_name)

  // For full name, if it's a placeholder, use a generic term
  const isPlaceholderName = smartFirstName === 'there'
  const smartFullName = isPlaceholderName ? 'Customer' : (fullName || 'Customer')

  personalized = personalized.replace(/{{customer_name}}/g, smartFullName)
  personalized = personalized.replace(/{{first_name}}/g, smartFirstName)
  personalized = personalized.replace(/{{last_name}}/g, customer.last_name || '')
  personalized = personalized.replace(/{{venue_name}}/g, 'The Anchor')
  personalized = personalized.replace(/{{contact_phone}}/g, contactPhone || '')

  if (eventDetails) {
    personalized = personalized.replace(/{{event_name}}/g, eventDetails.name)
    personalized = personalized.replace(
      /{{event_date}}/g,
      formatDateInLondon(eventDetails.date, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    )
    personalized = personalized.replace(
      /{{event_time}}/g,
      eventDetails.time ? formatTime12Hour(eventDetails.time) : 'TBC'
    )
  }

  if (categoryDetails?.name) {
    personalized = personalized.replace(/{{category_name}}/g, categoryDetails.name)
  }

  return personalized
}

function normalizeAbortErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof (error as any)?.message === 'string' && (error as any).message.trim().length > 0) {
    return (error as any).message
  }

  return 'Unexpected SMS send exception'
}

function resolveAbortSignalFromThrownSendError(error: unknown): BulkAbortSignal {
  const thrownCode = typeof (error as any)?.code === 'string'
    ? (error as any).code
    : null
  const thrownLogFailure = (error as any)?.logFailure === true || thrownCode === 'logging_failed'
  const errorMessage = normalizeAbortErrorMessage(error)

  if (thrownLogFailure) {
    return {
      code: 'logging_failed',
      error: errorMessage,
    }
  }

  if (
    thrownCode === 'safety_unavailable'
    || thrownCode === 'idempotency_conflict'
    || thrownCode === 'logging_failed'
  ) {
    return {
      code: thrownCode,
      error: errorMessage,
    }
  }

  // sendSMS is expected to return structured failures. A thrown exception indicates
  // the safety pipeline is degraded, so abort fanout to fail closed.
  return {
    code: 'safety_unavailable',
    error: errorMessage,
  }
}

export async function sendBulkSms(request: BulkSmsRequest): Promise<BulkSmsResult> {
  try {
    const { customerIds, message, eventId, categoryId } = request
    const normalizedCustomerIds = normalizeBulkRecipientIds(customerIds)
    const recipientLimitError = validateBulkSmsRecipientCount(normalizedCustomerIds.length)
    const chunkSize = normalizePositiveInt(request.chunkSize, 25, 100)
    // Reliability hardening: keep dispatch single-flight so a fatal safety signal
    // can halt fanout before additional in-flight sends are started.
    const concurrency = normalizePositiveInt(request.concurrency, 1, 1)
    const batchDelayMs = normalizeNonNegativeInt(request.batchDelayMs, 400, 60_000)
    const bulkJobId = request.bulkJobId ?? 'direct'

    if (normalizedCustomerIds.length === 0) {
      return { success: false, error: 'No recipients provided for bulk SMS' }
    }

    if (recipientLimitError) {
      return { success: false, error: recipientLimitError }
    }

    const supabase = createAdminClient()

    const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER
      || process.env.TWILIO_PHONE_NUMBER
      || '01753682707'

    // Load customers
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, mobile_e164, sms_opt_in, sms_status, marketing_sms_opt_in')
      .in('id', normalizedCustomerIds)

    if (customerError) {
      logger.error('Bulk SMS blocked because customer lookup failed', {
        metadata: {
          bulkJobId,
          error: customerError.message,
        },
      })
      return { success: false, error: 'Failed to load customers for bulk SMS' }
    }

    if (!customers || customers.length === 0) {
      return { success: false, error: 'No valid customers found' }
    }

    // Load event/category context if provided
    let eventDetails: { name: string; date: string; time: string | null } | null = null
    let categoryDetails: { name: string | null } | null = null

    if (eventId) {
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select('name, date, time')
        .eq('id', eventId)
        .maybeSingle()

      if (eventError) {
        logger.error('Bulk SMS blocked because event context lookup failed', {
          metadata: { bulkJobId, eventId, error: eventError.message },
        })
        return { success: false, error: 'Failed to load event context for bulk SMS' }
      }

      if (!event) {
        return { success: false, error: 'Event not found for bulk SMS context' }
      }

      eventDetails = { name: event.name, date: event.date, time: event.time }
    }

    if (categoryId) {
      const { data: category, error: categoryError } = await supabase
        .from('event_categories')
        .select('name')
        .eq('id', categoryId)
        .maybeSingle()

      if (categoryError) {
        logger.error('Bulk SMS blocked because category context lookup failed', {
          metadata: { bulkJobId, categoryId, error: categoryError.message },
        })
        return { success: false, error: 'Failed to load category context for bulk SMS' }
      }

      if (!category) {
        return { success: false, error: 'Category not found for bulk SMS context' }
      }

      categoryDetails = { name: category.name }
    }

    const validCustomers = customers.filter(customer => {
      const recipient =
        typeof (customer as any).mobile_e164 === 'string' && (customer as any).mobile_e164.trim().length > 0
          ? (customer as any).mobile_e164
          : typeof (customer as any).mobile_number === 'string' && (customer as any).mobile_number.trim().length > 0
            ? (customer as any).mobile_number
            : null

      if (!recipient) {
        logger.debug('Skipping customer with no mobile number', { metadata: { customerId: customer.id } })
        return false
      }
      if ((customer as any).sms_opt_in !== true) {
        logger.debug('Skipping customer without SMS opt-in', { metadata: { customerId: customer.id } })
        return false
      }
      if ((customer as any).marketing_sms_opt_in !== true) {
        logger.debug('Skipping customer without marketing SMS opt-in', { metadata: { customerId: customer.id } })
        return false
      }

      const smsStatus = ((customer as any).sms_status ?? null) as string | null
      if (smsStatus !== null && smsStatus !== 'active') {
        logger.debug('Skipping customer with blocked sms_status', {
          metadata: { customerId: customer.id, smsStatus },
        })
        return false
      }

      return true
    })

    if (validCustomers.length === 0) {
      return { success: false, error: 'No customers eligible for marketing SMS' }
    }

    const results: Array<{ customerId: string; messageSid: string }> = []
    const errors: Array<{ customerId: string; error: string }> = []
    const abort = { current: null as { code: string; error: string } | null }

    function shouldAbortBulkSend(code: unknown): boolean {
      // Fatal safety signals: we cannot safely continue sending in a loop.
      return (
        code === 'safety_unavailable'
        || code === 'idempotency_conflict'
        || code === 'logging_failed'
      )
    }

    for (let i = 0; i < validCustomers.length; i += chunkSize) {
      const chunk = validCustomers.slice(i, i + chunkSize)
      for (let j = 0; j < chunk.length; j += concurrency) {
        if (abort.current) {
          break
        }

        const window = chunk.slice(j, j + concurrency)
        await Promise.all(
          window.map(async customer => {
            try {
              if (abort.current) {
                errors.push({
                  customerId: customer.id,
                  error: `Aborted bulk send due to prior safety failure (${abort.current.code})`
                })
                return
              }

              const personalized = applySmartVariables(
                message,
                { first_name: customer.first_name, last_name: customer.last_name },
                eventDetails ?? undefined,
                categoryDetails ?? undefined,
                contactPhone
              )
              const messageWithSupport = ensureReplyInstruction(personalized, contactPhone)
              const recipient =
                typeof (customer as any).mobile_e164 === 'string' && (customer as any).mobile_e164.trim().length > 0
                  ? (customer as any).mobile_e164
                  : (customer as any).mobile_number

              const sendResult = await sendSMS(recipient as string, messageWithSupport, {
                customerId: customer.id,
                metadata: {
                  template_key: 'bulk_sms_campaign',
                  trigger_type: 'bulk_sms_campaign',
                  bulk_sms: true,
                  bulk_job_id: bulkJobId,
                  event_id: eventId,
                  category_id: categoryId
                }
              })

              const fatalCode = (sendResult as any)?.code
              const logFailure = (sendResult as any)?.logFailure === true

              if (!abort.current && (logFailure || shouldAbortBulkSend(fatalCode))) {
                abort.current = {
                  code: String(fatalCode ?? 'fatal'),
                  error: logFailure
                    ? 'SMS sent but message persistence failed'
                    : (sendResult as any)?.error || 'Bulk send aborted by safety guard'
                }
              }

              if (!sendResult.success) {
                errors.push({
                  customerId: customer.id,
                  error: sendResult.error || 'Failed to send SMS'
                })
                return
              }

              const deliveryToken =
                sendResult.sid ||
                (sendResult.deferred ? `deferred:${bulkJobId}:${customer.id}` : null) ||
                (sendResult.suppressed ? `suppressed:${bulkJobId}:${customer.id}` : null)

              if (!deliveryToken) {
                errors.push({
                  customerId: customer.id,
                  error: 'SMS send succeeded but no delivery reference was returned'
                })
                return
              }

              results.push({
                customerId: customer.id,
                messageSid: deliveryToken
              })
            } catch (error) {
              if (!abort.current) {
                abort.current = resolveAbortSignalFromThrownSendError(error)
              }

              logger.error('Failed to send SMS to customer', {
                error: error as Error,
                metadata: {
                  customerId: customer.id,
                  bulkJobId,
                  abortCode: abort.current?.code ?? null,
                }
              })
              errors.push({
                customerId: customer.id,
                error: normalizeAbortErrorMessage(error)
              })
            }
          })
        )
      }

      if (abort.current) {
        logger.error('Bulk SMS aborted due to safety failure', {
          metadata: {
            bulkJobId,
            code: abort.current.code,
            error: abort.current.error,
            sent: results.length,
            failed: errors.length,
            total: validCustomers.length
          }
        })

        return {
          success: false,
          error: `Bulk SMS aborted due to safety failure (${abort.current.code}): ${abort.current.error}`
        }
      }

      if (i + chunkSize < validCustomers.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs))
      }
    }

    logger.info('Bulk SMS batch complete', {
      metadata: {
        total: validCustomers.length,
        sent: results.length,
        failed: errors.length,
        bulkJobId
      }
    })

    return {
      success: true,
      sent: results.length,
      failed: errors.length,
      total: validCustomers.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    }
  } catch (error) {
    logger.error('Bulk SMS batch failed', { error: error as Error })
    return { success: false, error: 'Failed to send bulk SMS' }
  }
}
