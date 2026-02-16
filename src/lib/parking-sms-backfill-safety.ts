type ExistingMessageLookupResult = {
  messageId: string | null
  error?: string
}

type PersistBackfillResult = {
  error?: string
}

type ParkingSmsBackfillScriptError = {
  notificationId: string
  reason: string
}

export function assertParkingSmsBackfillPayloadProcessable(params: {
  notificationId: string
  messageSid: string | null
  smsBody: string | null | undefined
}): void {
  if (!params.messageSid || !params.smsBody) {
    throw new Error(
      `Notification ${params.notificationId} is missing required SMS payload fields (message_sid/body)`
    )
  }
}

export function assertParkingSmsBackfillBookingHasCustomerFields(params: {
  bookingId: string
  customerId: string | null
  customerMobile: string | null
}): void {
  if (!params.customerId || !params.customerMobile) {
    throw new Error(
      `Parking booking ${params.bookingId} is missing required customer fields (customer_id/customer_mobile)`
    )
  }
}

export function assertParkingSmsBackfillCompletedWithoutErrors(
  errors: ParkingSmsBackfillScriptError[]
): void {
  if (errors.length === 0) {
    return
  }

  const preview = errors
    .slice(0, 3)
    .map((entry) => `${entry.notificationId}:${entry.reason}`)
    .join(' | ')

  throw new Error(`parking-sms-backfill completed with ${errors.length} error(s): ${preview}`)
}

export async function findExistingMessageBySid(
  supabase: any,
  sid: string
): Promise<ExistingMessageLookupResult> {
  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .eq('twilio_message_sid', sid)
    .maybeSingle()

  if (error) {
    return {
      messageId: null,
      error: error.message || 'Failed to verify existing SMS message by SID'
    }
  }

  return {
    messageId: typeof data?.id === 'string' ? data.id : null
  }
}

export async function persistBackfilledNotificationMessageId(
  supabase: any,
  input: {
    notificationId: string
    payload: Record<string, unknown>
    messageId: string
  }
): Promise<PersistBackfillResult> {
  const { data, error } = await supabase
    .from('parking_booking_notifications')
    .update({
      payload: {
        ...input.payload,
        message_id: input.messageId
      }
    })
    .eq('id', input.notificationId)
    .select('id')
    .maybeSingle()

  if (error) {
    return {
      error: error.message || 'Failed to persist parking SMS backfill notification linkage'
    }
  }

  if (!data) {
    return {
      error: 'Parking SMS backfill notification update affected no rows'
    }
  }

  return {}
}
