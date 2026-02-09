import { NextRequest, NextResponse } from 'next/server'
import { formatPhoneForStorage } from '@/lib/utils'
import { requireEventsManagePermission } from '@/lib/events/api-auth'

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
}

function normalizeSearchTerm(value: string): string {
  return value.replace(/[,%_]/g, '').trim()
}

function buildFullName(customer: CustomerRow): string {
  const parts = [customer.first_name || '', customer.last_name || '']
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown customer'
}

function scoreCustomerMatch(customer: CustomerRow, rawTerm: string, normalizedPhone: string | null): number {
  const term = rawTerm.toLowerCase()
  const fullName = buildFullName(customer).toLowerCase()
  const mobileE164 = (customer.mobile_e164 || '').toLowerCase()
  const mobileNumber = (customer.mobile_number || '').toLowerCase()
  const digits = term.replace(/\D/g, '')

  let score = 0
  if (normalizedPhone && mobileE164 === normalizedPhone.toLowerCase()) {
    score += 300
  }
  if (digits.length >= 4 && (mobileE164.includes(digits) || mobileNumber.includes(digits))) {
    score += 120
  }
  if (fullName === term) {
    score += 200
  } else if (fullName.startsWith(term)) {
    score += 120
  } else if (fullName.includes(term)) {
    score += 60
  }

  return score
}

export async function GET(request: NextRequest) {
  const auth = await requireEventsManagePermission()
  if (!auth.ok) {
    return auth.response
  }

  const rawQuery = request.nextUrl.searchParams.get('q')?.trim() || ''
  const defaultCountryCode = request.nextUrl.searchParams.get('default_country_code')?.trim() || undefined

  if (rawQuery.length < 2) {
    return NextResponse.json({ success: true, data: [] })
  }

  const searchTerm = normalizeSearchTerm(rawQuery)
  if (searchTerm.length < 2) {
    return NextResponse.json({ success: true, data: [] })
  }

  let normalizedPhone: string | null = null
  try {
    normalizedPhone = formatPhoneForStorage(rawQuery, {
      defaultCountryCode
    })
  } catch {
    normalizedPhone = null
  }

  const orFilters = [
    `first_name.ilike.%${searchTerm}%`,
    `last_name.ilike.%${searchTerm}%`,
    `mobile_number.ilike.%${searchTerm}%`,
    `mobile_e164.ilike.%${searchTerm}%`
  ]

  if (normalizedPhone) {
    orFilters.push(`mobile_e164.eq.${normalizedPhone}`)
    orFilters.push(`mobile_number.eq.${normalizedPhone}`)
  }

  const { data, error } = await (auth.supabase.from('customers') as any)
    .select('id, first_name, last_name, mobile_number, mobile_e164, created_at')
    .or(orFilters.join(','))
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: 'Failed to search customers' }, { status: 500 })
  }

  const rows = ((data || []) as CustomerRow[])
    .map((customer) => ({
      customer,
      score: scoreCustomerMatch(customer, searchTerm, normalizedPhone)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ customer }) => ({
      id: customer.id,
      first_name: customer.first_name,
      last_name: customer.last_name,
      full_name: buildFullName(customer),
      mobile_number: customer.mobile_number,
      mobile_e164: customer.mobile_e164,
      display_phone: customer.mobile_e164 || customer.mobile_number || null
    }))

  return NextResponse.json({
    success: true,
    data: rows
  })
}
