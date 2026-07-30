import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohVoucherPermission } from '@/lib/foh/api-auth'
import type { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'
import { validationError, serverError, buildCustomerName } from '../shared'

type AdminClient = ReturnType<typeof createAdminClient>

// Quick-add find-or-create for voucher assignment (spec 5.1, F16). This is a
// dedicated vouchers.edit path, not the customers.manage path. The consent tick
// sets sms_opt_in on NEWLY CREATED customers only; existing customers always
// keep their current flag.
const QuickAddSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(120),
  mobile: z.string().trim().min(7, 'Enter a valid mobile number').max(32),
  smsOk: z.boolean()
})

type CustomerHit = { id: string; first_name: string | null; last_name: string | null }

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' ')
  }
}

async function findByPhone(supabase: AdminClient, variants: string[]): Promise<CustomerHit | null> {
  const quoted = variants.map((variant) => `"${variant}"`).join(',')
  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name')
    .or(`mobile_e164.in.(${quoted}),mobile_number.in.(${quoted})`)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    throw error
  }

  const rows = (data ?? []) as CustomerHit[]
  return rows[0] ?? null
}

export async function POST(request: NextRequest) {
  const auth = await requireFohVoucherPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = QuickAddSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message || 'Invalid customer details')
  }

  const payload = parsed.data

  let normalisedPhone: string
  try {
    normalisedPhone = formatPhoneForStorage(payload.mobile)
  } catch {
    return validationError('Please enter a valid mobile number')
  }

  let variants: string[]
  try {
    variants = generatePhoneVariants(payload.mobile)
  } catch {
    variants = []
  }
  const searchNumbers = Array.from(new Set([normalisedPhone, ...variants]))

  try {
    const existing = await findByPhone(auth.supabase, searchNumbers)
    if (existing) {
      return NextResponse.json({
        success: true,
        data: {
          id: existing.id,
          name: buildCustomerName(existing.first_name, existing.last_name),
          existing: true
        }
      })
    }
  } catch {
    return serverError('Failed to check for an existing customer')
  }

  const { firstName, lastName } = splitName(payload.name)

  const { data: created, error: insertError } = await auth.supabase
    .from('customers')
    .insert({
      first_name: firstName,
      last_name: lastName,
      mobile_number: normalisedPhone,
      mobile_e164: normalisedPhone,
      sms_opt_in: payload.smsOk
    })
    .select('id, first_name, last_name')
    .maybeSingle()

  if (!insertError && created) {
    const row = created as CustomerHit
    return NextResponse.json({
      success: true,
      data: {
        id: row.id,
        name: buildCustomerName(row.first_name, row.last_name),
        existing: false
      }
    })
  }

  // Race-safe: a unique violation means someone created this customer between our
  // check and insert; re-select and return the existing row (F16).
  if ((insertError as { code?: string } | null)?.code === '23505') {
    try {
      const existing = await findByPhone(auth.supabase, searchNumbers)
      if (existing) {
        return NextResponse.json({
          success: true,
          data: {
            id: existing.id,
            name: buildCustomerName(existing.first_name, existing.last_name),
            existing: true
          }
        })
      }
    } catch {
      return serverError('Failed to add the customer')
    }
  }

  return serverError('Failed to add the customer')
}
