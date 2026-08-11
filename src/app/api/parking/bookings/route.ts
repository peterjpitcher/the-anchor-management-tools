import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { z } from 'zod'
import { createParkingPaymentOrder, sendParkingPaymentRequest } from '@/lib/parking/payments'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import type { ParkingBooking } from '@/types/parking'
import { createPendingParkingBooking } from '@/services/parking'
import {
  computeIdempotencyRequestHash,
  claimIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { OptionalCommunicationConsentSchema, consentHashPayload } from '@/lib/consent/validation'
import { ConsentService } from '@/services/consent'
import { parkingGuestUrl, parkingPaymentReturnUrl } from '@/lib/parking/public-links'

const CreateBookingSchema = z.object({
  customer: z.object({
    first_name: z.string().min(1),
    last_name: z.string().optional(),
    email: z.string().email().optional(),
    mobile_number: z.string().min(1),
    default_country_code: z.string().regex(/^\d{1,4}$/).optional()
  }),
  vehicle: z.object({
    registration: z.string().min(1),
    make: z.string().optional(),
    model: z.string().optional(),
    colour: z.string().optional()
  }),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  notes: z.string().optional(),
  source: z.enum(['website', 'staff']).optional().default('staff'),
  communication_consent: OptionalCommunicationConsentSchema
})

function sanitizeRegistration(reg: string): string {
  return reg.replace(/\s+/g, '').toUpperCase()
}

function mapParkingCreateError(message: string) {
  if (message.includes('End time must be after start time') || message.includes('Invalid start or end time')) {
    return createErrorResponse(message, 'VALIDATION_ERROR', 400)
  }

  if (message.includes('Parking rates have not been configured')) {
    return createErrorResponse('Parking rates are not configured', 'CONFIGURATION_MISSING', 500)
  }

  if (message.includes('Parking rates are invalid')) {
    return createErrorResponse('Parking rates are invalid', 'CONFIGURATION_INVALID', 500)
  }

  if (message.includes('No parking spaces remaining')) {
    return createErrorResponse(
      'No parking spaces available for the requested period',
      'CAPACITY_UNAVAILABLE',
      409
    )
  }

  if (message.includes('Override price must be greater than zero')) {
    return createErrorResponse('Override price must be greater than zero', 'VALIDATION_ERROR', 400)
  }

  return null
}

type ParkingBookingSmsMeta = {
  sent: boolean
  skipped: boolean
  code: string | null
  logFailure: boolean
}

function replayedParkingBookingId(response: unknown): string | null {
  const data = (response as { data?: { booking_id?: unknown } } | null)?.data
  const bookingId = data?.booking_id
  return typeof bookingId === 'string' && bookingId.length > 0 ? bookingId : null
}

/**
 * Can the booking behind a stored idempotency response still be paid for?
 *
 * The website derives its Idempotency-Key from the booking details alone (dates, phone,
 * registration, consent), so a guest re-submitting the same booking presents the same key for
 * the whole 24-hour TTL. Website bookings only get a 30-minute payment window; once it lapses
 * the notifications cron marks the booking expired and the PayPal return handler refuses to
 * capture against it. Replaying that booking id therefore handed the guest a dead booking and a
 * stale approval URL, and every retry returned the same dead booking: a permanent dead end.
 *
 * Treat a booking that can no longer be paid for as a cache miss so a fresh one is created,
 * while still suppressing genuine duplicates of a booking that is alive.
 */
async function isParkingBookingStillPayable(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('parking_bookings')
    .select('id, status, payment_due_at')
    .eq('id', bookingId)
    .maybeSingle()

  if (error) {
    // We cannot prove the booking is dead, and replaying is the safe failure: it never
    // double-books or double-charges. Fall back to the previous behaviour.
    logger.warn('Failed to re-read parking booking behind replayed idempotency key', {
      metadata: { bookingId, error: error.message }
    })
    return true
  }

  // Row is gone (deleted or purged), so there is no duplicate to suppress.
  if (!data) {
    return false
  }

  if (data.status === 'expired' || data.status === 'cancelled') {
    return false
  }

  // Only a booking still awaiting payment can time out. A confirmed, paid or completed booking
  // keeps a payment_due_at in the past and must still be replayed, or a double submit after
  // payment would create a second booking.
  if (data.status === 'pending_payment') {
    const dueAtMs = data.payment_due_at ? Date.parse(data.payment_due_at) : Number.NaN
    // A missing or lapsed due date is terminal either way: the cron expires a lapsed one, and
    // createParkingPaymentOrder refuses to build an order without a payment_due_at at all.
    if (!Number.isFinite(dueAtMs) || dueAtMs <= Date.now()) {
      return false
    }
  }

  return true
}

/**
 * Delete the stored idempotency record, but only while it still points at the dead booking.
 *
 * A plain delete by key would let a second concurrent retry wipe the claim, or the finished
 * response, of the retry that got there first, and both would then create a booking. Matching on
 * the booking id makes the delete a no-op once another request has replaced the record with its
 * own processing claim (which carries no data.booking_id) or with a freshly created booking (a
 * different one). The re-claim that follows then reports in_progress or replay, as it should.
 */
async function clearDeadParkingIdempotencyRecord(
  supabase: ReturnType<typeof createAdminClient>,
  key: string,
  requestHash: string,
  deadBookingId: string
): Promise<void> {
  const { error } = await supabase
    .from('idempotency_keys')
    .delete()
    .eq('key', key)
    .eq('request_hash', requestHash)
    .filter('response->data->>booking_id', 'eq', deadBookingId)

  if (error) {
    throw error
  }
}

export async function POST(request: NextRequest) {
  return withApiAuth(async (req, apiKey) => {
    try {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
      }
      const parsed = CreateBookingSchema.safeParse(body)

      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors[0]?.message || 'Invalid booking payload',
          'VALIDATION_ERROR',
          400,
          { issues: parsed.error.errors }
        )
      }

      const payload = parsed.data
      const start = new Date(payload.start_at)
      const end = new Date(payload.end_at)

      if (end <= start) {
        return createErrorResponse('End time must be after start time', 'VALIDATION_ERROR', 400)
      }

      const supabase = createAdminClient()
      const idempotencyKey = req.headers.get('Idempotency-Key')
      const requestHashPayload = {
        start_at: payload.start_at,
        end_at: payload.end_at,
        mobile_number: payload.customer.mobile_number,
        registration: sanitizeRegistration(payload.vehicle.registration),
        communication_consent: consentHashPayload(payload.communication_consent)
      }
      const requestHash = computeIdempotencyRequestHash(requestHashPayload)
      let claimHeld = false
      let skipClaimRelease = false

      if (idempotencyKey) {
        let lookup = await claimIdempotencyKey(supabase, idempotencyKey, requestHash)

        if (lookup.state === 'replay') {
          const bookingId = replayedParkingBookingId(lookup.response)

          // No booking id means the stored response is not a booking we can check, so keep the
          // previous behaviour rather than risk creating a duplicate.
          if (!bookingId || (await isParkingBookingStillPayable(supabase, bookingId))) {
            return createApiResponse(lookup.response, 201)
          }

          // Drop the dead record and take the key afresh so this request books again. The stored
          // request_hash must equal ours, or claimIdempotencyKey would have said 'conflict'. A
          // failure here throws to the outer handler and the guest retries, which is honest: we
          // could not process the request.
          logger.info('Replacing parking idempotency record for an unpayable booking', {
            metadata: { idempotencyKey, bookingId }
          })
          await clearDeadParkingIdempotencyRecord(supabase, idempotencyKey, requestHash, bookingId)

          // Re-claim rather than simply carrying on, so two concurrent retries of the same dead
          // booking cannot both create one. Whatever the re-claim says is now authoritative.
          lookup = await claimIdempotencyKey(supabase, idempotencyKey, requestHash)

          if (lookup.state === 'replay') {
            // Lost the race: another retry already created the fresh booking. It was made
            // seconds ago, so it is inside its payment window. Return it.
            return createApiResponse(lookup.response, 201)
          }
        }

        if (lookup.state === 'conflict') {
          return createErrorResponse(
            'Idempotency key already used with a different request payload',
            'IDEMPOTENCY_KEY_CONFLICT',
            409
          )
        }

        if (lookup.state === 'in_progress') {
          return createErrorResponse(
            'This request is already being processed. Please retry shortly.',
            'IDEMPOTENCY_KEY_IN_PROGRESS',
            409
          )
        }

        claimHeld = true
      }

      try {
        let booking: ParkingBooking
        let smsMeta: ParkingBookingSmsMeta | null = null
        try {
          const result = await createPendingParkingBooking(
            {
              customer: {
                firstName: payload.customer.first_name,
                lastName: payload.customer.last_name,
                email: payload.customer.email,
                mobile: payload.customer.mobile_number,
                defaultCountryCode: payload.customer.default_country_code
              },
              vehicle: {
                registration: payload.vehicle.registration,
                make: payload.vehicle.make,
                model: payload.vehicle.model,
                colour: payload.vehicle.colour
              },
              startAt: payload.start_at,
              endAt: payload.end_at,
              notes: payload.notes,
              createdBy: null,
              updatedBy: null
            },
            { client: supabase }
          )
          booking = result.booking
          if (booking.customer_id) {
            await ConsentService.applyBookingContactConsent(
              booking.customer_id,
              payload.communication_consent,
              {
                source: payload.source === 'website' ? 'public_parking_booking' : 'staff_parking_booking',
                captureMethod: payload.source === 'website' ? 'checkbox' : 'staff_verbal',
                sourceUrl: req.headers.get('referer'),
                userAgent: req.headers.get('user-agent'),
                relatedEntityType: 'parking_booking',
                relatedEntityId: booking.id,
                metadata: { idempotency_key: idempotencyKey ?? null }
              }
            )
          }
        } catch (serviceError) {
          const message = serviceError instanceof Error ? serviceError.message : 'Failed to create parking booking'
          const mappedError = mapParkingCreateError(message)
          if (mappedError) {
            return mappedError
          }
          throw serviceError
        }

        // For website-sourced bookings use a 30-minute expiry.
        // The default 7-day window is only needed for the SMS-reminder flow.
        if (payload.source === 'website') {
          const thirtyMinsFromNow = new Date(Date.now() + 30 * 60 * 1000).toISOString()
          const { error: expiryError } = await supabase
            .from('parking_bookings')
            .update({ payment_due_at: thirtyMinsFromNow })
            .eq('id', booking.id)
          if (expiryError) {
            logger.error('Failed to set 30-minute expiry for website parking booking', {
              error: expiryError,
              metadata: { bookingId: booking.id }
            })
          }
          booking = { ...booking, payment_due_at: thirtyMinsFromNow }
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const paymentResult = await createParkingPaymentOrder(booking, {
          returnUrl: parkingPaymentReturnUrl(appUrl, booking.id),
          cancelUrl: parkingGuestUrl(appUrl, booking.id, 'cancelled'),
          client: supabase
        })

        // Only send payment-request SMS for staff-created bookings.
        // Website bookings collect payment inline; no SMS needed at this stage.
        if (payload.source !== 'website') {
          try {
            const notificationResult = await sendParkingPaymentRequest(booking, paymentResult.approveUrl, {
              client: supabase
            })
            const smsCode =
              notificationResult && typeof notificationResult.code === 'string'
                ? notificationResult.code
                : null
            const smsLogFailure =
              (notificationResult?.logFailure === true) || smsCode === 'logging_failed'
            const smsSent = notificationResult?.sent === true
            const smsSkipped = notificationResult?.skipped === true

            smsMeta = {
              sent: smsSent,
              skipped: smsSkipped,
              code: smsCode,
              logFailure: smsLogFailure
            }

            if (smsLogFailure) {
              logger.error('Initial parking payment request SMS sent but outbound message logging failed', {
                metadata: {
                  bookingId: booking.id,
                  code: smsCode,
                  logFailure: smsLogFailure
                }
              })
            } else if (!smsSent && !smsSkipped) {
              logger.warn('Initial parking payment request SMS did not send', {
                metadata: {
                  bookingId: booking.id,
                  code: smsCode
                }
              })
            }
          } catch (notificationError) {
            logger.error('Initial parking payment request SMS task threw unexpectedly', {
              error:
                notificationError instanceof Error
                  ? notificationError
                  : new Error(String(notificationError)),
              metadata: {
                bookingId: booking.id
              }
            })

            smsMeta = {
              sent: false,
              skipped: false,
              code: 'unexpected_exception',
              logFailure: false
            }
          }
        } else {
          smsMeta = { sent: false, skipped: true, code: 'source_website', logFailure: false }
        }

        const responsePayload = {
          success: true,
          data: {
            booking_id: booking.id,
            reference: booking.reference,
            amount: booking.override_price ?? booking.calculated_price,
            currency: 'GBP',
            pricing_breakdown: booking.pricing_breakdown,
            payment_due_at: booking.payment_due_at,
            paypal_approval_url: paymentResult.approveUrl,
            paypal_order_id: paymentResult.orderId
          },
          meta: {
            status_code: 201,
            sms: smsMeta
          }
        }

        if (idempotencyKey) {
          try {
            await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)
            claimHeld = false
          } catch (persistError) {
            // Returning 500 causes clients to retry, which can create duplicate bookings and
            // re-send payment request notifications when the main mutation has already committed.
            logger.error('Parking booking created but failed to persist idempotency response', {
              error: persistError instanceof Error ? persistError : new Error(String(persistError)),
              metadata: {
                idempotencyKey,
                bookingId: booking.id,
              }
            })
            skipClaimRelease = true
          }
        }

        try {
          await logAuditEvent({
            operation_type: 'create',
            resource_type: 'parking_booking',
            resource_id: booking.id,
            operation_status: 'success',
            additional_info: {
              source: 'api',
              api_key_id: apiKey.id
            },
            new_values: {
              reference: booking.reference,
              amount: booking.override_price ?? booking.calculated_price
            }
          })
        } catch (auditError) {
          // Booking + payment order may already be committed; do not return a retry-driving 500.
          logger.error('Failed to write parking booking API audit log', {
            error: auditError instanceof Error ? auditError : new Error(String(auditError)),
            metadata: { bookingId: booking.id }
          })
        }

        return createApiResponse(responsePayload, 201)
      } finally {
        if (claimHeld && idempotencyKey && !skipClaimRelease) {
          try {
            await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
          } catch (releaseError) {
            logger.error('Failed to release parking booking idempotency claim', {
              error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
              metadata: { idempotencyKey }
            })
          }
        }
      }
    } catch (error) {
      logger.error('Error creating parking booking via API', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return createErrorResponse('Failed to create parking booking', 'INTERNAL_ERROR', 500)
    }
  }, ['parking:create'], request)
}
