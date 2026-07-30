import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohVoucherPermission } from '@/lib/foh/api-auth'
import { quickAddVoucherCustomer, QuickAddCustomerError } from '@/lib/vouchers/customer-quick-add'
import { validationError, serverError } from '../shared'

// Thin FOH wrapper. The find-or-create behaviour and its consent rules live in
// @/lib/vouchers/customer-quick-add so the back-office Hand-out mode behaves
// identically (spec 5.1, F16).
const QuickAddSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(120),
  mobile: z.string().trim().min(7, 'Enter a valid mobile number').max(32),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(255)
    .optional()
    .or(z.literal(''))
})

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

  try {
    const result = await quickAddVoucherCustomer(auth.supabase, {
      name: parsed.data.name,
      mobile: parsed.data.mobile,
      email: parsed.data.email || null
    })
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof QuickAddCustomerError) {
      return validationError(error.message)
    }
    return serverError('Failed to add the customer')
  }
}
