import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'

const CustomerLookupQuerySchema = z.object({
  phone: z.string().trim().min(5).max(32),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional()
})

type CustomerLookupRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  mobile_number: string | null
  mobile_e164: string | null
}

type PrivateBookingLookupRow = {
  id: string
  customer_id: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  customer_name: string | null
  contact_email: string | null
  contact_phone: string | null
}

function buildFullName(customer: CustomerLookupRow): string | null {
  const parts = [customer.first_name || '', customer.last_name || '']
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return null
  return parts.join(' ')
}

function parseNameParts(fullName: string | null | undefined): { firstName?: string; lastName?: string } {
  if (!fullName) return {}

  const parts = fullName
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return {}

  const [firstName, ...rest] = parts
  const lastName = rest.length > 0 ? rest.join(' ') : undefined
  return { firstName, lastName }
}

function toLookupPayload(customer: CustomerLookupRow | null, normalizedPhone: string) {
  const fullName = customer ? buildFullName(customer) : null

  return {
    known: Boolean(customer),
    normalized_phone: normalizedPhone,
    customer: customer
      ? {
          id: customer.id,
          first_name: customer.first_name,
          last_name: customer.last_name,
          full_name: fullName,
          email: customer.email,
          mobile_e164: customer.mobile_e164 || normalizedPhone,
          mobile_number: customer.mobile_number
        }
      : null
  }
}

export async function GET(request: NextRequest) {
  return withApiAuth(async (_req, apiKey) => {
    const hasLookupPermission =
      apiKey.permissions.includes('*') ||
      apiKey.permissions.includes('create:bookings') ||
      apiKey.permissions.includes('read:events')

    if (!hasLookupPermission) {
      return createErrorResponse('Insufficient permissions', 'FORBIDDEN', 403)
    }

    const phone = request.nextUrl.searchParams.get('phone')?.trim() || ''
    const defaultCountryCode =
      request.nextUrl.searchParams.get('default_country_code')?.trim() || undefined

    const parsed = CustomerLookupQuerySchema.safeParse({
      phone,
      default_country_code: defaultCountryCode
    })

    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.issues[0]?.message || 'Invalid customer lookup query',
        'VALIDATION_ERROR',
        400,
        { issues: parsed.error.issues }
      )
    }

    let normalizedPhone: string
    try {
      normalizedPhone = formatPhoneForStorage(parsed.data.phone, {
        defaultCountryCode: parsed.data.default_country_code
      })
    } catch {
      return createErrorResponse('Please enter a valid phone number', 'VALIDATION_ERROR', 400)
    }

    const variants = generatePhoneVariants(normalizedPhone, {
      defaultCountryCode: parsed.data.default_country_code
    })
    const uniqueVariants = [...new Set(variants.filter((value) => value.trim().length > 0))]

    const mobileE164Variants = uniqueVariants
      .map((value) => {
        try {
          return formatPhoneForStorage(value, {
            defaultCountryCode: parsed.data.default_country_code
          })
        } catch {
          return null
        }
      })
      .filter((value): value is string => Boolean(value))

    const supabase = createAdminClient()
    const { data: canonicalData, error: canonicalError } = await (supabase.from('customers') as any)
      .select('id, first_name, last_name, email, mobile_number, mobile_e164, created_at')
      .in('mobile_e164', mobileE164Variants)
      .order('created_at', { ascending: false })
      .limit(1)

    if (canonicalError) {
      return createErrorResponse('Failed to look up customer', 'DATABASE_ERROR', 500)
    }

    const canonicalCustomer = ((canonicalData || [])[0] || null) as CustomerLookupRow | null
    if (canonicalCustomer) {
      return createApiResponse(toLookupPayload(canonicalCustomer, normalizedPhone))
    }

    const { data: legacyData, error: legacyError } = await (supabase.from('customers') as any)
      .select('id, first_name, last_name, email, mobile_number, mobile_e164, created_at')
      .in('mobile_number', uniqueVariants)
      .order('created_at', { ascending: false })
      .limit(1)

    if (legacyError) {
      return createErrorResponse('Failed to look up customer', 'DATABASE_ERROR', 500)
    }

    const legacyCustomer = ((legacyData || [])[0] || null) as CustomerLookupRow | null
    if (legacyCustomer) {
      return createApiResponse(toLookupPayload(legacyCustomer, normalizedPhone))
    }

    // Legacy fallback: recover known customer context from older private bookings.
    const { data: privateBookingData, error: privateBookingError } = await (supabase.from('private_bookings') as any)
      .select(
        'id, customer_id, customer_first_name, customer_last_name, customer_name, contact_email, contact_phone, created_at'
      )
      .in('contact_phone', uniqueVariants)
      .order('created_at', { ascending: false })
      .limit(1)

    if (privateBookingError) {
      return createErrorResponse('Failed to look up customer', 'DATABASE_ERROR', 500)
    }

    const privateBooking = ((privateBookingData || [])[0] || null) as PrivateBookingLookupRow | null
    if (!privateBooking) {
      return createApiResponse(toLookupPayload(null, normalizedPhone))
    }

    const parsedName = parseNameParts(privateBooking.customer_name)
    const fallbackFirstName =
      privateBooking.customer_first_name?.trim() || parsedName.firstName
    const fallbackLastName =
      privateBooking.customer_last_name?.trim() || parsedName.lastName
    const fallbackEmail = privateBooking.contact_email?.trim() || null
    const hasIdentityData = Boolean(fallbackFirstName || fallbackLastName || fallbackEmail)

    // If there is no usable identity data, keep this as unknown so we still ask for details.
    if (!hasIdentityData) {
      return createApiResponse(toLookupPayload(null, normalizedPhone))
    }

    let resolvedCustomerId = privateBooking.customer_id || null

    if (!resolvedCustomerId) {
      const ensuredCustomer = await ensureCustomerForPhone(supabase, normalizedPhone, {
        firstName: fallbackFirstName,
        lastName: fallbackLastName,
        email: fallbackEmail
      })
      resolvedCustomerId = ensuredCustomer.customerId
    }

    if (resolvedCustomerId) {
      const { data: resolvedData, error: resolvedError } = await (supabase.from('customers') as any)
        .select('id, first_name, last_name, email, mobile_number, mobile_e164, created_at')
        .eq('id', resolvedCustomerId)
        .limit(1)

      if (!resolvedError) {
        const resolvedCustomer = ((resolvedData || [])[0] || null) as CustomerLookupRow | null
        if (resolvedCustomer) {
          return createApiResponse(toLookupPayload(resolvedCustomer, normalizedPhone))
        }
      }
    }

    // Final fallback: still treat as known using legacy private booking identity.
    return createApiResponse({
      known: true,
      normalized_phone: normalizedPhone,
      customer: {
        id: resolvedCustomerId || undefined,
        first_name: fallbackFirstName || null,
        last_name: fallbackLastName || null,
        full_name: [fallbackFirstName || '', fallbackLastName || ''].filter(Boolean).join(' ') || null,
        email: fallbackEmail,
        mobile_e164: normalizedPhone,
        mobile_number: privateBooking.contact_phone || normalizedPhone
      }
    })
  }, [], request)
}
