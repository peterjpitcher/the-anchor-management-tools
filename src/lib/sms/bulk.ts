import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'

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

function buildPersonalizedMessage(
  base: string,
  customer: { first_name: string; last_name: string | null },
  eventDetails?: { name: string; date: string; time: string | null },
  categoryDetails?: { name: string | null },
  contactPhone?: string
) {
  const fullName = [customer.first_name, customer.last_name ?? ''].filter(Boolean).join(' ').trim()
  let personalized = base
  personalized = personalized.replace(/{{customer_name}}/g, fullName || customer.first_name)
  personalized = personalized.replace(/{{first_name}}/g, customer.first_name)
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

export async function sendBulkSms(request: BulkSmsRequest): Promise<BulkSmsResult> {
  try {
    const supabase = createAdminClient()
    const { customerIds, message, eventId, categoryId } = request
    const chunkSize = request.chunkSize ?? 25
    const concurrency = request.concurrency ?? 5
    const batchDelayMs = request.batchDelayMs ?? 400
    const bulkJobId = request.bulkJobId ?? 'direct'

    const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER
      || process.env.TWILIO_PHONE_NUMBER
      || '01753682707'

    // Load customers
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, sms_opt_in')
      .in('id', customerIds)

    if (customerError || !customers || customers.length === 0) {
      return { success: false, error: 'No valid customers found' }
    }

    // Load event/category context if provided
    let eventDetails: { name: string; date: string; time: string | null } | null = null
    let categoryDetails: { name: string | null } | null = null

    if (eventId) {
      const { data: event } = await supabase
        .from('events')
        .select('name, date, time')
        .eq('id', eventId)
        .single()
      if (event) {
        eventDetails = { name: event.name, date: event.date, time: event.time }
      }
    }

    if (categoryId) {
      const { data: category } = await supabase
        .from('event_categories')
        .select('name')
        .eq('id', categoryId)
        .single()
      if (category) {
        categoryDetails = { name: category.name }
      }
    }

    const validCustomers = customers.filter(customer => {
      if (!customer.mobile_number) {
        logger.debug('Skipping customer with no mobile number', { metadata: { customerId: customer.id } })
        return false
      }
      if (customer.sms_opt_in !== true) {
        logger.debug('Skipping customer without SMS opt-in', { metadata: { customerId: customer.id } })
        return false
      }
      return true
    })

    if (validCustomers.length === 0) {
      return { success: false, error: 'No customers with valid mobile numbers and SMS opt-in' }
    }

    const results: Array<{ customerId: string; messageSid: string }> = []
    const errors: Array<{ customerId: string; error: string }> = []

    for (let i = 0; i < validCustomers.length; i += chunkSize) {
      const chunk = validCustomers.slice(i, i + chunkSize)
      for (let j = 0; j < chunk.length; j += concurrency) {
        const window = chunk.slice(j, j + concurrency)
        await Promise.all(
          window.map(async customer => {
            try {
              const personalized = buildPersonalizedMessage(
                message,
                { first_name: customer.first_name, last_name: customer.last_name },
                eventDetails ?? undefined,
                categoryDetails ?? undefined,
                contactPhone
              )
              const messageWithSupport = personalized
              const sendResult = await sendSMS(customer.mobile_number as string, messageWithSupport, {
                customerId: customer.id,
                metadata: {
                  bulk_sms: true,
                  bulk_job_id: bulkJobId,
                  event_id: eventId,
                  category_id: categoryId
                }
              })

              if (!sendResult.success || !sendResult.sid) {
                errors.push({
                  customerId: customer.id,
                  error: sendResult.error || 'Failed to send SMS'
                })
                return
              }

              results.push({
                customerId: customer.id,
                messageSid: sendResult.sid
              })
            } catch (error) {
              logger.error('Failed to send SMS to customer', {
                error: error as Error,
                metadata: { customerId: customer.id, bulkJobId }
              })
              errors.push({
                customerId: customer.id,
                error: error instanceof Error ? error.message : 'Unknown error'
              })
            }
          })
        )
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
